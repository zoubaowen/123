import type { AgentCallbackMessage, StreamEvent, UnifiedMessagePart, UnifiedMessageRecord } from '@ai-xiaobao/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  events: [] as StreamEvent[],
  records: [] as UnifiedMessageRecord[],
  writes: [] as string[],
  taskUpdates: [] as Array<Record<string, unknown>>,
  runtime: null as null | {
    name: string
    chatStream: (...args: any[]) => Promise<{ turnId: string; alreadyRunning: boolean }>
  },
  finalizeFailuresRemaining: 0,
  recordStatusFailuresRemaining: 0,
  recordStatusGate: null as null | Promise<void>,
  recordStatusEntered: undefined as (() => void) | undefined,
  taskStatus: 'created',
  taskUserId: 'student-1',
  taskEnvId: 'task-env',
  authenticatedEnvId: 'task-env',
  observedTaskHint: undefined as string | undefined,
  finalizeGate: null as null | Promise<void>,
  closeGate: null as null | Promise<void>,
  finalizeEntered: undefined as (() => void) | undefined,
  closeEntered: undefined as (() => void) | undefined,
  cleanupCalls: 0,
}))

vi.mock('hono/streaming', () => ({
  streamSSE: async (_context: unknown, handler: (stream: Record<string, unknown>) => Promise<void>) => {
    await handler({
      closed: false,
      aborted: false,
      onAbort() {},
      async writeSSE(message: { data: string }) {
        state.writes.push(message.data)
      },
    })
    return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireUserEnv: async (c: any, next: () => Promise<void>) => {
    state.observedTaskHint = c.get('taskIdHint')
    c.set('userEnv', {
      envId: state.observedTaskHint ? state.authenticatedEnvId : 'user-env',
      userId: 'student-1',
      credentials: { secretId: 'local', secretKey: 'local' },
    })
    await next()
  },
}))

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    tasks: {
      async findById(taskId: string) {
        return {
          id: taskId,
          userId: state.taskUserId,
          envId: state.taskEnvId,
          selectedModel: null,
          selectedRuntime: null,
          mode: 'default',
          status: state.taskStatus,
          deletedAt: null,
        }
      },
      async update(_taskId: string, update: Record<string, unknown>) {
        state.taskUpdates.push(structuredClone(update))
        if (typeof update.status === 'string') state.taskStatus = update.status
      },
    },
  }),
}))

vi.mock('../../agent/cloudbase-agent.service.js', () => ({
  CloudbaseAgentService: {
    convertToSessionUpdate(message: AgentCallbackMessage) {
      if (message.type === 'text' && message.content) {
        return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: message.content } }
      }
      if (message.type === 'agent_phase' && message.phase) {
        return { sessionUpdate: 'agent_phase', phase: message.phase, timestamp: 1 }
      }
      if (message.type === 'error') {
        return { sessionUpdate: 'log', level: 'error', message: message.content ?? '任务失败', timestamp: 1 }
      }
      return null
    },
  },
  getSupportedModels: async () => [],
}))

