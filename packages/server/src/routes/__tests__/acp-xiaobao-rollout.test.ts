import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  role: 'user' as 'user' | 'admin',
  userStatus: 'active',
  taskOwned: true,
  taskUserId: 'user-1',
  taskMode: 'default' as 'default' | 'coding',
  taskRuntime: null as string | null,
  taskCapability: null as string | null,
  existingRun: false,
  runUserId: 'user-1',
  xiaobaoAvailable: true,
  calls: [] as Array<{ runtime: string; prompt: string; options: Record<string, unknown> }>,
}))

const registry = vi.hoisted(() => ({
  getAgentRun: vi.fn(() =>
    state.existingRun
      ? {
          conversationId: 'task-1',
          turnId: 'existing-turn',
          envId: 'local',
          userId: state.runUserId,
          status: 'running',
          abortController: new AbortController(),
          startTime: 1,
          lastSeq: -1,
        }
      : undefined,
  ),
}))

const streamEvents = vi.hoisted(() => ({
  get: vi.fn(async () => []),
}))

const database = vi.hoisted(() => ({
  users: {
    findById: vi.fn(async () => ({ role: state.role, status: state.userStatus })),
  },
  tasks: {
    findById: vi.fn(async (taskId: string) => ({
      id: taskId,
      userId: state.taskUserId,
      selectedModel: null,
      selectedRuntime: state.taskRuntime,
      xiaobaoCapability: state.taskCapability,
      mode: state.taskMode,
    })),
    findByIdAndUserId: vi.fn(async (taskId: string, userId: string) =>
      state.taskOwned ? { id: taskId, userId } : null,
    ),
    update: vi.fn(async () => null),
  },
}))

const runtimes = vi.hoisted(() => {
  const createRuntime = (name: string) => ({
    name,
    async isAvailable() {
      if (name === 'xiaobao') return state.xiaobaoAvailable
      return true
    },
    async getSupportedModels() {
      if (name === 'xiaobao') return [{ id: 'xiaobao-model', name: 'XiaoBao Model' }]
      return []
    },
    async chatStream(prompt: string, _callback: unknown, options: Record<string, unknown>) {
      state.calls.push({ runtime: name, prompt, options })
      return { turnId: 'turn-1', alreadyRunning: false }
    },
  })
  return {
    xiaobao: createRuntime('xiaobao'),
    codebuddy: createRuntime('codebuddy'),
    opencode: createRuntime('opencode-acp'),
  }
})

vi.mock('hono/streaming', () => ({
  streamSSE: async (_context: unknown, handler: (stream: Record<string, unknown>) => Promise<void>) => {
    await handler({
      closed: true,
      aborted: false,
      onAbort() {},
      async writeSSE() {},
    })
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

vi.mock('../../agent/runtime/index.js', () => ({
  agentRuntimeRegistry: {
    resolve: ({ explicitRuntime }: { explicitRuntime?: string } = {}) => {
      if (explicitRuntime === 'xiaobao') return runtimes.xiaobao
      if (explicitRuntime === 'opencode-acp') return runtimes.opencode
      return runtimes.codebuddy
    },
    list: () => [runtimes.codebuddy, runtimes.opencode, runtimes.xiaobao],
  },
}))

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

async function requestChat(runtime: string, capability?: unknown) {
  const { default: acp } = await import('../acp.js')
  return acp.request('/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: '请开始任务',
      conversationId: 'task-1',
      runtime,
      ...(capability === undefined ? {} : { xiaobaoCapability: capability }),
    }),
  })
}

async function requestSessionPrompt(capability?: unknown) {
  const { default: acp } = await import('../acp.js')
  return acp.request('/acp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'session/prompt',
      params: {
        sessionId: 'task-1',
        runtime: 'xiaobao',
        prompt: [{ type: 'text', text: '请开始任务' }],
        ...(capability === undefined ? {} : { xiaobaoCapability: capability }),
      },
    }),
  })
}

async function requestSessionCancel() {
  const { default: acp } = await import('../acp.js')
  return acp.request('/acp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/cancel',
      params: { sessionId: 'task-1' },
    }),
  })
}

