import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as null | { id: string; username: string; xiaobaoCreditLimit: number | null },
  updated: [] as Array<{ id: string; data: Record<string, unknown> }>,
  logs: [] as Array<Record<string, unknown>>,
  settled: 0 as number | null,
  breakdown: null as null | Record<string, number>,
  breakdownThrows: false,
}))

vi.mock('../../middleware/admin', () => ({
  requireAdmin: async (c: any, next: () => Promise<void>) => {
    c.set('adminUser', { id: 'admin-1', role: 'admin', username: 'admin' })
    await next()
  },
}))

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    users: {
      findById: vi.fn(async (id: string) => (state.user && state.user.id === id ? state.user : null)),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        state.updated.push({ id, data })
        return { ...state.user, ...data }
      }),
    },
    adminLogs: {
      create: vi.fn(async (log: Record<string, unknown>) => {
        state.logs.push(log)
        return log
      }),
    },
    xiaobaoUsageLedger: {
      sumSettledCreditsByUser: vi.fn(async () => state.settled),
      sumSettledCreditsByUserByCategory: vi.fn(async () => {
        if (state.breakdownThrows) throw new Error('ledger down')
        return state.breakdown
      }),
    },
  }),
}))

// admin.ts 的路由模块图很大（沙箱 / CloudBase / provisioning），首次 import 需要放宽超时，
// 但任何断言都不放宽。
vi.setConfig({ testTimeout: 30_000 })

async function requestBudget(method: string, body?: Record<string, unknown>) {
  const { default: adminRouter } = await import('../admin.js')
  return adminRouter.request('/users/student-1/budget', {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

describe('admin user budget endpoint', () => {
  beforeEach(() => {
    state.user = { id: 'student-1', username: 'student-1', xiaobaoCreditLimit: 120 }
    state.updated.length = 0
    state.logs.length = 0
    state.settled = 42
    state.breakdown = { model: 30, tool: 5, sandbox: 7, media: 0 }
    state.breakdownThrows = false
    vi.clearAllMocks()
  })

  it('reads the configured cap together with the settled usage and its breakdown', async () => {
    const response = await requestBudget('GET')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      creditLimit: 120,
      settledCredits: 42,
      usageByCategory: { model: 30, tool: 5, sandbox: 7, media: 0 },
    })
  })

  it('keeps "usage unknown" distinct from zero so the UI can tell them apart', async () => {
    state.settled = null
    state.breakdown = null

    const response = await requestBudget('GET')

    await expect(response.json()).resolves.toEqual({
      creditLimit: 120,
      settledCredits: null,
      usageByCategory: null,
    })
  })

  it('reports an unconfigured cap as null rather than as zero', async () => {
    state.user = { id: 'student-1', username: 'student-1', xiaobaoCreditLimit: null }

    const response = await requestBudget('GET')

    await expect(response.json()).resolves.toEqual({
      creditLimit: null,
      settledCredits: 42,
      usageByCategory: { model: 30, tool: 5, sandbox: 7, media: 0 },
    })
  })

  it('still serves the cap when the usage breakdown cannot be read', async () => {
    state.breakdownThrows = true

    const response = await requestBudget('GET')

    expect(response.status).toBe(200)
    // 明细失败不应该把已经拿到的总量一起丢掉
    await expect(response.json()).resolves.toEqual({ creditLimit: 120, settledCredits: 42, usageByCategory: null })
  })

  it('returns 404 for an unknown user on read', async () => {
    state.user = null

    const response = await requestBudget('GET')

    expect(response.status).toBe(404)
  })

  it('sets a positive whole-number cap and records an audit log', async () => {
    const response = await requestBudget('POST', { creditLimit: 300 })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, creditLimit: 300 })
    expect(state.updated).toEqual([{ id: 'student-1', data: { xiaobaoCreditLimit: 300 } }])
    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({
      adminUserId: 'admin-1',
      action: 'user_budget_change',
      targetUserId: 'student-1',
    })
    expect(state.logs[0].details).toContain('300')
  })

  it('clears the cap when null is sent explicitly', async () => {
    const response = await requestBudget('POST', { creditLimit: null })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, creditLimit: null })
    expect(state.updated).toEqual([{ id: 'student-1', data: { xiaobaoCreditLimit: null } }])
  })

  it('refuses caps the runtime reader would treat as misconfigured', async () => {
    // NaN/Infinity 无法通过 JSON 传输（会被序列化成 null），所以这里覆盖真正能到达服务端的非法值。
    for (const creditLimit of [0, -3, 12.5, '120', true]) {
      const response = await requestBudget('POST', { creditLimit })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid credit limit' })
    }
    expect(state.updated).toHaveLength(0)
    expect(state.logs).toHaveLength(0)
  })

  it('refuses a request that omits the field so nothing is cleared by accident', async () => {
    const response = await requestBudget('POST', {})

    expect(response.status).toBe(400)
    expect(state.updated).toHaveLength(0)
  })

  it('returns 404 for an unknown user on write', async () => {
    state.user = null

    const response = await requestBudget('POST', { creditLimit: 50 })

    expect(response.status).toBe(404)
    expect(state.updated).toHaveLength(0)
  })
})
