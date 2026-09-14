import type { XiaobaoCapability } from './domain.js'

/**
 * 待执行任务的入队项。只带调度必需的字段：worker 领取后按 taskId 从检查点恢复执行，
 * 不在这里复制提示词或用户内容（避免敏感数据进入队列存储）。
 */
export interface XiaobaoQueueItem {
  readonly taskId: string
  readonly userId: string
  readonly capability: XiaobaoCapability
  readonly enqueuedAt: number
}

export type XiaobaoQueueClaim =
  | { readonly ok: true; readonly item: XiaobaoQueueItem; readonly leaseId: string }
  | { readonly ok: false }

/**
 * 任务队列契约。
 *
 * 语义要求：
 * - **同一 taskId 幂等入队**：重复入队不得产生第二个待执行项；
 * - **领取带租约**：worker 崩溃后租约到期，该项必须能被其他 worker 重新领取；
 * - `complete` 与 `release` 都必须按 leaseId 生效，且对过期/未知租约是**无副作用**的。
 *
 * 内存实现用于单机与测试；多节点部署需替换为 Redis 等共享实现（同一契约）。
 */
export interface XiaobaoTaskQueue {
  enqueue(item: XiaobaoQueueItem): Promise<void>
  claim(workerId: string, now: number, leaseMs: number): Promise<XiaobaoQueueClaim>
  complete(leaseId: string): Promise<void>
  /** 执行失败：把任务放回队列，让其他 worker（或本 worker 之后）重试。 */
  release(leaseId: string): Promise<void>
  depth(): Promise<number>
  healthCheck(): Promise<boolean>
}

interface QueueEntry {
  readonly item: XiaobaoQueueItem
  /** 为空表示待领取；有值表示已被某 worker 持有。 */
  leaseId: string | null
  leaseExpiresAt: number
  leaseOwner: string | null
}

/**
 * 单进程内存实现。
 *
 * 关键点：`claim` 会用**同步**代码段完成"选出一条 → 打上租约"，中间没有 await，
 * 因此在 Node 的单线程模型下天然原子 —— 同一进程内两个 worker 不可能领到同一条。
 * 跨进程原子性必须由共享存储实现提供，这是内存实现的已知边界。
 */
export class InMemoryXiaobaoTaskQueue implements XiaobaoTaskQueue {
  private readonly entries: QueueEntry[] = []
  private readonly taskIds = new Set<string>()
  private leaseCounter = 0

  constructor(private readonly idFactory: () => string = () => `lease-${++this.leaseCounter}`) {}

  async enqueue(item: XiaobaoQueueItem): Promise<void> {
    // 幂等：同 taskId 已在队列/执行中时不再插入第二项。
    if (this.taskIds.has(item.taskId)) return
    this.taskIds.add(item.taskId)
    this.entries.push({ item, leaseId: null, leaseExpiresAt: 0, leaseOwner: null })
  }

  async claim(workerId: string, now: number, leaseMs: number): Promise<XiaobaoQueueClaim> {
    for (const entry of this.entries) {
      const leaseActive = entry.leaseId !== null && entry.leaseExpiresAt > now
      if (leaseActive) continue

      const leaseId = this.idFactory()
      entry.leaseId = leaseId
      entry.leaseExpiresAt = now + leaseMs
      entry.leaseOwner = workerId
      return { ok: true, item: entry.item, leaseId }
    }
    return { ok: false }
  }

  async complete(leaseId: string): Promise<void> {
    const index = this.entries.findIndex((entry) => entry.leaseId === leaseId)
    if (index < 0) return
    this.taskIds.delete(this.entries[index]!.item.taskId)
    this.entries.splice(index, 1)
  }

  async release(leaseId: string): Promise<void> {
    const entry = this.entries.find((candidate) => candidate.leaseId === leaseId)
    if (!entry) return
    // 放回队尾并清掉租约：让其他 worker 可以立刻重试，且不需要等租约到期。
    entry.leaseId = null
    entry.leaseExpiresAt = 0
    entry.leaseOwner = null
    const index = this.entries.indexOf(entry)
    this.entries.splice(index, 1)
    this.entries.push(entry)
  }

  async depth(): Promise<number> {
    return this.entries.length
  }

  async healthCheck(): Promise<boolean> {
    return true
  }
}
