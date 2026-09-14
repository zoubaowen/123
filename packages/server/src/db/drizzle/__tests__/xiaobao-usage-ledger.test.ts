import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const originalDatabasePath = process.env.DATABASE_PATH

type LedgerRepository = InstanceType<(typeof import('../repositories.js'))['DrizzleXiaobaoUsageLedgerRepository']>

interface Fixture {
  closeClient(): void
  database: Database.Database
  directory: string
  failAfter(writeNumber: number): void
  repository: LedgerRepository
}

let fixture: Fixture | undefined

async function createFixture(afterInitialRead: () => void = () => undefined): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'xiaobao-usage-ledger-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { DrizzleXiaobaoUsageLedgerRepository } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)
  let failureTarget: number | undefined
  let writeCount = 0
  const repository = new DrizzleXiaobaoUsageLedgerRepository(() => {
    if (failureTarget !== undefined && ++writeCount === failureTarget) {
      throw new Error('Injected ledger write failure')
    }
  }, afterInitialRead)

  for (const userId of ['user-1', 'user-2']) {
    database
      .prepare(
        `INSERT INTO users (
          id, provider, external_id, access_token, username, role, status,
          created_at, updated_at, last_login_at
        ) VALUES (?, 'local', ?, '', ?, 'user', 'active', 1, 1, 1)`,
      )
      .run(userId, userId, userId)
  }

  fixture = {
    closeClient: closeDrizzleClient,
    database,
    directory,
    failAfter(writeNumber: number) {
      failureTarget = writeNumber
      writeCount = 0
    },
    repository,
  }
  return fixture
}

function seedCredits(database: Database.Database, userId = 'user-1', balance = 100, frozenBalance = 0): void {
  database
    .prepare(
      `INSERT INTO user_credits (
        id, user_id, balance, frozen_balance, lifetime_balance, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 1)`,
    )
    .run(`credits-${userId}`, userId, balance, frozenBalance, balance)
}

function reserveInput(overrides: Partial<Parameters<LedgerRepository['reserve']>[0]> = {}) {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    category: 'model' as const,
    reservedUnits: 20,
    creditCostReserved: 30,
    now: 100,
    ...overrides,
  }
}

function settlementInput(reservationId: string, overrides: Partial<Parameters<LedgerRepository['settle']>[0]> = {}) {
  return {
    reservationId,
    taskId: 'task-1',
    category: 'model' as const,
    settledUnits: 12,
    creditCostSettled: 18,
    now: 200,
    ...overrides,
  }
}

async function reserveOnce(database: Database.Database, repository: LedgerRepository): Promise<string> {
  seedCredits(database)
  const result = await repository.reserve(reserveInput())
  if (!result.allowed) throw new Error('Expected reservation to be allowed')
  return result.record.id
}

function creditState(database: Database.Database, userId = 'user-1') {
  return database
    .prepare('SELECT balance, frozen_balance AS frozenBalance FROM user_credits WHERE user_id = ?')
    .get(userId)
}

function reservationCount(database: Database.Database): number {
  return (database.prepare('SELECT count(*) AS count FROM xiaobao_usage_reservations').get() as { count: number }).count
}

function creditTransactions(database: Database.Database) {
  return database
    .prepare(
      `SELECT id, type, amount, balance_after AS balanceAfter
       FROM credit_transactions ORDER BY created_at, id`,
    )
    .all()
}

beforeEach(() => {
  fixture = undefined
})

