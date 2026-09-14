import type { ObservableXiaobaoTaskQueue, XiaobaoQueueMetrics } from './queue-metrics.js'
import type { XiaobaoQueueItem } from './task-queue.js'

export interface XiaobaoQueueLoadOptions {
  /** 入队任务数。 */
  readonly tasks: number
  /** 并发 worker 数。 */
  readonly workers: number
  /** 租约时长；负荷测试里取足够大，避免正常处理被误判为崩溃。 */
  readonly leaseMs: number
  readonly capability?: XiaobaoQueueItem['capability']
  readonly now?: () => number
}

export interface XiaobaoQueueLoadResult {
  readonly enqueued: number
  /** 每个任务恰好被处理一次时等于 enqueued。 */
  readonly processed: number
  /** 同一任务被两个 worker 各领到一次的次数；**必须为 0**。 */
  readonly duplicateClaims: number
  /** 处理结束后仍未完成的残留任务数；**必须为 0**。 */
  readonly leftover: number
  readonly elapsedMs: number
  readonly metrics: XiaobaoQueueMetrics
}

/**
 * 队列负荷模拟：N 个任务 × W 个并发 worker，全部走 `claim → complete`。
 *
 * 它同时是**正确性验证**：并发领取下每个任务必须恰好被处理一次
 * （`duplicateClaims === 0` 且 `processed === tasks` 且无残留），否则说明队列的领取/租约语义有洞。
 * 单进程内可完整跑；跨进程一致性需要共享存储实现（见 task-queue.ts 的边界说明）。
 */
export async function simulateXiaobaoQueueLoad(
  queue: ObservableXiaobaoTaskQueue,
  options: XiaobaoQueueLoadOptions,
): Promise<XiaobaoQueueLoadResult> {
  const now = options.now ?? Date.now
  const capability = options.capability ?? 'writing'
  const processedTaskIds = new Set<string>()
  let duplicateClaims = 0

  for (let index = 0; index < options.tasks; index += 1) {
    await queue.enqueue({
      taskId: `load-${index}`,
      userId: `student-${index % Math.max(1, options.workers)}`,
      capability,
      enqueuedAt: now(),
    })
  }

  const startedAt = now()

  const worker = async (workerId: string): Promise<void> => {
    for (;;) {
      const claim = await queue.claim(workerId, now(), options.leaseMs)
      if (!claim.ok) return
      if (processedTaskIds.has(claim.item.taskId)) duplicateClaims += 1
      processedTaskIds.add(claim.item.taskId)
      await queue.complete(claim.leaseId)
    }
  }

  await Promise.all(Array.from({ length: options.workers }, (_, index) => worker(`load-worker-${index}`)))

  return {
    enqueued: options.tasks,
    processed: processedTaskIds.size,
    duplicateClaims,
    leftover: await queue.depth(),
    elapsedMs: now() - startedAt,
    metrics: await queue.snapshot(),
  }
}
