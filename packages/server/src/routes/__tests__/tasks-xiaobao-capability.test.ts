import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  role: 'user' as 'user' | 'admin',
  status: 'active' as string,
  created: [] as Array<Record<string, unknown>>,
  /** 学生是否只在 `class_only` 班级里；默认不在任何班。 */
  classOnly: false,
  /** 进行中的课开放的能力；null 表示此刻没有开课。 */
  activeCapabilities: null as string[] | null,
}))

vi.mock('../../middleware/auth', () => ({
  requireAuth: (c: any) => {
    c.set('session', { user: { id: 'student-1' } })
    return null
  },
  requireUserEnv: async (_c: any, next: () => Promise<void>) => {
    await next()
  },
}))

vi.mock('../../middleware/usage.js', () => ({
  checkDailyLimit: async () => ({ allowed: true, limit: 100, used: 0 }),
  trackUsage: async () => undefined,
}))

vi.mock('../../services/credits.js', () => ({
  getBalance: async () => ({ balance: 100 }),
  consumeCredits: async () => undefined,
}))

vi.mock('../../services/credit-pricing.js', () => ({ getCreditCost: () => 1 }))

vi.mock('../../services/central-credits.js', () => ({
  shouldUseCentralCredits: () => false,
  isCentralCreditsConfigured: () => false,
  getCentralCreditBalance: async () => ({ balance: 100 }),
  consumeCentralCredits: async () => undefined,
}))

vi.mock('../../lib/provision-config.js', () => ({ getProvisionMode: async () => 'shared' }))

const database = vi.hoisted(() => ({
  users: {
    findById: vi.fn(async () => ({ role: state.role, status: state.status })),
  },
  tasks: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      state.created.push(input)
      return input
    }),
    findById: vi.fn(async (id: string) => ({ id, skillSettings: null })),
    findByIdAndUserId: vi.fn(async () => null),
  },
  classes: {
    listByStudent: vi.fn(async () => (state.classOnly ? [{ id: 'c1', aiUsageMode: 'class_only' }] : [])),
  },
  classSessions: {
    findActiveByClass: vi.fn(async () =>
      state.activeCapabilities === null
        ? null
        : { id: 'session-1', classId: 'c1', capabilities: JSON.stringify(state.activeCapabilities) },
    ),
  },
}))

vi.mock('../../db/index.js', () => ({ getDb: () => database }))

// tasks.ts 的路由模块图很大（3000+ 行 + 沙箱/Git/CloudBase 依赖），首次 import
// 在本环境约需 20 秒，只有第一个用例承担该成本。这里只放宽超时，不放宽任何断言。
vi.setConfig({ testTimeout: 30_000 })

async function createTask(body: Record<string, unknown>) {
  const { default: tasksRouter } = await import('../tasks.js')
  return tasksRouter.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: '请开始任务', ...body }),
  })
}

describe('POST /api/tasks xiaobao capability handshake', () => {
  beforeEach(() => {
    state.role = 'user'
    state.status = 'active'
    state.created.length = 0
    state.classOnly = false
    state.activeCapabilities = null
    process.env.XIAOBAO_TEST_USER_IDS = ''
    vi.clearAllMocks()
  })

  it('persists runtime and capability for an allowlisted user', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'learning' })

    expect(response.status).toBe(200)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatchObject({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'learning' })
    delete process.env.XIAOBAO_TEST_USER_IDS
  })

  it('rejects a non-allowlisted user selecting xiaobao without creating a task', async () => {
    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'learning' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Xiaobao runtime is restricted' })
    expect(state.created).toHaveLength(0)
  })

  it('rejects an unsupported capability without creating a task', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'image' })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid XiaoBao capability' })
    expect(state.created).toHaveLength(0)
    delete process.env.XIAOBAO_TEST_USER_IDS
  })

  it('rejects a valid capability that is not paired with the xiaobao runtime', async () => {
    const response = await createTask({ selectedRuntime: 'codebuddy', xiaobaoCapability: 'writing' })

    expect(response.status).toBe(400)
    expect(state.created).toHaveLength(0)
  })

  it('keeps the previous behaviour when neither field is sent', async () => {
    const response = await createTask({})

    expect(response.status).toBe(200)
    expect(state.created).toHaveLength(1)
    expect(state.created[0]).toMatchObject({ selectedRuntime: null, xiaobaoCapability: null })
  })

  it('treats a missing or disabled user as restricted', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'
    state.status = 'disabled'

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'writing' })

    expect(response.status).toBe(403)
    expect(state.created).toHaveLength(0)
    delete process.env.XIAOBAO_TEST_USER_IDS
  })

  it('rejects a class_only student outside class time', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'
    state.classOnly = true

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'learning' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: '本节课还没有开始，暂时不能使用小宝' })
    expect(state.created).toHaveLength(0)
    delete process.env.XIAOBAO_TEST_USER_IDS
  })

  it('rejects a capability the running class did not open', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'
    state.classOnly = true
    state.activeCapabilities = ['writing']

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'learning' })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: '本节课没有开放这个能力' })
    expect(state.created).toHaveLength(0)
    delete process.env.XIAOBAO_TEST_USER_IDS
  })

  it('allows a capability the running class opened', async () => {
    process.env.XIAOBAO_TEST_USER_IDS = 'student-1'
    state.classOnly = true
    state.activeCapabilities = ['writing']

    const response = await createTask({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'writing' })

    expect(response.status).toBe(200)
    expect(state.created[0]).toMatchObject({ selectedRuntime: 'xiaobao', xiaobaoCapability: 'writing' })
    delete process.env.XIAOBAO_TEST_USER_IDS
  })
})
