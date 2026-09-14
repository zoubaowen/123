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
  const directory = mkdtempSync(join(tmpdir(), 'class-session-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { createDrizzleProvider } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)

  for (const userId of ['teacher-1', 'student-1']) {
    database
      .prepare(
        `INSERT INTO users (
          id, provider, external_id, access_token, username, role, status,
          created_at, updated_at, last_login_at
        ) VALUES (?, 'local', ?, '', ?, 'user', 'active', 1, 1, 1)`,
      )
      .run(userId, userId, userId)
  }

  const provider = createDrizzleProvider()
  await provider.institutions.create({ id: 'i1', name: '机构一', status: 'active' })
  await provider.classes.create({
    id: 'c1',
    institutionId: 'i1',
    name: '二年级创作 A 班',
    aiUsageMode: 'class_only',
    xiaobaoCreditLimit: null,
    status: 'active',
    archivedAt: null,
  })
  await provider.courses.create({
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
  })
  await provider.courses.createChapter({ id: 'chapter-1', courseId: 'course-1', title: '第一章', sortOrder: 1 })
  await provider.courses.createLesson({
    id: 'lesson-1',
    chapterId: 'chapter-1',
    title: '第一课时',
    sortOrder: 1,
    durationMinutes: 40,
  })

  fixture = { closeClient: closeDrizzleClient, database, directory, provider }
  return fixture
}

function sessionInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 's1',
    classId: 'c1',
    lessonId: 'lesson-1',
    startedByUserId: 'teacher-1',
    startedAt: 1_000,
    pointLimit: 100,
    capabilities: JSON.stringify(['writing']),
    skills: JSON.stringify(['story']),
    mcpServers: JSON.stringify(['draw']),
    studentCount: 12,
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

describe('DrizzleClassSessionRepository', () => {
  it('records an open class with no end time and no invented duration', async () => {
    const { provider } = await createFixture()

    const created = await provider.classSessions.create(sessionInput())

    expect(created).toMatchObject({
      id: 's1',
      classId: 'c1',
      lessonId: 'lesson-1',
      pointLimit: 100,
      endedAt: null,
      // 进行中的课没有时长，不能用 0 冒充
      durationMinutes: null,
    })
    expect(created.studentCount).toBe(12)
    await expect(provider.classSessions.findById('s1')).resolves.toMatchObject({ id: 's1' })
    await expect(provider.classSessions.findActiveByClass('c1')).resolves.toMatchObject({ id: 's1' })
    await expect(provider.classSessions.findById('missing')).resolves.toBeNull()
    await expect(provider.classSessions.findActiveByClass('missing')).resolves.toBeNull()
  })

  it('keeps at most one running class per class even when opening twice', async () => {
    const { provider } = await createFixture()

    const first = await provider.classSessions.create(sessionInput())
    // 老师重复点"开课"：第二次必须拿到正在上的那一节，而不是把课堂劈成两节
    const second = await provider.classSessions.create(sessionInput({ id: 's2', startedAt: 2_000 }))

    expect(second.id).toBe(first.id)
    await expect(provider.classSessions.listByClass('c1')).resolves.toHaveLength(1)
  })

  it('applies mid-class changes to the running session', async () => {
    const { provider } = await createFixture()
    await provider.classSessions.create(sessionInput())

    const updated = await provider.classSessions.update('s1', {
      pointLimit: 250,
      capabilities: JSON.stringify(['writing', 'learning']),
    })

    expect(updated).toMatchObject({
      id: 's1',
      pointLimit: 250,
      capabilities: JSON.stringify(['writing', 'learning']),
      endedAt: null,
      // 课中调整能力不该顺手改掉其他字段
      skills: JSON.stringify(['story']),
      mcpServers: JSON.stringify(['draw']),
    })
    await expect(provider.classSessions.findActiveByClass('c1')).resolves.toMatchObject({ pointLimit: 250 })
  })

  it('closes a session once and ignores a second close', async () => {
    const { provider } = await createFixture()
    await provider.classSessions.create(sessionInput())

    const closed = await provider.classSessions.update('s1', { endedAt: 5_000, durationMinutes: 40 })
    expect(closed).toMatchObject({ id: 's1', endedAt: 5_000, durationMinutes: 40 })

    // 重复下课幂等：课堂时长是既成事实，不能被第二次点击改写成另一段时长
    const again = await provider.classSessions.update('s1', { endedAt: 9_000, durationMinutes: 80 })
    expect(again).toMatchObject({ endedAt: 5_000, durationMinutes: 40 })

    await expect(provider.classSessions.findActiveByClass('c1')).resolves.toBeNull()
    await expect(provider.classSessions.update('missing', { endedAt: 1 })).resolves.toBeNull()

    // 下课后可以再开一节，历史保留
    const next = await provider.classSessions.create(sessionInput({ id: 's2', startedAt: 6_000 }))
    expect(next.id).toBe('s2')
    await expect(provider.classSessions.listByClass('c1')).resolves.toHaveLength(2)
  })

  it('lists the classroom history newest first', async () => {
    const { provider } = await createFixture()
    await provider.classSessions.create(sessionInput({ id: 's-old', startedAt: 1_000 }))
    await provider.classSessions.update('s-old', { endedAt: 2_000, durationMinutes: 15 })
    await provider.classSessions.create(sessionInput({ id: 's-new', startedAt: 3_000 }))

    const history = await provider.classSessions.listByClass('c1')

    expect(history?.map((session) => session.id)).toEqual(['s-new', 's-old'])
    await expect(provider.classSessions.listByClass('missing')).resolves.toEqual([])
  })
})