vi.mock('../../agent/persistence.service.js', () => ({
  persistenceService: {
    async loadDBMessages() {
      return structuredClone(state.records)
    },
    async preSavePendingRecords(params: {
      conversationId: string
      envId: string
      userId: string
      prompt: string
      assistantRecordId: string
    }) {
      const userRecordId = `${params.assistantRecordId}-user`
      state.records.push({
        recordId: userRecordId,
        conversationId: params.conversationId,
        role: 'user',
        status: 'done',
        envId: params.envId,
        userId: params.userId,
        parts: [{ partId: `${userRecordId}-text`, contentType: 'text', content: params.prompt }],
        createTime: 1,
      })
      state.records.push({
        recordId: params.assistantRecordId,
        conversationId: params.conversationId,
        replyTo: userRecordId,
        role: 'assistant',
        status: 'pending',
        envId: params.envId,
        userId: params.userId,
        parts: [],
        createTime: 2,
      })
      return { userRecordId, assistantRecordId: params.assistantRecordId }
    },
    async appendStreamEvents(events: StreamEvent[]) {
      state.closeEntered?.()
      if (state.closeGate) await state.closeGate
      state.events.push(...structuredClone(events))
    },
    async getStreamEvents(conversationId: string, turnId: string, envId: string, userId: string, afterSeq = -1) {
      return structuredClone(
        state.events.filter(
          (event) =>
            event.conversationId === conversationId &&
            event.turnId === turnId &&
            event.envId === envId &&
            event.userId === userId &&
            event.seq > afterSeq,
        ),
      )
    },
    async cleanupStreamEvents() {
      state.cleanupCalls += 1
    },
    async setRecordParts(recordId: string, parts: UnifiedMessagePart[]) {
      const record = state.records.find((candidate) => candidate.recordId === recordId)
      if (record) record.parts = structuredClone(parts)
    },
    async finalizePendingRecords(recordId: string, status: UnifiedMessageRecord['status']) {
      state.finalizeEntered?.()
      if (state.finalizeGate) await state.finalizeGate
      if (state.finalizeFailuresRemaining > 0) {
        state.finalizeFailuresRemaining -= 1
        throw new Error('simulated finalize failure')
      }
      const record = state.records.find((candidate) => candidate.recordId === recordId)
      if (record) record.status = status
    },
    async updateRecordStatus(recordId: string, status: UnifiedMessageRecord['status']) {
      state.recordStatusEntered?.()
      if (state.recordStatusGate) await state.recordStatusGate
      if (state.recordStatusFailuresRemaining > 0) {
        state.recordStatusFailuresRemaining -= 1
        throw new Error('simulated record status failure')
      }
      const record = state.records.find((candidate) => candidate.recordId === recordId)
      if (record) record.status = status
    },
    async getLatestRecordStatus(conversationId: string, userId: string, envId: string) {
      const record = state.records
        .filter(
          (candidate) =>
            candidate.conversationId === conversationId &&
            candidate.userId === userId &&
            candidate.envId === envId &&
            candidate.role === 'assistant',
        )
        .at(-1)
      return record ? { recordId: record.recordId, status: record.status } : null
    },
  },
}))

vi.mock('../../agent/runtime/index.js', () => ({
  agentRuntimeRegistry: {
    resolve: () => state.runtime ?? { name: 'codebuddy' },
    list: () => [],
  },
}))

vi.mock('../../agent/runtime/opencode-acp-runtime.js', () => ({
  emitForConversation: async () => undefined,
  getAskUserToken: () => 'internal-token',
  markAskUserPending: () => undefined,
  getMessageBuilder: () => undefined,
}))

import { completeAgent, getAgentRun, registerAgent, removeAgent } from '../../agent/agent-registry.js'
import type { XiaobaoRuntimeDependencies } from '../../agent/xiaobao-runtime/ports.js'
import { XiaobaoRuntime } from '../../agent/xiaobao-runtime/runtime.js'
import { createTaskSnapshot, transitionTask } from '../../agent/xiaobao-runtime/state-machine.js'
import {
  FixedSafetyProvider,
  InMemoryCheckpointStore,
  InMemorySkillProvider,
  UnlimitedUsageProvider,
} from '../../agent/xiaobao-runtime/testing.js'

function createDependencies(model: XiaobaoRuntimeDependencies['model']): XiaobaoRuntimeDependencies {
  return {
    model,
    tools: new Map(),
    skills: new InMemorySkillProvider(
      new Map([
        [
          'writing',
          {
            name: 'student-writing-coach',
            version: '1.0.0',
            instructions: '完成写作任务。',
            qualityGates: ['有完整结果'],
          },
        ],
      ]),
    ),
    checkpoints: new InMemoryCheckpointStore(),
    safety: new FixedSafetyProvider(),
    usage: new UnlimitedUsageProvider(),
    clock: { now: () => 1000 },
  }
}

