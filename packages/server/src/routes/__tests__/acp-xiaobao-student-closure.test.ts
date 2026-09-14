import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveProductionXiaobaoCapability } from '../../agent/xiaobao-runtime/runtime.js'

const state = vi.hoisted(() => ({
  role: 'user' as 'user' | 'admin',
  userStatus: 'active' as string,
  taskRuntime: 'xiaobao' as string | null,
  taskCapability: 'learning' as string | null,
  existingRun: false,
  calls: [] as Array<{ prompt: string; capability: unknown; gateOk: boolean; gateCapability: unknown }>,
}))

const database = vi.hoisted(() => ({
  users: {
    findById: vi.fn(async () => ({ role: state.role, status: state.userStatus })),
  },
  tasks: {
    findById: vi.fn(async (taskId: string) => ({
      id: taskId,
      userId: 'user-1',
      envId: 'local',
      selectedModel: null,
      selectedRuntime: state.taskRuntime,
      xiaobaoCapability: state.taskCapability,
      mode: 'default',
      status: 'pending',
      deletedAt: null,
    })),
    findByIdAndUserId: vi.fn(async (taskId: string, userId: string) => ({ id: taskId, userId })),
    update: vi.fn(async () => null),
  },
}))

const streamEvents = vi.hoisted(() => ({ get: vi.fn(async () => []) }))

vi.mock('hono/streaming', () => ({
  streamSSE: async (_context: unknown, handler: (stream: Record<string, unknown>) => Promise<void>) => {
    await handler({ closed: true, aborted: false, onAbort() {}, async writeSSE() {} })
    return new Response('', { status: 200, headers: { 'content-type': 'text/event-stream' } })
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireUserEnv: async (c: any, next: () => Promise<void>) => {
    c.set('userEnv', {
      envId: 'local',
      userId: 'user-1',
      credentials: { secretId: 'local', secretKey: 'local' },
    })
    await next()
  },
}))

vi.mock('../../db/index.js', () => ({ getDb: () => database }))

vi.mock('../../agent/runtime/index.js', () => {
  const xiaobao = {
    name: 'xiaobao',
    async isAvailable() {
      return true
    },
    async getSupportedModels() {
      return []
    },
    async chatStream(prompt: string, _callback: unknown, options: Record<string, unknown>) {
      // 用真实的生产门禁判定，而不是自己发明一套规则：
      // 任务行缺失 capability 时这里必须 fail-closed。
      const gated = await resolveProductionXiaobaoCapability(prompt, options as never).then(
        (capability) => ({ ok: true as const, capability }),
        () => ({ ok: false as const, capability: undefined }),
      )
      state.calls.push({
        prompt,
        capability: options.xiaobaoCapability,
        gateOk: gated.ok,
        gateCapability: gated.capability,
      })
      return { turnId: `turn-${state.calls.length}`, alreadyRunning: false }
    },
  }
  const codebuddy = {
    name: 'codebuddy',
    async isAvailable() {
      return true
    },
    async getSupportedModels() {
      return []
    },
    async chatStream() {
      return { turnId: 'x', alreadyRunning: false }
    },
  }
  return {
    agentRuntimeRegistry: {
      resolve: ({ explicitRuntime }: { explicitRuntime?: string } = {}) =>
        explicitRuntime === 'xiaobao' ? xiaobao : codebuddy,
      get: (name: string) => (name === 'xiaobao' ? xiaobao : undefined),
      list: () => [codebuddy, xiaobao],
    },
  }
})

vi.mock('../../agent/cloudbase-agent.service.js', () => ({
  CloudbaseAgentService: { convertToSessionUpdate: () => null },
  getSupportedModels: async () => [],
}))

vi.mock('../../agent/persistence.service.js', () => ({
  persistenceService: {
    getLatestRecordStatus: async () => null,
    getStreamEvents: streamEvents.get,
    cleanupStreamEvents: async () => undefined,
    updateRecordStatus: async () => undefined,
  },
}))

const registry = vi.hoisted(() => ({ getAgentRun: vi.fn() }))

vi.mock('../../agent/agent-registry.js', () => ({
  getAgentRun: registry.getAgentRun,
  removeAgent: () => undefined,
}))

vi.mock('../../agent/runtime/opencode-acp-runtime.js', () => ({
  emitForConversation: async () => undefined,
  getAskUserToken: () => 'internal-token',
  markAskUserPending: () => undefined,
  getMessageBuilder: () => undefined,
}))

async function prompt(params: Record<string, unknown>) {
  const { default: acp } = await import('../acp.js')
  return acp.request('/acp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/prompt',
      params: { sessionId: 'task-1', runtime: 'xiaobao', ...params },
    }),
  })
}

const firstTurn = { prompt: [{ type: 'text', text: '我想学习分数' }] }
const answerTurn = {
  prompt: [{ type: 'text', text: '' }],
  askAnswers: { 'turn-1': { toolCallId: 'ask-1', answers: { 学习主题: '分数' } } },
}

describe('xiaobao student entry closed loop', () => {
  beforeEach(() => {
    state.role = 'user'
    state.userStatus = 'active'
    state.taskRuntime = 'xiaobao'
    state.taskCapability = 'learning'
    state.existingRun = false
    state.calls.length = 0
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    registry.getAgentRun.mockImplementation(() =>
      state.existingRun
        ? {
            conversationId: 'task-1',
            turnId: 'turn-1',
            envId: 'local',
            userId: 'user-1',
            status: 'running',
            abortController: new AbortController(),
            startTime: 1,
            lastSeq: -1,
          }
        : undefined,
    )
  })

  it('carries the stored capability into the first prompt turn', async () => {
    const response = await prompt(firstTurn)

    expect(response.status).toBe(200)
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]).toMatchObject({ capability: 'learning', gateOk: true, gateCapability: 'learning' })
  })

  it('carries the same stored capability into the answer-resume turn', async () => {
    await prompt(firstTurn)
    // 模拟"上一轮仍在运行"：没有 resume payload 时该状态会被早退路径拦下。
    state.existingRun = true

    const response = await prompt(answerTurn)

    expect(response.status).toBe(200)
    // 两轮都真正进入 runtime，且都从任务行拿到同一个能力。
    expect(state.calls).toHaveLength(2)
    expect(state.calls[1]).toMatchObject({ capability: 'learning', gateOk: true, gateCapability: 'learning' })
  })

  it('would be blocked by the in-progress guard without the resume payload', async () => {
    await prompt(firstTurn)
    state.existingRun = true

    const response = await prompt(firstTurn)

    expect(response.status).toBe(200)
    // 没有 askAnswers 时走 observe 早退路径，runtime 不会被再次调用。
    expect(state.calls).toHaveLength(1)
  })

  it('fails closed through the production gate when the task row has no capability', async () => {
    state.taskCapability = null

    const response = await prompt(firstTurn)

    expect(response.status).toBe(200)
    expect(state.calls).toHaveLength(1)
    // 路由没有伪造能力，真实生产门禁因此拒绝该轮。
    expect(state.calls[0]).toMatchObject({ capability: undefined, gateOk: false })
  })

  it('still rejects a user outside the rollout before reaching the runtime', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = ''

    const response = await prompt(firstTurn)

    await expect(response.json()).resolves.toMatchObject({
      error: { message: 'Xiaobao runtime is restricted' },
    })
    expect(state.calls).toHaveLength(0)
  })
})
