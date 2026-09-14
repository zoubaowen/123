import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createApiTeacherWorkspaceSource,
  createDemoTeacherWorkspaceSource,
  resolveTeacherWorkspaceSource,
  TEACHER_WRITE_FAILED,
  toTeacherDashboardData,
  type TeacherWorkspacePayload,
} from './teacher-workspace-source'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(async () => ({})),
  put: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
}))

vi.mock('../../lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, put: mocks.put, delete: mocks.delete },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function payloadOf(overrides: Partial<TeacherWorkspacePayload> = {}): TeacherWorkspacePayload {
  return {
    institution: { id: 'i1', name: '示例机构' },
    teacher: { id: 'teacher-1', name: '李老师' },
    classes: [
      {
        id: 'c1',
        name: '二年级创作 A 班',
        aiUsageMode: 'class_only',
        xiaobaoCreditLimit: 300,
        status: 'active',
        studentCount: 26,
        course: { id: 'course-1', title: 'AI 太空海报创作营', lessonCount: 4, completedLessonCount: 1, progress: 25 },
      },
    ],
    ...overrides,
  }
}

describe('toTeacherDashboardData', () => {
  it('maps the institution, teacher and classes from the API payload', () => {
    const data = toTeacherDashboardData(payloadOf())

    expect(data.institutionName).toBe('示例机构')
    expect(data.teacherName).toBe('李老师')
    expect(data.classes).toEqual([
      {
        id: 'c1',
        name: '二年级创作 A 班',
        studentCount: 26,
        courseTitle: 'AI 太空海报创作营',
        progress: 25,
        // 班级共享额度是真实字段：界面要能显示与修改它
        xiaobaoCreditLimit: 300,
      },
    ])
  })

  it('leaves sections the backend does not provide yet empty instead of faking them', () => {
    const data = toTeacherDashboardData(payloadOf())

    // 演示数据不能泄漏进真实数据源，否则真机上会出现"假班级、假作品"
    expect(data.todaySchedule).toEqual([])
    expect(data.pendingReviews).toEqual([])
    expect(data.works).toEqual([])
    expect(data.recentSessions).toEqual([])
    expect(data.courses).toEqual([])
    expect(data.activeSession).toBeNull()
    expect(data.classDetails).toEqual([])
  })

  it('keeps unknown values unknown rather than turning them into zero', () => {
    const data = toTeacherDashboardData(
      payloadOf({
        classes: [
          {
            id: 'c2',
            name: '未关联课包的班',
            aiUsageMode: 'anytime',
            xiaobaoCreditLimit: null,
            status: 'active',
            studentCount: null,
            course: null,
          },
        ],
      }),
    )

    // 人数无法确定保持 null；课程进度没有课包时保持 null，界面显示占位符而不是 0%
    expect(data.classes[0].studentCount).toBeNull()
    expect(data.classes[0].progress).toBeNull()
    // 完成率后端目前不提供，字段留空（不是 0）
    expect(data.classes[0].completionRate).toBeUndefined()
  })

  it('maps the institution courses so the course console is not empty in API mode', () => {
    const data = toTeacherDashboardData(
      payloadOf({
        courses: [
          {
            id: 'course-1',
            title: 'AI 太空海报创作营',
            description: '用 AI 画出自己的太空校园海报',
            coverAsset: '',
            stage: 'lower_primary',
            topic: '视觉创作',
            status: 'ready',
            ageRange: '8-10 岁',
            goals: ['理解构图'],
            expectedOutcome: '一张完整海报',
            lessonCount: 2,
            assignedClassIds: ['c1'],
          },
        ],
      }),
    )

    expect(data.courses).toHaveLength(1)
    expect(data.courses[0]).toMatchObject({
      id: 'course-1',
      title: 'AI 太空海报创作营',
      stage: 'lower_primary',
      status: 'ready',
      lessonCount: 2,
      assignedClassIds: ['c1'],
    })
    // 内容完善度后端不提供：**不填 0**，界面显示占位符
    expect(data.courses[0].completion).toBeUndefined()
    // 章节要按需拉详情接口，工作区不带大纲
    expect(data.courses[0].chapters).toEqual([])
  })

  it('maps the institution role so the console can hide admin-only actions', () => {
    expect(toTeacherDashboardData(payloadOf({ role: 'teacher' })).institutionRole).toBe('teacher')
    expect(toTeacherDashboardData(payloadOf({ role: 'owner' })).institutionRole).toBe('owner')
    // 旧后端不返回 role：按"未知"处理，界面不假装知道
    expect(toTeacherDashboardData(payloadOf()).institutionRole).toBeNull()
  })

  it('maps the class details so the console detail page works without another request', () => {
    const data = toTeacherDashboardData(
      payloadOf({
        classDetails: [
          {
            class: {
              id: 'c1',
              name: '二年级创作 A 班',
              aiUsageMode: 'class_only',
              xiaobaoCreditLimit: 300,
              status: 'active',
              studentCount: 2,
              course: {
                id: 'course-1',
                title: 'AI 太空海报创作营',
                lessonCount: 4,
                completedLessonCount: 1,
                progress: 25,
              },
            },
            teachers: [{ userId: 'teacher-1', role: 'lead', name: '李老师' }],
            students: [
              { id: 'student-1', name: '陈小雨', joinedAt: 10 },
              { id: 'ghost', name: null, joinedAt: 11 },
            ],
            lessonProgress: [
              { lessonId: 'lesson-1', title: '第一课时', order: 1, status: 'completed', completedAt: 900 },
              { lessonId: 'lesson-2', title: '第二课时', order: 2, status: 'next', completedAt: null },
            ],
          },
        ],
      }),
    )

    expect(data.classDetails).toHaveLength(1)
    expect(data.classDetails[0].summary).toMatchObject({
      id: 'c1',
      name: '二年级创作 A 班',
      status: 'active',
      xiaobaoCreditLimit: 300,
      progress: 25,
    })
    expect(data.classDetails[0].teachers).toEqual([{ userId: 'teacher-1', name: '李老师', role: 'lead' }])
    expect(data.classDetails[0].students).toEqual([
      { id: 'student-1', name: '陈小雨' },
      // 用户行缺失时不隐藏这一行，也不编造姓名
      { id: 'ghost', name: '未知学生' },
    ])
    // 任务完成数与学习状态后端没有：**不填 0**，界面显示占位符
    expect(data.classDetails[0].students[0].completedTasks).toBeUndefined()
    expect(data.classDetails[0].students[0].status).toBeUndefined()
    expect(data.classDetails[0].lessonProgress[0]).toMatchObject({ lessonId: 'lesson-1', status: 'completed' })
    expect(data.classDetails[0].lessonProgress[1].completedAt).toBeUndefined()
  })

  it('maps the running class from the API payload', () => {
    const data = toTeacherDashboardData(
      payloadOf({
        activeSession: {
          id: 'session-1',
          classId: 'c1',
          className: '二年级创作 A 班',
          lessonId: 'lesson-1',
          lessonTitle: '第一课时',
          startedAt: 1_700_000_000_000,
          endedAt: null,
          durationMinutes: null,
          studentCount: 26,
          pointLimit: 100,
          capabilities: ['image'],
          skills: ['story'],
          mcpServers: ['draw'],
        },
      }),
    )

    expect(data.activeSession).toEqual({
      id: 'session-1',
      classId: 'c1',
      className: '二年级创作 A 班',
      lessonId: 'lesson-1',
      lessonTitle: '第一课时',
      startedAt: new Date(1_700_000_000_000).toISOString(),
      pointLimit: 100,
      capabilities: ['image'],
      skills: ['story'],
      mcpServers: ['draw'],
    })
  })

  it('never guesses a capability the teacher UI cannot label', () => {
    const data = toTeacherDashboardData(
      payloadOf({
        activeSession: {
          id: 'session-1',
          classId: 'c1',
          className: '二年级创作 A 班',
          lessonId: 'lesson-1',
          lessonTitle: null,
          startedAt: 1,
          endedAt: null,
          durationMinutes: null,
          studentCount: null,
          pointLimit: 100,
          // writing / learning 是运行时能力 id，教师端词汇表里没有对应标签：
          // 不猜映射，宁可少显示，也不显示一个与实际放行不符的能力
          capabilities: ['writing', 'learning', 'video', 'code'],
          skills: [],
          mcpServers: [],
        },
      }),
    )

    expect(data.activeSession?.capabilities).toEqual(['video', 'code'])
    // 课时已不在当前课包大纲里时后端给 null：显示空标题而不是编造
    expect(data.activeSession?.lessonTitle).toBe('')
  })
})

