import { describe, expect, it, vi } from 'vitest'
import { MeteredXiaobaoTaskQueue } from '../queue-metrics.js'
import { InMemoryXiaobaoTaskQueue, type XiaobaoQueueItem, type XiaobaoTaskQueue } from '../task-queue.js'

const LEASE_MS = 30_000

function item(taskId: string): XiaobaoQueueItem {
  return { taskId, userId: 'student-1', capability: 'writing', enqueuedAt: 1 }
}

function harness() {
  const inner = new InMemoryXiaobaoTaskQueue()
  return { inner, queue: new MeteredXiaobaoTaskQueue(inner) }
}

describe('MeteredXiaobaoTaskQueue', () => {
  it('counts allowed and denied claims', async () => {
    const { queue } = harness()
    await queue.enqueue(item('task-1'))

    await queue.claim('worker-a', 0, LEASE_MS)
    await queue.claim('worker-b', 0, LEASE_MS)
    await queue.claim('worker-c', 0, LEASE_MS)

    await expect(queue.snapshot()).resolves.toMatchObject({ claimsAllowed: 1, claimsDenied: 2, depth: 1 })
  })

  it('counts completions and releases', async () => {
    const { queue } = harness()
    await queue.enqueue(item('task-1'))
    await queue.enqueue(item('task-2'))

    const first = await queue.claim('worker-a', 0, LEASE_MS)
    const second = await queue.claim('worker-a', 0, LEASE_MS)
    if (!first.ok || !second.ok) throw new Error('Expected two claims')

    await queue.complete(first.leaseId)
    await queue.release(second.leaseId)

    await expect(queue.snapshot()).resolves.toMatchObject({ completed: 1, released: 1, depth: 1 })
  })

  it('reflects the underlying depth without caching it', async () => {
    const { inner, queue } = harness()
    await queue.enqueue(item('task-1'))

    const before = await queue.snapshot()
    await inner.enqueue(item('task-2'))
    const after = await queue.snapshot()

    expect(before.depth).toBe(1)
    expect(after.depth).toBe(2)
  })

  it('forwards enqueue and health without changing queue behaviour', async () => {
    const inner = new InMemoryXiaobaoTaskQueue()
    const enqueue = vi.spyOn(inner, 'enqueue')
    const queue = new MeteredXiaobaoTaskQueue(inner)

    await queue.enqueue(item('task-1'))
    await queue.enqueue(item('task-1'))

    expect(enqueue).toHaveBeenCalledTimes(2)
    // 幂等语义仍由底层实现保证：重复入队不会变成两个任务
    await expect(queue.depth()).resolves.toBe(1)
    await expect(queue.healthCheck()).resolves.toBe(true)
  })

  it('propagates underlying failures instead of masking them as metrics', async () => {
    const failing: XiaobaoTaskQueue = {
      enqueue: vi.fn(async () => undefined),
      claim: vi.fn(async () => {
        throw new Error('queue unavailable')
      }),
      complete: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
      depth: vi.fn(async () => 0),
      healthCheck: vi.fn(async () => false),
    }
    const queue = new MeteredXiaobaoTaskQueue(failing)

    await expect(queue.claim('worker-a', 0, LEASE_MS)).rejects.toThrow('queue unavailable')
    // 抛错的领取不计入成功，也不伪造为拒绝
    await expect(queue.snapshot()).resolves.toMatchObject({ claimsAllowed: 0, claimsDenied: 0 })
    await expect(queue.healthCheck()).resolves.toBe(false)
  })
})
