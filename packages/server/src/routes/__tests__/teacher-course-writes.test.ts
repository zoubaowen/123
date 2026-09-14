import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; name: string | null; role: string; status: string }>,
  members: [] as Array<{ id: string; institutionId: string; userId: string; role: string; status: string }>,
  courses: [] as Array<Record<string, unknown>>,
  chapters: [] as Array<Record<string, unknown>>,
  lessons: [] as Array<Record<string, unknown>>,
  resources: [] as Array<Record<string, unknown>>,
  nextId: 1,
}))

vi.mock('../../db/index.js', () => ({
  getDb: () => ({
    users: { findById: vi.fn(async (id: string) => state.users.find((user) => user.id === id) ?? null) },
    institutions: { findById: vi.fn(async () => ({ id: 'i1', name: '示例机构', status: 'active' })) },
    institutionMembers: {
      listByUserId: vi.fn(async (userId: string) => state.members.filter((member) => member.userId === userId)),
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    courses: {
      findById: vi.fn(async (id: string) => state.courses.find((course) => course.id === id) ?? null),
      create: vi.fn(async (input: Record<string, unknown>) => {
        const row = { ...input, createdAt: 1, updatedAt: 1 }
        state.courses.push(row)
        return row
      }),
      update: vi.fn(async (id: string, data: Record<string, unknown>) => {
        const row = state.courses.find((course) => course.id === id)
        if (!row) return null
        Object.assign(row, data, { updatedAt: 2 })
        return row
      }),
      listByInstitution: vi.fn(async () => state.courses),
      createChapter: vi.fn(async (chapter: Record<string, unknown>) => {
        state.chapters.push(chapter)
        return chapter
      }),
      createLesson: vi.fn(async (lesson: Record<string, unknown>) => {
        state.lessons.push(lesson)
        return lesson
      }),
      createResource: vi.fn(async (resource: Record<string, unknown>) => {
        state.resources.push(resource)
        return resource
      }),
      // 大纲按真实仓储那样按 sortOrder 组装：排序是这一轮要验的东西
      loadOutline: vi.fn(async (courseId: string) => {
        const course = state.courses.find((item) => item.id === courseId)
        if (!course) return null
        const chapters = state.chapters
          .filter((chapter) => chapter.courseId === courseId)
          .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder))
          .map((chapter) => ({
            chapter,
            lessons: state.lessons
              .filter((lesson) => lesson.chapterId === chapter.id)
              .sort((left, right) => Number(left.sortOrder) - Number(right.sortOrder))
              .map((lesson) => ({
                lesson,
                resources: state.resources.filter((resource) => resource.lessonId === lesson.id),
              })),
          }))
        return { course, chapters }
      }),
    },
    classCourses: { listByCourse: vi.fn(async () => []), listByClass: vi.fn(async () => []) },
    // 以下仓储本文件用不到，但路由模块会整体加载
    classes: {
      findById: vi.fn(async () => null),
      listByInstitution: vi.fn(async () => []),
      listByTeacher: vi.fn(async () => []),
    },
    classTeachers: { findByClassAndUser: vi.fn(async () => null), listByClass: vi.fn(async () => []) },
    classEnrollments: { listByClass: vi.fn(async () => []) },
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

function courseInput(overrides: Record<string, unknown> = {}) {
  return {
    title: '  太空海报创作营  ',
    stage: 'lower_primary',
    topic: '视觉创作',
    ...overrides,
  }
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', username: 'owner-1', name: '机构管理员', role: 'user', status: 'active' },
    { id: 'lead-1', username: 'lead-1', name: '李老师', role: 'user', status: 'active' },
  ]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
  ]
  state.courses = []
  state.chapters = []
  state.lessons = []
  state.resources = []
  state.nextId = 1
  vi.clearAllMocks()
})

describe('POST /api/teacher/courses', () => {
  it('creates a draft course inside the caller institution', async () => {
    const response = await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ goals: ['理解构图', '会写提示词'] }),
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { course: Record<string, unknown> }
    expect(payload.course).toMatchObject({
      title: '太空海报创作营',
      stage: 'lower_primary',
      topic: '视觉创作',
      // 新课程一节课都没有：默认 draft，避免班级关联到"看起来能上、其实没内容"的课包
      status: 'draft',
      goals: ['理解构图', '会写提示词'],
      lessonCount: 0,
      assignedClassIds: [],
    })
    expect(state.courses[0]).toMatchObject({ institutionId: 'i1', status: 'draft' })
  })

  it('never takes the institution from the request body', async () => {
    await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ institutionId: 'i-other' }),
    })

    expect(state.courses[0].institutionId).toBe('i1')
  })

  it('rejects a bad title, stage and missing authentication', async () => {
    const blank = await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ title: '   ' }),
    })
    expect(blank.status).toBe(400)

    const tooLong = await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ title: '课'.repeat(81) }),
    })
    expect(tooLong.status).toBe(400)

    const badStage = await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ stage: 'university' }),
    })
    expect(badStage.status).toBe(400)
    await expect(badStage.json()).resolves.toEqual({ error: 'Invalid course stage' })

    expect((await request('/api/teacher/courses', { method: 'POST', body: courseInput() })).status).toBe(401)
    expect(state.courses).toHaveLength(0)
  })

  it('refuses plain teachers', async () => {
    const response = await request('/api/teacher/courses', {
      userId: 'lead-1',
      method: 'POST',
      body: courseInput(),
    })

    // 课包是机构级资源：普通老师可以关联已有课包，但不能编辑机构课包内容
    expect(response.status).toBe(403)
    expect(state.courses).toHaveLength(0)
  })
})

