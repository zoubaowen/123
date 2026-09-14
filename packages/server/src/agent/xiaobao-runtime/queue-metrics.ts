import type { XiaobaoQueueClaim, XiaobaoQueueItem, XiaobaoTaskQueue } from './task-queue.js'

/** 队列只读观测快照：用于健康检查与容量判断。 */
export interface XiaobaoQueueMetrics {
  readonly depth: number
  /** worker 成功领到任务的次数。 */
  readonly claimsAllowed: number
  /** 空队列或全被租约占用而领不到的次数。 */
  readonly claimsDenied: number
  readonly completed: number
  readonly released: number
}

/**
 * 可观测队列：在基础契约之上暴露只读快照。
 *
 * 租约过期后的"重新领取"次数由具体队列实现统计（它才知道一条记录是否曾经过期），
 * 因此不在这个装饰器里伪造。
 */
export interface ObservableXiaobaoTaskQueue extends XiaobaoTaskQueue {
  snapshot(): Promise<XiaobaoQueueMetrics>
}

/**
 * 给任意队列（内存实现或未来的 Redis 实现）套上计数。
 *
 * 只做计数与转发，**不改变任何队列语义**：失败路径与副作用与原实现完全一致。
 */
export class MeteredXiaobaoTaskQueue implements ObservableXiaobaoTaskQueue {
  private claimsAllowed = 0
  private claimsDenied = 0
  private completed = 0
  private released = 0

  constructor(private readonly inner: XiaobaoTaskQueue) {}

  async enqueue(item: XiaobaoQueueItem): Promise<void> {
    return this.inner.enqueue(item)
  }

  async claim(workerId: string, now: number, leaseMs: number): Promise<XiaobaoQueueClaim> {
    const claim = await this.inner.claim(workerId, now, leaseMs)
    if (claim.ok) this.claimsAllowed += 1
    else this.claimsDenied += 1
    return claim
  }

  async complete(leaseId: string): Promise<void> {
    await this.inner.complete(leaseId)
    this.completed += 1
  }

  async release(leaseId: string): Promise<void> {
    await this.inner.release(leaseId)
    this.released += 1
  }

  async depth(): Promise<number> {
    return this.inner.depth()
  }

  async healthCheck(): Promise<boolean> {
    return this.inner.healthCheck()
  }

  async snapshot(): Promise<XiaobaoQueueMetrics> {
    return {
      depth: await this.inner.depth(),
      claimsAllowed: this.claimsAllowed,
      claimsDenied: this.claimsDenied,
      completed: this.completed,
      released: this.released,
    }
  }
}
