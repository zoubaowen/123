import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; name: string | null; role: string; status: string }>,
  institutions: [] as Array<{ id: string; name: string; status: string }>,
  members: [] as Array<{ id: string; institutionId: string; userId: string; role: string; status: string }>,
  classes: [] as Array<{
    id: string
    institutionId: string
    name: string
    aiUsageMode: string
    xiaobaoCreditLimit: number | null
    status: string
    archivedAt: number | null
  }>,
  enrollments: [] as Array<{ id: string; classId: string; studentUserId: string; status: string; joinedAt: number }>,
  /** 名单读取被截断，用来验证 fail-closed。 */
  enrollmentsReturnNull: false,
  /** 成员读取被截断，用来验证 fail-closed。 */
  membersReturnNull: false,
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
      listByUserId: vi.fn(async (userId: string) => state.members.filter((member) => member.userId === userId)),
      listByInstitutionId: vi.fn(async (institutionId: string) => {
        if (state.membersReturnNull) return null
        return state.members.filter((member) => member.institutionId === institutionId && member.status === 'active')
      }),
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    classes: {
      listByInstitution: vi.fn(async (institutionId: string) =>
        state.classes.filter((item) => item.institutionId === institutionId && item.status === 'active'),
      ),
    },
    classEnrollments: {
      listByClass: vi.fn(async (classId: string) => {
        if (state.enrollmentsReturnNull) return null
        return state.enrollments.filter((item) => item.classId === classId && item.status === 'active')
      }),
    },
    // 以下仓储本文件用不到，但路由模块会整体加载
    classTeachers: { findByClassAndUser: vi.fn(async () => null) },
    classCourses: { listByClass: vi.fn(async () => []) },
    courses: { loadOutline: vi.fn(async () => null) },
    lessonProgress: { listByClass: vi.fn(async () => []) },
    classSessions: { findActiveByClass: vi.fn(async () => null) },
  }),
}))

function buildApp() {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    const userId = c.req.header('x-test-user')
    if (userId) c.set('session', { user: { id: userId } } as AppEnv['Variables']['session'])
    await next()
  })
  app.route('/api/teacher', teacherRoutes)
  return app
}

const app = buildApp()

function request(path: string, userId?: string) {
  return app.request(path, userId === undefined ? {} : { headers: { 'x-test-user': userId } })
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', username: 'owner-1', name: '机构管理员', role: 'user', status: 'active' },
    { id: 'lead-1', username: 'lead-1', name: '李老师', role: 'user', status: 'active' },
    { id: 'student-1', username: 'xiaoyu', name: '陈小雨', role: 'user', status: 'active' },
    { id: 'student-2', username: 'zhouy', name: '周星宇', role: 'user', status: 'active' },
    { id: 'student-other', username: 'xiaoyu-other', name: '别机构的学生', role: 'user', status: 'active' },
    { id: 'platform-admin', username: 'admin', name: '平台管理员', role: 'admin', status: 'active' },
  ]
  state.institutions = [
    { id: 'i1', name: '示例机构', status: 'active' },
    { id: 'i2', name: '另一个机构', status: 'active' },
  ]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
  ]
  state.classes = [
    {
      id: 'c1',
      institutionId: 'i1',
      name: '二年级创作 A 班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: null,
      status: 'active',
      archivedAt: null,
    },
    {
      id: 'c-other',
      institutionId: 'i2',
      name: '别机构的班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: null,
      status: 'active',
      archivedAt: null,
    },
  ]
  state.enrollments = [
    { id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active', joinedAt: 1 },
    { id: 'e2', classId: 'c1', studentUserId: 'student-2', status: 'active', joinedAt: 2 },
    { id: 'e3', classId: 'c1', studentUserId: 'student-left', status: 'left', joinedAt: 3 },
    { id: 'e-other', classId: 'c-other', studentUserId: 'student-other', status: 'active', joinedAt: 4 },
  ]
  state.enrollmentsReturnNull = false
  state.membersReturnNull = false
  vi.clearAllMocks()
})