describe('ACP XiaoBao durable turn integration', () => {
  beforeEach(() => {
    state.events.length = 0
    state.records.length = 0
    state.writes.length = 0
    state.taskUpdates.length = 0
    state.runtime = null
    state.finalizeFailuresRemaining = 0
    state.recordStatusFailuresRemaining = 0
    state.recordStatusGate = null
    state.recordStatusEntered = undefined
    state.taskStatus = 'created'
    state.taskUserId = 'student-1'
    state.taskEnvId = 'task-env'
    state.authenticatedEnvId = 'task-env'
    state.observedTaskHint = undefined
    state.finalizeGate = null
    state.closeGate = null
    state.finalizeEntered = undefined
    state.closeEntered = undefined
    state.cleanupCalls = 0
  })

  afterEach(() => {
    removeAgent('xiaobao-observe-task')
    removeAgent('xiaobao-cancel-route-task')
    removeAgent('xiaobao-finalize-recovery-task')
    for (const taskId of [
      'cross-env-task',
      'cancel-finalize-task',
      'cancel-close-task',
      'foreign-task',
      'ownership-change-task',
      'turn-binding-task',
      'cancel-during-recovery-task',
      'orphaned-cancel-task',
      'xiaobao-resume-task',
    ]) {
      const run = getAgentRun(taskId)
      run?.abortController.abort()
      if (run) run.status = 'cancelled'
      removeAgent(taskId)
    }
  })

  it('replays a disconnected delayed run through observe and persists its final assistant result', async () => {
    let releaseModel: (() => void) | undefined
    let modelStarted = false
    const modelReady = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'delayed-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            modelStarted = true
            await modelReady
            return { kind: 'complete', text: '断流后完成' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'xiaobao-observe-turn',
    })

    const launch = await runtime.chatStream(
      '完成写作',
      async () => {
        throw new Error('client disconnected')
      },
      {
        conversationId: 'xiaobao-observe-task',
        envId: 'task-env',
        userId: 'student-1',
        maxTurns: 2,
      },
    )

    expect(launch).toEqual({ turnId: 'xiaobao-observe-turn', alreadyRunning: false })
    await vi.waitFor(() => expect(modelStarted).toBe(true), { timeout: 500 })
    expect(getAgentRun('xiaobao-observe-task')?.status).toBe('running')

    const { default: acp } = await import('../acp.js')
    const observing = acp.request('/observe/xiaobao-observe-task?turnId=xiaobao-observe-turn')
    await vi.waitFor(() => expect(state.observedTaskHint).toBe('xiaobao-observe-task'))
    releaseModel?.()
    const response = await observing

    expect(response.status).toBe(200)
    expect(state.writes).toContain('[DONE]')
    expect(state.writes.some((write) => write.includes('断流后完成'))).toBe(true)
    expect(state.records.find((record) => record.recordId === 'xiaobao-observe-turn')).toMatchObject({
      status: 'done',
      parts: [{ contentType: 'text', content: '断流后完成' }],
    })
    expect(state.taskUpdates.some((update) => update.status === 'done')).toBe(true)
  })

  it('rejects observing an active run through a different task environment', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'blocked-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete(_input, signal) {
            return new Promise((_resolve, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
            )
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'cross-env-turn',
    })
    await runtime.chatStream('开始', null, {
      conversationId: 'cross-env-task',
      userId: 'student-1',
      envId: 'task-env',
      maxTurns: 4,
    })
    state.authenticatedEnvId = 'other-env'
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/observe/cross-env-task?turnId=cross-env-turn')

    expect(response.status).toBe(404)
    getAgentRun('cross-env-task')?.abortController.abort()
  })

  it('keeps a cancelled live prompt stopped after SSE sends its terminal response', async () => {
    let markModelStarted: (() => void) | undefined
    const modelStarted = new Promise<void>((resolve) => {
      markModelStarted = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'cancel-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete(_input, signal) {
            markModelStarted?.()
            return new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(signal.reason), { once: true })
            })
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'xiaobao-cancel-route-turn',
    })
    state.runtime = {
      name: 'codebuddy',
      chatStream: runtime.chatStream.bind(runtime),
    }
    const { default: acp } = await import('../acp.js')
    const promptResponse = acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'session/prompt',
        params: {
          sessionId: 'xiaobao-cancel-route-task',
          prompt: [{ type: 'text', text: '开始任务' }],
        },
      }),
    })
    await modelStarted

    await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'session/cancel',
        params: { sessionId: 'xiaobao-cancel-route-task' },
      }),
    })
    await promptResponse

    expect(state.writes.some((write) => write.includes('"stopReason":"cancelled"'))).toBe(true)
    expect(state.taskUpdates.at(-1)).toMatchObject({ status: 'stopped' })
  })

  it('does not publish cancellation until assistant finalization has finished', async () => {
    let releaseFinalize: (() => void) | undefined
    state.finalizeGate = new Promise<void>((resolve) => {
      releaseFinalize = resolve
    })
    const finalizeEntered = new Promise<void>((resolve) => {
      state.finalizeEntered = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'fast-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '待保存' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'cancel-finalize-turn',
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    const { default: acp } = await import('../acp.js')
    const prompt = acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 41,
        method: 'session/prompt',
        params: { sessionId: 'cancel-finalize-task', prompt: [{ type: 'text', text: '开始' }] },
      }),
    })
    await finalizeEntered

    await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'session/cancel',
        params: { sessionId: 'cancel-finalize-task' },
      }),
    })

    expect(getAgentRun('cancel-finalize-task')?.status).toBe('running')
    expect(state.writes).not.toContain('[DONE]')
    expect(state.taskUpdates.some((update) => update.status === 'stopped')).toBe(false)
    releaseFinalize?.()
    await prompt
    expect(state.writes).toContain('[DONE]')
    expect(state.taskUpdates.at(-1)).toMatchObject({ status: 'stopped' })
  })

  it('does not publish cancellation until the durable event buffer has closed', async () => {
    let releaseClose: (() => void) | undefined
    state.closeGate = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const closeEntered = new Promise<void>((resolve) => {
      state.closeEntered = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'fast-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '待关闭' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'cancel-close-turn',
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    const { default: acp } = await import('../acp.js')
    const prompt = acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 43,
        method: 'session/prompt',
        params: { sessionId: 'cancel-close-task', prompt: [{ type: 'text', text: '开始' }] },
      }),
    })
    await closeEntered

    await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 44,
        method: 'session/cancel',
        params: { sessionId: 'cancel-close-task' },
      }),
    })

    expect(getAgentRun('cancel-close-task')?.status).toBe('running')
    expect(state.writes).not.toContain('[DONE]')
    expect(state.cleanupCalls).toBe(0)
    releaseClose?.()
    await prompt
    expect(state.taskUpdates.at(-1)).toMatchObject({ status: 'stopped' })
  })

  it('rejects prompt startup when the authenticated environment does not own the task', async () => {
    state.authenticatedEnvId = 'other-env'
    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 45,
        method: 'session/prompt',
        params: { sessionId: 'wrong-env-task', prompt: [{ type: 'text', text: '开始' }] },
      }),
    })
    expect((await response.json()) as Record<string, unknown>).toMatchObject({
      error: { message: 'Session not found' },
    })
  })

  it('runtime refuses a task owned by another user before registering a run', async () => {
    state.taskUserId = 'student-2'
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'unused-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '不应执行' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'foreign-turn',
    })
    await expect(
      runtime.chatStream('开始', null, {
        conversationId: 'foreign-task',
        userId: 'student-1',
        envId: 'task-env',
        maxTurns: 4,
      }),
    ).rejects.toThrow('Xiaobao task is unavailable')
    expect(getAgentRun('foreign-task')).toBeUndefined()
  })

  it('runtime skips its final task write if ownership changes while the turn is running', async () => {
    let releaseModel: (() => void) | undefined
    const modelGate = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'delayed-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            await modelGate
            return { kind: 'complete', text: '完成' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'ownership-change-turn',
    })
    await runtime.chatStream('开始', null, {
      conversationId: 'ownership-change-task',
      userId: 'student-1',
      envId: 'task-env',
      maxTurns: 4,
    })
    await vi.waitFor(() => expect(getAgentRun('ownership-change-task')?.status).toBe('running'))
    state.taskUserId = 'student-2'
    releaseModel?.()
    await vi.waitFor(() => expect(getAgentRun('ownership-change-task')?.status).toBe('completed'))
    expect(state.taskUpdates).toHaveLength(0)
  })

  it('surfaces finalize failure as an error and allows the next prompt to start', async () => {
    let nextTurn = 0
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'complete-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '写作结果' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => `xiaobao-finalize-recovery-turn-${++nextTurn}`,
    })
    state.runtime = {
      name: 'codebuddy',
      chatStream: runtime.chatStream.bind(runtime),
    }
    state.finalizeFailuresRemaining = 1
    const { default: acp } = await import('../acp.js')
    const requestPrompt = () =>
      acp.request('/acp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 20 + nextTurn,
          method: 'session/prompt',
          params: {
            sessionId: 'xiaobao-finalize-recovery-task',
            prompt: [{ type: 'text', text: '完成写作' }],
          },
        }),
      })

    await requestPrompt()

    expect(state.records.find((record) => record.recordId === 'xiaobao-finalize-recovery-turn-1')).toMatchObject({
      status: 'error',
    })
    expect(state.writes.some((write) => write.includes('"stopReason":"refusal"'))).toBe(true)
    expect(state.taskUpdates.at(-1)).toMatchObject({ status: 'error' })

    const secondResponse = await requestPrompt()

    expect(secondResponse.status).toBe(200)
    expect(state.records.some((record) => record.recordId === 'xiaobao-finalize-recovery-turn-2')).toBe(true)
  })

  it('rejects POST chat when the owned task belongs to another environment', async () => {
    let launched = false
    state.taskEnvId = 'another-env'
    state.runtime = {
      name: 'codebuddy',
      async chatStream() {
        launched = true
        return { turnId: 'should-not-launch', alreadyRunning: false }
      },
    }
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '开始', conversationId: 'cross-env-chat-task' }),
    })

    expect(response.status).toBe(404)
    expect(launched).toBe(false)
  })

  it('persists cancellation when abort arrives during finalize error recovery', async () => {
    let releaseStatusWrite: (() => void) | undefined
    state.recordStatusGate = new Promise<void>((resolve) => {
      releaseStatusWrite = resolve
    })
    const statusWriteEntered = new Promise<void>((resolve) => {
      state.recordStatusEntered = resolve
    })
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'complete-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '写作结果' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'cancel-during-recovery-turn',
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    state.finalizeFailuresRemaining = 1
    const { default: acp } = await import('../acp.js')
    const prompting = acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 41,
        method: 'session/prompt',
        params: { sessionId: 'cancel-during-recovery-task', prompt: [{ type: 'text', text: '开始' }] },
      }),
    })
    await statusWriteEntered

    const cancelling = acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 42,
        method: 'session/cancel',
        params: { sessionId: 'cancel-during-recovery-task' },
      }),
    })
    await cancelling
    releaseStatusWrite?.()
    await prompting

    expect(state.records.find((record) => record.recordId === 'cancel-during-recovery-turn')).toMatchObject({
      status: 'cancel',
    })
    expect(state.writes.some((write) => write.includes('"stopReason":"cancelled"'))).toBe(true)
    expect(state.taskStatus).toBe('stopped')
  })

  it('does not use a newer turn registry status to finish an older turn stream', async () => {
    state.runtime = {
      name: 'codebuddy',
      async chatStream() {
        registerAgent({
          conversationId: 'turn-binding-task',
          turnId: 'newer-turn',
          envId: 'task-env',
          userId: 'student-1',
          abortController: new AbortController(),
        })
        completeAgent('turn-binding-task', 'cancelled', undefined, 'cancelled')
        return { turnId: 'older-turn', alreadyRunning: false }
      },
    }
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 45,
        method: 'session/prompt',
        params: { sessionId: 'turn-binding-task', prompt: [{ type: 'text', text: '开始' }] },
      }),
    })

    expect(response.status).toBe(200)
    expect(state.writes.some((write) => write.includes('"stopReason":"end_turn"'))).toBe(true)
    expect(state.writes.some((write) => write.includes('"stopReason":"cancelled"'))).toBe(false)
    expect(state.taskUpdates.some((update) => update.status === 'stopped')).toBe(false)
  })

  it('cancels an owned orphaned pending turn after restart and permits the next prompt', async () => {
    state.taskStatus = 'pending'
    state.records.push({
      recordId: 'orphaned-cancel-turn',
      conversationId: 'orphaned-cancel-task',
      role: 'assistant',
      status: 'pending',
      envId: 'task-env',
      userId: 'student-1',
      parts: [],
      createTime: 1,
    })
    let launches = 0
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'complete-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            launches += 1
            return { kind: 'complete', text: '新一轮完成' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => 'after-orphan-cancel-turn',
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    const { default: acp } = await import('../acp.js')

    await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 43,
        method: 'session/cancel',
        params: { sessionId: 'orphaned-cancel-task' },
      }),
    })

    expect(state.records[0]).toMatchObject({ status: 'cancel' })
    expect(state.taskStatus).toBe('stopped')

    const nextPrompt = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 44,
        method: 'session/prompt',
        params: { sessionId: 'orphaned-cancel-task', prompt: [{ type: 'text', text: '继续' }] },
      }),
    })

    expect(nextPrompt.status).toBe(200)
    expect(launches).toBe(1)
  })

  it('recovers an orphaned pending record on the next prompt after every final status write fails', async () => {
    let nextTurn = 0
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () =>
        createDependencies({
          name: 'complete-model',
          async healthCheck() {
            return true
          },
          async listModels() {
            return []
          },
          async complete() {
            return { kind: 'complete', text: '可恢复结果' }
          },
        }),
      capabilityResolver: async () => 'writing',
      idFactory: () => `xiaobao-orphan-recovery-turn-${++nextTurn}`,
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    state.finalizeFailuresRemaining = 1
    state.recordStatusFailuresRemaining = 3
    const { default: acp } = await import('../acp.js')
    const requestPrompt = () =>
      acp.request('/acp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 30 + nextTurn,
          method: 'session/prompt',
          params: {
            sessionId: 'xiaobao-finalize-recovery-task',
            prompt: [{ type: 'text', text: '继续任务' }],
          },
        }),
      })

    await requestPrompt()

    expect(state.records.find((record) => record.recordId === 'xiaobao-orphan-recovery-turn-1')).toMatchObject({
      status: 'pending',
    })
    expect(state.taskStatus).toBe('error')

    const secondResponse = await requestPrompt()

    expect(secondResponse.status).toBe(200)
    expect(state.records.find((record) => record.recordId === 'xiaobao-orphan-recovery-turn-1')).toMatchObject({
      status: 'error',
    })
    expect(state.records.some((record) => record.recordId === 'xiaobao-orphan-recovery-turn-2')).toBe(true)
  })

  it('resumes a waiting xiaobao task through the ACP route with student answers', async () => {
    let modelCalls = 0
    const sharedCheckpoints = new InMemoryCheckpointStore()
    const dependenciesFactory = async (): Promise<XiaobaoRuntimeDependencies> => {
      const base = createDependencies({
        name: 'resume-model',
        async healthCheck() {
          return true
        },
        async listModels() {
          return []
        },
        async complete() {
          modelCalls += 1
          return { kind: 'complete', text: '根据回答完成写作' }
        },
      })
      return { ...base, checkpoints: sharedCheckpoints }
    }
    const runtime = new XiaobaoRuntime({
      dependenciesFactory,
      capabilityResolver: async () => 'writing',
      idFactory: () => `resume-turn-${modelCalls}`,
    })
    state.runtime = { name: 'codebuddy', chatStream: runtime.chatStream.bind(runtime) }
    state.taskStatus = 'pending'
    state.taskUserId = 'student-1'

    // Seed a waiting checkpoint that mirrors a previous question turn.
    const snapshot = createTaskSnapshot({
      taskId: 'xiaobao-resume-task',
      userId: 'student-1',
      capability: 'writing',
      prompt: '帮我写作文',
      now: 100,
    })
    const planned = transitionTask(snapshot, 'safety_check', 110)
    const req = transitionTask(planned, 'requirements', 120)
    const planned2 = transitionTask(req, 'planned', 130)
    const running = transitionTask(planned2, 'running', 140)
    const waiting = transitionTask(running, 'waiting_for_student', 150)
    const seeded = {
      ...waiting,
      currentStepId: 'ask-1',
      observations: [
        {
          actionId: 'ask-1',
          ok: true,
          output: { header: '写作主题', questions: ['你想写什么故事？'] },
          toolName: 'xiaobao_ask',
        },
      ],
    }
    await sharedCheckpoints.save(seeded)

    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 90,
        method: 'session/prompt',
        params: {
          sessionId: 'xiaobao-resume-task',
          prompt: [{ type: 'text', text: '继续未完成的任务' }],
          askAnswers: { 'turn-1': { toolCallId: 'ask-1', answers: { 写作主题: '太空冒险' } } },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(modelCalls).toBe(1)
    // The question turn is gone and the task reached a terminal done state.
    expect(state.taskUpdates.some((update) => update.status === 'done')).toBe(true)
    expect(state.writes.some((write) => write.includes('根据回答完成写作'))).toBe(true)
  })
})
