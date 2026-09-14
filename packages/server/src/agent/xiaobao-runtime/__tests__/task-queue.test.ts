import { describe, expect, it } from 'vitest'
import { InMemoryXiaobaoTaskQueue, type XiaobaoQueueItem } from '../task-queue.js'

const LEASE_MS = 30_000

function item(taskId: string, overrides: Partial<XiaobaoQueueItem> = {}): XiaobaoQueueItem {
  return { taskId, userId: 'student-1', capability: 'writing', enqueuedAt: 1, ...overrides }
}

describe('InMemoryXiaobaoTaskQueue', () => {
  it('claims items in enqueue order', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    await queue.enqueue(item('task-2'))

    const first = await queue.claim('worker-a', 0, LEASE_MS)
    const second = await queue.claim('worker-a', 0, LEASE_MS)

    expect(first).toMatchObject({ ok: true, item: { taskId: 'task-1' } })
    expect(second).toMatchObject({ ok: true, item: { taskId: 'task-2' } })
    expect(first.ok && second.ok && first.leaseId).not.toBe(second.ok && second.leaseId)
  })

  it('reports an empty queue instead of inventing work', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()

    await expect(queue.claim('worker-a', 0, LEASE_MS)).resolves.toEqual({ ok: false })
  })

  it('is idempotent per task id', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    await queue.enqueue(item('task-1'))

    await expect(queue.depth()).resolves.toBe(1)
    await expect(queue.claim('worker-a', 0, LEASE_MS)).resolves.toMatchObject({ ok: true })
    await expect(queue.claim('worker-b', 0, LEASE_MS)).resolves.toEqual({ ok: false })
  })

  it('keeps a claimed item leased until it completes or the lease expires', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))

    await queue.claim('worker-a', 1_000, LEASE_MS)

    // 租约仍有效：其他 worker 领不到
    await expect(queue.claim('worker-b', 1_000 + LEASE_MS - 1, LEASE_MS)).resolves.toEqual({ ok: false })
    // 租约到期：崩溃 worker 的任务必须能被重新领取
    await expect(queue.claim('worker-b', 1_000 + LEASE_MS, LEASE_MS)).resolves.toMatchObject({
      ok: true,
      item: { taskId: 'task-1' },
    })
  })

  it('completes a lease and frees the task id for a future enqueue', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    const claim = await queue.claim('worker-a', 0, LEASE_MS)
    if (!claim.ok) throw new Error('Expected a claim')

    await queue.complete(claim.leaseId)

    await expect(queue.depth()).resolves.toBe(0)
    await queue.enqueue(item('task-1'))
    await expect(queue.depth()).resolves.toBe(1)
  })

  it('releases a failed task so another worker retries without waiting for the lease', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    const claim = await queue.claim('worker-a', 0, LEASE_MS)
    if (!claim.ok) throw new Error('Expected a claim')

    await queue.release(claim.leaseId)

    await expect(queue.depth()).resolves.toBe(1)
    await expect(queue.claim('worker-b', 0, LEASE_MS)).resolves.toMatchObject({ ok: true, item: { taskId: 'task-1' } })
  })

  it('ignores complete and release for unknown or already-settled leases', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    const claim = await queue.claim('worker-a', 0, LEASE_MS)
    if (!claim.ok) throw new Error('Expected a claim')

    await queue.complete('unknown-lease')
    await queue.release('unknown-lease')
    await expect(queue.depth()).resolves.toBe(1)

    // 同一租约重复 complete/release 不得产生副作用（含不得删除别人的任务）
    await queue.complete(claim.leaseId)
    await queue.release(claim.leaseId)
    await queue.complete(claim.leaseId)
    await expect(queue.depth()).resolves.toBe(0)
  })

  it('reports queue depth and health', async () => {
    const queue = new InMemoryXiaobaoTaskQueue()
    await queue.enqueue(item('task-1'))
    await queue.enqueue(item('task-2'))

    await expect(queue.depth()).resolves.toBe(2)
    await expect(queue.healthCheck()).resolves.toBe(true)
  })
})
