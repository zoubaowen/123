import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  fileURLToPath(new URL('../migrations/0004_xiaobao_usage_ledger.sql', import.meta.url)),
  'utf8',
)

type ReservationOverrides = Partial<{
  id: string
  category: unknown
  reservedUnits: unknown
  settledUnits: unknown
  status: unknown
  creditCostReserved: unknown
  creditCostSettled: unknown
}>

describe('xiaobao usage reservation migration', () => {
  let database: Database.Database

  beforeEach(() => {
    database = new Database(':memory:')
    database.exec(migrationSql)
  })

  afterEach(() => {
    database.close()
  })

  function insertReservation(overrides: ReservationOverrides = {}): void {
    database
      .prepare(
        `INSERT INTO xiaobao_usage_reservations (
          id, task_id, user_id, category, reserved_units, settled_units, status,
          credit_cost_reserved, credit_cost_settled, created_at, updated_at, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        overrides.id ?? 'reservation-1',
        'task-1',
        'user-1',
        overrides.category ?? 'model',
        overrides.reservedUnits ?? 10,
        overrides.settledUnits ?? null,
        overrides.status ?? 'reserved',
        overrides.creditCostReserved ?? 10,
        overrides.creditCostSettled ?? null,
        100,
        100,
        null,
      )
  }

  it('accepts a valid reservation record', () => {
    expect(() => insertReservation()).not.toThrow()
    expect(() =>
      insertReservation({
        id: 'reservation-2',
        category: 'tool',
        settledUnits: 0,
        creditCostReserved: 0,
        creditCostSettled: 0,
      }),
    ).not.toThrow()
  })

  it('rejects unknown category and status values', () => {
    expect(() => insertReservation({ category: 'other' })).toThrow()
    expect(() => insertReservation({ status: 'other' })).toThrow()
  })

  it('rejects reserved units that are not positive SQLite integers', () => {
    expect(() => insertReservation({ reservedUnits: 0 })).toThrow()
    expect(() => insertReservation({ reservedUnits: 1.5 })).toThrow()
  })

  it('rejects negative or fractional settled and credit amounts', () => {
    expect(() => insertReservation({ settledUnits: -1 })).toThrow()
    expect(() => insertReservation({ settledUnits: 1.5 })).toThrow()
    expect(() => insertReservation({ creditCostReserved: -1 })).toThrow()
    expect(() => insertReservation({ creditCostReserved: 1.5 })).toThrow()
    expect(() => insertReservation({ creditCostSettled: -1 })).toThrow()
    expect(() => insertReservation({ creditCostSettled: 1.5 })).toThrow()
  })
})
