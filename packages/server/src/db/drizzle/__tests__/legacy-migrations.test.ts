import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalDatabasePath = process.env.DATABASE_PATH
const expectedMigrations = [
  {
    hash: 'ed061b97c692af9b6acb4e6ffa703fcd58393a1a4195576cbee8cceb9479c320',
    createdAt: 1784971639364,
  },
  {
    hash: '73be246c049c39fbafce9f0a961e0e2fd08b2af34b510766679e9183a9d1ee3a',
    createdAt: 1784998703819,
  },
  {
    hash: '24371e7b970461f2aeafab5f340d1d08a59271f45eeeb5e88ed815e358c93a24',
    createdAt: 1785261300000,
  },
  {
    hash: '2807b4c10116db84780d1e16e415324b84dece49e7a66b80fae3f03da95e2ef9',
    createdAt: 1787370304658,
  },
  {
    hash: 'f848e40841ee863be0a56c2185163f20cb47814fceebc46e9b0640ef4dfdaf41',
    createdAt: 1787450923074,
  },
  {
    hash: '0995c4f5a116bc74061c61b2b3526fcf5a99ae637684d50f841444d3745ed9bb',
    createdAt: 1789305632652,
  },
  {
    hash: '2e8c6b313274d42317f1fcb51446b57ff1254caacb4bd6da35e48f9bdac041b4',
    createdAt: 1789342666787,
  },
  {
    hash: '7106ab257cd2f9bef5528c405614bff9c1cad59325d3038a0aba7ed1775ed230',
    createdAt: 1789345632797,
  },
  {
    hash: '2f6361d204c8aee85103ec9d717598c9018e721b18b77b74fcb62083cfa2e879',
    createdAt: 1789351578080,
  },
  {
    hash: '146c5ea70b0ac00ce9c5c6b9258b4f164dea2d779bafc1b89c7539997cf3562a',
    createdAt: 1789357609736,
  },
] as const
const expectedTables = [
  'accounts',
  'admin_logs',
  'class_courses',
  'class_enrollments',
  'class_sessions',
  'class_teachers',
  'classes',
  'community_works',
  'connectors',
  'course_chapters',
  'course_lessons',
  'courses',
  'credit_transactions',
  'cron_tasks',
  'daily_usage',
  'deployments',
  'env_pool',
  'institution_members',
  'institutions',
  'keys',
  'lesson_progress',
  'lesson_resources',
  'local_credentials',
  'miniprogram_apps',
  'settings',
  'sms_codes',
  'subscription_plans',
  'tasks',
  'user_credits',
  'user_resources',
  'user_subscriptions',
  'users',
  'xiaobao_runtime_checkpoints',
  'xiaobao_usage_reservations',
] as const
const expectedIndexes = [
  'accounts_user_id_provider_idx',
  'admin_logs_action_idx',
  'admin_logs_admin_user_id_idx',
  'admin_logs_created_at_idx',
  'admin_logs_target_user_id_idx',
  'class_enrollments_class_student_unique',
  'class_enrollments_student_status_idx',
  'class_courses_course_id_idx',
  'class_sessions_active_class_unique',
  'class_sessions_class_started_idx',
  'class_teachers_user_id_idx',
  'classes_institution_status_idx',
  'course_chapters_course_id_idx',
  'course_lessons_chapter_id_idx',
  'courses_institution_status_idx',
  'ct_created_at_idx',
  'ct_type_idx',
  'ct_user_id_idx',
  'cw_created_at_idx',
  'cw_user_id_idx',
  'deployments_task_id_idx',
  'deployments_task_type_path_idx',
  'du_date_idx',
  'du_user_date_unique',
  'env_pool_status_idx',
  'institution_members_institution_user_unique',
  'institution_members_user_id_idx',
  'keys_user_id_provider_idx',
  'lesson_progress_class_id_idx',
  'lesson_progress_class_lesson_unique',
  'lesson_resources_lesson_id_idx',
  'settings_user_id_key_idx',
  'sms_codes_expires_idx',
  'sms_codes_phone_idx',
  'sp_active_idx',
  'tasks_deleted_status_created_idx',
  'tasks_user_deleted_created_idx',
  'tasks_user_pr_repo_idx',
  'us_status_idx',
  'us_user_id_idx',
  'user_credits_user_id_idx',
  'user_credits_user_id_unique',
  'users_phone_unique_idx',
  'users_provider_external_id_idx',
  'xiaobao_usage_reservations_status_idx',
  'xiaobao_usage_reservations_task_category_unique',
  'xiaobao_usage_reservations_user_id_idx',
] as const
let closeClient: (() => void) | undefined
let inspector: Database.Database | undefined
let directory: string | undefined