describe('createApiTeacherWorkspaceSource', () => {
  it('treats a permission failure as "no institution" so the UI shows an empty state', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('Institution access required'), { status: 403 }))

    await expect(createApiTeacherWorkspaceSource().load()).resolves.toEqual({ status: 'no-institution' })
  })

  it('treats a server failure as an error so the UI can offer a retry', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))

    await expect(createApiTeacherWorkspaceSource().load()).resolves.toEqual({ status: 'error' })
  })

  it('returns ready data when the payload has an institution', async () => {
    mocks.get.mockResolvedValueOnce(payloadOf())

    const result = await createApiTeacherWorkspaceSource().load()

    expect(result.status).toBe('ready')
    if (result.status === 'ready') {
      expect(result.data.institutionName).toBe('示例机构')
    }
  })

  it('treats a payload without an institution as "no institution"', async () => {
    mocks.get.mockResolvedValueOnce({ teacher: { id: 'teacher-1', name: '李老师' }, classes: [] })

    await expect(createApiTeacherWorkspaceSource().load()).resolves.toEqual({ status: 'no-institution' })
  })
})

describe('createApiTeacherWorkspaceSource writer', () => {
  it('opens a class without inventing a capability mapping', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(
      writer.start({
        classId: 'c1',
        lessonId: 'lesson-1',
        pointLimit: 100,
        capabilities: ['chat'],
        skills: ['story'],
        mcpServers: [],
      }),
    ).resolves.toEqual({ ok: true })

    // capabilities 刻意不发：页面词汇（chat/code…）与运行时能力 id 不是一套，映射要由产品拍板
    expect(mocks.post).toHaveBeenCalledWith('/api/teacher/classes/c1/sessions', {
      lessonId: 'lesson-1',
      pointLimit: 100,
      skills: ['story'],
      mcpServers: [],
    })
  })

  it('adjusts and ends the running class by its own ids', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(
      writer.updateActiveSettings('c1', 'session-1', { pointLimit: 200, capabilities: ['chat'] }),
    ).resolves.toEqual({ ok: true })
    await expect(writer.end('c1', 'session-1')).resolves.toEqual({ ok: true })

    expect(mocks.put).toHaveBeenCalledWith('/api/teacher/classes/c1/sessions/session-1', { pointLimit: 200 })
    expect(mocks.post).toHaveBeenCalledWith('/api/teacher/classes/c1/sessions/session-1/end')
  })

  it('reports a failed class write instead of claiming success', async () => {
    mocks.post.mockRejectedValueOnce(new Error('boom'))
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(
      writer.start({
        classId: 'c1',
        lessonId: 'lesson-1',
        pointLimit: 100,
        capabilities: [],
        skills: [],
        mcpServers: [],
      }),
    ).resolves.toEqual({ ok: false, message: TEACHER_WRITE_FAILED })
  })

  it('creates a class with its AI usage mode', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(writer.createClass({ name: '二年级创作 A 班', aiUsageMode: 'class_only' })).resolves.toEqual({
      ok: true,
    })

    expect(mocks.post).toHaveBeenCalledWith('/api/teacher/classes', {
      name: '二年级创作 A 班',
      aiUsageMode: 'class_only',
    })
  })

  it('joins and leaves a class roster', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(writer.addStudent('c1', 'student-1')).resolves.toEqual({ ok: true })
    // 退班是写标记：DELETE 到同一条关系上，后端保留历史
    await expect(writer.removeStudent('c1', 'student-1')).resolves.toEqual({ ok: true })

    expect(mocks.post).toHaveBeenCalledWith('/api/teacher/classes/c1/students', { studentUserId: 'student-1' })
    expect(mocks.delete).toHaveBeenCalledWith('/api/teacher/classes/c1/students/student-1')
  })

  it('sets and clears the class shared budget', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(writer.setClassBudget('c1', 300)).resolves.toEqual({ ok: true })
    await expect(writer.setClassBudget('c1', null)).resolves.toEqual({ ok: true })

    expect(mocks.put).toHaveBeenNthCalledWith(1, '/api/teacher/classes/c1/budget', { creditLimit: 300 })
    // null 是"取消上限"的显式写法，不能省略字段
    expect(mocks.put).toHaveBeenNthCalledWith(2, '/api/teacher/classes/c1/budget', { creditLimit: null })
  })

  it('assigns and removes a class teacher', async () => {
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(writer.assignTeacher('c1', 'teacher-1', 'assistant')).resolves.toEqual({ ok: true })
    await expect(writer.removeTeacher('c1', 'teacher-1')).resolves.toEqual({ ok: true })

    expect(mocks.put).toHaveBeenCalledWith('/api/teacher/classes/c1/teachers', {
      userId: 'teacher-1',
      role: 'assistant',
    })
    expect(mocks.delete).toHaveBeenCalledWith('/api/teacher/classes/c1/teachers/teacher-1')
  })

  it('reports a failed roster or teacher write instead of claiming success', async () => {
    mocks.delete.mockRejectedValueOnce(new Error('boom'))
    const writer = createApiTeacherWorkspaceSource().writer!

    await expect(writer.removeStudent('c1', 'student-1')).resolves.toEqual({
      ok: false,
      message: TEACHER_WRITE_FAILED,
    })
  })
})

