import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import teacherRoutes from '../teacher'
import type { AppEnv } from '../../middleware/auth'

const state = vi.hoisted(() => ({
  users: [] as Array<{ id: string; username: string; name: string | null; status: string }>,
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
  classCourses: [] as Array<{ classId: string; courseId: string; assignedAt: number }>,
  /** 机构课包；工作区要把它们带回列表页，否则接口模式下"课程中心"是空的。 */
  courses: [] as Array<Record<string, unknown>>,
  outlines: new Map<string, unknown>(),
  lessonProgressRows: [] as Array<{ classId: string; lessonId: string; status: string; completedAt: number | null }>,
  rosterReturnsNull: false,
  classListReturnsNull: false,
  outlineThrows: false,
  /** 只让指定的课包读不出大纲：用来验证"课包列表跳过坏的、班级列表照常"。 */
  outlineThrowsFor: null as string | null,
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
      findByInstitutionAndUser: vi.fn(
        async (institutionId: string, userId: string) =>
          state.members.find((member) => member.institutionId === institutionId && member.userId === userId) ?? null,
      ),
    },
    classes: {
      findById: vi.fn(async (id: string) => state.classes.find((item) => item.id === id) ?? null),
      listByInstitution: vi.fn(async (institutionId: string) =>
        state.classListReturnsNull
          ? null
          : state.classes.filter((item) => item.institutionId === institutionId && item.status === 'active'),
      ),
      listByTeacher: vi.fn(async (userId: string) => {
        if (state.classListReturnsNull) return null
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
    },
    classEnrollments: {
      listByClass: vi.fn(async (classId: string, options?: { includeLeft?: boolean }) => {
        if (state.rosterReturnsNull) return null
        return state.enrollments.filter(
          (item) => item.classId === classId && (options?.includeLeft || item.status === 'active'),
        )
      }),
    },
    courses: {
      loadOutline: vi.fn(async (courseId: string) => {
        // 真实仓储在大纲被截断时抛错；测试用同一个信号验证 fail-closed
        if (state.outlineThrows || state.outlineThrowsFor === courseId) throw new Error('course outline is unknown')
        return state.outlines.get(courseId) ?? null
      }),
      listByInstitution: vi.fn(async (institutionId: string) =>
        state.courses.filter((course) => course.institutionId === institutionId),
      ),
      findById: vi.fn(async (id: string) => state.courses.find((course) => course.id === id) ?? null),
    },
    classCourses: {
      listByClass: vi.fn(async (classId: string) => state.classCourses.filter((item) => item.classId === classId)),
      listByCourse: vi.fn(async (courseId: string) => state.classCourses.filter((item) => item.courseId === courseId)),
    },
    lessonProgress: {
      listByClass: vi.fn(async (classId: string) =>
        state.lessonProgressRows.filter((item) => item.classId === classId),
      ),
    },
    // 工作区还要报告"正在上的那节课"；本文件默认没有课堂
    classSessions: {
      findActiveByClass: vi.fn(async () => null),
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

function request(path: string, userId?: string) {
  return app.request(path, userId === undefined ? {} : { headers: { 'x-test-user': userId } })
}

beforeEach(() => {
  state.users = [
    { id: 'owner-1', username: 'owner-1', name: '机构管理员', status: 'active' },
    { id: 'lead-1', username: 'lead-1', name: '李老师', status: 'active' },
    { id: 'assistant-1', username: 'assistant-1', name: null, status: 'active' },
    { id: 'student-1', username: 'student-1', name: '学生一', status: 'active' },
    { id: 'student-2', username: 'student-2', name: '学生二', status: 'active' },
    { id: 'student-3', username: 'student-3', name: '学生三', status: 'active' },
  ]
  state.institutions = [{ id: 'i1', name: '示例机构', status: 'active' }]
  state.members = [
    { id: 'm-owner', institutionId: 'i1', userId: 'owner-1', role: 'owner', status: 'active' },
    { id: 'm-lead', institutionId: 'i1', userId: 'lead-1', role: 'teacher', status: 'active' },
    { id: 'm-assistant', institutionId: 'i1', userId: 'assistant-1', role: 'teacher', status: 'active' },
  ]
  state.classes = [
    {
      id: 'c1',
      institutionId: 'i1',
      name: '二年级创作 A 班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: 300,
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
    {
      id: 'c-archived',
      institutionId: 'i1',
      name: '已归档班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: null,
      status: 'archived',
      archivedAt: 1,
    },
  ]
  state.assignments = [
    { classId: 'c1', userId: 'lead-1', role: 'lead', createdAt: 1 },
    { classId: 'c1', userId: 'assistant-1', role: 'assistant', createdAt: 1 },
  ]
  state.enrollments = [
    { id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active', joinedAt: 10 },
    { id: 'e2', classId: 'c1', studentUserId: 'student-2', status: 'active', joinedAt: 11 },
    { id: 'e3', classId: 'c1', studentUserId: 'student-3', status: 'left', joinedAt: 12 },
    { id: 'e4', classId: 'c1', studentUserId: 'ghost-student', status: 'active', joinedAt: 13 },
  ]
  state.classCourses = [{ classId: 'c1', courseId: 'course-1', assignedAt: 1 }]
  state.outlines = new Map([
    [
      'course-1',
      {
        course: { id: 'course-1', institutionId: 'i1', title: 'AI 太空海报创作营', status: 'ready' },
        chapters: [
          {
            chapter: { id: 'ch-1', courseId: 'course-1', title: '第一章', sortOrder: 1 },
            lessons: [
              {
                lesson: { id: 'lesson-1', chapterId: 'ch-1', title: '第一课时', sortOrder: 1 },
                resources: [],
              },
              {
                lesson: { id: 'lesson-2', chapterId: 'ch-1', title: '第二课时', sortOrder: 2 },
                resources: [],
              },
            ],
          },
        ],
      },
    ],
  ])
  // 第一课时已完成 ⇒ 课程进度 50%
  state.lessonProgressRows = [{ classId: 'c1', lessonId: 'lesson-1', status: 'completed', completedAt: 900 }]
  state.rosterReturnsNull = false
  state.classListReturnsNull = false
  state.outlineThrows = false
  vi.clearAllMocks()
})

describe('GET /api/teacher/workspace', () => {
  it('returns the institution, the teacher and only the classes that teacher runs', async () => {
    const response = await request('/api/teacher/workspace', 'lead-1')

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      institution: { id: string; name: string }
      teacher: { id: string; name: string }
      classes: Array<{ id: string; name: string; studentCount: number | null }>
    }

    expect(payload.institution).toEqual({ id: 'i1', name: '示例机构' })
    expect(payload.teacher).toEqual({ id: 'lead-1', name: '李老师' })
    // 只带自己任课的班级，且不含已归档班
    expect(payload.classes.map((item) => item.id)).toEqual(['c1'])
    // 在班学生数只算 active：e3 已退班、e4 对应用户行缺失但仍占一个名额
    expect(payload.classes[0]).toMatchObject({ name: '二年级创作 A 班', studentCount: 3 })
  })

  it('falls back to the username when the teacher has no display name', async () => {
    const response = await request('/api/teacher/workspace', 'assistant-1')

    const payload = (await response.json()) as { teacher: { name: string } }
    expect(payload.teacher.name).toBe('assistant-1')
  })

  it('includes the institution courses so the course console is not empty in API mode', async () => {
    state.courses = [
      {
        id: 'course-1',
        institutionId: 'i1',
        title: 'AI 太空海报创作营',
        description: '',
        coverAsset: '',
        stage: 'lower_primary',
        topic: '视觉创作',
        status: 'ready',
        ageRange: '',
        goals: '[]',
        expectedOutcome: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    const response = await request('/api/teacher/workspace', 'lead-1')

    const payload = (await response.json()) as { courses: Array<{ id: string; title: string; lessonCount: number }> }
    expect(payload.courses.map((course) => course.id)).toEqual(['course-1'])
    expect(payload.courses[0]).toMatchObject({ title: 'AI 太空海报创作营', lessonCount: 2 })
  })

  it('skips a course whose outline cannot be read instead of returning a partial course', async () => {
    state.courses = [
      {
        id: 'course-unreadable',
        institutionId: 'i1',
        title: '读不出大纲的课包',
        description: '',
        coverAsset: '',
        stage: 'lower_primary',
        topic: '视觉创作',
        status: 'ready',
        ageRange: '',
        goals: '[]',
        expectedOutcome: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    // 只有这门课读不出大纲；班级用的 course-1 仍可读，所以班级列表不受影响
    state.outlineThrowsFor = 'course-unreadable'

    const response = await request('/api/teacher/workspace', 'lead-1')

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { courses: unknown[]; classes: unknown[] }
    // 少一门课比给一份"课时数不完整"的课包安全：后者会让老师以为课都排好了
    expect(payload.courses).toEqual([])
    expect(payload.classes).toHaveLength(1)
  })

  it('reports the caller institution role so the console can hide what it must not do', async () => {
    // 界面要按权限显隐"加学生/设额度/分配老师"，就必须知道自己在机构里是什么角色
    const owner = (await (await request('/api/teacher/workspace', 'owner-1')).json()) as { role: string }
    expect(owner.role).toBe('owner')

    const teacher = (await (await request('/api/teacher/workspace', 'lead-1')).json()) as { role: string }
    expect(teacher.role).toBe('teacher')
  })

  it('includes each visible class detail so the console does not have to re-request it', async () => {
    const response = await request('/api/teacher/workspace', 'lead-1')

    const payload = (await response.json()) as {
      classDetails: Array<{
        class: { id: string }
        teachers: Array<{ userId: string; role: string; name: string }>
        students: Array<{ id: string; name: string | null; joinedAt: number }>
        lessonProgress: Array<{ lessonId: string; status: string }>
      }>
    }

    // 没有它，接口模式下班级详情页拿不到任何数据，名单/额度/任课老师这些界面根本点不到
    expect(payload.classDetails.map((detail) => detail.class.id)).toEqual(['c1'])
    expect(payload.classDetails[0].teachers).toEqual([
      { userId: 'lead-1', role: 'lead', name: '李老师' },
      { userId: 'assistant-1', role: 'assistant', name: 'assistant-1' },
    ])
    // 退班学生不在在班名单里；用户行缺失的学生仍占位但姓名为 null（名单不静默变短）
    expect(payload.classDetails[0].students.map((student) => student.id)).toEqual([
      'student-1',
      'student-2',
      'ghost-student',
    ])
    expect(payload.classDetails[0].students.filter((student) => student.name === null)).toHaveLength(1)
    expect(payload.classDetails[0].lessonProgress.map((item) => item.lessonId)).toEqual(['lesson-1', 'lesson-2'])
  })

  it('lists every class in the institution for an institution administrator', async () => {
    const response = await request('/api/teacher/workspace', 'owner-1')

    const payload = (await response.json()) as { classes: Array<{ id: string; studentCount: number | null }> }
    expect(payload.classes.map((item) => item.id).sort()).toEqual(['c1', 'c2'])
    expect(payload.classes.find((item) => item.id === 'c2')?.studentCount).toBe(0)
  })

  it('reports an unknown roster size as null instead of zero', async () => {
    state.rosterReturnsNull = true

    const response = await request('/api/teacher/workspace', 'lead-1')

    const payload = (await response.json()) as { classes: Array<{ studentCount: number | null }> }
    expect(payload.classes[0].studentCount).toBeNull()
  })

  it('fails closed when the class list cannot be determined', async () => {
    state.classListReturnsNull = true

    const response = await request('/api/teacher/workspace', 'lead-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Classes unavailable' })
  })

  it('rejects a request without a session', async () => {
    const response = await request('/api/teacher/workspace')

    expect(response.status).toBe(401)
  })
})

describe('GET /api/teacher/classes', () => {
  it('returns the same class views as the workspace payload', async () => {
    const response = await request('/api/teacher/classes', 'lead-1')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      classes: [expect.objectContaining({ id: 'c1', aiUsageMode: 'class_only', xiaobaoCreditLimit: 300 })],
    })
  })
})

describe('GET /api/teacher/classes/:classId', () => {
  it('returns the class with its teachers and active students', async () => {
    const response = await request('/api/teacher/classes/c1', 'lead-1')

    expect(response.status).toBe(200)
    const payload = (await response.json()) as {
      class: { id: string; name: string; studentCount: number | null }
      teachers: Array<{ userId: string; role: string; name: string | null }>
      students: Array<{ id: string; name: string | null; joinedAt: number }>
    }

    expect(payload.class).toMatchObject({ id: 'c1', name: '二年级创作 A 班', studentCount: 3 })
    // 任课老师带姓名：界面上显示一串用户 id 没有意义（缺失时退回账号名）
    expect(payload.teachers).toEqual(
      expect.arrayContaining([
        { userId: 'lead-1', role: 'lead', name: '李老师' },
        { userId: 'assistant-1', role: 'assistant', name: 'assistant-1' },
      ]),
    )
    // 退班学生不出现在在班名单里
    expect(payload.students.map((item) => item.id)).not.toContain('student-3')
    expect(payload.students.find((item) => item.id === 'student-1')).toMatchObject({ name: '学生一', joinedAt: 10 })
  })

  it('marks a student whose user row is missing instead of hiding the row', async () => {
    const response = await request('/api/teacher/classes/c1', 'lead-1')

    const payload = (await response.json()) as { students: Array<{ id: string; name: string | null }> }
    expect(payload.students.find((item) => item.id === 'ghost-student')).toMatchObject({ name: null })
  })

  it('lets an institution administrator open any class in the institution', async () => {
    const response = await request('/api/teacher/classes/c2', 'owner-1')

    expect(response.status).toBe(200)
  })

  it('rejects a teacher from another class and an unknown class', async () => {
    const otherClass = await request('/api/teacher/classes/c2', 'lead-1')
    expect(otherClass.status).toBe(403)
    await expect(otherClass.json()).resolves.toEqual({ error: 'Class access required' })

    const missing = await request('/api/teacher/classes/missing', 'lead-1')
    expect(missing.status).toBe(404)
    await expect(missing.json()).resolves.toEqual({ error: 'Class not found' })
  })

  it('fails closed when the roster cannot be determined', async () => {
    state.rosterReturnsNull = true

    const response = await request('/api/teacher/classes/c1', 'lead-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Class members unavailable' })
  })
})

describe('course progress in the class views', () => {
  it('reports the assigned course and its lesson progress for a class', async () => {
    const response = await request('/api/teacher/workspace', 'lead-1')

    const payload = (await response.json()) as { classes: Array<{ id: string; course: unknown }> }
    // 第一课时已完成、共两课时 ⇒ 课程进度 50%
    expect(payload.classes[0].course).toEqual({
      id: 'course-1',
      title: 'AI 太空海报创作营',
      lessonCount: 2,
      completedLessonCount: 1,
      progress: 50,
    })
  })

  it('distinguishes "no course assigned" from "progress zero"', async () => {
    state.classCourses = []

    const response = await request('/api/teacher/workspace', 'lead-1')

    const payload = (await response.json()) as { classes: Array<{ course: unknown }> }
    // 未关联课包是 null；返回 0% 会被读成"课上了但一点没学"
    expect(payload.classes[0].course).toBeNull()
  })

  it('fails closed when the assigned course outline cannot be read', async () => {
    state.outlineThrows = true

    const response = await request('/api/teacher/workspace', 'lead-1')

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Classes unavailable' })
  })

  it('derives lesson progress so exactly one lesson is next', async () => {
    const response = await request('/api/teacher/classes/c1', 'lead-1')

    const payload = (await response.json()) as {
      lessonProgress: Array<{
        lessonId: string
        title: string
        order: number
        status: string
        completedAt: number | null
      }>
    }
    expect(payload.lessonProgress).toEqual([
      { lessonId: 'lesson-1', title: '第一课时', order: 1, status: 'completed', completedAt: 900 },
      { lessonId: 'lesson-2', title: '第二课时', order: 2, status: 'next', completedAt: null },
    ])
  })

  it('marks the lessons after the next one as locked', async () => {
    state.lessonProgressRows = []
    const outline = state.outlines.get('course-1') as {
      chapters: Array<{ lessons: Array<unknown> }>
    }
    outline.chapters[0].lessons.push({
      lesson: { id: 'lesson-3', chapterId: 'ch-1', title: '第三课时', sortOrder: 3 },
      resources: [],
    })

    const response = await request('/api/teacher/classes/c1', 'lead-1')

    const payload = (await response.json()) as { lessonProgress: Array<{ status: string }> }
    expect(payload.lessonProgress.map((item) => item.status)).toEqual(['next', 'locked', 'locked'])
  })

  it('returns an empty lesson progress list for a class without a course', async () => {
    state.classCourses = []

    const response = await request('/api/teacher/classes/c1', 'lead-1')

    const payload = (await response.json()) as { class: { course: unknown }; lessonProgress: unknown[] }
    expect(payload.class.course).toBeNull()
    expect(payload.lessonProgress).toEqual([])
  })
})
