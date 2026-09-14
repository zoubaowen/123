import { beforeEach, describe, expect, it, vi } from 'vitest'

interface InstitutionRow {
  id: string
  name: string
  status: 'active' | 'archived'
  createdAt: number
  updatedAt: number
}

interface MemberRow {
  id: string
  institutionId: string
  userId: string
  role: 'owner' | 'admin' | 'teacher'
  status: 'active' | 'left'
  createdAt: number
  updatedAt: number
}

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string }>,
  institutions: [] as InstitutionRow[],
  members: [] as MemberRow[],
  logs: [] as Array<Record<string, unknown>>,
  listAllReturnsNull: false,
  nextId: 1,
}))

vi.mock('../../middleware/admin', () => ({
  requireAdmin: async (c: any, next: () => Promise<void>) => {
    c.set('adminUser', { id: 'admin-1', role: 'admin', username: 'admin' })
    await next()
  },
}))

vi.mock('../../db/index.js', () => {
  const now = () => 1_000 + state.nextId

  return {
    getDb: () => ({
      users: {
        findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null),
      },
      institutions: {
        findById: vi.fn(async (id: string) => state.institutions.find((item) => item.id === id) ?? null),
        create: vi.fn(async (input: { id: string; name: string; status: 'active' | 'archived' }) => {
          const row: InstitutionRow = { ...input, createdAt: now(), updatedAt: now() }
          state.institutions.push(row)
          return row
        }),
        listAll: vi.fn(async () => (state.listAllReturnsNull ? null : [...state.institutions])),
        listForUser: vi.fn(async (userId: string) => {
          const institutionIds = state.members
            .filter((member) => member.userId === userId && member.status === 'active')
            .map((member) => member.institutionId)
          return state.institutions.filter((item) => institutionIds.includes(item.id))
        }),
      },
      institutionMembers: {
        findByInstitutionAndUser: vi.fn(
          async (institutionId: string, userId: string) =>
            state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
        ),
        create: vi.fn(async (input: Omit<MemberRow, 'createdAt' | 'updatedAt'>) => {
          const duplicate = state.members.some(
            (member) => member.institutionId === input.institutionId && member.userId === input.userId,
          )
          if (duplicate) return null
          const row: MemberRow = { ...input, createdAt: now(), updatedAt: now() }
          state.members.push(row)
          return row
        }),
        listByInstitutionId: vi.fn(async (institutionId: string) =>
          state.members.filter((member) => member.institutionId === institutionId),
        ),
      },
      adminLogs: {
        create: vi.fn(async (log: Record<string, unknown>) => {
          state.logs.push(log)
          return log
        }),
      },
    }),
  }
})

vi.setConfig({ testTimeout: 30_000 })

