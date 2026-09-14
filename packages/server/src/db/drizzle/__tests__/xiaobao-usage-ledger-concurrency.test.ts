import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UsageReservationLedgerInput, UsageSettlementLedgerInput } from '../../types.js'

const originalDatabasePath = process.env.DATABASE_PATH

// 本文件用真实 worker 线程 + 独立 SQLite 连接验证并发语义：每个用例要等两个 worker 启动
// （register tsx、import client、跑完整迁移 bootstrap）。这一启动成本高度依赖机器负载，
// 单个用例在负载高时会超过默认的 15 秒。这里只放宽超时，不放宽任何并发/幂等断言。
vi.setConfig({ testTimeout: 60_000 })

type Operation = 'reserve' | 'settle' | 'release'
type WorkerOutcome = { ok: true; value: unknown } | { ok: false; error: { code?: string; message: string } }

interface Fixture {
  closeClient(): void
  database: Database.Database
  databasePath: string
  directory: string
  repository: InstanceType<(typeof import('../repositories.js'))['DrizzleXiaobaoUsageLedgerRepository']>
}

let fixture: Fixture | undefined

async function createFixture(): Promise<Fixture> {
  const directory = mkdtempSync(join(tmpdir(), 'xiaobao-ledger-concurrency-'))
  const databasePath = join(directory, 'test.db')
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()

  const { DrizzleXiaobaoUsageLedgerRepository } = await import('../repositories.js')
  const { closeDrizzleClient } = await import('../client.js')
  const database = new Database(databasePath)

  database
    .prepare(
      `INSERT INTO users (
        id, provider, external_id, access_token, username, role, status,
        created_at, updated_at, last_login_at
      ) VALUES ('user-1', 'local', 'user-1', '', 'user-1', 'user', 'active', 1, 1, 1)`,
    )
    .run()

  fixture = {
    closeClient: closeDrizzleClient,
    database,
    databasePath,
    directory,
    repository: new DrizzleXiaobaoUsageLedgerRepository(),
  }
  return fixture
}

function seedCredits(database: Database.Database): void {
  database
    .prepare(
      `INSERT INTO user_credits (
        id, user_id, balance, frozen_balance, lifetime_balance, created_at, updated_at
      ) VALUES ('credits-user-1', 'user-1', 100, 0, 100, 1, 1)`,
    )
    .run()
}

function reserveInput(overrides: Partial<UsageReservationLedgerInput> = {}): UsageReservationLedgerInput {
  return {
    taskId: 'task-1',
    userId: 'user-1',
    category: 'model',
    reservedUnits: 20,
    creditCostReserved: 30,
    now: 100,
    ...overrides,
  }
}

function settlementInput(
  reservationId: string,
  overrides: Partial<UsageSettlementLedgerInput> = {},
): UsageSettlementLedgerInput {
  return {
    reservationId,
    taskId: 'task-1',
    category: 'model',
    settledUnits: 12,
    creditCostSettled: 18,
    now: 200,
    ...overrides,
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Worker coordination timed out')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

function workerOutcome(worker: Worker): Promise<WorkerOutcome> {
  return new Promise((resolve, reject) => {
    let outcome: WorkerOutcome | undefined
    worker.once('message', (message: WorkerOutcome) => {
      outcome = message
    })
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0 || !outcome) reject(new Error('Ledger worker exited unsuccessfully'))
      else resolve(outcome)
    })
  })
}

function workerStartupFailure(worker: Worker): Promise<never> {
  return new Promise((_, reject) => {
    worker.once('error', reject)
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error('Ledger worker exited unsuccessfully'))
    })
  })
}

async function runAcrossConnections(
  databasePath: string,
  operation: Operation,
  firstInput: unknown,
  secondInput: unknown,
): Promise<{ outcomes: [WorkerOutcome, WorkerOutcome]; readersBeforeRelease: number }> {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3)
  const barrier = new Int32Array(shared)
  const workerUrl = new URL('./xiaobao-usage-ledger.worker.mjs', import.meta.url)
  const createWorker = (input: unknown) =>
    new Worker(workerUrl, {
      workerData: { barrier: shared, databasePath, input, operation },
    })

  const firstWorker = createWorker(firstInput)
  const secondWorker = createWorker(secondInput)
  const firstOutcome = workerOutcome(firstWorker)
  const secondOutcome = workerOutcome(secondWorker)

  await Promise.race([
    // worker 启动需要 register tsx、import client 并跑完整迁移 bootstrap，负载高时会明显超过 5 秒。
    // 这里只放宽"启动协调"的等待上限，不放宽任何并发/幂等语义断言（读交错窗口仍是 500ms）。
    waitForCondition(() => Atomics.load(barrier, 2) === 2, 30_000),
    workerStartupFailure(firstWorker),
    workerStartupFailure(secondWorker),
  ])
  const readDeadline = Date.now() + 500
  while (Atomics.load(barrier, 0) < 2 && Date.now() < readDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const readersBeforeRelease = Atomics.load(barrier, 0)
  Atomics.store(barrier, 1, 1)
  Atomics.notify(barrier, 1, 2)

  return {
    outcomes: [await firstOutcome, await secondOutcome],
    readersBeforeRelease,
  }
}

