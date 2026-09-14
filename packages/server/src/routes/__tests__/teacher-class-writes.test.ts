import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

interface EnrollmentRow {
  id: string
  classId: string
  studentUserId: string
  status: 'active' | 'left'
  joinedAt: number
  leftAt: number | null
}

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
  assignments: [] as Array<{ classId: string; userId: string; role: string; createdAt: number }>,
  enrollments: [] as EnrollmentRow[],
  created: [] as Array<Record<string, unknown>>,
  nextId: 1,
}))

const now = () => 1_000 + state.nextId

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
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    classes: {
      findById: vi.fn(async (id: string) => state.classes.find((item) => item.id === id) ?? null),
      create: vi.fn(async (input: Record<string, unknown>) => {
        const row = {
          id: String(input.id),
          institutionId: String(input.institutionId),
          name: String(input.name),
          aiUsageMode: String(input.aiUsageMode),
          xiaobaoCreditLimit: (input.xiaobaoCreditLimit ?? null) as number | null,
          status: 'active',
          archivedAt: null,
        }
        state.classes.push(row)
        state.created.push(row)
        return row
      }),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        const row = state.classes.find((item) => item.id === id)
        if (!row) return null
        Object.assign(row, data)
        return row
      }),
    },
    classTeachers: {
      findByClassAndUser: vi.fn(
        async (classId: string, userId: string) =>
          state.assignments.find((item) => item.classId === classId && item.userId === userId) ?? null,
      ),
    },
    classEnrollments: {
      listByClass: vi.fn(async (classId: string, options?: { includeLeft?: boolean }) =>
        state.enrollments.filter(
          (item) => item.classId === classId && (options?.includeLeft || item.status === 'active'),
        ),
      ),
      findByClassAndStudent: vi.fn(
        async (classId: string, studentUserId: string) =>
          state.enrollments.find((item) => item.classId === classId && item.studentUserId === studentUserId) ?? null,
      ),
      // 与真实仓储同语义：新建 / 复学复用同一条 / 已在班幂等
      enroll: vi.fn(async (input: { id: string; classId: string; studentUserId: string }) => {
        const existing = state.enrollments.find(
          (item) => item.classId === input.classId && item.studentUserId === input.studentUserId,
        )
        if (existing) {
          if (existing.status === 'active') return existing
          existing.status = 'active'
          existing.leftAt = null
          return existing
        }
        const row: EnrollmentRow = {
          id: input.id,
          classId: input.classId,
          studentUserId: input.studentUserId,
          status: 'active',
          joinedAt: now(),
          leftAt: null,
        }
        state.enrollments.push(row)
        return row
      }),
      leave: vi.fn(async (classId: string, studentUserId: string, leftAt: number) => {
        const existing = state.enrollments.find(
          (item) => item.classId === classId && item.studentUserId === studentUserId,
        )
        if (!existing || existing.status !== 'active') return null
        existing.status = 'left'
        existing.leftAt = leftAt
        return existing
      }),
    },
    // 班级视图会带上关联课包与进度；本文件只关心班级与名单写入，这里一律返回"没有课包"
    courses: { loadOutline: vi.fn(async () => null) },
    classCourses: { listByClass: vi.fn(async () => []) },
    lessonProgress: { listByClass: vi.fn(async () => []) },
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

function request(path: string, options: { userId?: string; method?: string; body?: Record<string, unknown> } = {}) {
  const headers: Record<string, string> = {}
  if (options.userId) headers['x-test-user'] = options.userId
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  return app.request(path, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', username: 'owner-1', name: '机构管理员', role: 'user', status: 'active' },
    { id: 'lead-1', username: 'lead-1', name: '李老师', role: 'user', status: 'active' },
    { id: 'student-1', username: 'student-1', name: '学生一', role: 'user', status: 'active' },
    { id: 'student-2', username: 'student-2', name: '学生二', role: 'user', status: 'active' },
    { id: 'platform-admin', username: 'admin', name: '平台管理员', role: 'admin', status: 'active' },
  ]
  state.institutions = [{ id: 'i1', name: '示例机构', status: 'active' }]
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
      id: 'c2',
      institutionId: 'i1',
      name: '四年级游戏 B 班',
      aiUsageMode: 'anytime',
      xiaobaoCreditLimit: null,
      status: 'active',
      archivedAt: null,
    },
  ]
  state.assignments = [{ classId: 'c1', userId: 'lead-1', role: 'lead', createdAt: 1 }]
  state.enrollments = [
    { id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active', joinedAt: 10, leftAt: null },
  ]
  state.created = []
  state.nextId = 1
  vi.clearAllMocks()
})

