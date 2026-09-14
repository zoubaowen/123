import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

interface SessionRow {
  id: string
  classId: string
  lessonId: string
  startedByUserId: string
  startedAt: number
  endedAt: number | null
  durationMinutes: number | null
  pointLimit: number
  capabilities: string
  skills: string
  mcpServers: string
  studentCount: number | null
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
  enrollments: [] as Array<{ id: string; classId: string; studentUserId: string; status: string; joinedAt: number }>,
  sessions: [] as SessionRow[],
  /** 覆盖 `findActiveByClass`，用来模拟"读不出来"。 */
  activeThrows: false,
  nextId: 1,
}))

/** 一节课 40 分钟；课时里配置了 writing 能力。 */
const outline = {
  course: {
    id: 'course-1',
    institutionId: 'i1',
    title: 'AI 太空海报创作营',
    description: '',
    coverAsset: '',
    stage: 'lower_primary',
    topic: '视觉创作',
    status: 'ready',
    ageRange: '8-10 岁',
    goals: '[]',
    expectedOutcome: '',
    createdAt: 1,
    updatedAt: 1,
  },
  chapters: [
    {
      chapter: { id: 'chapter-1', courseId: 'course-1', title: '第一章', sortOrder: 1 },
      lessons: [
        {
          lesson: {
            id: 'lesson-1',
            chapterId: 'chapter-1',
            title: '第一课时',
            sortOrder: 1,
            durationMinutes: 40,
            objectives: '[]',
            steps: '[]',
            teacherTips: '[]',
            assignment: '',
            capabilities: JSON.stringify(['writing']),
            skills: JSON.stringify(['story']),
            mcpServers: '[]',
          },
          resources: [],
        },
      ],
    },
  ],
}

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
      listByInstitution: vi.fn(async (institutionId: string) =>
        state.classes.filter((item) => item.institutionId === institutionId && item.status === 'active'),
      ),
      listByTeacher: vi.fn(async (userId: string) => {
        const classIds = state.assignments.filter((item) => item.userId === userId).map((item) => item.classId)
        return state.classes.filter((item) => classIds.includes(item.id) && item.status === 'active')
      }),
    },
    classTeachers: {
      findByClassAndUser: vi.fn(
        async (classId: string, userId: string) =>
          state.assignments.find((item) => item.classId === classId && item.userId === userId) ?? null,
      ),
      listByClass: vi.fn(async (classId: string) => state.assignments.filter((item) => item.classId === classId)),
      create: vi.fn(async (input: { classId: string; userId: string; role: string }) => {
        const existing = state.assignments.find(
          (item) => item.classId === input.classId && item.userId === input.userId,
        )
        if (existing) return null
        const row = { classId: input.classId, userId: input.userId, role: input.role, createdAt: 1 }
        state.assignments.push(row)
        return row
      }),
      remove: vi.fn(async (classId: string, userId: string) => {
        const index = state.assignments.findIndex((item) => item.classId === classId && item.userId === userId)
        if (index < 0) return false
        state.assignments.splice(index, 1)
        return true
      }),
    },
    classEnrollments: {
      listByClass: vi.fn(async (classId: string) =>
        state.enrollments.filter((item) => item.classId === classId && item.status === 'active'),
      ),
    },
    classCourses: {
      listByClass: vi.fn(async (classId: string) =>
        classId === 'c1' ? [{ classId: 'c1', courseId: 'course-1', assignedAt: 1 }] : [],
      ),
    },
    courses: {
      loadOutline: vi.fn(async () => outline),
      // 工作区还会带回机构课包列表；本文件只关心课堂，因此返回空列表
      listByInstitution: vi.fn(async () => []),
    },
    lessonProgress: { listByClass: vi.fn(async () => []) },
    classSessions: {
      create: vi.fn(async (input: Partial<SessionRow>) => {
        const row: SessionRow = {
          id: String(input.id),
          classId: String(input.classId),
          lessonId: String(input.lessonId),
          startedByUserId: String(input.startedByUserId),
          startedAt: Number(input.startedAt),
          endedAt: input.endedAt ?? null,
          durationMinutes: input.durationMinutes ?? null,
          pointLimit: Number(input.pointLimit),
          capabilities: String(input.capabilities ?? '[]'),
          skills: String(input.skills ?? '[]'),
          mcpServers: String(input.mcpServers ?? '[]'),
          studentCount: input.studentCount ?? null,
        }
        state.sessions.push(row)
        return row
      }),
      findById: vi.fn(async (id: string) => state.sessions.find((item) => item.id === id) ?? null),
      findActiveByClass: vi.fn(async (classId: string) => {
        if (state.activeThrows) throw new Error('Class session state unavailable')
        return state.sessions.find((item) => item.classId === classId && item.endedAt === null) ?? null
      }),
      listByClass: vi.fn(async (classId: string) =>
        state.sessions
          .filter((item) => item.classId === classId)
          .sort((left, right) => right.startedAt - left.startedAt),
      ),
      update: vi.fn(async (id: string, patch: Partial<SessionRow>) => {
        const row = state.sessions.find((item) => item.id === id)
        if (!row) return null
        if (row.endedAt !== null && patch.endedAt !== undefined) return row
        Object.assign(row, patch)
        return row
      }),
    },
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
    { id: 'assistant-1', username: 'assistant-1', name: '助教老师', role: 'user', status: 'active' },
    { id: 'other-1', username: 'other-1', name: '别的老师', role: 'user', status: 'active' },
    { id: 'student-1', username: 'student-1', name: '学生一', role: 'user', status: 'active' },
    { id: 'student-2', username: 'student-2', name: '学生二', role: 'user', status: 'active' },
  ]
  state.institutions = [{ id: 'i1', name: '示例机构', status: 'active' }]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
    { id: 'm-assistant', institutionId: 'i1', userId: 'assistant-1', role: 'teacher', status: 'active' },
    { id: 'm-other', institutionId: 'i1', userId: 'other-1', role: 'teacher', status: 'active' },
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
  ]
  state.assignments = [
    { classId: 'c1', userId: 'lead-1', role: 'lead', createdAt: 1 },
    { classId: 'c1', userId: 'assistant-1', role: 'assistant', createdAt: 1 },
  ]
  state.enrollments = [
    { id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active', joinedAt: 10 },
    { id: 'e2', classId: 'c1', studentUserId: 'student-2', status: 'active', joinedAt: 11 },
  ]
  state.sessions = []
  state.activeThrows = false
  state.nextId = 1
  vi.clearAllMocks()
})

