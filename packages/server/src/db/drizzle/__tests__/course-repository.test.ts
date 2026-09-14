import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalDatabasePath = process.env.DATABASE_PATH

type Provider = ReturnType<(typeof import('../repositories.js'))['createDrizzleProvider']>

interface Fixture {
  closeClient(): void
  database: Database.Database
  directory: string
  provider: Provider
}

let fixture: Fixture | undefined

async function createFixture(): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'teacher-course-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { createDrizzleProvider } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)

  const provider = createDrizzleProvider()
  await provider.institutions.create({ id: 'i1', name: '机构一', status: 'active' })
  await provider.institutions.create({ id: 'i2', name: '机构二', status: 'active' })
  await provider.classes.create({
    id: 'c1',
    institutionId: 'i1',
    name: '二年级创作 A 班',
    aiUsageMode: 'class_only',
    xiaobaoCreditLimit: null,
    status: 'active',
    archivedAt: null,
  })

  fixture = { closeClient: closeDrizzleClient, database, directory, provider }
  return fixture
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
    goals: JSON.stringify(['理解构图', '会用提示词']),
    expectedOutcome: '一张完整海报',
    ...overrides,
  }
}

afterEach(() => {
  fixture?.closeClient()
  fixture?.database.close()
  if (fixture && existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true })
  fixture = undefined
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('DrizzleCourseRepository', () => {
  it('creates a course and lists it only for its own institution', async () => {
    const { provider } = await createFixture()

    const created = await provider.courses.create(courseInput())
    await provider.courses.create(courseInput({ id: 'course-2', institutionId: 'i2', title: '别的机构的课' }))

    expect(created).toMatchObject({ id: 'course-1', title: 'AI 太空海报创作营', status: 'ready' })
    await expect(provider.courses.listByInstitution('i1')).resolves.toEqual([
      expect.objectContaining({ id: 'course-1' }),
    ])
    await expect(provider.courses.listByInstitution('i2')).resolves.toEqual([
      expect.objectContaining({ id: 'course-2' }),
    ])
    await expect(provider.courses.findById('missing')).resolves.toBeNull()
  })

  it('loads the outline with chapters, lessons and resources in sort order', async () => {
    const { provider } = await createFixture()
    await provider.courses.create(courseInput())
    await provider.courses.createChapter({ id: 'ch-2', courseId: 'course-1', title: '第二章', sortOrder: 2 })
    await provider.courses.createChapter({ id: 'ch-1', courseId: 'course-1', title: '第一章', sortOrder: 1 })
    await provider.courses.createLesson({
      id: 'lesson-2',
      chapterId: 'ch-1',
      title: '第二课时',
      sortOrder: 2,
      durationMinutes: 40,
    })
    await provider.courses.createLesson({
      id: 'lesson-1',
      chapterId: 'ch-1',
      title: '第一课时',
      sortOrder: 1,
      durationMinutes: 40,
    })
    await provider.courses.createResource({
      id: 'res-1',
      lessonId: 'lesson-1',
      title: '课件',
      type: 'slides',
      status: 'ready',
    })

    const outline = await provider.courses.loadOutline('course-1')

    expect(outline?.course.title).toBe('AI 太空海报创作营')
    expect(outline?.chapters.map((item) => item.chapter.id)).toEqual(['ch-1', 'ch-2'])
    expect(outline?.chapters[0].lessons.map((item) => item.lesson.id)).toEqual(['lesson-1', 'lesson-2'])
    expect(outline?.chapters[0].lessons[0].resources).toEqual([
      expect.objectContaining({ id: 'res-1', type: 'slides', status: 'ready' }),
    ])
    // 空章节也要保留，否则前端会看不到"尚未排课"的章节
    expect(outline?.chapters[1].lessons).toEqual([])

    await expect(provider.courses.loadOutline('missing')).resolves.toBeNull()
  })

  it('updates a course in place, refreshing only the fields it was given', async () => {
    const { provider } = await createFixture()
    const created = await provider.courses.create(courseInput())

    const updated = await provider.courses.update('course-1', { title: '改过的标题', status: 'ready' })

    expect(updated).toMatchObject({ id: 'course-1', title: '改过的标题', status: 'ready' })
    // 没给的字段保持原值
    expect(updated?.topic).toBe('视觉创作')
    expect(updated?.stage).toBe('lower_primary')
    // updatedAt 由仓储刷新，不能被调用方填
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    await expect(provider.courses.update('missing', { title: 'x' })).resolves.toBeNull()
  })
})

describe('DrizzleClassCourseRepository', () => {
  it('assigns a course to a class idempotently and lists both directions', async () => {
    const { provider } = await createFixture()
    await provider.courses.create(courseInput())

    const first = await provider.classCourses.assign({ classId: 'c1', courseId: 'course-1' })
    const second = await provider.classCourses.assign({ classId: 'c1', courseId: 'course-1' })

    // 关联是幂等的：重复关联不产生第二行，也不刷新首次关联时间
    expect(second).toMatchObject({ classId: 'c1', courseId: 'course-1' })
    expect(second.assignedAt).toBe(first.assignedAt)
    await expect(provider.classCourses.listByClass('c1')).resolves.toHaveLength(1)
    await expect(provider.classCourses.listByCourse('course-1')).resolves.toEqual([
      expect.objectContaining({ classId: 'c1' }),
    ])
    await expect(provider.classCourses.listByClass('missing')).resolves.toEqual([])
  })
})

describe('DrizzleLessonProgressRepository', () => {
  it('upserts one progress row per class and lesson', async () => {
    const { provider } = await createFixture()
    await provider.courses.create(courseInput())
    await provider.courses.createChapter({ id: 'ch-1', courseId: 'course-1', title: '第一章', sortOrder: 1 })
    await provider.courses.createLesson({
      id: 'lesson-1',
      chapterId: 'ch-1',
      title: '第一课时',
      sortOrder: 1,
      durationMinutes: 40,
    })

    const created = await provider.lessonProgress.setStatus({
      id: 'p1',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'next',
    })
    expect(created).toMatchObject({ status: 'next', completedAt: null })

    // 同一 (班级, 课时) 再次写入是更新而不是插入第二条
    const completed = await provider.lessonProgress.setStatus({
      id: 'p2',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'completed',
      completedAt: 5_000,
    })
    expect(completed).toMatchObject({ id: 'p1', status: 'completed', completedAt: 5_000 })

    await expect(provider.lessonProgress.listByClass('c1')).resolves.toEqual([
      expect.objectContaining({ lessonId: 'lesson-1', status: 'completed' }),
    ])
    // 回到未完成时必须把完成时间清空，不能留下旧时间戳
    const reopened = await provider.lessonProgress.setStatus({
      id: 'p3',
      classId: 'c1',
      lessonId: 'lesson-1',
      status: 'next',
    })
    expect(reopened).toMatchObject({ status: 'next', completedAt: null })
    await expect(provider.lessonProgress.listByClass('c1')).resolves.toHaveLength(1)
  })
})
