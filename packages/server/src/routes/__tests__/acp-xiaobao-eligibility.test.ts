import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalUserAllowlist = process.env.XIAOBAO_TEST_USER_IDS
const originalArkKey = process.env.ARK_API_KEY

const state = vi.hoisted(() => ({
  role: 'user' as 'user' | 'admin',
  userStatus: 'active' as string,
  userMissing: false,
  userThrows: false,
  xiaobaoAvailable: true,
  /** 学生在办班级；空数组表示不在任何班里。 */
  studentClasses: [] as Array<{ id: string; aiUsageMode: 'class_only' | 'anytime' }>,
  /** 各班进行中的课（键为班级 id）；缺键表示此刻没有开课。 */
  activeSessions: {} as Record<string, { capabilities: string }>,
}))

const database = vi.hoisted(() => ({
  users: {
    findById: vi.fn(async () => {
      if (state.userThrows) throw new Error('unavailable')
      if (state.userMissing) return null
      return { role: state.role, status: state.userStatus }
    }),
  },
  tasks: {
    findByIdAndUserId: vi.fn(async () => null),
  },
  classes: {
    listByStudent: vi.fn(async () => state.studentClasses),
  },
  classSessions: {
    findActiveByClass: vi.fn(async (classId: string) => {
      const session = state.activeSessions[classId]
      return session ? { id: `session-${classId}`, classId, capabilities: session.capabilities } : null
    }),
  },
}))

const xiaobaoRuntime = vi.hoisted(() => ({
  name: 'xiaobao',
  async isAvailable() {
    return state.xiaobaoAvailable
  },
  async getSupportedModels() {
    return []
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
    get: (name: string) => (name === 'xiaobao' ? xiaobaoRuntime : undefined),
    resolve: () => xiaobaoRuntime,
    list: () => [xiaobaoRuntime],
  },
}))

vi.mock('../../agent/cloudbase-agent.service.js', () => ({
  CloudbaseAgentService: { convertToSessionUpdate: () => null },
  getSupportedModels: async () => [],
}))

vi.mock('../../agent/persistence.service.js', () => ({
  persistenceService: {
    getLatestRecordStatus: async () => null,
    getStreamEvents: async () => [],
    cleanupStreamEvents: async () => undefined,
    updateRecordStatus: async () => undefined,
  },
}))

vi.mock('../../agent/agent-registry.js', () => ({
  getAgentRun: () => undefined,
  removeAgent: () => undefined,
}))

vi.mock('../../agent/runtime/opencode-acp-runtime.js', () => ({
  emitForConversation: async () => undefined,
  getAskUserToken: () => 'internal-token',
  markAskUserPending: () => undefined,
  getMessageBuilder: () => undefined,
}))

async function requestEligibility() {
  const { default: acp } = await import('../acp.js')
  return acp.request('/xiaobao/eligibility', { method: 'GET' })
}

describe('GET /api/agent/xiaobao/eligibility', () => {
  beforeEach(() => {
    state.role = 'user'
    state.userStatus = 'active'
    state.userMissing = false
    state.userThrows = false
    state.xiaobaoAvailable = true
    state.studentClasses = []
    state.activeSessions = {}
    process.env.XIAOBAO_TEST_USER_IDS = ''
    vi.clearAllMocks()
  })

  // 测试池是 singleFork：必须还原白名单与媒体密钥，否则会污染同进程内其他测试。
  afterEach(() => {
    if (originalUserAllowlist === undefined) delete process.env.XIAOBAO_TEST_USER_IDS
    else process.env.XIAOBAO_TEST_USER_IDS = originalUserAllowlist
    if (originalArkKey === undefined) delete process.env.ARK_API_KEY
    else process.env.ARK_API_KEY = originalArkKey
  })

  it('advertises the media capabilities once the volcengine media service is configured', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    process.env.ARK_API_KEY = 'ark-secret-key'

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing', 'learning', 'game', 'image', 'video'],
    })
  })

  it('keeps the media capabilities hidden while no media service is configured', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    delete process.env.ARK_API_KEY

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing', 'learning', 'game'],
    })
  })

  it('reports an ineligible active user outside the allowlist', async () => {
    const response = await requestEligibility()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ eligible: false, runtime: 'xiaobao', capabilities: [] })
  })

  it('reports an allowlisted user with the production capability list', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'

    const response = await requestEligibility()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing', 'learning', 'game'],
    })
  })

  it('reports an administrator as eligible without an allowlist entry', async () => {
    state.role = 'admin'

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing', 'learning', 'game'],
    })
  })

  it('reports ineligible when the xiaobao runtime is unavailable', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.xiaobaoAvailable = false

    const response = await requestEligibility()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ eligible: false, runtime: 'xiaobao', capabilities: [] })
  })

  it('stays fail-closed and does not fail the request when the user lookup throws', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.userThrows = true

    const response = await requestEligibility()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ eligible: false, runtime: 'xiaobao', capabilities: [] })
  })

  it('stays fail-closed when the user is missing or disabled', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.userMissing = true
    await expect((await requestEligibility()).json()).resolves.toMatchObject({ eligible: false })

    state.userMissing = false
    state.userStatus = 'disabled'
    await expect((await requestEligibility()).json()).resolves.toMatchObject({ eligible: false })
  })

  it('never echoes the user id, task id or allowlist content', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1,secret-student'

    const response = await requestEligibility()
    const body = await response.text()

    expect(body).not.toContain('user-1')
    expect(body).not.toContain('secret-student')
    expect(body).not.toContain('task')
  })

  it('advertises only the capabilities the running class opened', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.studentClasses = [{ id: 'c1', aiUsageMode: 'class_only' }]
    state.activeSessions = { c1: { capabilities: JSON.stringify(['writing']) } }

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing'],
    })
  })

  it('takes the capabilities back once the class is over', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.studentClasses = [{ id: 'c1', aiUsageMode: 'class_only' }]
    // 没有进行中的课：class_only 班级的学生此刻不获得任何能力
    state.activeSessions = {}

    const response = await requestEligibility()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ eligible: false, runtime: 'xiaobao', capabilities: [] })
  })

  it('stays unrestricted for an anytime class', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.studentClasses = [{ id: 'c1', aiUsageMode: 'anytime' }]

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({
      eligible: true,
      runtime: 'xiaobao',
      capabilities: ['writing', 'learning', 'game'],
    })
  })

  it('never advertises a capability outside the production allowlist', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'user-1'
    state.studentClasses = [{ id: 'c1', aiUsageMode: 'class_only' }]
    state.activeSessions = { c1: { capabilities: JSON.stringify(['music']) } }

    const response = await requestEligibility()

    await expect(response.json()).resolves.toEqual({ eligible: false, runtime: 'xiaobao', capabilities: [] })
  })
})
