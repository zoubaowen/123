import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requireClassAccess, requireInstitutionMember } from '../teacher'
import type { AppEnv } from '../auth'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; status: string }>,
  institutions: [] as Array<{ id: string; name: string; status: string }>,
  members: [] as Array<{ id: string; institutionId: string; userId: string; role: string; status: string }>,
  assignments: [] as Array<{ classId: string; userId: string; role: string }>,
  classes: [] as Array<{ id: string; institutionId: string; status: string }>,
  membershipListReturnsNull: false,
}))

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    users: {
      findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null),
    },
    institutions: {
      findById: vi.fn(async (id: string) => state.institutions.find((item) => item.id === id) ?? null),
    },
    institutionMembers: {
      listByUserId: vi.fn(async (userId: string) =>
        state.membershipListReturnsNull ? null : state.members.filter((member) => member.userId === userId),
      ),
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    classTeachers: {
      findByClassAndUser: vi.fn(
        async (classId: string, userId: string) =>
          state.assignments.find((item) => item.classId === classId && item.userId === userId) ?? null,
      ),
    },
    classes: {
      findById: vi.fn(async (id: string) => state.classes.find((item) => item.id === id) ?? null),
    },
  }),
}))

/**
 * 用一个最小 Hono 应用承载中间件：`x-test-user` 头注入会话，方便逐条构造拒绝场景。
 */
function buildApp() {
  const app = new Hono<AppEnv>()

  app.use('*', async (c, next) => {
    const userId = c.req.header('x-test-user')
    if (userId) c.set('session', { user: { id: userId } } as AppEnv['Variables']['session'])
    await next()
  })

  app.use('/institutions/:institutionId/probe', requireInstitutionMember())
  app.get('/institutions/:institutionId/probe', (c) => c.json({ institutionId: c.get('institution')?.id }))

  app.use('/institutions/:institutionId/admin-probe', requireInstitutionMember(['owner', 'admin']))
  app.get('/institutions/:institutionId/admin-probe', (c) => c.json({ role: c.get('institutionMember')?.role }))

  app.use('/workspace-probe', requireInstitutionMember())
  app.get('/workspace-probe', (c) => c.json({ institutionId: c.get('institution')?.id }))

  app.use('/classes/:classId/probe', requireClassAccess())
  app.get('/classes/:classId/probe', (c) => c.json({ classId: c.get('teacherClass')?.id }))

  app.use('/classes/:classId/lead-probe', requireClassAccess({ leadOnly: true }))
  app.get('/classes/:classId/lead-probe', (c) => c.json({ ok: true }))

  app.use('/classes/:classId/admin-probe', requireClassAccess({ institutionAdminOnly: true }))
  app.get('/classes/:classId/admin-probe', (c) => c.json({ ok: true }))

  return app
}

const app = buildApp()

function probe(path: string, userId?: string) {
  return app.request(path, userId === undefined ? {} : { headers: { 'x-test-user': userId } })
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', status: 'active' },
    { id: 'admin-1', status: 'active' },
    { id: 'lead-1', status: 'active' },
    { id: 'assistant-1', status: 'active' },
    { id: 'other-teacher', status: 'active' },
    { id: 'student-1', status: 'active' },
    { id: 'disabled-1', status: 'disabled' },
  ]
  state.institutions = [
    { id: 'i1', name: '机构一', status: 'active' },
    { id: 'i2', name: '机构二', status: 'active' },
  ]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-admin', institutionId: 'i1', userId: 'admin-1', role: 'admin', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
    { id: 'm-assistant', institutionId: 'i1', userId: 'assistant-1', role: 'teacher', status: 'active' },
    { id: 'm-left', institutionId: 'i1', userId: 'other-teacher', role: 'teacher', status: 'left' },
    { id: 'm-other-institution', institutionId: 'i2', userId: 'other-teacher', role: 'admin', status: 'active' },
  ]
  state.assignments = [
    { classId: 'c1', userId: 'lead-1', role: 'lead' },
    { classId: 'c1', userId: 'assistant-1', role: 'assistant' },
  ]
  state.classes = [
    { id: 'c1', institutionId: 'i1', status: 'active' },
    { id: 'c2', institutionId: 'i1', status: 'active' },
    { id: 'c-other', institutionId: 'i2', status: 'active' },
  ]
  state.membershipListReturnsNull = false
  vi.clearAllMocks()
})

