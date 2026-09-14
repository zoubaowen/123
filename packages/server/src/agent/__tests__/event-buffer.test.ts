import type { ExtendedSessionUpdate, StreamEvent } from '@ai-xiaobao/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

const writes = vi.hoisted(() => {
  const batches: StreamEvent[][] = []
  const releases: Array<() => void> = []
  return { batches, releases }
})

vi.mock('../persistence.service.js', () => ({
  persistenceService: {
    appendStreamEvents: vi.fn(async (batch: StreamEvent[]) => {
      writes.batches.push(structuredClone(batch))
      await new Promise<void>((resolve) => writes.releases.push(resolve))
    }),
  },
}))

import { getAgentRun, registerAgent, removeAgent } from '../agent-registry.js'
import { EventBuffer } from '../event-buffer.js'

const taskId = 'event-buffer-task'

afterEach(() => {
  const run = getAgentRun(taskId)
  if (run) run.status = 'completed'
  removeAgent(taskId)
  writes.batches.length = 0
  writes.releases.length = 0
  vi.clearAllMocks()
})

describe('EventBuffer durable close', () => {
  it('waits for an earlier timed flush and the close batch before resolving', async () => {
    registerAgent({
      conversationId: taskId,
      turnId: 'turn-1',
      envId: 'local',
      userId: 'student-1',
      abortController: new AbortController(),
    })
    const buffer = new EventBuffer(taskId, 'turn-1', 'local', 'student-1')
    buffer.push({ sessionUpdate: 'agent_phase', phase: 'running', timestamp: 1 } as ExtendedSessionUpdate)
    buffer.push({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: '第二批' },
    } as ExtendedSessionUpdate)

    let closed = false
    const closing = buffer.close().then(() => {
      closed = true
    })
    await Promise.resolve()

    // A single serialized chain keeps the close batch behind the earlier write.
    // The old implementation launched both writes and overwrote flushPromise.
    expect(writes.batches).toHaveLength(1)
    expect(closed).toBe(false)

    writes.releases[0]?.()
    await vi.waitFor(() => expect(writes.batches).toHaveLength(2))
    expect(closed).toBe(false)

    writes.releases[1]?.()
    await closing

    expect(writes.batches.map((batch) => batch.map((event) => event.seq))).toEqual([[0], [1]])
    expect(closed).toBe(true)
  })
})