function openClass(body: Record<string, unknown> = {}) {
  return request('/api/teacher/classes/c1/sessions', {
    userId: 'lead-1',
    method: 'POST',
    body: { lessonId: 'lesson-1', pointLimit: 100, ...body },
  })
}

describe('POST /api/teacher/classes/:classId/sessions', () => {
  it('records the class with the lesson capabilities and the roster snapshot', async () => {
    const response = await openClass()

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { session: Record<string, unknown> }
    expect(payload.session).toMatchObject({
      classId: 'c1',
      className: '二年级创作 A 班',
      lessonId: 'lesson-1',
      lessonTitle: '第一课时',
      pointLimit: 100,
      // 开课时名单读得到，就存真实人数
      studentCount: 2,
      // 进行中的课堂没有结束时间与时长
      endedAt: null,
      durationMinutes: null,
      // 没显式指定能力时按课时配置放行
      capabilities: ['writing'],
    })
    expect(typeof payload.session.startedAt).toBe('number')
    expect(state.sessions).toHaveLength(1)
  })

  it('lets an explicit capability list override the lesson defaults', async () => {
    const response = await openClass({ capabilities: ['learning', 'game', 'learning'] })

    const payload = (await response.json()) as { session: { capabilities: string[] } }
    expect(payload.session.capabilities).toEqual(['learning', 'game'])
    expect(state.sessions[0].capabilities).toBe(JSON.stringify(['learning', 'game']))
  })

  it('is idempotent when the teacher clicks start twice', async () => {
    const first = (await (await openClass()).json()) as { session: { id: string } }
    const second = await openClass({ lessonId: 'lesson-1' })

    const payload = (await second.json()) as { session: { id: string } }
    expect(second.status).toBe(200)
    expect(payload.session.id).toBe(first.session.id)
    expect(state.sessions).toHaveLength(1)
  })

  it('rejects an invalid point limit, capability, or lesson', async () => {
    await expect((await openClass({ pointLimit: 0 })).json()).resolves.toEqual({ error: 'Invalid point limit' })
    await expect((await openClass({ pointLimit: '200' })).json()).resolves.toEqual({ error: 'Invalid point limit' })
    await expect((await openClass({ capabilities: ['not-a-capability'] })).json()).resolves.toEqual({
      error: 'Invalid capability',
    })
    await expect((await openClass({ capabilities: 'writing' })).json()).resolves.toEqual({
      error: 'Invalid capability',
    })
    await expect((await openClass({ lessonId: 'lesson-999' })).json()).resolves.toEqual({
      error: 'Lesson is not in this class course',
    })
    expect(state.sessions).toHaveLength(0)
  })

  it('refuses assistant teachers and teachers of other classes', async () => {
    const assistant = await request('/api/teacher/classes/c1/sessions', {
      userId: 'assistant-1',
      method: 'POST',
      body: { lessonId: 'lesson-1', pointLimit: 100 },
    })
    expect(assistant.status).toBe(403)
    await expect(assistant.json()).resolves.toEqual({ error: 'Class access required' })

    const other = await request('/api/teacher/classes/c1/sessions', {
      userId: 'other-1',
      method: 'POST',
      body: { lessonId: 'lesson-1', pointLimit: 100 },
    })
    expect(other.status).toBe(403)

    const anonymous = await request('/api/teacher/classes/c1/sessions', {
      method: 'POST',
      body: { lessonId: 'lesson-1', pointLimit: 100 },
    })
    expect(anonymous.status).toBe(401)
    expect(state.sessions).toHaveLength(0)
  })

  it('answers 503 instead of opening a second class when the running one cannot be read', async () => {
    state.activeThrows = true

    const response = await openClass()

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Class session state unavailable' })
    expect(state.sessions).toHaveLength(0)
  })
})

