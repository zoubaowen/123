import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCloudBaseDatabase } from './helpers/fake-cloudbase-database'

const cloudbase = vi.hoisted(() => ({ database: undefined as unknown }))

vi.mock('@cloudbase/node-sdk', () => ({
  default: {
    init: () => ({
      database: () => {
        if (!cloudbase.database) throw new Error('CloudBase test database is not configured')
        return cloudbase.database
      },
    }),
  },
}))

vi.mock('@cloudbase/manager-node', () => ({
  default: class CloudBaseManagerDouble {},
}))

const originalEnvironment = {
  DB_COLLECTION_PREFIX: process.env.DB_COLLECTION_PREFIX,
  TCB_ENV_ID: process.env.TCB_ENV_ID,
  TCB_SECRET_ID: process.env.TCB_SECRET_ID,
  TCB_SECRET_KEY: process.env.TCB_SECRET_KEY,
}

async function createRepositories(pageSize?: number, maxPages?: number) {
  vi.resetModules()
  const database = new FakeCloudBaseDatabase()
  cloudbase.database = database
  const {
    CloudBaseInstitutionRepository,
    CloudBaseTeacherClassRepository,
    CloudBaseCourseRepository,
    CloudBaseClassCourseRepository,
    CloudBaseLessonProgressRepository,
  } = await import('../repositories.js')

  const institutions = new CloudBaseInstitutionRepository(pageSize, maxPages)
  const classes = new CloudBaseTeacherClassRepository(pageSize, maxPages)
  await institutions.create({ id: 'i1', name: '机构一', status: 'active' })
  await institutions.create({ id: 'i2', name: '机构二', status: 'active' })
  await classes.create({
    id: 'c1',
    institutionId: 'i1',
    name: '二年级创作 A 班',
    aiUsageMode: 'class_only',
    xiaobaoCreditLimit: null,
    status: 'active',
    archivedAt: null,
  })

  return {
    database,
    courses: new CloudBaseCourseRepository(pageSize, maxPages),
    classCourses: new CloudBaseClassCourseRepository(pageSize, maxPages),
    lessonProgress: new CloudBaseLessonProgressRepository(pageSize, maxPages),
  }
}

function courseInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'course-1',
    institutionId: 'i1',
    title: 'AI 太空海报创作营',
    description: '用 AI 画出自己的太空校园海报',
    coverAsset: '',
    stage: 'lower_primary' as const,
    topic: '视觉创作',
    status: 'ready' as const,
    ageRange: '8-10 岁',
    goals: JSON.stringify(['理解构图']),
    expectedOutcome: '一张完整海报',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.DB_COLLECTION_PREFIX = 'vibe_agent_'
  process.env.TCB_ENV_ID = 'test-env'
  process.env.TCB_SECRET_ID = 'test-id'
  process.env.TCB_SECRET_KEY = 'test-secret'
})

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  cloudbase.database = undefined
})

