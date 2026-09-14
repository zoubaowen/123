import { describe, expect, it } from 'vitest'
import { xiaobaoTaskSnapshotSchema } from '../domain.js'
import { createTaskSnapshot, transitionTask } from '../state-machine.js'

describe('xiaobao task state machine', () => {
  it('adds usage defaults when parsing legacy schema version 1 checkpoints', () => {
    const legacy = {
      schemaVersion: 1,
      taskId: 'legacy-task',
      userId: 'student-1',
      capability: 'learning',
      prompt: '学习分数',
      status: 'running',
      revision: 4,
      turnCount: 1,
      observations: [],
      resultText: null,
      createdAt: 100,
      updatedAt: 140,
      currentStepId: null,
    }

    expect(xiaobaoTaskSnapshotSchema.parse(legacy)).toMatchObject({
      schemaVersion: 1,
      usageReservationId: null,
      modelUsageTokens: 0,
      hasExactModelUsage: false,
    })
    expect(createTaskSnapshot({ taskId: 'new-task', capability: 'learning', now: 200 })).toMatchObject({
      usageReservationId: null,
      modelUsageTokens: 0,
      hasExactModelUsage: false,
    })
  })

  it('moves through the valid foundation lifecycle', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'game', now: 100 })
    const checked = transitionTask(created, 'safety_check', 110)
    const requirements = transitionTask(checked, 'requirements', 120)
    const planned = transitionTask(requirements, 'planned', 130)
    const running = transitionTask(planned, 'running', 140)

    expect(running).toMatchObject({
      taskId: 'task-1',
      capability: 'game',
      status: 'running',
      revision: 4,
      createdAt: 100,
      updatedAt: 140,
      currentStepId: null,
    })
  })

  it('rejects a transition that skips required gates', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'video', now: 100 })

    expect(() => transitionTask(created, 'completed', 110)).toThrow('Invalid Xiaobao task transition')
  })

  it('treats the same transition as idempotent', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'image', now: 100 })

    expect(transitionTask(created, 'created', 110)).toBe(created)
  })
})
