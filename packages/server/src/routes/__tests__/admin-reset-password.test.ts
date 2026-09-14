import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import adminRoutes from '../admin'
import type { AppEnv } from '../../middleware/admin'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; role: string; status: string; provider: string }>,
  credentials: [] as Array<{ userId: string; passwordHash: string }>,
  isAdmin: true,
}))

vi.mock('../../middleware/admin', async () => {
  const actual = await vi.importActual<typeof import('../../middleware/admin')>('../../middleware/admin')
  return {
    ...actual,
    requireAdmin: async (c: any, next: () => Promise<void>) => {
      if (!state.isAdmin) return c.json({ error: 'Admin access required' }, 403)
      c.set('adminUser', { id: 'admin-1' })
      await next()
    },
  }
})

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    users: { findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null) },
    localCredentials: {
      findByUserId: vi.fn(
        async (userId: string) => state.credentials.find((credential) => credential.userId === userId) ?? null,
      ),
      update: vi.fn(async (userId: string, data: { passwordHash: string }) => {
        const credential = state.credentials.find((item) => item.userId === userId)
        if (!credential) return null
        credential.passwordHash = data.passwordHash
        return credential
      }),
      create: vi.fn(async (input: { userId: string; passwordHash: string }) => {
        state.credentials.push({ userId: input.userId, passwordHash: input.passwordHash })
        return input
      }),
    },
    adminLogs: { create: vi.fn(async () => undefined) },
  }),
}))

function buildApp() {
  const app = new Hono<AppEnv>()
  app.route('/api/admin', adminRoutes)
  return app
}

const app = buildApp()

beforeEach(() => {
  // 平台管理员由"初始管理员"通道建立：有用户行，但可能压根没有本地密码凭据
  state.users = [{ id: 'admin-1', username: 'platform-admin', role: 'admin', status: 'active', provider: 'local' }]
  state.credentials = []
  state.isAdmin = true
  vi.clearAllMocks()
})

describe('POST /api/admin/users/:userId/reset-password', () => {
  it('creates credentials when the user has none, instead of reporting a false success', async () => {
    const response = await app.request('/api/admin/users/admin-1/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'demo-pass-123' }),
    })

    expect(response.status).toBe(200)
    // 没有凭据行时必须新建：只 update 会静默什么都不做，管理员以为设好了却登不进去
    expect(state.credentials).toHaveLength(1)
    expect(state.credentials[0]).toMatchObject({ userId: 'admin-1' })
    expect(state.credentials[0].passwordHash).not.toBe('demo-pass-123')
  })

  it('updates the existing credentials in place', async () => {
    state.credentials = [{ userId: 'admin-1', passwordHash: 'old-hash' }]

    await app.request('/api/admin/users/admin-1/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'another-pass-123' }),
    })

    expect(state.credentials).toHaveLength(1)
    expect(state.credentials[0].passwordHash).not.toBe('old-hash')
  })

  it('rejects a short password and an unknown user', async () => {
    const short = await app.request('/api/admin/users/admin-1/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: '123' }),
    })
    expect(short.status).toBe(400)

    const missing = await app.request('/api/admin/users/missing/reset-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: 'demo-pass-123' }),
    })
    expect(missing.status).toBe(404)
  })
})