describe('CloudBaseCourseRepository', () => {
  it('creates a course and lists it only for its own institution', async () => {
    const { courses } = await createRepositories()

    const created = await courses.create(courseInput())
    await courses.create(courseInput({ id: 'course-2', institutionId: 'i2', title: '别的机构的课' }))

    expect(created).toMatchObject({ id: 'course-1', status: 'ready' })
    await expect(courses.listByInstitution('i1')).resolves.toEqual([expect.objectContaining({ id: 'course-1' })])
    await expect(courses.findById('missing')).resolves.toBeNull()
  })

  it('loads the outline with chapters, lessons and resources in sort order', async () => {
    const { courses } = await createRepositories()
    await courses.create(courseInput())
    await courses.createChapter({ id: 'ch-2', courseId: 'course-1', title: '第二章', sortOrder: 2 })
    await courses.createChapter({ id: 'ch-1', courseId: 'course-1', title: '第一章', sortOrder: 1 })
    await courses.createLesson({
      id: 'lesson-2',
      chapterId: 'ch-1',
      title: '第二课时',
      sortOrder: 2,
      durationMinutes: 40,
    })
    await courses.createLesson({
      id: 'lesson-1',
      chapterId: 'ch-1',
      title: '第一课时',
      sortOrder: 1,
      durationMinutes: 40,
    })
    await courses.createResource({ id: 'res-1', lessonId: 'lesson-1', title: '课件', type: 'slides', status: 'ready' })

    const outline = await courses.loadOutline('course-1')

    expect(outline?.chapters.map((item) => item.chapter.id)).toEqual(['ch-1', 'ch-2'])
    expect(outline?.chapters[0].lessons.map((item) => item.lesson.id)).toEqual(['lesson-1', 'lesson-2'])
    expect(outline?.chapters[0].lessons[0].resources).toEqual([expect.objectContaining({ id: 'res-1' })])
    expect(outline?.chapters[1].lessons).toEqual([])

    await expect(courses.loadOutline('missing')).resolves.toBeNull()
  })

  it('returns null instead of a partial outline when paging cannot finish', async () => {
    // 每页 2 条、最多读 1 页：3 个章节必定读不完。
    const { courses } = await createRepositories(2, 1)
    await courses.create(courseInput())
    for (const index of [1, 2, 3]) {
      await courses.createChapter({
        id: `ch-${index}`,
        courseId: 'course-1',
        title: `第 ${index} 章`,
        sortOrder: index,
      })
    }

    // 不完整的课程大纲会让学生少上几节课，因此必须抛错而不是返回一份缺课的课程。
    // 返回 null 只表示"课程不存在"，端点据此区分 404 与 503。
    await expect(courses.loadOutline('course-1')).rejects.toThrow()
  })

  it('updates a course in place, refreshing only the fields it was given', async () => {
    const { courses } = await createRepositories()
    const created = await courses.create(courseInput())

    const updated = await courses.update('course-1', { title: '改过的标题', status: 'ready' })

    expect(updated).toMatchObject({ id: 'course-1', title: '改过的标题', status: 'ready' })
    // 没给的字段保持原值
    expect(updated?.topic).toBe('视觉创作')
    expect(updated?.stage).toBe('lower_primary')
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    await expect(courses.update('missing', { title: 'x' })).resolves.toBeNull()
  })
})

describe('CloudBaseClassCourseRepository', () => {
  it('assigns a course to a class idempotently and lists both directions', async () => {
    const { courses, classCourses } = await createRepositories()
    await courses.create(courseInput())

    const first = await classCourses.assign({ classId: 'c1', courseId: 'course-1' })
    const second = await classCourses.assign({ classId: 'c1', courseId: 'course-1' })

    expect(second.assignedAt).toBe(first.assignedAt)
    await expect(classCourses.listByClass('c1')).resolves.toHaveLength(1)
    await expect(classCourses.listByCourse('course-1')).resolves.toEqual([expect.objectContaining({ classId: 'c1' })])
  })
})

describe('CloudBaseLessonProgressRepository', () => {
  it('upserts one progress row per class and lesson and clears stale completion time', async () => {
    const { courses, lessonProgress } = await createRepositories()
    await courses.create(courseInput())
    await courses.createChapter({ id: 'ch-1', courseId: 'course-1', title: '第一章', sortOrder: 1 })
    await courses.createLesson({
      id: 'lesson-1',
      chapterId: 'ch-1',
      title: '第一课时',
      sortOrder: 1,
      durationMinutes: 40,
    })

    const created = await lessonProgress.setStatus({
      id: 'p1',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'next',
    })
    expect(created).toMatchObject({ status: 'next', completedAt: null })

    const completed = await lessonProgress.setStatus({
      id: 'p2',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'completed',
      completedAt: 5_000,
    })
    expect(completed).toMatchObject({ id: 'p1', status: 'completed', completedAt: 5_000 })

    const reopened = await lessonProgress.setStatus({
      id: 'p3',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'next',
    })
    expect(reopened).toMatchObject({ status: 'next', completedAt: null })
    await expect(lessonProgress.listByClass('c1')).resolves.toHaveLength(1)
  })
})
