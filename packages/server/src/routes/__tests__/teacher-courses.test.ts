import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; name: string | null; role: string; status: string }>,
  institutions: [] as Array<{ id: string; name: string; status: string }>,
  members: [] as Array<{ id: string; institutionId: string; userId: string; role: string; status: string }>,
  classes: [] as Array<{ id: string; institutionId: string; name: string; status: string }>,
  assignments: [] as Array<{ classId: string; userId: string; role: string }>,
  courses: [] as Array<{ id: string; institutionId: string; title: string; status: string }>,
  outlines: new Map<string, unknown>(),
  classCourses: [] as Array<{ classId: string; courseId: string; assignedAt: number }>,
  courseListReturnsNull: false,
  nextId: 1,
}))

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    users: { findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null) },
    institutions: { findById: vi.fn(async (id: string) => state.institutions.find((item) => item.id === id) ?? null) },
    institutionMembers: {
      listByUserId: vi.fn(async (userId: string) => state.members.filter((member) => member.userId === userId)),
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    classes: { findById: vi.fn(async (id: string) => state.classes.find((item) => item.id === id) ?? null) },
    classTeachers: {
      findByClassAndUser: vi.fn(
        async (classId: string, userId: string) =>
          state.assignments.find((item) => item.classId === classId && item.userId === userId) ?? null,
      ),
    },
    courses: {
      listByInstitution: vi.fn(async (institutionId: string) =>
        state.courseListReturnsNull ? null : state.courses.filter((item) => item.institutionId === institutionId),
      ),
      findById: vi.fn(async (id: string) => state.courses.find((item) => item.id === id) ?? null),
      loadOutline: vi.fn(async (courseId: string) => state.outlines.get(courseId) ?? null),
    },
    classCourses: {
      listByCourse: vi.fn(async (courseId: string) => state.classCourses.filter((item) => item.courseId === courseId)),
      listByClass: vi.fn(async (classId: string) => state.classCourses.filter((item) => item.classId === classId)),
      assign: vi.fn(async (input: { classId: string; courseId: string }) => {
        const existing = state.classCourses.find(
          (item) => item.classId === input.classId && item.courseId === input.courseId,
        )
        if (existing) return existing
        const row = { ...input, assignedAt: 1_000 + state.nextId }
        state.classCourses.push(row)
        return row
      }),
    },
    lessonProgress: { listByClass: vi.fn(async () => []) },
    classEnrollments: { listByClass: vi.fn(async () => []) },
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

function outlineOf(courseId: string, title: string, lessonTitles: string[]) {
  return {
    course: { id: courseId, institutionId: 'i1', title, status: 'ready' },
    chapters: [
      {
        chapter: { id: `${courseId}-ch1`, courseId, title: '第一章', sortOrder: 1 },
        lessons: lessonTitles.map((lessonTitle, index) => ({
          lesson: {
            id: `${courseId}-l${index + 1}`,
            chapterId: `${courseId}-ch1`,
            title: lessonTitle,
            sortOrder: index + 1,
          },
          resources: [],
        })),
      },
    ],
  }
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', username: 'owner-1', name: '机构管理员', role: 'user', status: 'active' },
    { id: 'lead-1', username: 'lead-1', name: '李老师', role: 'user', status: 'active' },
    { id: 'assistant-1', username: 'assistant-1', name: '协助老师', role: 'user', status: 'active' },
  ]
  state.institutions = [{ id: 'i1', name: '示例机构', status: 'active' }]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
    { id: 'm-assistant', institutionId: 'i1', userId: 'assistant-1', role: 'teacher', status: 'active' },
  ]
  state.classes = [
    { id: 'c1', institutionId: 'i1', name: '二年级创作 A 班', status: 'active' },
    { id: 'c2', institutionId: 'i1', name: '四年级游戏 B 班', status: 'active' },
  ]
  state.assignments = [
    { classId: 'c1', userId: 'lead-1', role: 'lead' },
    { classId: 'c1', userId: 'assistant-1', role: 'assistant' },
  ]
  state.courses = [
    { id: 'course-1', institutionId: 'i1', title: 'AI 太空海报创作营', status: 'ready' },
    { id: 'course-2', institutionId: 'i1', title: '弹跳球游戏课', status: 'ready' },
  ]
  state.outlines = new Map([
    ['course-1', outlineOf('course-1', 'AI 太空海报创作营', ['第一课时', '第二课时'])],
    ['course-2', outlineOf('course-2', '弹跳球游戏课', ['唯一课时'])],
  ])
  state.classCourses = []
  state.courseListReturnsNull = false
  state.nextId = 1
  vi.clearAllMocks()
})