describe('GET /api/teacher/students', () => {
  it('lists the students enrolled in the institution for an administrator', async () => {
    const response = await request('/api/teacher/students', 'owner-1')

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { students: Array<{ id: string; name: string; username: string }> }
    expect(payload.students.map((item) => item.id).sort()).toEqual(['student-1', 'student-2'])
    expect(payload.students.find((item) => item.id === 'student-1')).toMatchObject({
      name: '陈小雨',
      username: 'xiaoyu',
    })
  })

  it('matches on both display name and username', async () => {
    const byName = (await (await request('/api/teacher/students?query=小雨', 'owner-1')).json()) as {
      students: Array<{ id: string }>
    }
    expect(byName.students.map((item) => item.id)).toEqual(['student-1'])

    const byUsername = (await (await request('/api/teacher/students?query=zhouy', 'owner-1')).json()) as {
      students: Array<{ id: string }>
    }
    expect(byUsername.students.map((item) => item.id)).toEqual(['student-2'])

    const noMatch = (await (await request('/api/teacher/students?query=不存在', 'owner-1')).json()) as {
      students: unknown[]
    }
    expect(noMatch.students).toEqual([])
  })

  it('never returns a student of another institution, even when the username matches', async () => {
    const response = await request('/api/teacher/students?query=xiaoyu', 'owner-1')

    const payload = (await response.json()) as { students: Array<{ id: string }> }
    // student-other 的用户名也含 xiaoyu，但他在别的机构：跨机构泄露是这里最严重的错误
    expect(payload.students.map((item) => item.id)).toEqual(['student-1'])
  })

  it('refuses plain teachers, and platform administrators without an institution', async () => {
    const teacher = await request('/api/teacher/students', 'lead-1')
    expect(teacher.status).toBe(403)

    // 平台运维管理员不属于任何机构：拿不到机构就无从圈定"本机构的学生"
    const platformAdmin = await request('/api/teacher/students', 'platform-admin')
    expect(platformAdmin.status).toBe(400)

    const anonymous = await request('/api/teacher/students')
    expect(anonymous.status).toBe(401)
  })

  it('reports 503 instead of a short list when the roster read is truncated', async () => {
    state.enrollmentsReturnNull = true

    const response = await request('/api/teacher/students', 'owner-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Students unavailable' })
  })

  it('does not list students who already left the class', async () => {
    const response = await request('/api/teacher/students?query=student-left', 'owner-1')

    const payload = (await response.json()) as { students: unknown[] }
    expect(payload.students).toEqual([])
  })
})

describe('GET /api/teacher/teachers', () => {
  it('lists the institution members an administrator can assign to a class', async () => {
    const response = await request('/api/teacher/teachers', 'owner-1')

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      teachers: Array<{ userId: string; name: string; username: string; role: string }>
    }
    // 分配任课老师时要能看出谁是机构管理员、谁是普通老师；顺序按中文拼音（机 < 李），结果确定
    expect(payload.teachers).toEqual([
      { userId: 'owner-1', name: '机构管理员', username: 'owner-1', role: 'owner' },
      { userId: 'lead-1', name: '李老师', username: 'lead-1', role: 'teacher' },
    ])
  })

  it('matches on name or username and ignores members of other institutions', async () => {
    state.members.push({
      id: 'm-other',
      institutionId: 'i2',
      userId: 'student-other',
      role: 'teacher',
      status: 'active',
    })

    const byName = (await (await request('/api/teacher/teachers?query=李老师', 'owner-1')).json()) as {
      teachers: Array<{ userId: string }>
    }
    expect(byName.teachers.map((item) => item.userId)).toEqual(['lead-1'])

    const other = (await (await request('/api/teacher/teachers?query=student-other', 'owner-1')).json()) as {
      teachers: unknown[]
    }
    expect(other.teachers).toEqual([])

    const noMatch = (await (await request('/api/teacher/teachers?query=不存在', 'owner-1')).json()) as {
      teachers: unknown[]
    }
    expect(noMatch.teachers).toEqual([])
  })

  it('skips members whose user row is missing instead of inventing a name', async () => {
    state.members.push({ id: 'm-ghost', institutionId: 'i1', userId: 'ghost', role: 'teacher', status: 'active' })

    const response = await request('/api/teacher/teachers', 'owner-1')

    const payload = (await response.json()) as { teachers: Array<{ userId: string }> }
    expect(payload.teachers.map((item) => item.userId)).not.toContain('ghost')
  })

  it('refuses plain teachers and platform administrators', async () => {
    expect((await request('/api/teacher/teachers', 'lead-1')).status).toBe(403)
    expect((await request('/api/teacher/teachers', 'platform-admin')).status).toBe(400)
    expect((await request('/api/teacher/teachers')).status).toBe(401)
  })

  it('reports 503 instead of a short list when the member read is truncated', async () => {
    state.membersReturnNull = true

    const response = await request('/api/teacher/teachers', 'owner-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Teachers unavailable' })
  })
})