describe('POST /api/teacher/classes', () => {
  it('creates a class for an institution administrator', async () => {
    const response = await request('/api/teacher/classes', {
      userId: 'owner-1',
      method: 'POST',
      body: { name: '  三年级编程 C 班  ' },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { class: { id: string; name: string; aiUsageMode: string } }
    expect(payload.class).toMatchObject({ name: '三年级编程 C 班', aiUsageMode: 'class_only' })
    expect(state.classes.find((item) => item.id === payload.class.id)).toMatchObject({ institutionId: 'i1' })
  })

  it('honours the requested AI usage mode', async () => {
    const response = await request('/api/teacher/classes', {
      userId: 'owner-1',
      method: 'POST',
      body: { name: '随时可用班', aiUsageMode: 'anytime' },
    })

    const payload = (await response.json()) as { class: { aiUsageMode: string } }
    expect(payload.class.aiUsageMode).toBe('anytime')
  })

  it('refuses an invalid name or usage mode', async () => {
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(81) }, { name: 42 }]) {
      const response = await request('/api/teacher/classes', { userId: 'owner-1', method: 'POST', body })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid class name' })
    }

    const invalidMode = await request('/api/teacher/classes', {
      userId: 'owner-1',
      method: 'POST',
      body: { name: '班级', aiUsageMode: 'always' },
    })
    expect(invalidMode.status).toBe(400)
    await expect(invalidMode.json()).resolves.toEqual({ error: 'Invalid AI usage mode' })

    expect(state.created).toHaveLength(0)
  })

  it('refuses a plain teacher even though they run a class in the institution', async () => {
    const response = await request('/api/teacher/classes', {
      userId: 'lead-1',
      method: 'POST',
      body: { name: '私自开的班' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Institution role required' })
    expect(state.created).toHaveLength(0)
  })

  it('rejects a request without a session', async () => {
    const response = await request('/api/teacher/classes', { method: 'POST', body: { name: '班级' } })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/teacher/classes/:classId/students', () => {
  it('adds a student to the class', async () => {
    const response = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'student-2' },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      enrollment: { classId: 'c1', studentUserId: 'student-2', status: 'active' },
    })
    expect(state.enrollments.filter((item) => item.classId === 'c1')).toHaveLength(2)
  })

  it('is idempotent so a repeated submit does not create a second roster row', async () => {
    const first = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'student-1' },
    })
    const second = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'student-1' },
    })

    const firstPayload = (await first.json()) as { enrollment: { id: string } }
    const secondPayload = (await second.json()) as { enrollment: { id: string } }
    expect(secondPayload.enrollment.id).toBe(firstPayload.enrollment.id)
    expect(state.enrollments.filter((item) => item.classId === 'c1')).toHaveLength(1)
  })

  it('revives the same roster row when a left student comes back', async () => {
    await request('/api/teacher/classes/c1/students/student-1', { userId: 'owner-1', method: 'DELETE' })

    const response = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'student-1' },
    })

    const payload = (await response.json()) as { enrollment: { id: string; status: string; leftAt: number | null } }
    expect(payload.enrollment).toMatchObject({ id: 'e1', status: 'active', leftAt: null })
    expect(state.enrollments).toHaveLength(1)
  })

  it('refuses an unknown student, a platform administrator and a missing field', async () => {
    const unknown = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'ghost' },
    })
    expect(unknown.status).toBe(404)

    // 平台运维管理员不属于任何班级名单，加进去只会造成权限困惑
    const administrator = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: { studentUserId: 'platform-admin' },
    })
    expect(administrator.status).toBe(400)
    await expect(administrator.json()).resolves.toEqual({ error: 'Invalid student' })

    const missing = await request('/api/teacher/classes/c1/students', {
      userId: 'owner-1',
      method: 'POST',
      body: {},
    })
    expect(missing.status).toBe(400)

    expect(state.enrollments).toHaveLength(1)
  })

  it('refuses a plain teacher managing the roster of their own class', async () => {
    const response = await request('/api/teacher/classes/c1/students', {
      userId: 'lead-1',
      method: 'POST',
      body: { studentUserId: 'student-2' },
    })

    expect(response.status).toBe(403)
    expect(state.enrollments).toHaveLength(1)
  })

  it('refuses a class the caller cannot reach', async () => {
    const response = await request('/api/teacher/classes/c2/students', {
      userId: 'lead-1',
      method: 'POST',
      body: { studentUserId: 'student-2' },
    })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Class access required' })
  })
})