describe('PUT /api/teacher/classes/:classId/sessions/:sessionId', () => {
  it('applies mid-class changes without touching the end time', async () => {
    await openClass()

    const response = await request(`/api/teacher/classes/c1/sessions/${state.sessions[0].id}`, {
      userId: 'lead-1',
      method: 'PUT',
      body: { pointLimit: 250, capabilities: ['learning'] },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { session: Record<string, unknown> }
    expect(payload.session).toMatchObject({ pointLimit: 250, capabilities: ['learning'], endedAt: null })
    // 其他字段不该被顺手改掉
    expect(payload.session.skills).toEqual([])
  })

  it('rejects an empty patch, an unknown session, and a session of another class', async () => {
    await openClass()
    const sessionId = state.sessions[0].id

    await expect(
      (
        await request(`/api/teacher/classes/c1/sessions/${sessionId}`, { userId: 'lead-1', method: 'PUT', body: {} })
      ).json(),
    ).resolves.toEqual({ error: 'No changes' })

    await expect(
      (
        await request('/api/teacher/classes/c1/sessions/missing', {
          userId: 'lead-1',
          method: 'PUT',
          body: { pointLimit: 10 },
        })
      ).json(),
    ).resolves.toEqual({ error: 'Class session not found' })

    state.sessions[0].classId = 'c2'
    await expect(
      (
        await request(`/api/teacher/classes/c1/sessions/${sessionId}`, {
          userId: 'lead-1',
          method: 'PUT',
          body: { pointLimit: 10 },
        })
      ).json(),
    ).resolves.toEqual({ error: 'Class session not found' })
  })

  it('refuses to change a class that already ended', async () => {
    await openClass()
    const sessionId = state.sessions[0].id
    state.sessions[0].endedAt = 5_000
    state.sessions[0].durationMinutes = 40

    const response = await request(`/api/teacher/classes/c1/sessions/${sessionId}`, {
      userId: 'lead-1',
      method: 'PUT',
      body: { pointLimit: 10 },
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'Class session already ended' })
  })
})

describe('POST /api/teacher/classes/:classId/sessions/:sessionId/end', () => {
  it('closes the class and clears the running state', async () => {
    await openClass()
    const sessionId = state.sessions[0].id
    state.sessions[0].startedAt = Date.now() - 40 * 60_000

    const response = await request(`/api/teacher/classes/c1/sessions/${sessionId}/end`, {
      userId: 'lead-1',
      method: 'POST',
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { session: Record<string, unknown> }
    expect(payload.session.durationMinutes).toBe(40)
    expect(typeof payload.session.endedAt).toBe('number')

    const active = state.sessions.find((item) => item.endedAt === null)
    expect(active).toBeUndefined()
  })

  it('is idempotent when the teacher closes twice', async () => {
    await openClass()
    const sessionId = state.sessions[0].id

    const first = (await (
      await request(`/api/teacher/classes/c1/sessions/${sessionId}/end`, { userId: 'lead-1', method: 'POST' })
    ).json()) as { session: { endedAt: number; durationMinutes: number } }
    const second = (await (
      await request(`/api/teacher/classes/c1/sessions/${sessionId}/end`, { userId: 'lead-1', method: 'POST' })
    ).json()) as { session: { endedAt: number; durationMinutes: number } }

    expect(second.session.endedAt).toBe(first.session.endedAt)
    expect(second.session.durationMinutes).toBe(first.session.durationMinutes)
  })

  it('rejects an unknown session and another class session', async () => {
    await openClass()
    const sessionId = state.sessions[0].id
    state.sessions[0].classId = 'c2'

    await expect(
      (await request('/api/teacher/classes/c1/sessions/missing/end', { userId: 'lead-1', method: 'POST' })).json(),
    ).resolves.toEqual({ error: 'Class session not found' })
    await expect(
      (await request(`/api/teacher/classes/c1/sessions/${sessionId}/end`, { userId: 'lead-1', method: 'POST' })).json(),
    ).resolves.toEqual({ error: 'Class session not found' })
  })
})

describe('GET /api/teacher/classes/:classId/sessions', () => {
  it('lists the classroom history newest first', async () => {
    await openClass()
    const firstId = state.sessions[0].id
    // 上一节课明显更早开始（同一毫秒开两节课属于异常输入，顺序另有 id 兜底）
    state.sessions[0].startedAt = Date.now() - 60 * 60_000
    state.sessions[0].endedAt = 2_000
    state.sessions[0].durationMinutes = 15
    await openClass({ lessonId: 'lesson-1' })

    const response = await request('/api/teacher/classes/c1/sessions', { userId: 'lead-1' })

    const payload = (await response.json()) as { sessions: Array<{ id: string; durationMinutes: number | null }> }
    expect(payload.sessions).toHaveLength(2)
    expect(payload.sessions[0].durationMinutes).toBeNull()
    expect(payload.sessions[1]).toMatchObject({ id: firstId, durationMinutes: 15 })
  })
})

describe('GET /api/teacher/workspace active session', () => {
  it('reports no active class before one is opened', async () => {
    const payload = (await (await request('/api/teacher/workspace', { userId: 'lead-1' })).json()) as {
      activeSession: unknown
    }

    expect(payload.activeSession).toBeNull()
  })

  it('reports the running class with its lesson title', async () => {
    await openClass()

    const payload = (await (await request('/api/teacher/workspace', { userId: 'lead-1' })).json()) as {
      activeSession: Record<string, unknown> | null
    }

    expect(payload.activeSession).toMatchObject({
      classId: 'c1',
      className: '二年级创作 A 班',
      lessonId: 'lesson-1',
      lessonTitle: '第一课时',
      studentCount: 2,
    })
  })

  it('answers 503 rather than claiming there is no running class', async () => {
    state.activeThrows = true

    const response = await request('/api/teacher/workspace', { userId: 'lead-1' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Class session state unavailable' })
  })
})

describe('PUT /api/teacher/classes/:classId/teachers', () => {
  function assignTeacher(body: Record<string, unknown>, userId = 'owner-1') {
    return request('/api/teacher/classes/c1/teachers', { userId, method: 'PUT', body })
  }

  it('assigns an institution teacher as the lead teacher', async () => {
    const response = await assignTeacher({ userId: 'other-1' })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { teacher: { userId: string; role: string } }
    expect(payload.teacher).toMatchObject({ userId: 'other-1', role: 'lead' })
    expect(state.assignments.filter((item) => item.userId === 'other-1')).toHaveLength(1)
  })

  it('is idempotent and re-assigns when the role changes', async () => {
    await assignTeacher({ userId: 'other-1', role: 'lead' })
    await assignTeacher({ userId: 'other-1', role: 'lead' })
    expect(state.assignments.filter((item) => item.userId === 'other-1')).toHaveLength(1)

    const demoted = await assignTeacher({ userId: 'other-1', role: 'assistant' })
    const payload = (await demoted.json()) as { teacher: { role: string } }
    expect(payload.teacher.role).toBe('assistant')
    // 改角色是重新分配：同一人在同一班只能有一条记录
    expect(state.assignments.filter((item) => item.userId === 'other-1')).toHaveLength(1)
  })

  it('lets the assigned teacher see and run the class afterwards', async () => {
    // 这正是这个接口存在的理由：没有它，普通老师永远看不到班级、也开不了课
    const before = await request('/api/teacher/classes/c1/sessions', {
      userId: 'other-1',
      method: 'POST',
      body: { lessonId: 'lesson-1', pointLimit: 100 },
    })
    expect(before.status).toBe(403)

    await assignTeacher({ userId: 'other-1' })

    const classes = (await (await request('/api/teacher/classes', { userId: 'other-1' })).json()) as {
      classes: Array<{ id: string }>
    }
    expect(classes.classes.map((item) => item.id)).toEqual(['c1'])

    const opened = await request('/api/teacher/classes/c1/sessions', {
      userId: 'other-1',
      method: 'POST',
      body: { lessonId: 'lesson-1', pointLimit: 100 },
    })
    expect(opened.status).toBe(200)
  })

  it('refuses users who are not institution members or not teachers', async () => {
    // 学生不是任课老师：学籍与任课是两回事
    await expect((await assignTeacher({ userId: 'student-1' })).json()).resolves.toEqual({
      error: 'User is not an institution member',
    })

    state.users.push({ id: 'platform-admin', username: 'admin', name: '平台管理员', role: 'admin', status: 'active' })
    state.members.push({
      id: 'm-platform',
      institutionId: 'i1',
      userId: 'platform-admin',
      role: 'teacher',
      status: 'active',
    })
    await expect((await assignTeacher({ userId: 'platform-admin' })).json()).resolves.toEqual({
      error: 'Invalid teacher',
    })

    await expect((await assignTeacher({ userId: 'missing' })).json()).resolves.toEqual({ error: 'User not found' })
    await expect((await assignTeacher({ userId: '' })).json()).resolves.toEqual({ error: 'Invalid user' })
    await expect((await assignTeacher({ userId: 'other-1', role: 'boss' })).json()).resolves.toEqual({
      error: 'Invalid class teacher role',
    })
    expect(state.assignments).toHaveLength(2)
  })

  it('refuses teachers who are not institution administrators', async () => {
    const response = await assignTeacher({ userId: 'other-1' }, 'lead-1')

    // lead 老师有访问权但这个操作仅限机构管理员
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Institution role required' })

    const outsider = await assignTeacher({ userId: 'other-1' }, 'nobody-1')
    // 会话里的用户已经不存在：fail-closed，同样拒绝
    expect(outsider.status).toBe(403)
  })
})

describe('DELETE /api/teacher/classes/:classId/teachers/:userId', () => {
  it('removes an assignment once and reports a missing one', async () => {
    const removed = await request('/api/teacher/classes/c1/teachers/assistant-1', {
      userId: 'owner-1',
      method: 'DELETE',
    })
    expect(removed.status).toBe(200)
    await expect(removed.json()).resolves.toEqual({ removed: true })
    expect(state.assignments.find((item) => item.userId === 'assistant-1')).toBeUndefined()

    const again = await request('/api/teacher/classes/c1/teachers/assistant-1', {
      userId: 'owner-1',
      method: 'DELETE',
    })
    expect(again.status).toBe(404)
    await expect(again.json()).resolves.toEqual({ error: 'Teacher is not assigned to this class' })
  })

  it('refuses assistant teachers', async () => {
    const response = await request('/api/teacher/classes/c1/teachers/lead-1', {
      userId: 'assistant-1',
      method: 'DELETE',
    })

    expect(response.status).toBe(403)
    expect(state.assignments.find((item) => item.userId === 'lead-1')).toBeDefined()
  })
})