function createUsersOnlyDatabase(databasePath: string): Database.Database {
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE users (
      id text PRIMARY KEY NOT NULL,
      provider text NOT NULL,
      external_id text NOT NULL,
      access_token text DEFAULT '' NOT NULL,
      username text NOT NULL
    );
  `)
  return database
}

function assertAllMigrationArtifacts(database: Database.Database): void {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => (row as { name: string }).name)
  const indexes = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => (row as { name: string }).name)
  const userColumns = database
    .prepare('PRAGMA table_info(users)')
    .all()
    .map((row) => (row as { name: string }).name)
  const ledgerSql = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'xiaobao_usage_reservations'")
    .get() as { sql: string } | undefined
  const migrationRecords = database
    .prepare('SELECT hash, created_at AS createdAt FROM __drizzle_migrations ORDER BY created_at')
    .all() as Array<{ hash: string; createdAt: number }>

  expect(tables).toEqual(expect.arrayContaining(expectedTables))
  expect(indexes).toEqual(expect.arrayContaining(expectedIndexes))
  expect(userColumns).toEqual(expect.arrayContaining(['phone', 'phone_verified', 'xiaobao_credit_limit']))
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_category_check')
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_status_check')
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_reserved_units_check')
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_settled_units_check')
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_credit_cost_reserved_check')
  expect(ledgerSql?.sql).toContain('xiaobao_usage_reservations_credit_cost_settled_check')
  expect(migrationRecords).toEqual(expectedMigrations)
}

afterEach(() => {
  inspector?.close()
  closeClient?.()
  if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true })
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('Drizzle legacy database bootstrap', () => {
  it('runs unapplied checkpoint and ledger migrations instead of marking absent schema as applied', async () => {
    directory = mkdtempSync(join(tmpdir(), 'drizzle-legacy-migrations-'))
    const databasePath = join(directory, 'legacy.db')
    const legacy = createUsersOnlyDatabase(databasePath)
    legacy.close()

    process.env.DATABASE_PATH = databasePath
    vi.resetModules()
    const client = await import('../client.js')
    closeClient = client.closeDrizzleClient
    inspector = new Database(databasePath, { readonly: true })

    assertAllMigrationArtifacts(inspector)

    inspector.close()
    inspector = undefined
    closeClient()
    closeClient = undefined
    rmSync(directory, { recursive: true, force: true })
    expect(existsSync(directory)).toBe(false)
    directory = undefined
  })

  it('replaces legacy tag tracking that falsely claims missing checkpoint and ledger migrations', async () => {
    directory = mkdtempSync(join(tmpdir(), 'drizzle-invalid-tracking-'))
    const databasePath = join(directory, 'legacy.db')
    const legacy = createUsersOnlyDatabase(databasePath)
    legacy.exec(`
      CREATE TABLE __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
    `)
    const insertTracking = legacy.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    for (const [index, tag] of [
      '0000_shallow_ozymandias',
      '0001_nervous_karma',
      '0002_unique_user_phone',
      '0003_chubby_justice',
      '0004_xiaobao_usage_ledger',
    ].entries()) {
      insertTracking.run(tag, 1900000000000 + index)
    }
    legacy.close()

    process.env.DATABASE_PATH = databasePath
    vi.resetModules()
    const client = await import('../client.js')
    closeClient = client.closeDrizzleClient
    inspector = new Database(databasePath, { readonly: true })

    assertAllMigrationArtifacts(inspector)
  })

  it('records an untracked ledger migration only when its complete schema is already present', async () => {
    directory = mkdtempSync(join(tmpdir(), 'drizzle-untracked-ledger-'))
    const databasePath = join(directory, 'legacy.db')
    const legacy = createUsersOnlyDatabase(databasePath)
    legacy.exec(readFileSync(new URL('../../migrations/0003_chubby_justice.sql', import.meta.url), 'utf8'))
    legacy.exec(
      readFileSync(new URL('../../migrations/0004_xiaobao_usage_ledger.sql', import.meta.url), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    )
    legacy.close()

    process.env.DATABASE_PATH = databasePath
    vi.resetModules()
    const client = await import('../client.js')
    closeClient = client.closeDrizzleClient
    inspector = new Database(databasePath, { readonly: true })

    assertAllMigrationArtifacts(inspector)
  })
})