afterEach(() => {
  fixture?.database.close()
  fixture?.closeClient()
  if (fixture && existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true })
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('DrizzleXiaobaoUsageLedgerRepository reserve', () => {
  it('exposes the initial read boundary before the first reservation write', async () => {
    let initialReads = 0
    const { database, repository } = await createFixture(() => {
      initialReads += 1
    })
    seedCredits(database)

    await repository.reserve(reserveInput())

    expect(initialReads).toBe(1)
  })

  it('atomically reserves credits and records a stable reserve transaction', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)

    const result = await repository.reserve(reserveInput())

    expect(result).toMatchObject({
      allowed: true,
      record: {
        taskId: 'task-1',
        userId: 'user-1',
        category: 'model',
        reservedUnits: 20,
        settledUnits: null,
        status: 'reserved',
        creditCostReserved: 30,
        creditCostSettled: null,
        createdAt: 100,
        updatedAt: 100,
        settledAt: null,
      },
    })
    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    if (!result.allowed) throw new Error('Expected reservation to be allowed')
    expect(creditTransactions(database)).toEqual([
      {
        id: `xiaobao:${result.record.id}:reserve`,
        type: 'freeze',
        amount: -30,
        balanceAfter: 70,
      },
    ])
  })

  it('creates missing credits inside the reservation transaction', async () => {
    const { database, repository } = await createFixture()

    const result = await repository.reserve(reserveInput({ creditCostReserved: 0 }))

    expect(result.allowed).toBe(true)
    expect(creditState(database)).toEqual({ balance: 0, frozenBalance: 0 })
    expect(reservationCount(database)).toBe(1)
  })

  it('returns the original record for an identical reserve retry without freezing twice', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)

    const first = await repository.reserve(reserveInput())
    const second = await repository.reserve(reserveInput({ now: 999 }))

    expect(first).toEqual(second)
    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(reservationCount(database)).toBe(1)
    expect(creditTransactions(database)).toHaveLength(1)
  })

  it.each([
    ['user', { userId: 'user-2' }],
    ['units', { reservedUnits: 21 }],
    ['cost', { creditCostReserved: 31 }],
  ])('rejects a conflicting %s retry without changing accounting', async (_field, conflict) => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    await repository.reserve(reserveInput())

    await expect(repository.reserve(reserveInput(conflict))).rejects.toThrow('Usage reservation conflict')
    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(reservationCount(database)).toBe(1)
    expect(creditTransactions(database)).toHaveLength(1)
  })

  it('denies insufficient balance without reservation, freeze, or credit transaction', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 29)

    await expect(repository.reserve(reserveInput())).resolves.toEqual({
      allowed: false,
      reason: 'insufficient_credits',
    })
    expect(creditState(database)).toEqual({ balance: 29, frozenBalance: 0 })
    expect(reservationCount(database)).toBe(0)
    expect(creditTransactions(database)).toEqual([])
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository settlement and release', () => {
  it('settles the exact reserved cost from frozen credits with a stable transaction', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    const record = await repository.settle(settlementInput(reservationId, { settledUnits: 20, creditCostSettled: 30 }))

    expect(record).toMatchObject({
      id: reservationId,
      status: 'settled',
      settledUnits: 20,
      creditCostSettled: 30,
      updatedAt: 200,
      settledAt: 200,
    })
    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 0 })
    expect(creditTransactions(database)).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:settle`, type: 'consumption' },
    ])
  })

  it('returns the unused frozen cost to available balance and records a stable release transaction', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    await repository.settle(settlementInput(reservationId))

    expect(creditState(database)).toEqual({ balance: 82, frozenBalance: 0 })
    expect(creditTransactions(database)).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
      { amount: 12, balanceAfter: 82, id: `xiaobao:${reservationId}:release`, type: 'refund' },
      { amount: -18, balanceAfter: 82, id: `xiaobao:${reservationId}:settle`, type: 'consumption' },
    ])
  })

  it('settles zero usage and releases the full reservation', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    const record = await repository.settle(settlementInput(reservationId, { settledUnits: 0, creditCostSettled: 0 }))

    expect(record).toMatchObject({ status: 'settled', settledUnits: 0, creditCostSettled: 0 })
    expect(creditState(database)).toEqual({ balance: 100, frozenBalance: 0 })
    expect(creditTransactions(database)).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
      { amount: 30, balanceAfter: 100, id: `xiaobao:${reservationId}:release`, type: 'refund' },
      { amount: 0, balanceAfter: 100, id: `xiaobao:${reservationId}:settle`, type: 'consumption' },
    ])
  })

  it('treats an identical settlement retry as a no-op', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    const first = await repository.settle(settlementInput(reservationId))
    const second = await repository.settle(settlementInput(reservationId, { now: 999 }))

    expect(second).toEqual(first)
    expect(creditState(database)).toEqual({ balance: 82, frozenBalance: 0 })
    expect(creditTransactions(database)).toHaveLength(3)
  })

  it.each([
    ['task', { taskId: 'task-2' }],
    ['category', { category: 'tool' as const }],
    ['units', { settledUnits: 13 }],
    ['cost', { creditCostSettled: 19 }],
  ])('rejects a conflicting settled %s retry', async (_field, conflict) => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    await repository.settle(settlementInput(reservationId))

    await expect(repository.settle(settlementInput(reservationId, conflict))).rejects.toThrow(
      'Usage settlement conflict',
    )
    expect(creditState(database)).toEqual({ balance: 82, frozenBalance: 0 })
    expect(creditTransactions(database)).toHaveLength(3)
  })

  it('rejects settlement cost above the reservation without changing state', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    await expect(repository.settle(settlementInput(reservationId, { creditCostSettled: 31 }))).rejects.toThrow(
      'Usage settlement exceeds reservation',
    )
    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(creditTransactions(database)).toHaveLength(1)
    await expect(repository.findByTaskAndCategory('task-1', 'model')).resolves.toMatchObject({
      status: 'reserved',
      settledUnits: null,
      creditCostSettled: null,
    })
  })

  it.each(['safety_denied', 'runtime_failed'] as const)(
    'explicitly releases the full reservation for %s with a stable transaction',
    async (reason) => {
      const { database, repository } = await createFixture()
      const reservationId = await reserveOnce(database, repository)

      const record = await repository.release(reservationId, reason)

      expect(record).toMatchObject({
        id: reservationId,
        status: 'released',
        settledUnits: 0,
        creditCostSettled: 0,
      })
      expect(creditState(database)).toEqual({ balance: 100, frozenBalance: 0 })
      expect(creditTransactions(database)).toEqual([
        { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
        { amount: 30, balanceAfter: 100, id: `xiaobao:${reservationId}:release`, type: 'refund' },
      ])
    },
  )

  it('treats an identical explicit release as a no-op and rejects a different reason', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    const first = await repository.release(reservationId, 'safety_denied')
    const second = await repository.release(reservationId, 'safety_denied')

    expect(second).toEqual(first)
    await expect(repository.release(reservationId, 'runtime_failed')).rejects.toThrow('Usage release conflict')
    expect(creditState(database)).toEqual({ balance: 100, frozenBalance: 0 })
    expect(creditTransactions(database)).toHaveLength(2)
  })

  it('rejects an unsupported explicit release reason without changing accounting', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    await expect(repository.release(reservationId, 'other' as never)).rejects.toThrow('Usage release conflict')

    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(creditTransactions(database)).toHaveLength(1)
    await expect(repository.findByTaskAndCategory('task-1', 'model')).resolves.toMatchObject({
      status: 'reserved',
    })
  })

  it('rejects settlement after explicit release and release after settlement', async () => {
    const first = await createFixture()
    const releasedId = await reserveOnce(first.database, first.repository)
    await first.repository.release(releasedId, 'runtime_failed')
    await expect(first.repository.settle(settlementInput(releasedId))).rejects.toThrow('Usage settlement conflict')

    const settledResult = await first.repository.reserve(reserveInput({ taskId: 'task-2', category: 'tool', now: 300 }))
    if (!settledResult.allowed) throw new Error('Expected reservation to be allowed')
    await first.repository.settle(
      settlementInput(settledResult.record.id, {
        taskId: 'task-2',
        category: 'tool',
        now: 400,
      }),
    )
    await expect(first.repository.release(settledResult.record.id, 'runtime_failed')).rejects.toThrow(
      'Usage release conflict',
    )
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository transaction rollback', () => {
  it.each([1, 2, 3, 4])('rolls back a missing-credit reservation after write point %s', async (writePoint) => {
    const { database, failAfter, repository } = await createFixture()
    failAfter(writePoint)

    await expect(repository.reserve(reserveInput({ creditCostReserved: 0 }))).rejects.toThrow(
      'Injected ledger write failure',
    )

    expect(database.prepare('SELECT count(*) AS count FROM user_credits WHERE user_id = ?').get('user-1')).toEqual({
      count: 0,
    })
    expect(reservationCount(database)).toBe(0)
    expect(creditTransactions(database)).toEqual([])
  })

  it.each([1, 2, 3, 4])('rolls back a partial settlement after write point %s', async (writePoint) => {
    const { database, failAfter, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    failAfter(writePoint)

    await expect(repository.settle(settlementInput(reservationId))).rejects.toThrow('Injected ledger write failure')

    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(creditTransactions(database)).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
    ])
    await expect(repository.findByTaskAndCategory('task-1', 'model')).resolves.toMatchObject({
      status: 'reserved',
      settledUnits: null,
      creditCostSettled: null,
      updatedAt: 100,
      settledAt: null,
    })
  })

  it.each([1, 2, 3])('rolls back an explicit release after write point %s', async (writePoint) => {
    const { database, failAfter, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    failAfter(writePoint)

    await expect(repository.release(reservationId, 'runtime_failed')).rejects.toThrow('Injected ledger write failure')

    expect(creditState(database)).toEqual({ balance: 70, frozenBalance: 30 })
    expect(creditTransactions(database)).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
    ])
    await expect(repository.findByTaskAndCategory('task-1', 'model')).resolves.toMatchObject({
      status: 'reserved',
      settledUnits: null,
      creditCostSettled: null,
    })
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository health check', () => {
  it('verifies a probe inside a deliberately rolled-back transaction with no residue', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 77, 9)

    await expect(repository.healthCheck()).resolves.toBe(true)

    expect(creditState(database)).toEqual({ balance: 77, frozenBalance: 9 })
    expect(reservationCount(database)).toBe(0)
    expect(
      database
        .prepare(
          "SELECT count(*) AS count FROM xiaobao_usage_reservations WHERE task_id LIKE '__xiaobao_usage_probe__%'",
        )
        .get(),
    ).toEqual({ count: 0 })
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository settled credit sum', () => {
  it('sums settled credits per user and honours the since filter', async () => {
    const { database, repository } = await createFixture()
    const first = await reserveOnce(database, repository)
    await repository.settle(settlementInput(first, { settledUnits: 7, creditCostSettled: 7, now: 1_000 }))

    const second = await repository.reserve(reserveInput({ taskId: 'task-2', now: 1_500 }))
    if (!second.allowed) throw new Error('Expected the second reservation to be allowed')
    await repository.settle(
      settlementInput(second.record.id, {
        taskId: 'task-2',
        settledUnits: 5,
        creditCostSettled: 5,
        now: 2_000,
      }),
    )

    // 全部已结算：7 + 5
    await expect(repository.sumSettledCreditsByUser('user-1', null)).resolves.toBe(12)
    // 只统计 1500 之后结算的那笔
    await expect(repository.sumSettledCreditsByUser('user-1', 1_500)).resolves.toBe(5)
    // 其他用户不受影响
    await expect(repository.sumSettledCreditsByUser('user-2', null)).resolves.toBe(0)
  })

  it('ignores reserved and released rows', async () => {
    const { database, repository } = await createFixture()
    const released = await reserveOnce(database, repository)
    await repository.reserve(reserveInput({ taskId: 'task-2' }))
    await repository.release(released, 'safety_denied')

    await expect(repository.sumSettledCreditsByUser('user-1', null)).resolves.toBe(0)
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository settled credit breakdown', () => {
  it('groups settled credits by usage category and honours the since filter', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 1_000)

    const model = await repository.reserve(reserveInput({ taskId: 'task-model', category: 'model', now: 100 }))
    if (!model.allowed) throw new Error('Expected the model reservation to be allowed')
    await repository.settle(
      settlementInput(model.record.id, {
        taskId: 'task-model',
        category: 'model',
        settledUnits: 7,
        creditCostSettled: 7,
        now: 1_000,
      }),
    )

    const media = await repository.reserve(reserveInput({ taskId: 'task-media', category: 'media', now: 1_100 }))
    if (!media.allowed) throw new Error('Expected the media reservation to be allowed')
    await repository.settle(
      settlementInput(media.record.id, {
        taskId: 'task-media',
        category: 'media',
        settledUnits: 5,
        creditCostSettled: 5,
        now: 2_000,
      }),
    )

    // 全部已结算：模型 7、媒体 5，其余用途为 0
    await expect(repository.sumSettledCreditsByUserByCategory('user-1', null)).resolves.toEqual({
      model: 7,
      tool: 0,
      sandbox: 0,
      media: 5,
    })
    // 只统计 1500 之后结算的那笔
    await expect(repository.sumSettledCreditsByUserByCategory('user-1', 1_500)).resolves.toEqual({
      model: 0,
      tool: 0,
      sandbox: 0,
      media: 5,
    })
    // 其他用户不受影响，且"没有用量"与"无法确定"不同：这里是确切的 0
    await expect(repository.sumSettledCreditsByUserByCategory('user-2', null)).resolves.toEqual({
      model: 0,
      tool: 0,
      sandbox: 0,
      media: 0,
    })
  })

  it('ignores reserved and released rows in the breakdown', async () => {
    const { database, repository } = await createFixture()
    const released = await reserveOnce(database, repository)
    await repository.reserve(reserveInput({ taskId: 'task-2' }))
    await repository.release(released, 'safety_denied')

    await expect(repository.sumSettledCreditsByUserByCategory('user-1', null)).resolves.toEqual({
      model: 0,
      tool: 0,
      sandbox: 0,
      media: 0,
    })
  })
})

describe('DrizzleXiaobaoUsageLedgerRepository multi-user settled sum', () => {
  it('sums settled credits across the given users, honours since, and ignores others', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 1_000)
    seedCredits(database, 'user-2', 1_000)

    const first = await repository.reserve(reserveInput({ taskId: 'task-1', userId: 'user-1' }))
    if (!first.allowed) throw new Error('Expected the first reservation to be allowed')
    await repository.settle(settlementInput(first.record.id, { taskId: 'task-1', creditCostSettled: 7, now: 1_000 }))

    const second = await repository.reserve(reserveInput({ taskId: 'task-2', userId: 'user-2' }))
    if (!second.allowed) throw new Error('Expected the second reservation to be allowed')
    await repository.settle(settlementInput(second.record.id, { taskId: 'task-2', creditCostSettled: 5, now: 2_000 }))

    // 全班合计 7 + 5
    await expect(repository.sumSettledCreditsByUsers(['user-1', 'user-2'], null)).resolves.toBe(12)
    await expect(repository.sumSettledCreditsByUsers(['user-1'], null)).resolves.toBe(7)
    // 只统计 1500 之后结算的那笔
    await expect(repository.sumSettledCreditsByUsers(['user-1', 'user-2'], 1_500)).resolves.toBe(5)
    // 名单为空是**确定的 0**，不是"无法确定"
    await expect(repository.sumSettledCreditsByUsers([], null)).resolves.toBe(0)
  })

  it('ignores reserved and released rows in the multi-user sum', async () => {
    const { database, repository } = await createFixture()
    const released = await reserveOnce(database, repository)
    await repository.reserve(reserveInput({ taskId: 'task-2' }))
    await repository.release(released, 'safety_denied')

    await expect(repository.sumSettledCreditsByUsers(['user-1', 'user-2'], null)).resolves.toBe(0)
  })
})
