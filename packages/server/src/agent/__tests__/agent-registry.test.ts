import { describe, expect, it } from 'vitest'
import { completeAgent, getAgentRun, registerAgent, removeAgent } from '../agent-registry.js'

describe('agent registry removal guard', () => {
  it('refuses to remove a running entry and removes it after completion', () => {
    const conversationId = 'registry-running-removal-guard'
    const turnId = 'turn-running-removal-guard'
    registerAgent({
      conversationId,
      turnId,
      envId: 'env-registry-test',
      userId: 'user-registry-test',
      abortController: new AbortController(),
    })

    removeAgent(conversationId, turnId)
    expect(getAgentRun(conversationId)?.status).toBe('running')

    completeAgent(conversationId, 'completed', undefined, 'end_turn')
    removeAgent(conversationId, turnId)
    expect(getAgentRun(conversationId)).toBeUndefined()
  })
})