function expectSuccessfulIdenticalOutcomes(result: {
  outcomes: [WorkerOutcome, WorkerOutcome]
  readersBeforeRelease: number
}): void {
  expect(result.outcomes.flatMap((outcome) => (outcome.ok ? [] : [outcome.error.code]))).toEqual([])
  expect(result.outcomes[0]).toMatchObject({ ok: true })
  expect(result.outcomes[1]).toMatchObject({ ok: true })
  expect(result.readersBeforeRelease).toBe(1)
  if (!result.outcomes[0].ok || !result.outcomes[1].ok) throw new Error('Expected successful workers')
  expect(result.outcomes[0].value).toEqual(result.outcomes[1].value)
}

afterEach(() => {
  fixture?.database.close()
  fixture?.closeClient()
  if (fixture && existsSync(fixture.directory)) rmSync(fixture.directory, { recursive: true, force: true })
  fixture = undefined
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('Drizzle XiaoBao ledger across independent SQLite connections', () => {
  it('serializes concurrent identical reserves without duplicate freeze or transaction', async () => {
    const { database, databasePath } = await createFixture()
    seedCredits(database)

    const result = await runAcrossConnections(databasePath, 'reserve', reserveInput(), reserveInput({ now: 101 }))

    expectSuccessfulIdenticalOutcomes(result)
    expect(
      database
        .prepare('SELECT balance, frozen_balance AS frozenBalance FROM user_credits WHERE user_id = ?')
        .get('user-1'),
    ).toEqual({ balance: 70, frozenBalance: 30 })
    expect(database.prepare('SELECT count(*) AS count FROM xiaobao_usage_reservations').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT count(*) AS count FROM credit_transactions').get()).toEqual({ count: 1 })
  }, 15_000)

  it('serializes missing-credit creation without duplicate account, freeze, or transaction', async () => {
    const { database, databasePath } = await createFixture()

    const result = await runAcrossConnections(
      databasePath,
      'reserve',
      reserveInput({ creditCostReserved: 0 }),
      reserveInput({ creditCostReserved: 0, now: 101 }),
    )

    expectSuccessfulIdenticalOutcomes(result)
    expect(database.prepare('SELECT count(*) AS count FROM user_credits WHERE user_id = ?').get('user-1')).toEqual({
      count: 1,
    })
    expect(database.prepare('SELECT count(*) AS count FROM xiaobao_usage_reservations').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT count(*) AS count FROM credit_transactions').get()).toEqual({ count: 1 })
  }, 15_000)

  it('serializes concurrent identical settlements through the persisted idempotent terminal state', async () => {
    const { database, databasePath, repository } = await createFixture()
    seedCredits(database)
    const reservation = await repository.reserve(reserveInput())
    if (!reservation.allowed) throw new Error('Expected reservation to be allowed')

    const result = await runAcrossConnections(
      databasePath,
      'settle',
      settlementInput(reservation.record.id),
      settlementInput(reservation.record.id, { now: 201 }),
    )

    expectSuccessfulIdenticalOutcomes(result)
    expect(
      database
        .prepare('SELECT balance, frozen_balance AS frozenBalance FROM user_credits WHERE user_id = ?')
        .get('user-1'),
    ).toEqual({ balance: 82, frozenBalance: 0 })
    expect(database.prepare('SELECT count(*) AS count FROM credit_transactions').get()).toEqual({ count: 3 })
  }, 15_000)

  it('serializes concurrent identical releases through the persisted idempotent terminal state', async () => {
    const { database, databasePath, repository } = await createFixture()
    seedCredits(database)
    const reservation = await repository.reserve(reserveInput())
    if (!reservation.allowed) throw new Error('Expected reservation to be allowed')
    const release = { reservationId: reservation.record.id, reason: 'runtime_failed' }

    const result = await runAcrossConnections(databasePath, 'release', release, release)

    expectSuccessfulIdenticalOutcomes(result)
    expect(
      database
        .prepare('SELECT balance, frozen_balance AS frozenBalance FROM user_credits WHERE user_id = ?')
        .get('user-1'),
    ).toEqual({ balance: 100, frozenBalance: 0 })
    expect(database.prepare('SELECT count(*) AS count FROM credit_transactions').get()).toEqual({ count: 2 })
  }, 15_000)
})
