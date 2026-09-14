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
  const directory = mkdtempSync(join(tmpdir(), 'teacher-class-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { createDrizzleProvider } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)

  for (const userId of ['teacher-1', 'teacher-2', 'student-1', 'student-2']) {
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
  await provider.institutions.create({ id: 'i2', name: '机构二', status: 'active' })

  fixture = { closeClient: closeDrizzleClient, database, directory, provider }
  return fixture
}

function classInput(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    institutionId: 'i1',
    name: '二年级创作 A 班',
    aiUsageMode: 'class_only' as const,
    xiaobaoCreditLimit: null,
    status: 'active' as const,
    archivedAt: null,
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

describe('DrizzleTeacherClassRepository', () => {
  it('creates a class and lists it only for its own institution', async () => {
    const { provider } = await createFixture()

    const created = await provider.classes.create(classInput())
    await provider.classes.create(classInput({ id: 'c2', institutionId: 'i2', name: '四年级游戏 B 班' }))

    expect(created).toMatchObject({ id: 'c1', name: '二年级创作 A 班', aiUsageMode: 'class_only' })
    await expect(provider.classes.listByInstitution('i1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
    await expect(provider.classes.listByInstitution('i2')).resolves.toEqual([expect.objectContaining({ id: 'c2' })])
    await expect(provider.classes.findById('missing')).resolves.toBeNull()
  })

  it('archives a class without deleting it, hiding it from institution and teacher lists', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())
    await provider.classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })

    await expect(provider.classes.archive('c1', 5_000)).resolves.toMatchObject({
      status: 'archived',
      archivedAt: 5_000,
    })

    // 记录仍在，历史课堂与作品不会失去归属
    await expect(provider.classes.findById('c1')).resolves.toMatchObject({ status: 'archived' })
    await expect(provider.classes.listByInstitution('i1')).resolves.toEqual([])
    await expect(provider.classes.listByTeacher('teacher-1')).resolves.toEqual([])
    await expect(provider.classes.archive('missing', 5_000)).resolves.toBeNull()
  })

  it('assigns a lead and an assistant teacher and rejects a duplicate assignment', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())

    await expect(
      provider.classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' }),
    ).resolves.toMatchObject({ role: 'lead' })
    await expect(
      provider.classTeachers.create({ classId: 'c1', userId: 'teacher-2', role: 'assistant' }),
    ).resolves.toMatchObject({ role: 'assistant' })

    // 同一老师在同一班重复分配由复合主键拒绝，返回 null 而不是抛出底层数据库错误
    await expect(
      provider.classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'assistant' }),
    ).resolves.toBeNull()

    await expect(provider.classTeachers.listByClass('c1')).resolves.toHaveLength(2)
    await expect(provider.classTeachers.findByClassAndUser('c1', 'teacher-1')).resolves.toMatchObject({ role: 'lead' })
    await expect(provider.classTeachers.findByClassAndUser('c1', 'teacher-2')).resolves.toMatchObject({
      role: 'assistant',
    })
    await expect(provider.classTeachers.findByClassAndUser('c1', 'teacher-2-missing')).resolves.toBeNull()
  })

  it('removes an assignment once and reports a missing one', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())
    await provider.classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })
    await provider.classTeachers.create({ classId: 'c1', userId: 'teacher-2', role: 'assistant' })

    await expect(provider.classTeachers.remove('c1', 'teacher-1')).resolves.toBe(true)
    await expect(provider.classTeachers.findByClassAndUser('c1', 'teacher-1')).resolves.toBeNull()
    await expect(provider.classTeachers.listByClass('c1')).resolves.toHaveLength(1)

    // 本来就没有这条关系：返回 false，而不是假装删掉了
    await expect(provider.classTeachers.remove('c1', 'teacher-1')).resolves.toBe(false)
  })

  it('scopes class lists by teacher so an unrelated teacher sees nothing', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())
    await provider.classes.create(classInput({ id: 'c2', name: '第二个班' }))
    await provider.classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })
    await provider.classTeachers.create({ classId: 'c1', userId: 'teacher-2', role: 'assistant' })

    await expect(provider.classes.listByTeacher('teacher-1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
    await expect(provider.classes.listByTeacher('teacher-2')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
    await expect(provider.classes.listByTeacher('teacher-3')).resolves.toEqual([])
    await expect(provider.classTeachers.listByUser('teacher-3')).resolves.toEqual([])
  })

  it('keeps a left student in history and out of the active roster', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())

    await expect(
      provider.classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ status: 'active', leftAt: null })

    await expect(provider.classEnrollments.leave('c1', 'student-1', 9_000)).resolves.toMatchObject({
      status: 'left',
      leftAt: 9_000,
    })

    // 在班名单里消失，但历史记录仍在（退班不删记录）
    await expect(provider.classEnrollments.listByClass('c1')).resolves.toEqual([])
    await expect(provider.classEnrollments.listByClass('c1', { includeLeft: true })).resolves.toEqual([
      expect.objectContaining({ id: 'e1', status: 'left' }),
    ])
    await expect(provider.classEnrollments.listByStudent('student-1')).resolves.toEqual([
      expect.objectContaining({ id: 'e1', status: 'left' }),
    ])
    await expect(provider.classes.listByStudent('student-1')).resolves.toEqual([])
    await expect(provider.classEnrollments.leave('c1', 'student-1', 9_000)).resolves.toBeNull()
  })

  it('revives the same enrollment record when a left student rejoins', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())
    await provider.classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' })
    await provider.classEnrollments.leave('c1', 'student-1', 9_000)

    // 唯一约束是 (classId, studentUserId)，所以复学必须复用同一条记录而不是插入第二条
    await expect(
      provider.classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ id: 'e1', status: 'active', leftAt: null })

    await expect(provider.classEnrollments.listByClass('c1')).resolves.toHaveLength(1)
    await expect(provider.classes.listByStudent('student-1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
  })

  it('treats a repeated enrollment as idempotent instead of inserting a duplicate', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())
    await provider.classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' })

    await expect(
      provider.classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ id: 'e1', status: 'active' })

    await expect(provider.classEnrollments.listByClass('c1')).resolves.toHaveLength(1)
  })

  it('updates the class-shared cap without touching the other fields', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())

    await expect(provider.classes.update('c1', { xiaobaoCreditLimit: 300 })).resolves.toMatchObject({
      id: 'c1',
      name: '二年级创作 A 班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: 300,
    })

    // 清空上限写 null 而不是 0：0 会被运行时预算读取器判为配置错误并锁死学生
    await expect(provider.classes.update('c1', { xiaobaoCreditLimit: null })).resolves.toMatchObject({
      xiaobaoCreditLimit: null,
    })
    await expect(provider.classes.update('missing', { xiaobaoCreditLimit: 10 })).resolves.toBeNull()
  })

  it('keeps enrollments per student so two students share one class', async () => {
    const { provider } = await createFixture()
    await provider.classes.create(classInput())

    await provider.classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' })
    await provider.classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-2', status: 'active' })

    await expect(provider.classEnrollments.listByClass('c1')).resolves.toHaveLength(2)
    await expect(provider.classEnrollments.findByClassAndStudent('c1', 'student-2')).resolves.toMatchObject({
      id: 'e2',
    })
    await expect(provider.classEnrollments.findByClassAndStudent('c1', 'student-3')).resolves.toBeNull()
  })
})