async function adminRequest(path: string, method = 'GET', body?: Record<string, unknown>) {
  const { default: adminRouter } = await import('../admin.js')
  return adminRouter.request(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
}

beforeEach(() => {
  state.users = [
    { id: 'teacher-1', username: 'teacher-1' },
    { id: 'teacher-2', username: 'teacher-2' },
  ]
  state.institutions = []
  state.members = []
  state.logs = []
  state.listAllReturnsNull = false
  state.nextId = 1
  vi.clearAllMocks()
})

describe('admin institution endpoints', () => {
  it('creates an institution with a trimmed name and records an audit log', async () => {
    const response = await adminRequest('/institutions', 'POST', { name: '  示例机构  ' })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { institution: InstitutionRow }
    expect(payload.institution).toMatchObject({ name: '示例机构', status: 'active' })
    expect(payload.institution.id).toBeTruthy()

    expect(state.institutions).toHaveLength(1)
    expect(state.logs).toHaveLength(1)
    expect(state.logs[0]).toMatchObject({ adminUserId: 'admin-1', action: 'institution_create' })
  })

  it('refuses an empty or oversized institution name', async () => {
    for (const name of ['', '   ', 'x'.repeat(81), 42, undefined]) {
      const response = await adminRequest('/institutions', 'POST', { name })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid institution name' })
    }
    expect(state.institutions).toHaveLength(0)
    expect(state.logs).toHaveLength(0)
  })

  it('lists institutions and fails closed when the list cannot be determined', async () => {
    await adminRequest('/institutions', 'POST', { name: '示例机构' })

    const response = await adminRequest('/institutions')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      institutions: [expect.objectContaining({ name: '示例机构' })],
    })

    // 仓储返回 null = 无法确定，绝不能当成"没有机构"
    state.listAllReturnsNull = true
    const unavailable = await adminRequest('/institutions')
    expect(unavailable.status).toBe(503)
    await expect(unavailable.json()).resolves.toEqual({ error: 'Institutions unavailable' })
  })

  it('assigns an institution role to a user and records an audit log', async () => {
    const created = (await (await adminRequest('/institutions', 'POST', { name: '示例机构' })).json()) as {
      institution: InstitutionRow
    }

    const response = await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'teacher-1',
      role: 'teacher',
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ member: { userId: 'teacher-1', role: 'teacher' } })
    expect(state.logs.at(-1)).toMatchObject({
      adminUserId: 'admin-1',
      action: 'institution_member_add',
      targetUserId: 'teacher-1',
    })
  })

  it('refuses an invalid role, an unknown user and an unknown institution', async () => {
    const created = (await (await adminRequest('/institutions', 'POST', { name: '示例机构' })).json()) as {
      institution: InstitutionRow
    }

    const invalidRole = await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'teacher-1',
      role: 'superuser',
    })
    expect(invalidRole.status).toBe(400)
    await expect(invalidRole.json()).resolves.toEqual({ error: 'Invalid institution role' })

    const unknownUser = await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'missing',
      role: 'teacher',
    })
    expect(unknownUser.status).toBe(404)

    const unknownInstitution = await adminRequest('/institutions/missing/members', 'POST', {
      userId: 'teacher-1',
      role: 'teacher',
    })
    expect(unknownInstitution.status).toBe(404)

    expect(state.members).toHaveLength(0)
  })

  it('reports a conflicting membership explicitly instead of silently succeeding', async () => {
    const created = (await (await adminRequest('/institutions', 'POST', { name: '示例机构' })).json()) as {
      institution: InstitutionRow
    }
    const path = `/institutions/${created.institution.id}/members`

    await adminRequest(path, 'POST', { userId: 'teacher-1', role: 'teacher' })
    const logsAfterFirst = state.logs.length
    const response = await adminRequest(path, 'POST', { userId: 'teacher-1', role: 'admin' })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'User is already a member' })
    // 冲突不得写第二条审计，也不得改动原成员关系
    expect(state.logs).toHaveLength(logsAfterFirst)
    expect(state.members).toHaveLength(1)
    expect(state.members[0].role).toBe('teacher')
  })

  it('lists the members of an institution and rejects an unknown one', async () => {
    const created = (await (await adminRequest('/institutions', 'POST', { name: '示例机构' })).json()) as {
      institution: InstitutionRow
    }
    await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'teacher-1',
      role: 'owner',
    })
    await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'teacher-2',
      role: 'teacher',
    })

    const response = await adminRequest(`/institutions/${created.institution.id}/members`)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      members: expect.arrayContaining([
        expect.objectContaining({ userId: 'teacher-1', role: 'owner' }),
        expect.objectContaining({ userId: 'teacher-2', role: 'teacher' }),
      ]),
    })

    const missing = await adminRequest('/institutions/missing/members')
    expect(missing.status).toBe(404)
  })

  it('lists the institutions a user belongs to', async () => {
    const created = (await (await adminRequest('/institutions', 'POST', { name: '示例机构' })).json()) as {
      institution: InstitutionRow
    }
    await adminRequest(`/institutions/${created.institution.id}/members`, 'POST', {
      userId: 'teacher-1',
      role: 'teacher',
    })

    const response = await adminRequest('/users/teacher-1/institutions')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      institutions: [expect.objectContaining({ name: '示例机构' })],
    })

    const other = await adminRequest('/users/teacher-2/institutions')
    await expect(other.json()).resolves.toEqual({ institutions: [] })
  })
})
