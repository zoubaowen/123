import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import adminRoutes from '../admin'
import type { AppEnv } from '../../middleware/admin'

const state = vi.hoisted(() => ({
  members: [] as Array<{ id: string; institutionId: string; userId: string; role: string; status: string }>,
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
    users: { findById: vi.fn(async () => null) },
    institutions: {
      findById: vi.fn(async (id: string) => (id === 'i1' ? { id: 'i1', name: '示例机构', status: 'active' } : null)),
    },
    institutionMembers: {
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
      updateRole: vi.fn(async (institutionId: string, userId: string, role: string) => {
        const member = state.members.find((item) => item.institutionId === institutionId && item.userId === userId)
        if (!member) return null
        member.role = role
        return member
      }),
      remove: vi.fn(async (institutionId: string, userId: string) => {
        const index = state.members.findIndex((item) => item.institutionId === institutionId && item.userId === userId)
        if (index < 0) return false
        state.members.splice(index, 1)
        return true
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

function request(path: string, options: { method?: string; body?: unknown } = {}) {
  return app.request(path, {
    method: options.method ?? 'GET',
    ...(options.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) }),
  })
}

beforeEach(() => {
  state.members = [{ id: 'm1', institutionId: 'i1', userId: 'teacher-1', role: 'teacher', status: 'active' }]
  state.isAdmin = true
  vi.clearAllMocks()
})

describe('PATCH /api/admin/institutions/:institutionId/members/:userId', () => {
  it('changes the member role without rebuilding the membership', async () => {
    const response = await request('/api/admin/institutions/i1/members/teacher-1', {
      method: 'PATCH',
      body: { role: 'admin' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ member: { userId: 'teacher-1', role: 'admin' } })
  })

  it('rejects an invalid role and reports an unknown membership', async () => {
    await expect(
      (
        await request('/api/admin/institutions/i1/members/teacher-1', {
          method: 'PATCH',
          body: { role: 'boss' },
        })
      ).json(),
    ).resolves.toEqual({ error: 'Invalid institution role' })

    const missing = await request('/api/admin/institutions/i1/members/teacher-9', {
      method: 'PATCH',
      body: { role: 'admin' },
    })
    expect(missing.status).toBe(404)
  })

  it('refuses a non-admin', async () => {
    state.isAdmin = false

    const response = await request('/api/admin/institutions/i1/members/teacher-1', {
      method: 'PATCH',
      body: { role: 'admin' },
    })

    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/admin/institutions/:institutionId/members/:userId', () => {
  it('removes the membership once and reports a missing one', async () => {
    const removed = await request('/api/admin/institutions/i1/members/teacher-1', { method: 'DELETE' })

    expect(removed.status).toBe(200)
    await expect(removed.json()).resolves.toEqual({ removed: true })

    const again = await request('/api/admin/institutions/i1/members/teacher-1', { method: 'DELETE' })
    expect(again.status).toBe(404)
  })

  it('refuses a non-admin', async () => {
    state.isAdmin = false

    expect((await request('/api/admin/institutions/i1/members/teacher-1', { method: 'DELETE' })).status).toBe(403)
    expect(state.members).toHaveLength(1)
  })
})