describe('PATCH /api/teacher/courses/:courseId', () => {
  async function seedCourse(overrides: Record<string, unknown> = {}) {
    await request('/api/teacher/courses', {
      userId: 'owner-1',
      method: 'POST',
      body: courseInput({ ...overrides }),
    })
    return state.courses[0].id as string
  }

  it('updates the fields it was given and publishes a course', async () => {
    const courseId = await seedCourse()

    const response = await request(`/api/teacher/courses/${courseId}`, {
      userId: 'owner-1',
      method: 'PATCH',
      body: { title: '改过的标题', status: 'ready', ageRange: '8-10 岁' },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { course: Record<string, unknown> }
    expect(payload.course).toMatchObject({ title: '改过的标题', status: 'ready', ageRange: '8-10 岁' })
    // 未给的字段保持原值
    expect(payload.course.topic).toBe('视觉创作')
  })

  it('reports another institution course as 404 instead of letting it be edited', async () => {
    state.courses.push({
      id: 'foreign-course',
      institutionId: 'i2',
      title: '别机构的课包',
      description: '',
      coverAsset: '',
      stage: 'lower_primary',
      topic: '主题',
      status: 'draft',
      ageRange: '',
      goals: '[]',
      expectedOutcome: '',
      createdAt: 1,
      updatedAt: 1,
    })

    const response = await request('/api/teacher/courses/foreign-course', {
      userId: 'owner-1',
      method: 'PATCH',
      body: { title: '偷偷改掉' },
    })

    expect(response.status).toBe(404)
    expect(state.courses[0].title).toBe('别机构的课包')
  })

  it('rejects an invalid status, an unknown course and a plain teacher', async () => {
    const courseId = await seedCourse()

    const badStatus = await request(`/api/teacher/courses/${courseId}`, {
      userId: 'owner-1',
      method: 'PATCH',
      body: { status: 'published' },
    })
    expect(badStatus.status).toBe(400)

    expect(
      (await request('/api/teacher/courses/missing', { userId: 'owner-1', method: 'PATCH', body: { title: 'x' } }))
        .status,
    ).toBe(404)
    expect(
      (await request(`/api/teacher/courses/${courseId}`, { userId: 'lead-1', method: 'PATCH', body: { title: 'x' } }))
        .status,
    ).toBe(403)
  })
})

describe('POST /api/teacher/courses/:courseId/chapters', () => {
  async function seedCourse() {
    await request('/api/teacher/courses', { userId: 'owner-1', method: 'POST', body: courseInput() })
    return state.courses[0].id as string
  }

  it('appends chapters with increasing sortOrder', async () => {
    const courseId = await seedCourse()

    const first = await request(`/api/teacher/courses/${courseId}/chapters`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第一章' },
    })
    const second = await request(`/api/teacher/courses/${courseId}/chapters`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第二章' },
    })

    expect(first.status).toBe(200)
    const firstPayload = (await first.json()) as { chapter: { id: string; title: string; order: number } }
    const secondPayload = (await second.json()) as { chapter: { order: number } }
    expect(firstPayload.chapter).toMatchObject({ title: '第一章', order: 1 })
    // 序号由服务端追加决定：让客户端传序号，两个管理员同时加章节就会撞号
    expect(secondPayload.chapter.order).toBe(2)
    expect(state.chapters.map((chapter) => chapter.sortOrder)).toEqual([1, 2])
  })

  it('rejects a blank title, a foreign course and a plain teacher', async () => {
    const courseId = await seedCourse()

    const blank = await request(`/api/teacher/courses/${courseId}/chapters`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '  ' },
    })
    expect(blank.status).toBe(400)

    expect(
      (
        await request('/api/teacher/courses/missing/chapters', {
          userId: 'owner-1',
          method: 'POST',
          body: { title: '第一章' },
        })
      ).status,
    ).toBe(404)

    expect(
      (
        await request(`/api/teacher/courses/${courseId}/chapters`, {
          userId: 'lead-1',
          method: 'POST',
          body: { title: '第一章' },
        })
      ).status,
    ).toBe(403)
    expect(state.chapters).toHaveLength(0)
  })
})