describe('ACP XiaoBao rollout boundary', () => {
  beforeEach(() => {
    state.role = 'user'
    state.userStatus = 'active'
    state.taskOwned = true
    state.taskUserId = 'user-1'
    state.taskMode = 'default'
    state.existingRun = false
    state.runUserId = 'user-1'
    state.calls.length = 0
    state.xiaobaoAvailable = true
    process.env.XIAOBAO_TEST_TASK_IDS = ''
    vi.clearAllMocks()
  })

  it('allows an active administrator to select XiaoBao', async () => {
    state.role = 'admin'

    const response = await requestChat('xiaobao', 'writing')

    expect(response.status).toBe(200)
    expect(state.calls).toHaveLength(1)
  })

  it('allows an owned task from the server-side test allowlist', async () => {
    process.env.XIAOBAO_TEST_TASK_IDS = 'task-1'

    const response = await requestChat('xiaobao', 'learning')

    expect(response.status).toBe(200)
    expect(state.calls).toHaveLength(1)
  })

  it('does not let a student claim another allowlisted test task', async () => {
    process.env.XIAOBAO_TEST_TASK_IDS = 'task-1'
    state.taskOwned = false

    const response = await requestChat('xiaobao', 'learning')

    expect(response.status).toBe(403)
    expect(state.calls).toHaveLength(0)
  })

  it('rejects an ordinary student selecting XiaoBao outside the rollout', async () => {
    const response = await requestChat('xiaobao', 'writing')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Xiaobao runtime is restricted' })
    expect(state.calls).toHaveLength(0)
  })

  it('rejects an ordinary student through the JSON-RPC prompt path', async () => {
    const response = await requestSessionPrompt('learning')
    const payload = await response.json()

    expect(payload).toMatchObject({
      error: { message: 'Xiaobao runtime is restricted' },
    })
    expect(state.calls).toHaveLength(0)
  })

  it('checks task ownership before observing an existing JSON-RPC run', async () => {
    state.role = 'admin'
    state.taskUserId = 'another-user'
    state.existingRun = true

    const response = await requestSessionPrompt('learning')
    const payload = await response.json()

    expect(payload).toMatchObject({ error: { message: 'Session not found' } })
    expect(registry.getAgentRun).not.toHaveBeenCalled()
    expect(state.calls).toHaveLength(0)
  })

  it('does not let an administrator start chat with another users task id', async () => {
    state.role = 'admin'
    state.taskUserId = 'another-user'

    const response = await requestChat('codebuddy')

    expect(response.status).toBe(404)
    expect(state.calls).toHaveLength(0)
  })

  it('checks task ownership before cancelling a JSON-RPC run', async () => {
    state.taskUserId = 'another-user'
    state.existingRun = true

    const response = await requestSessionCancel()
    const payload = await response.json()

    expect(payload).toMatchObject({ error: { message: 'Session not found' } })
    expect(registry.getAgentRun).not.toHaveBeenCalled()
    expect(database.tasks.update).not.toHaveBeenCalled()
  })

  it('does not observe a registry run owned by another user', async () => {
    state.role = 'admin'
    state.existingRun = true
    state.runUserId = 'another-user'

    const response = await requestSessionPrompt('learning')
    const payload = await response.json()

    expect(payload).toMatchObject({ error: { message: 'Session not found' } })
    expect(state.calls).toHaveLength(0)
  })

  it('rejects cross-user observe before reading another task stream', async () => {
    state.taskUserId = 'another-user'

    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/observe/task-1?turnId=existing-turn')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Session not found' })
    expect(streamEvents.get).not.toHaveBeenCalled()
    expect(registry.getAgentRun).not.toHaveBeenCalled()
  })

  it('binds observe event reads to the authenticated environment and user', async () => {
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/observe/task-1?turnId=existing-turn')

    expect(response.status).toBe(200)
    expect(streamEvents.get).toHaveBeenCalledWith('task-1', 'existing-turn', 'local', 'user-1')
  })

  it('checks XiaoBao rollout before observing an existing JSON-RPC run', async () => {
    state.existingRun = true

    const response = await requestSessionPrompt('learning')
    const payload = await response.json()

    expect(payload).toMatchObject({ error: { message: 'Xiaobao runtime is restricted' } })
    expect(registry.getAgentRun).not.toHaveBeenCalled()
    expect(state.calls).toHaveLength(0)
  })

  it('rejects a disabled allowlisted student through both request paths', async () => {
    state.userStatus = 'disabled'
    process.env.XIAOBAO_TEST_TASK_IDS = 'task-1'

    const chatResponse = await requestChat('xiaobao', 'writing')
    const promptResponse = await requestSessionPrompt('learning')

    expect(chatResponse.status).toBe(403)
    expect(await promptResponse.json()).toMatchObject({ error: { message: 'Xiaobao runtime is restricted' } })
    expect(state.calls).toHaveLength(0)
  })

  it('rejects coding mode through both XiaoBao request paths before launching a runtime', async () => {
    state.role = 'admin'
    state.taskMode = 'coding'

    const chatResponse = await requestChat('xiaobao', 'writing')
    const promptResponse = await requestSessionPrompt('learning')

    expect(chatResponse.status).toBe(400)
    await expect(chatResponse.json()).resolves.toEqual({ error: '小宝写作和学习暂不支持编程模式或图片输入' })
    expect(await promptResponse.json()).toMatchObject({
      error: { message: '小宝写作和学习暂不支持编程模式或图片输入' },
    })
    expect(state.calls).toHaveLength(0)
  })

  it('rejects image input through the JSON-RPC XiaoBao path before launching a runtime', async () => {
    state.role = 'admin'
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: {
          sessionId: 'task-1',
          runtime: 'xiaobao',
          xiaobaoCapability: 'writing',
          prompt: [
            { type: 'text', text: '请看看图片' },
            { type: 'image', data: 'image-data', mimeType: 'image/png' },
          ],
        },
      }),
    })

    expect(await response.json()).toMatchObject({
      error: { message: '小宝写作和学习暂不支持编程模式或图片输入' },
    })
    expect(state.calls).toHaveLength(0)
  })

  it.each(['codebuddy', 'opencode-acp'])('does not apply the XiaoBao rollout gate to %s', async (runtime) => {
    const response = await requestChat(runtime)

    expect(response.status).toBe(200)
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0].runtime).toBe(runtime)
    expect(database.users.findById).not.toHaveBeenCalled()
    expect(database.tasks.findByIdAndUserId).not.toHaveBeenCalled()
  })

  it.each(['codebuddy', 'opencode-acp'])('keeps the owned JSON-RPC %s path available', async (runtime) => {
    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: { sessionId: 'task-1', runtime, prompt: [{ type: 'text', text: '继续任务' }] },
      }),
    })

    expect(response.status).toBe(200)
    expect(state.calls.at(-1)?.runtime).toBe(runtime)
    expect(database.users.findById).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined, undefined],
    ['writing', 'writing', 'writing'],
    ['media', 'image', 'image'],
    ['game', 'game', 'game'],
  ])('propagates %s capability through both real ACP request paths', async (_case, input, expected) => {
    state.role = 'admin'

    const chatResponse = await requestChat('xiaobao', input)
    expect(chatResponse.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBe(expected)

    const promptResponse = await requestSessionPrompt(input)
    expect(promptResponse.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBe(expected)
  })

  it('reports XiaoBao availability and models through the public runtimes endpoint', async () => {
    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/runtimes', { method: 'GET' })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      default: string
      runtimes: Array<{ name: string; available: boolean; models: Array<{ id: string }> }>
    }
    expect(body.default).not.toBe('xiaobao')
    const xiaobao = body.runtimes.find((runtime) => runtime.name === 'xiaobao')
    expect(xiaobao).toEqual({
      name: 'xiaobao',
      available: true,
      models: [{ id: 'xiaobao-model', name: 'XiaoBao Model' }],
    })
  })

  it('reports XiaoBao as unavailable without models when its dependencies are unhealthy', async () => {
    state.xiaobaoAvailable = false
    const { default: acp } = await import('../acp.js')
    const response = await acp.request('/runtimes', { method: 'GET' })

    const body = (await response.json()) as {
      runtimes: Array<{ name: string; available: boolean; models: unknown[] }>
    }
    const xiaobao = body.runtimes.find((runtime) => runtime.name === 'xiaobao')
    expect(xiaobao).toEqual({ name: 'xiaobao', available: false, models: [] })
  })
})

