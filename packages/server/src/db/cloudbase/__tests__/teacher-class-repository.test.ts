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
    CloudBaseClassTeacherRepository,
    CloudBaseClassEnrollmentRepository,
  } = await import('../repositories.js')

  return {
    database,
    institutions: new CloudBaseInstitutionRepository(pageSize, maxPages),
    classes: new CloudBaseTeacherClassRepository(pageSize, maxPages),
    classTeachers: new CloudBaseClassTeacherRepository(pageSize, maxPages),
    classEnrollments: new CloudBaseClassEnrollmentRepository(pageSize, maxPages),
  }
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

async function withInstitutions() {
  const repositories = await createRepositories()
  await repositories.institutions.create({ id: 'i1', name: '机构一', status: 'active' })
  await repositories.institutions.create({ id: 'i2', name: '机构二', status: 'active' })
  return repositories
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

describe('CloudBaseTeacherClassRepository', () => {
  it('creates a class and lists it only for its own institution', async () => {
    const { classes } = await withInstitutions()

    const created = await classes.create(classInput())
    await classes.create(classInput({ id: 'c2', institutionId: 'i2', name: '四年级游戏 B 班' }))

    expect(created).toMatchObject({ id: 'c1', name: '二年级创作 A 班' })
    await expect(classes.listByInstitution('i1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
    await expect(classes.listByInstitution('i2')).resolves.toEqual([expect.objectContaining({ id: 'c2' })])
    await expect(classes.findById('missing')).resolves.toBeNull()
  })

  it('archives a class without deleting it, hiding it from institution and teacher lists', async () => {
    const { classes, classTeachers } = await withInstitutions()
    await classes.create(classInput())
    await classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })

    await expect(classes.archive('c1', 5_000)).resolves.toMatchObject({ status: 'archived', archivedAt: 5_000 })

    await expect(classes.findById('c1')).resolves.toMatchObject({ status: 'archived' })
    await expect(classes.listByInstitution('i1')).resolves.toEqual([])
    await expect(classes.listByTeacher('teacher-1')).resolves.toEqual([])
    await expect(classes.archive('missing', 5_000)).resolves.toBeNull()
  })

  it('assigns a lead and an assistant teacher and rejects a duplicate assignment', async () => {
    const { classes, classTeachers } = await withInstitutions()
    await classes.create(classInput())

    await expect(classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })).resolves.toMatchObject({
      role: 'lead',
    })
    await expect(
      classTeachers.create({ classId: 'c1', userId: 'teacher-2', role: 'assistant' }),
    ).resolves.toMatchObject({
      role: 'assistant',
    })
    // 集合没有复合主键，重复分配由显式预检查拒绝
    await expect(classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'assistant' })).resolves.toBeNull()

    await expect(classTeachers.listByClass('c1')).resolves.toHaveLength(2)
    await expect(classTeachers.findByClassAndUser('c1', 'teacher-1')).resolves.toMatchObject({ role: 'lead' })
    await expect(classTeachers.findByClassAndUser('c1', 'teacher-3')).resolves.toBeNull()
  })

  it('removes an assignment once and reports a missing one', async () => {
    const { classes, classTeachers } = await withInstitutions()
    await classes.create(classInput())
    await classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })
    await classTeachers.create({ classId: 'c1', userId: 'teacher-2', role: 'assistant' })

    await expect(classTeachers.remove('c1', 'teacher-1')).resolves.toBe(true)
    await expect(classTeachers.findByClassAndUser('c1', 'teacher-1')).resolves.toBeNull()
    await expect(classTeachers.listByClass('c1')).resolves.toHaveLength(1)

    // 本来就没有这条关系：返回 false，而不是假装删掉了
    await expect(classTeachers.remove('c1', 'teacher-1')).resolves.toBe(false)
  })

  it('scopes class lists by teacher so an unrelated teacher sees nothing', async () => {
    const { classes, classTeachers } = await withInstitutions()
    await classes.create(classInput())
    await classTeachers.create({ classId: 'c1', userId: 'teacher-1', role: 'lead' })

    await expect(classes.listByTeacher('teacher-1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
    await expect(classes.listByTeacher('teacher-3')).resolves.toEqual([])
    await expect(classTeachers.listByUser('teacher-3')).resolves.toEqual([])
  })

  it('keeps a left student in history and out of the active roster', async () => {
    const { classes, classEnrollments } = await withInstitutions()
    await classes.create(classInput())

    await expect(
      classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ status: 'active', leftAt: null })

    await expect(classEnrollments.leave('c1', 'student-1', 9_000)).resolves.toMatchObject({
      status: 'left',
      leftAt: 9_000,
    })

    await expect(classEnrollments.listByClass('c1')).resolves.toEqual([])
    await expect(classEnrollments.listByClass('c1', { includeLeft: true })).resolves.toEqual([
      expect.objectContaining({ id: 'e1', status: 'left' }),
    ])
    await expect(classEnrollments.listByStudent('student-1')).resolves.toEqual([
      expect.objectContaining({ id: 'e1', status: 'left' }),
    ])
    await expect(classes.listByStudent('student-1')).resolves.toEqual([])
    await expect(classEnrollments.leave('c1', 'student-1', 9_000)).resolves.toBeNull()
  })

  it('revives the same enrollment record when a left student rejoins', async () => {
    const { classes, classEnrollments } = await withInstitutions()
    await classes.create(classInput())
    await classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' })
    await classEnrollments.leave('c1', 'student-1', 9_000)

    await expect(
      classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ id: 'e1', status: 'active', leftAt: null })

    await expect(classEnrollments.listByClass('c1')).resolves.toHaveLength(1)
    await expect(classes.listByStudent('student-1')).resolves.toEqual([expect.objectContaining({ id: 'c1' })])
  })

  it('treats a repeated enrollment as idempotent and keeps two students in one class', async () => {
    const { classes, classEnrollments } = await withInstitutions()
    await classes.create(classInput())

    await classEnrollments.enroll({ id: 'e1', classId: 'c1', studentUserId: 'student-1', status: 'active' })
    await expect(
      classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-1', status: 'active' }),
    ).resolves.toMatchObject({ id: 'e1' })
    await classEnrollments.enroll({ id: 'e2', classId: 'c1', studentUserId: 'student-2', status: 'active' })

    await expect(classEnrollments.listByClass('c1')).resolves.toHaveLength(2)
    await expect(classEnrollments.findByClassAndStudent('c1', 'student-2')).resolves.toMatchObject({ id: 'e2' })
    await expect(classEnrollments.findByClassAndStudent('c1', 'student-3')).resolves.toBeNull()
  })

  it('updates the class-shared cap without touching the other fields', async () => {
    const { classes } = await withInstitutions()
    await classes.create(classInput())

    await expect(classes.update('c1', { xiaobaoCreditLimit: 300 })).resolves.toMatchObject({
      id: 'c1',
      name: '二年级创作 A 班',
      aiUsageMode: 'class_only',
      xiaobaoCreditLimit: 300,
    })
    await expect(classes.update('c1', { xiaobaoCreditLimit: null })).resolves.toMatchObject({
      xiaobaoCreditLimit: null,
    })
    await expect(classes.update('missing', { xiaobaoCreditLimit: 10 })).resolves.toBeNull()
  })

  it('returns null instead of a partial roster when paging cannot finish', async () => {
    // 每页 2 条、最多读 1 页：3 名学生必定读不完。
    const { classes, classEnrollments } = await createRepositories(2, 1)
    await classes.create(classInput())

    for (const index of [1, 2, 3]) {
      await classEnrollments.enroll({
        id: `e${index}`,
        classId: 'c1',
        studentUserId: `student-${index}`,
        status: 'active',
      })
    }

    // 偏小的在班名单会让教师看到不完整的学生，宁可返回 null 让调用方 fail-closed。
    await expect(classEnrollments.listByClass('c1')).resolves.toBeNull()
  })

  it('returns null instead of a partial class list when paging cannot finish', async () => {
    const { classes, classTeachers } = await createRepositories(2, 1)
    await classes.create(classInput({ id: 'c1' }))
    await classes.create(classInput({ id: 'c2' }))
    await classes.create(classInput({ id: 'c3' }))

    for (const index of [1, 2, 3]) {
      await classTeachers.create({ classId: `c${index}`, userId: 'teacher-1', role: 'lead' })
    }

    await expect(classes.listByTeacher('teacher-1')).resolves.toBeNull()
  })
})
