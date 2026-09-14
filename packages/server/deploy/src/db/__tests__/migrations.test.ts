import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalDatabasePath = process.env.DATABASE_PATH
let directory: string | undefined
let inspector: Database.Database | undefined
let closeClient: (() => void) | undefined

const EXPECTED_MIGRATIONS = 10

const usersOnlySql = `
  CREATE TABLE users (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    external_id text NOT NULL,
    access_token text DEFAULT '' NOT NULL,
    username text NOT NULL
  );
`

/**
 * 旧版桌面端 client.ts 中 ensureCommercialTablesCompatibility() 手写的建表语句。
 * 真实桌面库就是由这段 SQL 建出来的，所以它必须能与迁移修复共存而不冲突。
 */
const legacyDesktopSql = `
  CREATE TABLE users (
    id text PRIMARY KEY NOT NULL,
    provider text NOT NULL,
    external_id text NOT NULL,
    access_token text DEFAULT '' NOT NULL,
    username text NOT NULL,
    phone text
  );

  CREATE TABLE credit_transactions (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    amount integer NOT NULL,
    balance_after integer NOT NULL,
    description text,
    metadata text,
    created_at integer NOT NULL
  );
  CREATE INDEX ct_user_id_idx ON credit_transactions (user_id);
  CREATE INDEX ct_type_idx ON credit_transactions (type);
  CREATE INDEX ct_created_at_idx ON credit_transactions (created_at);

  CREATE TABLE daily_usage (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    date text NOT NULL,
    task_count integer DEFAULT 0 NOT NULL,
    sandbox_duration integer DEFAULT 0 NOT NULL,
    credits_consumed integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  );
  CREATE UNIQUE INDEX du_user_date_unique ON daily_usage (user_id, date);
  CREATE INDEX du_date_idx ON daily_usage (date);

  CREATE TABLE sms_codes (
    id text PRIMARY KEY NOT NULL,
    phone text NOT NULL,
    code text NOT NULL,
    expires_at integer NOT NULL,
    used integer DEFAULT false NOT NULL,
    created_at integer NOT NULL
  );

  CREATE TABLE subscription_plans (
    id text PRIMARY KEY NOT NULL,
    name text NOT NULL,
    description text,
    type text NOT NULL,
    credits_per_period integer DEFAULT 0 NOT NULL,
    period_days integer DEFAULT 30 NOT NULL,
    price_cents integer DEFAULT 0 NOT NULL,
    max_tasks_per_day integer,
    max_sandbox_duration integer,
    features text,
    active integer DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  );

  CREATE TABLE user_credits (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    balance integer DEFAULT 0 NOT NULL,
    frozen_balance integer DEFAULT 0 NOT NULL,
    lifetime_balance integer DEFAULT 0 NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  );
  CREATE UNIQUE INDEX user_credits_user_id_unique ON user_credits (user_id);
  CREATE INDEX user_credits_user_id_idx ON user_credits (user_id);

  CREATE TABLE user_subscriptions (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    plan_id text NOT NULL,
    status text DEFAULT 'active' NOT NULL,
    current_period_start integer NOT NULL,
    current_period_end integer NOT NULL,
    auto_renew integer DEFAULT true NOT NULL,
    cancelled_at integer,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  );
  CREATE INDEX us_user_id_idx ON user_subscriptions (user_id);
  CREATE INDEX us_status_idx ON user_subscriptions (status);
  CREATE UNIQUE INDEX users_phone_unique_idx ON users (phone);
`

function seed(databasePath: string, sql: string): void {
  const database = new Database(databasePath)
  database.exec(sql)
  database.close()
}

async function boot(databasePath: string): Promise<void> {
  process.env.DATABASE_PATH = databasePath
  vi.resetModules()
  const client = await import('../drizzle/client.js')
  closeClient = client.closeDrizzleClient
}

function readSchema(database: Database.Database) {
  const names = (rows: unknown[]) => rows.map((row) => (row as { name: string }).name)
  return {
    tables: names(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()),
    taskColumns: names(database.prepare('PRAGMA table_info(tasks)').all()),
    userColumns: names(database.prepare('PRAGMA table_info(users)').all()),
    tracking: database
      .prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at')
      .all() as Array<{ hash: string; createdAt: number }>,
  }
}

function expectConverged(databasePath: string): void {
  inspector = new Database(databasePath, { readonly: true })
  const schema = readSchema(inspector)

  expect(schema.tables).toEqual(
    expect.arrayContaining([
      'users',
      'tasks',
      'credit_transactions',
      'user_credits',
      'xiaobao_runtime_checkpoints',
      'xiaobao_usage_reservations',
      'institutions',
      'institution_members',
      'classes',
      'class_teachers',
      'class_enrollments',
      'courses',
      'course_chapters',
      'course_lessons',
      'lesson_resources',
      'class_courses',
      'lesson_progress',
      'class_sessions',
    ]),
  )
  expect(schema.taskColumns).toContain('xiaobao_capability')
  expect(schema.userColumns).toContain('xiaobao_credit_limit')
  // 每个迁移都写入真实 SQL 的 sha256，且 created_at 来自 journal 而不是当前时间。
  expect(schema.tracking).toHaveLength(EXPECTED_MIGRATIONS)
  expect(schema.tracking.every((row) => /^[0-9a-f]{64}$/.test(row.hash))).toBe(true)
  expect(new Set(schema.tracking.map((row) => row.createdAt)).size).toBe(EXPECTED_MIGRATIONS)
}

afterEach(() => {
  inspector?.close()
  inspector = undefined
  closeClient?.()
  closeClient = undefined
  if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true })
  directory = undefined
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('desktop drizzle bootstrap convergence', () => {
  it('applies every migration to a brand new database', async () => {
    directory = mkdtempSync(join(tmpdir(), 'deploy-fresh-'))
    const databasePath = join(directory, 'fresh.db')

    await boot(databasePath)
    expectConverged(databasePath)
  })

  it('repairs a users-only legacy database instead of marking migrations applied', async () => {
    directory = mkdtempSync(join(tmpdir(), 'deploy-users-only-'))
    const databasePath = join(directory, 'legacy.db')
    seed(databasePath, usersOnlySql)

    await boot(databasePath)
    expectConverged(databasePath)
  })

  it('converges a desktop database that already had the hand-written commercial tables', async () => {
    directory = mkdtempSync(join(tmpdir(), 'deploy-desktop-'))
    const databasePath = join(directory, 'desktop.db')
    seed(databasePath, legacyDesktopSql)

    await boot(databasePath)
    expectConverged(databasePath)
  })
})
