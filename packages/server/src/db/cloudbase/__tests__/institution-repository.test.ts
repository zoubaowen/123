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
  const { CloudBaseInstitutionRepository, CloudBaseInstitutionMemberRepository } = await import('../repositories.js')

  return {
    database,
    institutions: new CloudBaseInstitutionRepository(pageSize, maxPages),
    members: new CloudBaseInstitutionMemberRepository(pageSize, maxPages),
  }
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

describe('CloudBaseInstitutionRepository', () => {
  it('creates an institution and reads it back for its member', async () => {
    const { institutions, members } = await createRepositories()

    const created = await institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    expect(created).toMatchObject({ id: 'i1', name: '示例机构', status: 'active' })
    expect(created.createdAt).toBeGreaterThan(0)

    await members.create(membership())

    await expect(institutions.findById('i1')).resolves.toMatchObject({ name: '示例机构' })
    await expect(institutions.findById('missing')).resolves.toBeNull()
    await expect(institutions.listForUser('teacher-1')).resolves.toEqual([expect.objectContaining({ id: 'i1' })])
  })

  it('returns an empty list for a user without memberships rather than null', async () => {
    const { institutions } = await createRepositories()

    await expect(institutions.listForUser('teacher-1')).resolves.toEqual([])
  })

  it('rejects a duplicate membership in the same institution without touching the first one', async () => {
    const { institutions, members } = await createRepositories()
    await institutions.create({ id: 'i1', name: '示例机构', status: 'active' })

    await expect(members.create(membership())).resolves.toMatchObject({ role: 'teacher' })
    // 集合本身没有唯一索引，因此这条保证来自显式预检查而不是数据库约束
    await expect(members.create(membership({ id: 'm2', role: 'admin' }))).resolves.toBeNull()

    await expect(members.findByInstitutionAndUser('i1', 'teacher-1')).resolves.toMatchObject({
      id: 'm1',
      role: 'teacher',
    })
  })

  it('lets one teacher belong to two institutions and keeps memberships scoped', async () => {
    const { institutions, members } = await createRepositories()
    await institutions.create({ id: 'i1', name: '机构一', status: 'active' })
    await institutions.create({ id: 'i2', name: '机构二', status: 'active' })

    await members.create(membership())
    await members.create(membership({ id: 'm2', institutionId: 'i2', userId: 'teacher-2' }))

    await expect(institutions.listForUser('teacher-1')).resolves.toEqual([expect.objectContaining({ id: 'i1' })])
    await expect(members.listByUserId('teacher-1')).resolves.toEqual([expect.objectContaining({ institutionId: 'i1' })])
    await expect(members.findByInstitutionAndUser('i2', 'teacher-1')).resolves.toBeNull()
  })

  it('changes a member role in place and leaves the join time alone', async () => {
    const { institutions, members } = await createRepositories()
    await institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    const created = await members.create(membership())

    const updated = await members.updateRole('i1', 'teacher-1', 'admin')

    expect(updated).toMatchObject({ id: created?.id, role: 'admin' })
    // 谁在什么时候加入机构是有审计意义的事实：改角色不能把它重置成"刚加入"
    expect(updated?.createdAt).toBe(created?.createdAt)
    await expect(members.updateRole('i1', 'teacher-2', 'admin')).resolves.toBeNull()
  })

  it('removes a membership once and reports a missing one', async () => {
    const { institutions, members } = await createRepositories()
    await institutions.create({ id: 'i1', name: '示例机构', status: 'active' })
    await members.create(membership())

    await expect(members.remove('i1', 'teacher-1')).resolves.toBe(true)
    await expect(members.findByInstitutionAndUser('i1', 'teacher-1')).resolves.toBeNull()
    // 本来就没有这条关系：返回 false，而不是假装删掉了
    await expect(members.remove('i1', 'teacher-1')).resolves.toBe(false)
  })

  it('returns null instead of a partial member list when paging cannot finish', async () => {
    // 每页 2 条、最多读 1 页：同一机构下 3 条成员关系必定读不完。
    const { institutions, members } = await createRepositories(2, 1)
    await institutions.create({ id: 'i1', name: '示例机构', status: 'active' })

    for (const index of [1, 2, 3]) {
      await members.create(membership({ id: `m${index}`, userId: `teacher-${index}` }))
    }

    // 偏小的成员列表会让权限判断放行本不该放行的人，所以宁可返回 null 让调用方 fail-closed。
    await expect(members.listByInstitutionId('i1')).resolves.toBeNull()
  })

  it('returns null instead of a partial institution list when paging cannot finish', async () => {
    const { institutions, members } = await createRepositories(2, 1)

    for (const index of [1, 2, 3]) {
      await institutions.create({ id: `i${index}`, name: `机构${index}`, status: 'active' })
      await members.create(membership({ id: `m${index}`, institutionId: `i${index}` }))
    }

    await expect(institutions.listForUser('teacher-1')).resolves.toBeNull()
  })
})
