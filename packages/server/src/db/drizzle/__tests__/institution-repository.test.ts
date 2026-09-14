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
  const directory = mkdtempSync(join(tmpdir(), 'teacher-institution-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { createDrizzleProvider } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)

  for (const userId of ['teacher-1', 'teacher-2']) {
    database
      .prepare(
        `INSERT INTO users (
          id, provider, external_id, access_token, username, role, status,
          created_at, updated_at, last_login_at
        ) VALUES (?, 'local', ?, '', ?, 'user', 'active', 1, 1, 1)`,
      )
      .run(userId, userId, userId)
  }

  fixture = { closeClient: closeDrizzleClient, database, directory, provider: createDrizzleProvider() }
  return fixture
}

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    institutionId: 'i1',
    userId: 'teacher-1',
    role: 'teacher' as const,
    status: 'active' as const,
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

describe('DrizzleInstitutionRepository', () => {
  it('creates an institution and reads it back for its member', async () => {
    const { provider } = await createFixture()

    const created = await provider.institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    expect(created).toMatchObject({ id: 'i1', name: '示例机构', status: 'active' })
    expect(created.createdAt).toBeGreaterThan(0)

    await provider.institutionMembers.create(membership())

    await expect(provider.institutions.findById('i1')).resolves.toMatchObject({ name: '示例机构' })
    await expect(provider.institutions.findById('missing')).resolves.toBeNull()
    await expect(provider.institutions.listForUser('teacher-1')).resolves.toEqual([
      expect.objectContaining({ id: 'i1' }),
    ])
  })

  it('returns an empty list for a user without memberships rather than null', async () => {
    const { provider } = await createFixture()

    await expect(provider.institutions.listForUser('teacher-1')).resolves.toEqual([])
  })

  it('rejects a duplicate membership in the same institution without touching the first one', async () => {
    const { provider } = await createFixture()
    await provider.institutions.create({ id: 'i1', name: '示例机构', status: 'active' })

    await expect(provider.institutionMembers.create(membership())).resolves.toMatchObject({ role: 'teacher' })
    // 同一机构内同一用户的第二条成员关系由唯一约束拒绝，返回 null 而不是抛出底层数据库错误
    await expect(provider.institutionMembers.create(membership({ id: 'm2', role: 'admin' }))).resolves.toBeNull()

    await expect(provider.institutionMembers.listByInstitutionId('i1')).resolves.toHaveLength(1)
    await expect(provider.institutionMembers.findByInstitutionAndUser('i1', 'teacher-1')).resolves.toMatchObject({
      id: 'm1',
      role: 'teacher',
    })
  })

  it('lets one teacher belong to two institutions and keeps memberships scoped', async () => {
    const { provider } = await createFixture()
    await provider.institutions.create({ id: 'i1', name: '机构一', status: 'active' })
    await provider.institutions.create({ id: 'i2', name: '机构二', status: 'active' })

    await provider.institutionMembers.create(membership())
    await provider.institutionMembers.create(membership({ id: 'm2', institutionId: 'i2', userId: 'teacher-2' }))

    await expect(provider.institutions.listForUser('teacher-1')).resolves.toEqual([
      expect.objectContaining({ id: 'i1' }),
    ])
    await expect(provider.institutions.listForUser('teacher-2')).resolves.toEqual([
      expect.objectContaining({ id: 'i2' }),
    ])
    await expect(provider.institutionMembers.listByUserId('teacher-1')).resolves.toEqual([
      expect.objectContaining({ institutionId: 'i1' }),
    ])
    await expect(provider.institutionMembers.findByInstitutionAndUser('i2', 'teacher-1')).resolves.toBeNull()
  })

  it('changes a member role in place and leaves the join time alone', async () => {
    const { provider } = await createFixture()
    await provider.institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    const created = await provider.institutionMembers.create(membership())

    const updated = await provider.institutionMembers.updateRole('i1', 'teacher-1', 'admin')

    expect(updated).toMatchObject({ id: created?.id, role: 'admin' })
    // 谁在什么时候加入机构是有审计意义的事实：改角色不能把它重置成"刚加入"
    expect(updated?.createdAt).toBe(created?.createdAt)
    await expect(provider.institutionMembers.updateRole('i1', 'teacher-2', 'admin')).resolves.toBeNull()
  })

  it('removes a membership once and reports a missing one', async () => {
    const { provider } = await createFixture()
    await provider.institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    await provider.institutionMembers.create(membership())

    await expect(provider.institutionMembers.remove('i1', 'teacher-1')).resolves.toBe(true)
    await expect(provider.institutionMembers.findByInstitutionAndUser('i1', 'teacher-1')).resolves.toBeNull()
    // 本来就没有这条关系：返回 false，而不是假装删掉了
    await expect(provider.institutionMembers.remove('i1', 'teacher-1')).resolves.toBe(false)
  })
})
