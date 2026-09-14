import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import adminRoutes from '../admin'
import type { AppEnv } from '../../middleware/admin'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; name: string | null; role: string; status: string }>,
  /** 当前请求是否被视为平台管理员。 */
  isAdmin: true,
  throwOnLookup: false,
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
    users: {
      findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null),
      findByProviderAndExternalId: vi.fn(async (provider: string, externalId: string) => {
        if (state.throwOnLookup) throw new Error('unavailable')
        if (provider !== 'local') return null
        return state.users.find((user) => user.username === externalId) ?? null
      }),
    },
  }),
}))

function buildApp() {
  const app = new Hono<AppEnv>()
  app.route('/api/admin', adminRoutes)
  return app
}

const app = buildApp()

function request(path: string) {
  return app.request(path)
}

beforeEach(() => {
  state.users = [
    { id: 'user-1', username: 'teacher-li', name: '李老师', role: 'user', status: 'active' },
    { id: 'user-2', username: 'student-yu', name: null, role: 'user', status: 'disabled' },
  ]
  state.isAdmin = true
  state.throwOnLookup = false
  vi.clearAllMocks()
})

describe('GET /api/admin/users/lookup', () => {
  it('finds a user by exact username so an institution member can be added by account', async () => {
    const response = await request('/api/admin/users/lookup?username=teacher-li')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      user: { id: 'user-1', username: 'teacher-li', name: '李老师', role: 'user', status: 'active' },
    })
  })

  it('falls back to the username when the display name is missing', async () => {
    const response = await request('/api/admin/users/lookup?username=student-yu')

    const payload = (await response.json()) as { user: { name: string; status: string } }
    expect(payload.user).toMatchObject({ name: 'student-yu', status: 'disabled' })
  })

  it('rejects a blank username and reports an unknown one as 404', async () => {
    expect((await request('/api/admin/users/lookup')).status).toBe(400)
    expect((await request('/api/admin/users/lookup?username=%20')).status).toBe(400)
    expect((await request('/api/admin/users/lookup?username=missing')).status).toBe(404)
  })

  it('never lets a non-admin use the lookup', async () => {
    state.isAdmin = false

    expect((await request('/api/admin/users/lookup?username=teacher-li')).status).toBe(403)
  })

  it('reports a failed lookup as an error instead of "user not found"', async () => {
    state.throwOnLookup = true

    const response = await request('/api/admin/users/lookup?username=teacher-li')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'User lookup unavailable' })
  })
})
