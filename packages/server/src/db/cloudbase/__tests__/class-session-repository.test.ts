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
  const { CloudBaseClassSessionRepository } = await import('../repositories.js')
  return { database, classSessions: new CloudBaseClassSessionRepository(pageSize, maxPages) }
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

describe('CloudBaseClassSessionRepository', () => {
  it('records an open class with no end time and no invented duration', async () => {
    const { classSessions } = await createRepositories()

    const created = await classSessions.create(sessionInput())

    expect(created).toMatchObject({
      id: 's1',
      classId: 'c1',
      pointLimit: 100,
      endedAt: null,
      // 进行中的课没有时长，不能用 0 冒充
      durationMinutes: null,
      studentCount: 12,
    })
    await expect(classSessions.findById('s1')).resolves.toMatchObject({ id: 's1' })
    await expect(classSessions.findActiveByClass('c1')).resolves.toMatchObject({ id: 's1' })
    await expect(classSessions.findById('missing')).resolves.toBeNull()
    await expect(classSessions.findActiveByClass('missing')).resolves.toBeNull()
  })

  it('picks the row that is actually running when a class somehow has two', async () => {
    const { classSessions } = await createRepositories()
    // CloudBase 没有部分唯一索引，这一不变量靠路由层的"先查在读"保证；读取侧仍要给出确定答案
    await classSessions.create(sessionInput({ id: 's-old', startedAt: 1_000 }))
    await classSessions.create(sessionInput({ id: 's-new', startedAt: 2_000 }))

    await expect(classSessions.findActiveByClass('c1')).resolves.toMatchObject({ id: 's-new' })
  })

  it('applies mid-class changes to the running session', async () => {
    const { classSessions } = await createRepositories()
    await classSessions.create(sessionInput())

    const updated = await classSessions.update('s1', {
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
    await expect(classSessions.findActiveByClass('c1')).resolves.toMatchObject({ pointLimit: 250 })
  })

  it('closes a session once and ignores a second close', async () => {
    const { classSessions } = await createRepositories()
    await classSessions.create(sessionInput())

    await expect(classSessions.update('s1', { endedAt: 5_000, durationMinutes: 40 })).resolves.toMatchObject({
      endedAt: 5_000,
      durationMinutes: 40,
    })

    // 重复下课幂等：课堂时长是既成事实，不能被第二次点击改写成另一段时长
    await expect(classSessions.update('s1', { endedAt: 9_000, durationMinutes: 80 })).resolves.toMatchObject({
      endedAt: 5_000,
      durationMinutes: 40,
    })

    await expect(classSessions.findActiveByClass('c1')).resolves.toBeNull()
    await expect(classSessions.update('missing', { endedAt: 1 })).resolves.toBeNull()
  })

  it('lists the classroom history when the whole collection fits in the page budget', async () => {
    const { classSessions } = await createRepositories()
    await classSessions.create(sessionInput({ id: 's1', startedAt: 1_000 }))
    await classSessions.create(sessionInput({ id: 's2', startedAt: 2_000 }))

    await expect(classSessions.listByClass('c1')).resolves.toHaveLength(2)
    await expect(classSessions.listByClass('missing')).resolves.toEqual([])
  })

  it('refuses to guess when the read is truncated', async () => {
    // 一页一行、只翻一页：两条记录就必然读不全
    const { classSessions } = await createRepositories(1, 1)
    await classSessions.create(sessionInput({ id: 's1', startedAt: 1_000 }))
    await classSessions.create(sessionInput({ id: 's2', startedAt: 2_000 }))

    await expect(classSessions.listByClass('c1')).resolves.toBeNull()
    // 写路径靠它决定能不能再开一节：读不到就必须报错，而不是回答"没有进行中的课"
    await expect(classSessions.findActiveByClass('c1')).rejects.toThrow('Class session state unavailable')
  })
})