describe('POST /api/teacher/courses/:courseId/chapters/:chapterId/lessons', () => {
  async function seedChapter() {
    await request('/api/teacher/courses', { userId: 'owner-1', method: 'POST', body: courseInput() })
    const courseId = state.courses[0].id as string
    const chapter = await request(`/api/teacher/courses/${courseId}/chapters`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第一章' },
    })
    const payload = (await chapter.json()) as { chapter: { id: string } }
    return { courseId, chapterId: payload.chapter.id }
  }

  it('appends a lesson inside its chapter with the content fields stored as JSON', async () => {
    const { courseId, chapterId } = await seedChapter()

    const response = await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons`, {
      userId: 'owner-1',
      method: 'POST',
      body: {
        title: '第一课时',
        durationMinutes: 40,
        objectives: ['理解构图'],
        steps: ['讲一讲', '做一做'],
        teacherTips: ['先示范'],
        assignment: '画一张太空海报',
        capabilities: ['writing'],
        skills: ['story'],
        mcpServers: ['draw'],
      },
    })

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      lesson: {
        id: string
        title: string
        order: number
        durationMinutes: number
        objectives: string[]
        steps: string[]
        capabilities: string[]
      }
    }
    expect(payload.lesson).toMatchObject({
      title: '第一课时',
      order: 1,
      durationMinutes: 40,
      objectives: ['理解构图'],
      steps: ['讲一讲', '做一做'],
      capabilities: ['writing'],
    })
    expect(state.lessons[0]).toMatchObject({
      chapterId,
      sortOrder: 1,
      // 数组字段以 JSON 字符串列存储，与 tasks.skillSettings 一致
      objectives: JSON.stringify(['理解构图']),
      mcpServers: JSON.stringify(['draw']),
    })

    // 第二节课时序号递增
    const second = await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第二课时', durationMinutes: 40 },
    })
    const secondPayload = (await second.json()) as { lesson: { order: number } }
    expect(secondPayload.lesson.order).toBe(2)
    // 没给的可选内容字段存空数组，而不是 null
    expect(state.lessons[1]).toMatchObject({ objectives: '[]', capabilities: '[]' })
  })

  it('rejects a bad duration, a chapter of another course and a plain teacher', async () => {
    const { courseId, chapterId } = await seedChapter()

    for (const durationMinutes of [0, -10, 1.5, '40']) {
      const response = await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons`, {
        userId: 'owner-1',
        method: 'POST',
        body: { title: '第一课时', durationMinutes },
      })
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid lesson duration' })
    }

    expect(
      (
        await request(`/api/teacher/courses/${courseId}/chapters/missing/lessons`, {
          userId: 'owner-1',
          method: 'POST',
          body: { title: '第一课时', durationMinutes: 40 },
        })
      ).status,
    ).toBe(404)

    expect(
      (
        await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons`, {
          userId: 'lead-1',
          method: 'POST',
          body: { title: '第一课时', durationMinutes: 40 },
        })
      ).status,
    ).toBe(403)
    expect(state.lessons).toHaveLength(0)
  })
})

describe('POST /api/teacher/courses/:courseId/chapters/:chapterId/lessons/:lessonId/resources', () => {
  async function seedLesson() {
    await request('/api/teacher/courses', { userId: 'owner-1', method: 'POST', body: courseInput() })
    const courseId = state.courses[0].id as string
    const chapter = await request(`/api/teacher/courses/${courseId}/chapters`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第一章' },
    })
    const chapterId = ((await chapter.json()) as { chapter: { id: string } }).chapter.id
    const lesson = await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons`, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '第一课时', durationMinutes: 40 },
    })
    const lessonId = ((await lesson.json()) as { lesson: { id: string } }).lesson.id
    return { courseId, chapterId, lessonId }
  }

  it('attaches a resource to a lesson', async () => {
    const { courseId, chapterId, lessonId } = await seedLesson()

    const response = await request(
      `/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons/${lessonId}/resources`,
      { userId: 'owner-1', method: 'POST', body: { title: '课堂课件', type: 'slides', status: 'ready' } },
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      resource: { lessonId, title: '课堂课件', type: 'slides', status: 'ready' },
    })
    expect(state.resources).toHaveLength(1)
  })

  it('defaults the status to planned so a not-yet-ready resource is not claimed as ready', async () => {
    const { courseId, chapterId, lessonId } = await seedLesson()

    const response = await request(
      `/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons/${lessonId}/resources`,
      { userId: 'owner-1', method: 'POST', body: { title: '待做练习单', type: 'worksheet' } },
    )

    await expect(response.json()).resolves.toMatchObject({ resource: { status: 'planned' } })
  })

  it('rejects an unknown type or status, and a lesson of another course', async () => {
    const { courseId, chapterId, lessonId } = await seedLesson()
    const path = `/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons/${lessonId}/resources`

    const badType = await request(path, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '课件', type: 'video-clip' },
    })
    expect(badType.status).toBe(400)
    await expect(badType.json()).resolves.toEqual({ error: 'Invalid resource type' })

    const badStatus = await request(path, {
      userId: 'owner-1',
      method: 'POST',
      body: { title: '课件', type: 'slides', status: 'done' },
    })
    expect(badStatus.status).toBe(400)

    const blankTitle = await request(path, { userId: 'owner-1', method: 'POST', body: { type: 'slides' } })
    expect(blankTitle.status).toBe(400)

    expect(
      (
        await request(`/api/teacher/courses/${courseId}/chapters/${chapterId}/lessons/missing/resources`, {
          userId: 'owner-1',
          method: 'POST',
          body: { title: '课件', type: 'slides' },
        })
      ).status,
    ).toBe(404)

    expect(
      (await request(path, { userId: 'lead-1', method: 'POST', body: { title: '课件', type: 'slides' } })).status,
    ).toBe(403)
    expect(state.resources).toHaveLength(0)
  })
})
