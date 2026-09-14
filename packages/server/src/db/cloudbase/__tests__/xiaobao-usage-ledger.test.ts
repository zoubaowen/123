import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeCommand, matchesCriteria } from './helpers/fake-cloudbase-database'

type Document = Record<string, unknown>
type Collections = Map<string, Document[]>

const cloudbase = vi.hoisted(() => ({ database: undefined as FakeCloudBaseDatabase | undefined }))

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

function cloneCollections(source: Collections): Collections {
  return new Map([...source].map(([name, documents]) => [name, structuredClone(documents)]))
}

function codedError(code: string): Error & { code: string } {
  return Object.assign(new Error('upstream detail must not escape'), { code })
}

function matches(document: Document, criteria: Document): boolean {
  // 复用共享假数据库的比较语义：命令对象（如 `_.in` / `_.gte`）也要能正确匹配
  return matchesCriteria(document, criteria)
}

class FakeQuery {
  private criteria: Document = {}
  private maximum: number | undefined
  private offset: number | undefined

  constructor(
    private readonly transaction: FakeTransaction,
    private readonly name: string,
  ) {}

  where(criteria: Document): FakeQuery {
    this.criteria = criteria
    return this
  }

  limit(maximum: number): FakeQuery {
    this.maximum = maximum
    return this
  }

  skip(offset: number): FakeQuery {
    this.offset = offset
    return this
  }

  async get(): Promise<{ data: Document[] }> {
    const rows = this.transaction.documents(this.name).filter((document) => matches(document, this.criteria))
    const from = this.offset ?? 0
    const window = this.maximum === undefined ? rows.slice(from) : rows.slice(from, from + this.maximum)
    return { data: structuredClone(window) }
  }

  async count(): Promise<{ total: number }> {
    return {
      total: this.transaction.documents(this.name).filter((document) => matches(document, this.criteria)).length,
    }
  }

  async update(data: Document): Promise<{ updated: number }> {
    this.transaction.beforeWrite()
    let updated = 0
    for (const document of this.transaction.documents(this.name)) {
      if (!matches(document, this.criteria)) continue
      Object.assign(document, structuredClone(data))
      updated += 1
    }
    return { updated }
  }
}

class FakeCollection extends FakeQuery {
  constructor(
    transaction: FakeTransaction,
    private readonly collectionName: string,
  ) {
    super(transaction, collectionName)
    this.transaction = transaction
  }

  private readonly transaction: FakeTransaction

  async add(data: Document): Promise<{ id: string }> {
    this.transaction.beforeWrite()
    const documents = this.transaction.documents(this.collectionName)
    const candidate = structuredClone(data)
    const id = String(candidate._id ?? candidate.id ?? `fake-${documents.length + 1}`)

    if (documents.some((document) => document._id === id)) throw codedError('DATABASE_DUPLICATE_WRITE')

    documents.push({ _id: id, ...candidate })
    return { id }
  }
}

class FakeTransaction {
  private closed = false

  constructor(
    private readonly database: FakeCloudBaseDatabase,
    private readonly base: Collections,
    private readonly local: Collections,
  ) {}

  collection(name: string): FakeCollection {
    if (this.closed) throw new Error('Transaction is closed')
    return new FakeCollection(this, name)
  }

  documents(name: string): Document[] {
    let documents = this.local.get(name)
    if (!documents) {
      documents = []
      this.local.set(name, documents)
    }
    return documents
  }

  beforeWrite(): void {
    this.database.beforeWrite()
  }

  async commit(): Promise<{ requestId: string }> {
    await this.database.beforeCommit()
    this.database.commit(this.base, this.local)
    this.closed = true
    this.database.closeTransaction()
    return { requestId: 'commit' }
  }

  async rollback(): Promise<{ requestId: string }> {
    this.database.recordRollback()
    const failure = this.database.takeRollbackFailure()
    if (!this.closed) {
      this.closed = true
      this.database.closeTransaction()
    }
    if (failure) throw failure
    return { requestId: 'rollback' }
  }
}