describe('GET /api/teacher/courses', () => {
  it('lists the institution courses with lesson counts and assigned classes', async () => {
    state.classCourses = [{ classId: 'c1', courseId: 'course-1', assignedAt: 10 }]

    const response = await request('/api/teacher/courses', { userId: 'lead-1' })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      courses: Array<{ id: string; title: string; lessonCount: number; assignedClassIds: string[] }>
    }
    expect(payload.courses.map((item) => item.id).sort()).toEqual(['course-1', 'course-2'])
    expect(payload.courses.find((item) => item.id === 'course-1')).toMatchObject({
      title: 'AI 太空海报创作营',
      lessonCount: 2,
      assignedClassIds: ['c1'],
    })
    expect(payload.courses.find((item) => item.id === 'course-2')).toMatchObject({
      lessonCount: 1,
      assignedClassIds: [],
    })
  })

  it('fails closed when the course list cannot be determined', async () => {
    state.courseListReturnsNull = true

    const response = await request('/api/teacher/courses', { userId: 'lead-1' })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Courses unavailable' })
  })

  it('rejects a request without a session', async () => {
    expect((await request('/api/teacher/courses')).status).toBe(401)
  })
})

describe('GET /api/teacher/courses/:courseId', () => {
  it('returns the outline with chapters, lessons and resources', async () => {
    const response = await request('/api/teacher/courses/course-1', { userId: 'lead-1' })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      course: { id: string; title: string; lessonCount: number }
      chapters: Array<{ id: string; lessons: Array<{ id: string; title: string }> }>
    }
    expect(payload.course).toMatchObject({ id: 'course-1', title: 'AI 太空海报创作营', lessonCount: 2 })
    expect(payload.chapters[0].lessons.map((lesson) => lesson.title)).toEqual(['第一课时', '第二课时'])
  })

  it('returns 404 for an unknown course and 404 for another institution', async () => {
    expect((await request('/api/teacher/courses/missing', { userId: 'lead-1' })).status).toBe(404)

    state.courses.push({ id: 'course-other', institutionId: 'i2', title: '别的机构的课', status: 'ready' })
    state.outlines.set('course-other', outlineOf('course-other', '别的机构的课', ['课时']))

    const crossInstitution = await request('/api/teacher/courses/course-other', { userId: 'lead-1' })
    expect(crossInstitution.status).toBe(404)
  })
})

describe('POST /api/teacher/classes/:classId/courses', () => {
  it('assigns a course to the class idempotently for the lead teacher', async () => {
    const first = await request('/api/teacher/classes/c1/courses', {
      userId: 'lead-1',
      method: 'POST',
      body: { courseId: 'course-1' },
    })
    expect(first.status).toBe(200)
    await expect(first.json()).resolves.toMatchObject({ assignment: { classId: 'c1', courseId: 'course-1' } })

    const second = await request('/api/teacher/classes/c1/courses', {
      userId: 'lead-1',
      method: 'POST',
      body: { courseId: 'course-1' },
    })
    expect(second.status).toBe(200)
    expect(state.classCourses).toHaveLength(1)
  })

  it('refuses an assistant teacher, a cross-institution course and a missing course', async () => {
    const assistant = await request('/api/teacher/classes/c1/courses', {
      userId: 'assistant-1',
      method: 'POST',
      body: { courseId: 'course-1' },
    })
    expect(assistant.status).toBe(403)

    state.courses.push({ id: 'course-other', institutionId: 'i2', title: '别的机构的课', status: 'ready' })
    const crossInstitution = await request('/api/teacher/classes/c1/courses', {
      userId: 'lead-1',
      method: 'POST',
      body: { courseId: 'course-other' },
    })
    expect(crossInstitution.status).toBe(400)
    await expect(crossInstitution.json()).resolves.toEqual({ error: 'Course is not in this institution' })

    const missing = await request('/api/teacher/classes/c1/courses', {
      userId: 'lead-1',
      method: 'POST',
      body: { courseId: 'ghost' },
    })
    expect(missing.status).toBe(404)

    expect(state.classCourses).toHaveLength(0)
  })
})
