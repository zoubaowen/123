import { describe, expect, it } from 'vitest'
import { MeteredXiaobaoTaskQueue } from '../queue-metrics.js'
import { simulateXiaobaoQueueLoad } from '../queue-load-simulation.js'
import { InMemoryXiaobaoTaskQueue } from '../task-queue.js'

function harness() {
  return new MeteredXiaobaoTaskQueue(new InMemoryXiaobaoTaskQueue())
}

describe('simulateXiaobaoQueueLoad', () => {
  it('processes every task exactly once with concurrent workers', async () => {
    const result = await simulateXiaobaoQueueLoad(harness(), { tasks: 200, workers: 8, leaseMs: 60_000 })

    expect(result.enqueued).toBe(200)
    expect(result.processed).toBe(200)
    expect(result.duplicateClaims).toBe(0)
    expect(result.leftover).toBe(0)
    expect(result.metrics.completed).toBe(200)
    expect(result.metrics.claimsAllowed).toBe(200)
  })

  it('leaves no work behind when there are more workers than tasks', async () => {
    const result = await simulateXiaobaoQueueLoad(harness(), { tasks: 3, workers: 10, leaseMs: 60_000 })

    expect(result.processed).toBe(3)
    expect(result.leftover).toBe(0)
    expect(result.metrics.completed).toBe(3)
    // 多出来的 worker 空手而归，而不是领到重复任务
    expect(result.metrics.claimsDenied).toBeGreaterThan(0)
  })

  it('handles an empty workload without inventing claims', async () => {
    const result = await simulateXiaobaoQueueLoad(harness(), { tasks: 0, workers: 4, leaseMs: 60_000 })

    expect(result.processed).toBe(0)
    expect(result.metrics.claimsAllowed).toBe(0)
    expect(result.leftover).toBe(0)
  })

  it('uses the injected clock so elapsed time is deterministic', async () => {
    let ticks = 0
    const result = await simulateXiaobaoQueueLoad(harness(), {
      tasks: 5,
      workers: 2,
      leaseMs: 60_000,
      now: () => (ticks += 1),
    })

    expect(result.processed).toBe(5)
    expect(result.elapsedMs).toBeGreaterThan(0)
  })
})