class FakeCloudBaseDatabase {
  private collections: Collections = new Map()
  private activeTransactions = 0
  private commitFailures: Error[] = []
  private rollbackFailure: Error | undefined
  private writeFailureAt: number | undefined
  private writeCount = 0
  private commitBarrierTarget: number | undefined
  private commitBarrierWaiters: Array<() => void> = []

  rootCollectionCalls = 0
  rollbackAttempts = 0
  transactionStarts = 0

  command = new FakeCommand()

  async startTransaction(): Promise<FakeTransaction> {
    this.transactionStarts += 1
    this.activeTransactions += 1
    const base = cloneCollections(this.collections)
    return new FakeTransaction(this, base, cloneCollections(base))
  }

  collection(_name: string): never {
    this.rootCollectionCalls += 1
    if (this.activeTransactions > 0) throw new Error('Root collection used during transaction')
    throw new Error('Ledger tests require transaction-scoped collection handles')
  }

  createCollection(): never {
    throw new Error('Ledger must not create collections')
  }

  seed(name: string, document: Document): void {
    const fullName = `vibe_agent_${name}`
    const documents = this.collections.get(fullName) ?? []
    documents.push({
      _id: String(document._id ?? document.id ?? `seed-${documents.length + 1}`),
      ...structuredClone(document),
    })
    this.collections.set(fullName, documents)
  }

  rows(name: string): Document[] {
    return structuredClone(this.collections.get(`vibe_agent_${name}`) ?? [])
      .map(({ _id, ...document }) => document)
      .sort((left, right) => String(left.id ?? '').localeCompare(String(right.id ?? '')))
  }

  failWrite(writeNumber: number): void {
    this.writeFailureAt = writeNumber
    this.writeCount = 0
  }

  failCommits(...failures: Error[]): void {
    this.commitFailures.push(...failures)
  }

  failRollback(failure: Error): void {
    this.rollbackFailure = failure
  }

  synchronizeNextCommits(count: number): void {
    this.commitBarrierTarget = count
    this.commitBarrierWaiters = []
  }

  beforeWrite(): void {
    this.writeCount += 1
    if (this.writeCount === this.writeFailureAt) throw new Error('Injected ledger write failure')
  }

  async beforeCommit(): Promise<void> {
    if (this.commitBarrierTarget !== undefined) {
      await new Promise<void>((resolve) => {
        this.commitBarrierWaiters.push(resolve)
        if (this.commitBarrierWaiters.length === this.commitBarrierTarget) {
          const waiters = this.commitBarrierWaiters
          this.commitBarrierTarget = undefined
          this.commitBarrierWaiters = []
          for (const release of waiters) release()
        }
      })
    }
    const failure = this.commitFailures.shift()
    if (failure) throw failure
  }

  commit(base: Collections, local: Collections): void {
    const merged = cloneCollections(this.collections)
    for (const [name, localDocuments] of local) {
      const baseDocuments = base.get(name) ?? []
      const currentDocuments = this.collections.get(name) ?? []
      const mergedDocuments = merged.get(name) ?? []
      for (const localDocument of localDocuments) {
        const documentId = localDocument._id
        const baseDocument = baseDocuments.find((document) => document._id === documentId)
        if (JSON.stringify(localDocument) === JSON.stringify(baseDocument)) continue
        const currentDocument = currentDocuments.find((document) => document._id === documentId)
        if (JSON.stringify(currentDocument) !== JSON.stringify(baseDocument)) {
          throw codedError('DATABASE_TRANSACTION_CONFLICT')
        }
        const mergedIndex = mergedDocuments.findIndex((document) => document._id === documentId)
        if (mergedIndex === -1) mergedDocuments.push(structuredClone(localDocument))
        else mergedDocuments[mergedIndex] = structuredClone(localDocument)
      }
      merged.set(name, mergedDocuments)
    }
    this.collections = merged
  }

  closeTransaction(): void {
    this.activeTransactions -= 1
  }

  recordRollback(): void {
    this.rollbackAttempts += 1
  }

  takeRollbackFailure(): Error | undefined {
    const failure = this.rollbackFailure
    this.rollbackFailure = undefined
    return failure
  }
}