describe('DELETE /api/teacher/classes/:classId/students/:studentId', () => {
  it('writes a leave marker and keeps the roster row for history', async () => {
    const response = await request('/api/teacher/classes/c1/students/student-1', {
      userId: 'owner-1',
      method: 'DELETE',
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { enrollment: { status: string; leftAt: number | null } }
    expect(payload.enrollment.status).toBe('left')
    expect(payload.enrollment.leftAt).toBeGreaterThan(0)

    // 记录没有被删除：历史课堂与作品仍能定位归属
    expect(state.enrollments).toHaveLength(1)
    expect(state.enrollments[0]).toMatchObject({ id: 'e1', status: 'left' })
    // 在班名单里消失
    expect(state.enrollments.filter((item) => item.status === 'active')).toHaveLength(0)
  })

  it('refuses removing a student who is not on the active roster', async () => {
    const notEnrolled = await request('/api/teacher/classes/c1/students/student-2', {
      userId: 'owner-1',
      method: 'DELETE',
    })
    expect(notEnrolled.status).toBe(404)
    await expect(notEnrolled.json()).resolves.toEqual({ error: 'Student is not enrolled' })

    await request('/api/teacher/classes/c1/students/student-1', { userId: 'owner-1', method: 'DELETE' })
    const twice = await request('/api/teacher/classes/c1/students/student-1', {
      userId: 'owner-1',
      method: 'DELETE',
    })
    expect(twice.status).toBe(404)
  })

  it('refuses a plain teacher removing a student', async () => {
    const response = await request('/api/teacher/classes/c1/students/student-1', {
      userId: 'lead-1',
      method: 'DELETE',
    })

    expect(response.status).toBe(403)
    expect(state.enrollments[0].status).toBe('active')
  })
})

describe('PUT /api/teacher/classes/:classId/budget', () => {
  it('sets and clears the class-shared cap for an institution administrator', async () => {
    const set = await request('/api/teacher/classes/c1/budget', {
      userId: 'owner-1',
      method: 'PUT',
      body: { creditLimit: 300 },
    })

    expect(set.status).toBe(200)
    await expect(set.json()).resolves.toMatchObject({ class: { id: 'c1', xiaobaoCreditLimit: 300 } })
    expect(state.classes.find((item) => item.id === 'c1')?.xiaobaoCreditLimit).toBe(300)

    const cleared = await request('/api/teacher/classes/c1/budget', {
      userId: 'owner-1',
      method: 'PUT',
      body: { creditLimit: null },
    })
    await expect(cleared.json()).resolves.toMatchObject({ class: { xiaobaoCreditLimit: null } })
  })

  it('refuses caps the runtime reader would treat as misconfigured', async () => {
    // NaN/Infinity 无法通过 JSON 传输（会序列化成 null），这里覆盖真正能到达服务端的非法值
    for (const creditLimit of [0, -3, 12.5, '300', true]) {
      const response = await request('/api/teacher/classes/c1/budget', {
        userId: 'owner-1',
        method: 'PUT',
        body: { creditLimit },
      })

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid credit limit' })
    }
    expect(state.classes.find((item) => item.id === 'c1')?.xiaobaoCreditLimit).toBeNull()
  })

  it('refuses a request that omits the field so a cap is never cleared by accident', async () => {
    const response = await request('/api/teacher/classes/c1/budget', {
      userId: 'owner-1',
      method: 'PUT',
      body: {},
    })

    expect(response.status).toBe(400)
  })

  it('refuses a plain teacher and a class the caller cannot reach', async () => {
    const lead = await request('/api/teacher/classes/c1/budget', {
      userId: 'lead-1',
      method: 'PUT',
      body: { creditLimit: 100 },
    })
    expect(lead.status).toBe(403)
    await expect(lead.json()).resolves.toEqual({ error: 'Institution role required' })

    const otherClass = await request('/api/teacher/classes/c2/budget', {
      userId: 'lead-1',
      method: 'PUT',
      body: { creditLimit: 100 },
    })
    expect(otherClass.status).toBe(403)
    await expect(otherClass.json()).resolves.toEqual({ error: 'Class access required' })
  })
})