describe('requireInstitutionMember', () => {
  it('rejects a request without a session', async () => {
    const response = await probe('/institutions/i1/probe')

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rejects a session whose user row no longer exists', async () => {
    const response = await probe('/institutions/i1/probe', 'ghost')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Account is unavailable' })
  })

  it('rejects a disabled account even with a valid membership', async () => {
    state.members.push({
      id: 'm-disabled',
      institutionId: 'i1',
      userId: 'disabled-1',
      role: 'teacher',
      status: 'active',
    })

    const response = await probe('/institutions/i1/probe', 'disabled-1')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Account is disabled' })
  })

  it('rejects a user who is not a member of the institution', async () => {
    // 学生没有机构成员关系：教师后台一律拒绝
    const asStudent = await probe('/institutions/i1/probe', 'student-1')
    expect(asStudent.status).toBe(403)
    await expect(asStudent.json()).resolves.toEqual({ error: 'Institution access required' })

    // 跨机构：other-teacher 是 i2 的管理员，不能进 i1
    const crossInstitution = await probe('/institutions/i1/probe', 'other-teacher')
    expect(crossInstitution.status).toBe(403)
    await expect(crossInstitution.json()).resolves.toEqual({ error: 'Institution access required' })
  })

  it('rejects a membership that is no longer active', async () => {
    state.members = [{ id: 'm-left', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'left' }]

    const response = await probe('/institutions/i1/probe', 'lead-1')

    expect(response.status).toBe(403)
  })

  it('rejects a member whose role is not allowed by the route', async () => {
    const allowed = await probe('/institutions/i1/admin-probe', 'admin-1')
    expect(allowed.status).toBe(200)

    const denied = await probe('/institutions/i1/admin-probe', 'lead-1')
    expect(denied.status).toBe(403)
    await expect(denied.json()).resolves.toEqual({ error: 'Institution role required' })
  })

  it('returns 404 for an unknown institution', async () => {
    const response = await probe('/institutions/missing/probe', 'owner-1')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Institution not found' })
  })

  it('fails closed when the membership list cannot be determined', async () => {
    // 仓储返回 null = 无法确定；绝不能当成"没有成员关系"以外的任何放行语义
    state.membershipListReturnsNull = true

    const response = await probe('/institutions/i1/probe', 'owner-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Institution membership unavailable' })
  })

  it('resolves the only institution automatically for routes without an institution id', async () => {
    const response = await probe('/workspace-probe', 'lead-1')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ institutionId: 'i1' })
  })

  it('requires an explicit institution when the user belongs to several', async () => {
    state.members.push({ id: 'm-lead-i2', institutionId: 'i2', userId: 'lead-1', role: 'teacher', status: 'active' })

    const response = await probe('/workspace-probe', 'lead-1')

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Institution required' })
  })
})

describe('requireClassAccess', () => {
  it('rejects a request without a session', async () => {
    const response = await probe('/classes/c1/probe')

    expect(response.status).toBe(401)
  })

  it('lets an institution owner or admin reach any class in that institution', async () => {
    await expect((await probe('/classes/c1/probe', 'admin-1')).json()).resolves.toEqual({ classId: 'c1' })
    await expect((await probe('/classes/c2/probe', 'owner-1')).json()).resolves.toEqual({ classId: 'c2' })
  })

  it('lets the lead and assistant teacher reach their own class', async () => {
    await expect((await probe('/classes/c1/probe', 'lead-1')).json()).resolves.toEqual({ classId: 'c1' })
    await expect((await probe('/classes/c1/probe', 'assistant-1')).json()).resolves.toEqual({ classId: 'c1' })
  })

  it('rejects a teacher from another class', async () => {
    const response = await probe('/classes/c2/probe', 'lead-1')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Class access required' })
  })

  it('rejects an administrator of another institution', async () => {
    const response = await probe('/classes/c1/probe', 'other-teacher')

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Class access required' })
  })

  it('rejects a student', async () => {
    const response = await probe('/classes/c1/probe', 'student-1')

    expect(response.status).toBe(403)
  })

  it('requires the lead role where the route is restricted to it', async () => {
    const lead = await probe('/classes/c1/lead-probe', 'lead-1')
    expect(lead.status).toBe(200)

    // 协助老师不能开课/下课：默认只有 lead 能做
    const assistant = await probe('/classes/c1/lead-probe', 'assistant-1')
    expect(assistant.status).toBe(403)

    // 机构管理员不受教师角色限制
    const admin = await probe('/classes/c1/lead-probe', 'admin-1')
    expect(admin.status).toBe(200)
  })

  it('restricts roster maintenance to institution administrators', async () => {
    // 机构管理员可以维护本机构任意班级的名单
    const admin = await probe('/classes/c1/admin-probe', 'admin-1')
    expect(admin.status).toBe(200)

    // 任课老师够得着这个班，但名单维护只允许机构管理员
    const lead = await probe('/classes/c1/admin-probe', 'lead-1')
    expect(lead.status).toBe(403)
    await expect(lead.json()).resolves.toEqual({ error: 'Institution role required' })

    // 够不着这个班的老师则是另一种拒绝：两种文案必须能区分，否则排查时分不清原因
    const otherClass = await probe('/classes/c2/admin-probe', 'lead-1')
    expect(otherClass.status).toBe(403)
    await expect(otherClass.json()).resolves.toEqual({ error: 'Class access required' })
  })

  it('returns 404 for an unknown class', async () => {
    const response = await probe('/classes/missing/probe', 'admin-1')

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Class not found' })
  })
})