const originalEnvironment = {
  DB_COLLECTION_PREFIX: process.env.DB_COLLECTION_PREFIX,
  TCB_ENV_ID: process.env.TCB_ENV_ID,
  TCB_SECRET_ID: process.env.TCB_SECRET_ID,
  TCB_SECRET_KEY: process.env.TCB_SECRET_KEY,
}

type LedgerRepository = InstanceType<(typeof import('../repositories.js'))['CloudBaseXiaobaoUsageLedgerRepository']>

interface Fixture {
  database: FakeCloudBaseDatabase
  repository: LedgerRepository
}

async function createFixture(): Promise<Fixture> {
  const database = createDatabaseFixture()
  const { CloudBaseXiaobaoUsageLedgerRepository } = await import('../repositories.js')
  return { database, repository: new CloudBaseXiaobaoUsageLedgerRepository() }
}

function createDatabaseFixture(): FakeCloudBaseDatabase {
  vi.resetModules()
  const database = new FakeCloudBaseDatabase()
  cloudbase.database = database
  return database
}

function seedCredits(database: FakeCloudBaseDatabase, userId = 'user-1', balance = 100, frozenBalance = 0): void {
  database.seed('user_credits', {
    id: `credits-${userId}`,
    userId,
    balance,
    frozenBalance,
    lifetimeBalance: balance,
    createdAt: 1,
    updatedAt: 1,
  })
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

async function reserveOnce(database: FakeCloudBaseDatabase, repository: LedgerRepository): Promise<string> {
  seedCredits(database)
  const result = await repository.reserve(reserveInput())
  if (!result.allowed) throw new Error('Expected reservation to be allowed')
  return result.record.id
}

function creditState(database: FakeCloudBaseDatabase, userId = 'user-1'): Document | undefined {
  return database.rows('user_credits').find((row) => row.userId === userId)
}

function accountingState(database: FakeCloudBaseDatabase) {
  return {
    credits: database.rows('user_credits'),
    reservations: database.rows('xiaobao_usage_reservations'),
    transactions: database.rows('credit_transactions'),
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

describe('runCloudBaseTransaction', () => {
  it('commits transaction-scoped writes only after a successful callback', async () => {
    const database = createDatabaseFixture()
    const { runCloudBaseTransaction } = await import('../client.js')

    await expect(
      runCloudBaseTransaction(async (transaction) => {
        await transaction.collection('vibe_agent_user_credits').add({ id: 'credits-1', userId: 'user-1' })
        return 'committed'
      }),
    ).resolves.toBe('committed')

    expect(database.rows('user_credits')).toEqual([{ id: 'credits-1', userId: 'user-1' }])
    expect(database.rollbackAttempts).toBe(0)
    expect(database.rootCollectionCalls).toBe(0)
  })

  it('rolls back callback failures and preserves the original error', async () => {
    const database = createDatabaseFixture()
    const { runCloudBaseTransaction } = await import('../client.js')
    const callbackFailure = new Error('static callback failure')

    await expect(
      runCloudBaseTransaction(async (transaction) => {
        await transaction.collection('vibe_agent_user_credits').add({ id: 'credits-1', userId: 'user-1' })
        throw callbackFailure
      }),
    ).rejects.toBe(callbackFailure)

    expect(database.rows('user_credits')).toEqual([])
    expect(database.rollbackAttempts).toBe(1)
  })

  it('attempts rollback after commit failure even when rollback also fails', async () => {
    const database = createDatabaseFixture()
    const { runCloudBaseTransaction } = await import('../client.js')
    const commitFailure = codedError('AUTH_EXPIRED')
    database.failCommits(commitFailure)
    database.failRollback(new Error('rollback failed'))

    await expect(
      runCloudBaseTransaction(async (transaction) => {
        await transaction.collection('vibe_agent_user_credits').add({ id: 'credits-1', userId: 'user-1' })
      }),
    ).rejects.toBe(commitFailure)

    expect(database.rows('user_credits')).toEqual([])
    expect(database.rollbackAttempts).toBe(1)
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository reserve', () => {
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
    if (!result.allowed) throw new Error('Expected reservation to be allowed')
    expect(creditState(database)).toMatchObject({ balance: 70, frozenBalance: 30 })
    expect(database.rows('credit_transactions')).toEqual([
      {
        amount: -30,
        balanceAfter: 70,
        createdAt: 100,
        description: 'XiaoBao usage reservation',
        id: `xiaobao:${result.record.id}:reserve`,
        metadata: null,
        type: 'freeze',
        userId: 'user-1',
      },
    ])
    expect(database.rootCollectionCalls).toBe(0)
  })

  it('creates a missing zero-balance account in the same transaction', async () => {
    const { database, repository } = await createFixture()

    await expect(repository.reserve(reserveInput({ creditCostReserved: 0 }))).resolves.toMatchObject({ allowed: true })

    expect(creditState(database)).toMatchObject({ balance: 0, frozenBalance: 0, lifetimeBalance: 0 })
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
    expect(database.rows('credit_transactions')).toEqual([
      expect.objectContaining({ type: 'freeze', amount: 0, balanceAfter: 0 }),
    ])
  })

  it('returns an identical retry without freezing credits twice', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)

    const first = await repository.reserve(reserveInput())
    const second = await repository.reserve(reserveInput({ now: 999 }))

    expect(second).toEqual(first)
    expect(creditState(database)).toMatchObject({ balance: 70, frozenBalance: 30 })
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
    expect(database.rows('credit_transactions')).toHaveLength(1)
  })

  it.each([
    ['user', { userId: 'user-2' }],
    ['units', { reservedUnits: 21 }],
    ['cost', { creditCostReserved: 31 }],
  ])('rejects a conflicting %s retry without changing committed state', async (_field, conflict) => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    await repository.reserve(reserveInput())
    const before = accountingState(database)

    await expect(repository.reserve(reserveInput(conflict))).rejects.toThrow('Usage reservation conflict')
    expect(accountingState(database)).toEqual(before)
  })

  it('denies insufficient balance without a reservation, freeze, or transaction', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 29)

    await expect(repository.reserve(reserveInput())).resolves.toEqual({
      allowed: false,
      reason: 'insufficient_credits',
    })
    expect(creditState(database)).toMatchObject({ balance: 29, frozenBalance: 0 })
    expect(database.rows('xiaobao_usage_reservations')).toEqual([])
    expect(database.rows('credit_transactions')).toEqual([])
  })

  it('resolves concurrent identical reserves through the persisted unique record', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    database.synchronizeNextCommits(2)

    const [first, second] = await Promise.all([repository.reserve(reserveInput()), repository.reserve(reserveInput())])

    expect(first).toEqual(second)
    expect(creditState(database)).toMatchObject({ balance: 70, frozenBalance: 30 })
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
    expect(database.rows('credit_transactions')).toHaveLength(1)
    expect(database.transactionStarts).toBe(3)
  })

  it('rejects a concurrent conflicting reserve after reading the winning unique record', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    database.synchronizeNextCommits(2)

    const results = await Promise.allSettled([
      repository.reserve(reserveInput()),
      repository.reserve(reserveInput({ reservedUnits: 21 })),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { message: 'Usage reservation conflict' } },
    ])
    expect(creditState(database)).toMatchObject({ balance: 70, frozenBalance: 30 })
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
    expect(database.rows('credit_transactions')).toHaveLength(1)
  })

  it('enforces task and category uniqueness across different credit accounts', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    seedCredits(database, 'user-2')
    database.synchronizeNextCommits(2)

    const results = await Promise.allSettled([
      repository.reserve(reserveInput()),
      repository.reserve(reserveInput({ userId: 'user-2' })),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toMatchObject([
      { reason: { message: 'Usage reservation conflict' } },
    ])
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
    expect(database.rows('credit_transactions')).toHaveLength(1)
    expect(database.rows('user_credits').map(({ balance, frozenBalance }) => ({ balance, frozenBalance }))).toEqual(
      expect.arrayContaining([
        { balance: 70, frozenBalance: 30 },
        { balance: 100, frozenBalance: 0 },
      ]),
    )
  })

  it('serializes concurrent missing-credit creation for independent reservations', async () => {
    const { database, repository } = await createFixture()
    database.synchronizeNextCommits(2)

    const results = await Promise.all([
      repository.reserve(reserveInput({ creditCostReserved: 0 })),
      repository.reserve(reserveInput({ taskId: 'task-2', category: 'tool', creditCostReserved: 0 })),
    ])

    expect(results).toEqual([expect.objectContaining({ allowed: true }), expect.objectContaining({ allowed: true })])
    expect(database.rows('user_credits')).toHaveLength(1)
    expect(database.rows('xiaobao_usage_reservations')).toHaveLength(2)
    expect(database.rows('credit_transactions')).toHaveLength(2)
    expect(database.transactionStarts).toBe(3)
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository settlement and release', () => {
  it('settles the exact reserved cost from frozen credits', async () => {
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
    expect(creditState(database)).toMatchObject({ balance: 70, frozenBalance: 0 })
    expect(
      database
        .rows('credit_transactions')
        .map(({ id, type, amount, balanceAfter }) => ({ id, type, amount, balanceAfter })),
    ).toEqual([
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:reserve`, type: 'freeze' },
      { amount: -30, balanceAfter: 70, id: `xiaobao:${reservationId}:settle`, type: 'consumption' },
    ])
  })

  it('returns unused frozen cost and supports zero settlement', async () => {
    const partial = await createFixture()
    const partialId = await reserveOnce(partial.database, partial.repository)
    await partial.repository.settle(settlementInput(partialId))
    expect(creditState(partial.database)).toMatchObject({ balance: 82, frozenBalance: 0 })
    expect(partial.database.rows('credit_transactions')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `xiaobao:${partialId}:settle`, amount: -18 }),
        expect.objectContaining({ id: `xiaobao:${partialId}:release`, amount: 12 }),
      ]),
    )

    const zero = await createFixture()
    const zeroId = await reserveOnce(zero.database, zero.repository)
    await zero.repository.settle(settlementInput(zeroId, { settledUnits: 0, creditCostSettled: 0 }))
    expect(creditState(zero.database)).toMatchObject({ balance: 100, frozenBalance: 0 })
    expect(zero.database.rows('credit_transactions')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `xiaobao:${zeroId}:settle`, amount: 0 }),
        expect.objectContaining({ id: `xiaobao:${zeroId}:release`, amount: 30 }),
      ]),
    )
  })

  it('treats an identical settlement retry as a no-op', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    const first = await repository.settle(settlementInput(reservationId))
    const second = await repository.settle(settlementInput(reservationId, { now: 999 }))

    expect(second).toEqual(first)
    expect(database.rows('credit_transactions')).toHaveLength(3)
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
    const before = accountingState(database)

    await expect(repository.settle(settlementInput(reservationId, conflict))).rejects.toThrow(
      'Usage settlement conflict',
    )
    expect(accountingState(database)).toEqual(before)
  })

  it('rejects settlement above the reservation without changing state', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    const before = accountingState(database)

    await expect(repository.settle(settlementInput(reservationId, { creditCostSettled: 31 }))).rejects.toThrow(
      'Usage settlement exceeds reservation',
    )
    expect(accountingState(database)).toEqual(before)
  })

  it.each(['safety_denied', 'runtime_failed'] as const)(
    'explicitly releases the full reservation for %s',
    async (reason) => {
      const { database, repository } = await createFixture()
      const reservationId = await reserveOnce(database, repository)

      const record = await repository.release(reservationId, reason)

      expect(record).toMatchObject({ id: reservationId, status: 'released', settledUnits: 0, creditCostSettled: 0 })
      expect(creditState(database)).toMatchObject({ balance: 100, frozenBalance: 0 })
      expect(database.rows('credit_transactions')).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `xiaobao:${reservationId}:release`,
            amount: 30,
            metadata: JSON.stringify({ reason }),
          }),
        ]),
      )
    },
  )

  it('accepts an identical release retry and rejects conflicts or incompatible terminal state', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    const first = await repository.release(reservationId, 'safety_denied')

    await expect(repository.release(reservationId, 'safety_denied')).resolves.toEqual(first)
    await expect(repository.release(reservationId, 'runtime_failed')).rejects.toThrow('Usage release conflict')
    await expect(repository.settle(settlementInput(reservationId))).rejects.toThrow('Usage settlement conflict')

    const settled = await repository.reserve(reserveInput({ taskId: 'task-2', category: 'tool', now: 300 }))
    if (!settled.allowed) throw new Error('Expected reservation to be allowed')
    await repository.settle(settlementInput(settled.record.id, { taskId: 'task-2', category: 'tool', now: 400 }))
    await expect(repository.release(settled.record.id, 'runtime_failed')).rejects.toThrow('Usage release conflict')
    expect(database.rows('credit_transactions')).toHaveLength(5)
  })

  it('rejects an unsupported release reason without changing accounting', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    const before = accountingState(database)

    await expect(repository.release(reservationId, 'other' as never)).rejects.toThrow('Usage release conflict')
    expect(accountingState(database)).toEqual(before)
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository rollback', () => {
  it.each([1, 2, 3, 4])('rolls back a missing-credit reservation after write point %s', async (writePoint) => {
    const { database, repository } = await createFixture()
    database.failWrite(writePoint)

    await expect(repository.reserve(reserveInput({ creditCostReserved: 0 }))).rejects.toThrow(
      'XiaoBao usage ledger unavailable',
    )
    expect(accountingState(database)).toEqual({ credits: [], reservations: [], transactions: [] })
  })

  it.each([1, 2, 3, 4])('rolls back a partial settlement after write point %s', async (writePoint) => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    const before = accountingState(database)
    database.failWrite(writePoint)

    await expect(repository.settle(settlementInput(reservationId))).rejects.toThrow('XiaoBao usage ledger unavailable')
    expect(accountingState(database)).toEqual(before)
  })

  it.each([1, 2, 3])('rolls back an explicit release after write point %s', async (writePoint) => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)
    const before = accountingState(database)
    database.failWrite(writePoint)

    await expect(repository.release(reservationId, 'runtime_failed')).rejects.toThrow(
      'XiaoBao usage ledger unavailable',
    )
    expect(accountingState(database)).toEqual(before)
  })
})

describe('CloudBase transaction conflict retry policy', () => {
  it.each(['DATABASE_TRANSACTION_CONFLICT', 'DATABASE_DUPLICATE_WRITE'])(
    'retries %s conflicts with exactly three total attempts',
    async (code) => {
      const { database, repository } = await createFixture()
      seedCredits(database)
      database.failCommits(codedError(code), codedError(code))

      await expect(repository.reserve(reserveInput())).resolves.toMatchObject({ allowed: true })
      expect(database.transactionStarts).toBe(3)
      expect(database.rollbackAttempts).toBe(2)
      expect(database.rows('xiaobao_usage_reservations')).toHaveLength(1)
      expect(database.rows('credit_transactions')).toHaveLength(1)
    },
  )

  it('returns a static unavailable error after the third transaction conflict', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    database.failCommits(
      codedError('DATABASE_TRANSACTION_CONFLICT'),
      codedError('DATABASE_TRANSACTION_CONFLICT'),
      codedError('DATABASE_TRANSACTION_CONFLICT'),
      codedError('DATABASE_TRANSACTION_CONFLICT'),
    )

    await expect(repository.reserve(reserveInput())).rejects.toThrow('XiaoBao usage ledger unavailable')
    expect(database.transactionStarts).toBe(3)
    expect(database.rollbackAttempts).toBe(3)
    expect(database.rows('xiaobao_usage_reservations')).toEqual([])
  })

  it.each([
    ['authentication', codedError('AUTH_EXPIRED')],
    ['permission', codedError('DATABASE_PERMISSION_DENIED')],
    ['validation', codedError('INVALID_PARAM')],
    ['unknown', new Error('unknown upstream failure')],
  ])('does not retry %s failures or expose upstream details', async (_kind, failure) => {
    const { database, repository } = await createFixture()
    seedCredits(database)
    database.failCommits(failure)

    await expect(repository.reserve(reserveInput())).rejects.toThrow('XiaoBao usage ledger unavailable')
    expect(database.transactionStarts).toBe(1)
    expect(database.rows('xiaobao_usage_reservations')).toEqual([])
  })

  it('does not retry static business conflicts or insufficient credits', async () => {
    const conflict = await createFixture()
    seedCredits(conflict.database)
    await conflict.repository.reserve(reserveInput())
    const startsBeforeConflict = conflict.database.transactionStarts
    await expect(conflict.repository.reserve(reserveInput({ reservedUnits: 99 }))).rejects.toThrow(
      'Usage reservation conflict',
    )
    expect(conflict.database.transactionStarts - startsBeforeConflict).toBe(1)

    const insufficient = await createFixture()
    seedCredits(insufficient.database, 'user-1', 1)
    await expect(insufficient.repository.reserve(reserveInput())).resolves.toEqual({
      allowed: false,
      reason: 'insufficient_credits',
    })
    expect(insufficient.database.transactionStarts).toBe(1)
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository queries, health, and provider wiring', () => {
  it('finds a provider-neutral reservation by task and category', async () => {
    const { database, repository } = await createFixture()
    const reservationId = await reserveOnce(database, repository)

    await expect(repository.findByTaskAndCategory('task-1', 'model')).resolves.toMatchObject({
      id: reservationId,
      taskId: 'task-1',
      category: 'model',
      status: 'reserved',
    })
    await expect(repository.findByTaskAndCategory('missing', 'model')).resolves.toBeNull()
    expect(database.rootCollectionCalls).toBe(0)
  })

  it('verifies a transactional probe and leaves no balance, reservation, or transaction residue', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 77, 9)
    const before = accountingState(database)

    await expect(repository.healthCheck()).resolves.toBe(true)

    expect(accountingState(database)).toEqual(before)
    expect(database.rollbackAttempts).toBe(1)
    expect(database.rootCollectionCalls).toBe(0)
  })

  it('exposes the real ledger repository from the CloudBase provider factory', async () => {
    const { repository } = await createFixture()
    const { createCloudBaseProvider, CloudBaseXiaobaoUsageLedgerRepository } = await import('../repositories.js')

    const provider = createCloudBaseProvider()

    expect(provider.xiaobaoUsageLedger).toBeInstanceOf(CloudBaseXiaobaoUsageLedgerRepository)
    expect(repository).toBeInstanceOf(CloudBaseXiaobaoUsageLedgerRepository)
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository settled credit sum', () => {
  it('sums settled credits per user and ignores reserved or released rows', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database)

    const settled = await repository.reserve(reserveInput())
    await repository.settle(settlementInput(settled.record.id, { settledUnits: 7, creditCostSettled: 7 }))

    const released = await repository.reserve(reserveInput({ taskId: 'task-2' }))
    await repository.release(released.record.id, 'safety_denied')

    await expect(repository.sumSettledCreditsByUser('user-1', null)).resolves.toBe(7)
    await expect(repository.sumSettledCreditsByUser('user-2', null)).resolves.toBe(0)
  })

  it('returns null instead of a partial sum when paging cannot finish', async () => {
    const database = createDatabaseFixture()
    const { CloudBaseXiaobaoUsageLedgerRepository } = await import('../repositories.js')
    // 每页 2 条、最多读 1 页：3 条已结算记录必定读不完。
    const repository = new CloudBaseXiaobaoUsageLedgerRepository(2, 1)
    seedCredits(database, 'user-1', 1_000)

    for (const taskId of ['task-1', 'task-2', 'task-3']) {
      const reserved = await repository.reserve(reserveInput({ taskId }))
      await repository.settle(settlementInput(reserved.record.id, { taskId, creditCostSettled: 1 }))
    }

    // 偏小的用量会让预算放行本该拦下的任务，所以宁可返回 null 让调用方 fail-closed。
    await expect(repository.sumSettledCreditsByUser('user-1', null)).resolves.toBeNull()
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository settled credit breakdown', () => {
  it('groups settled credits by usage category and ignores reserved or released rows', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 1_000)

    const model = await repository.reserve(reserveInput({ taskId: 'task-model', category: 'model' }))
    await repository.settle(
      settlementInput(model.record.id, { taskId: 'task-model', category: 'model', creditCostSettled: 7 }),
    )

    const media = await repository.reserve(reserveInput({ taskId: 'task-media', category: 'media' }))
    await repository.settle(
      settlementInput(media.record.id, { taskId: 'task-media', category: 'media', creditCostSettled: 5 }),
    )

    const released = await repository.reserve(reserveInput({ taskId: 'task-released', category: 'tool' }))
    await repository.release(released.record.id, 'safety_denied')

    await expect(repository.sumSettledCreditsByUserByCategory('user-1', null)).resolves.toEqual({
      model: 7,
      tool: 0,
      sandbox: 0,
      media: 5,
    })
    await expect(repository.sumSettledCreditsByUserByCategory('user-2', null)).resolves.toEqual({
      model: 0,
      tool: 0,
      sandbox: 0,
      media: 0,
    })
  })

  it('returns null instead of a partial breakdown when paging cannot finish', async () => {
    const database = createDatabaseFixture()
    const { CloudBaseXiaobaoUsageLedgerRepository } = await import('../repositories.js')
    // 每页 2 条、最多读 1 页：3 条已结算记录必定读不完。
    const repository = new CloudBaseXiaobaoUsageLedgerRepository(2, 1)
    seedCredits(database, 'user-1', 1_000)

    for (const taskId of ['task-1', 'task-2', 'task-3']) {
      const reserved = await repository.reserve(reserveInput({ taskId }))
      await repository.settle(settlementInput(reserved.record.id, { taskId, creditCostSettled: 1 }))
    }

    // 分类明细同样不能给出偏小的数字，否则管理端会低估学生用量。
    await expect(repository.sumSettledCreditsByUserByCategory('user-1', null)).resolves.toBeNull()
  })
})

describe('CloudBaseXiaobaoUsageLedgerRepository multi-user settled sum', () => {
  it('sums settled credits across the given users and ignores reserved or released rows', async () => {
    const { database, repository } = await createFixture()
    seedCredits(database, 'user-1', 1_000)
    seedCredits(database, 'user-2', 1_000)

    const first = await repository.reserve(reserveInput({ taskId: 'task-1', userId: 'user-1' }))
    await repository.settle(settlementInput(first.record.id, { taskId: 'task-1', creditCostSettled: 7 }))

    const second = await repository.reserve(reserveInput({ taskId: 'task-2', userId: 'user-2' }))
    await repository.settle(settlementInput(second.record.id, { taskId: 'task-2', creditCostSettled: 5 }))

    const released = await repository.reserve(reserveInput({ taskId: 'task-3', userId: 'user-1' }))
    await repository.release(released.record.id, 'safety_denied')

    await expect(repository.sumSettledCreditsByUsers(['user-1', 'user-2'], null)).resolves.toBe(12)
    await expect(repository.sumSettledCreditsByUsers(['user-1'], null)).resolves.toBe(7)
    await expect(repository.sumSettledCreditsByUsers([], null)).resolves.toBe(0)
  })

  it('returns null instead of a partial multi-user sum when paging cannot finish', async () => {
    const database = createDatabaseFixture()
    const { CloudBaseXiaobaoUsageLedgerRepository } = await import('../repositories.js')
    // 每页 2 条、最多读 1 页：3 条已结算记录必定读不完。
    const repository = new CloudBaseXiaobaoUsageLedgerRepository(2, 1)
    seedCredits(database, 'user-1', 1_000)
    seedCredits(database, 'user-2', 1_000)

    for (const [taskId, userId] of [
      ['task-1', 'user-1'],
      ['task-2', 'user-1'],
      ['task-3', 'user-2'],
    ] as const) {
      const reserved = await repository.reserve(reserveInput({ taskId, userId }))
      await repository.settle(settlementInput(reserved.record.id, { taskId, creditCostSettled: 1 }))
    }

    // 偏小的全班合计会让班级共享额度放行本该拦下的任务，所以宁可返回 null。
    await expect(repository.sumSettledCreditsByUsers(['user-1', 'user-2'], null)).resolves.toBeNull()
  })
})