describe('createApiTeacherWorkspaceSource student search', () => {
  it('searches the institution students by keyword', async () => {
    mocks.get.mockResolvedValueOnce({ students: [{ id: 'student-1', name: '陈小雨', username: 'xiaoyu' }] })

    await expect(createApiTeacherWorkspaceSource().searchStudents?.('小雨')).resolves.toEqual([
      { id: 'student-1', name: '陈小雨', username: 'xiaoyu' },
    ])

    // 关键词要转义：姓名里的空格与特殊字符不能让查询串错位
    expect(mocks.get).toHaveBeenCalledWith('/api/teacher/students?query=%E5%B0%8F%E9%9B%A8')
  })

  it('distinguishes "search failed" from "no match"', async () => {
    mocks.get.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }))
    await expect(createApiTeacherWorkspaceSource().searchStudents?.('小雨')).resolves.toBeNull()

    mocks.get.mockResolvedValueOnce({ students: [] })
    await expect(createApiTeacherWorkspaceSource().searchStudents?.('小雨')).resolves.toEqual([])
  })

  it('searches the institution members for class teacher assignment', async () => {
    mocks.get.mockResolvedValueOnce({
      teachers: [{ userId: 'teacher-1', name: '李老师', username: 'lead-1', role: 'teacher' }],
    })

    await expect(createApiTeacherWorkspaceSource().searchTeachers?.('李')).resolves.toEqual([
      { userId: 'teacher-1', name: '李老师', username: 'lead-1', role: 'teacher' },
    ])
    expect(mocks.get).toHaveBeenCalledWith('/api/teacher/teachers?query=%E6%9D%8E')

    mocks.get.mockRejectedValueOnce(new Error('boom'))
    await expect(createApiTeacherWorkspaceSource().searchTeachers?.('李')).resolves.toBeNull()
  })
})

describe('resolveTeacherWorkspaceSource', () => {
  it('defaults to the demo source so the current product experience is unchanged', () => {
    expect(resolveTeacherWorkspaceSource({})).toBeInstanceOf(Object)
    expect(resolveTeacherWorkspaceSource({}).initial).toBeDefined()
  })

  it('switches to the API source when the rollout flag is set', () => {
    const source = resolveTeacherWorkspaceSource({ VITE_TEACHER_WORKSPACE_API: '1' })

    // 接口数据源没有同步初始数据：provider 会先显示加载中，再显示接口结果
    expect(source.initial).toBeUndefined()
  })

  it('keeps the demo source available with its synchronous initial data', () => {
    expect(createDemoTeacherWorkspaceSource().initial).toBeDefined()
  })
})