describe('session/prompt xiaobao capability source', () => {
  beforeEach(() => {
    state.role = 'admin'
    state.taskRuntime = 'xiaobao'
    state.taskCapability = null
    state.calls.length = 0
    state.existingRun = false
    process.env.XIAOBAO_TEST_TASK_IDS = ''
    vi.clearAllMocks()
  })

  it('reads the capability from the task row when the request omits it', async () => {
    state.taskCapability = 'learning'

    const response = await requestSessionPrompt(undefined)

    expect(response.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBe('learning')
  })

  it('prefers an explicitly requested capability over the stored task row', async () => {
    state.taskCapability = 'learning'

    const response = await requestSessionPrompt('writing')

    expect(response.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBe('writing')
  })

  it('never propagates an invalid capability stored on the task row', async () => {
    state.taskCapability = 'study'

    const response = await requestSessionPrompt(undefined)

    expect(response.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBeUndefined()
  })

  it('keeps the stored capability on a resume turn that only carries student answers', async () => {
    state.taskCapability = 'learning'
    const { default: acp } = await import('../acp.js')

    const response = await acp.request('/acp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'session/prompt',
        params: {
          sessionId: 'task-1',
          runtime: 'xiaobao',
          prompt: [{ type: 'text', text: '' }],
          askAnswers: { 'turn-1': { toolCallId: 'ask-1', answers: { 创作主题: '太空冒险' } } },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(state.calls.at(-1)?.options.xiaobaoCapability).toBe('learning')
  })
})
