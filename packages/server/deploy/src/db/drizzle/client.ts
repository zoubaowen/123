import { createHash } from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import Database from 'better-sqlite3'
import * as schema from '../schema'
import path from 'path'
import { existsSync, mkdirSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'app.db')

mkdirSync(path.dirname(DB_PATH), { recursive: true })

const sqlite = new Database(DB_PATH)

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')
sqlite.pragma('busy_timeout = 5000')

export const drizzleDb = drizzle(sqlite, { schema })

export function closeDrizzleClient(): void {
  if (sqlite.open) sqlite.close()
}

function resolveMigrationsFolder() {
  const candidates = [
    resolve(__dirname, '..', 'migrations'),
    resolve(__dirname, '..', 'src', 'db', 'migrations'),
    resolve(process.cwd(), 'packages', 'server', 'src', 'db', 'migrations'),
  ]
  const found = candidates.find((candidate) => existsSync(resolve(candidate, 'meta', '_journal.json')))
  if (!found) {
    throw new Error('Drizzle migrations folder not found')
  }
  return found
}

function normalizeMigrationSql(statement: string): string {
  return statement.replace(/\s+/g, ' ').replace(/;$/, '').trim()
}

interface MigrationFile {
  createdAt: number
  hash: string
  statements: string[]
  tag: string
}

type MigrationArtifact =
  | { kind: 'table'; name: string; columns: string[] }
  | { kind: 'index'; name: string; table: string; columns: string[]; unique: boolean }
  | { kind: 'column'; table: string; name: string }

function parseMigrationArtifact(statement: string): MigrationArtifact {
  const table = statement.match(/^CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)`/i)
  if (table) {
    const columns = statement.split(/\r?\n/).flatMap((line) => line.match(/^\s*`([^`]+)`\s+/)?.[1] ?? [])
    return { kind: 'table', name: table[1], columns }
  }

  const index = statement.match(/^CREATE (UNIQUE )?INDEX(?: IF NOT EXISTS)? `([^`]+)` ON `([^`]+)` \(([^)]+)\)/i)
  if (index) {
    return {
      kind: 'index',
      name: index[2],
      table: index[3],
      columns: [...index[4].matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      unique: Boolean(index[1]),
    }
  }

  const column = statement.match(/^ALTER TABLE `([^`]+)` ADD `([^`]+)`/i)
  if (column) return { kind: 'column', table: column[1], name: column[2] }
  throw new Error('Unsupported legacy migration statement')
}

function readMigrationFiles(migrationsFolder: string): MigrationFile[] {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  return journal.entries.map((entry) => {
    const migrationSql = readFileSync(resolve(migrationsFolder, `${entry.tag}.sql`), 'utf8')
    return {
      createdAt: entry.when,
      hash: createHash('sha256').update(migrationSql).digest('hex'),
      statements: migrationSql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean),
      tag: entry.tag,
    }
  })
}

function migrationArtifactIsComplete(statement: string, strictSql: boolean): boolean {
  const artifact = parseMigrationArtifact(statement)
  if (artifact.kind === 'column') {
    const columns = sqlite.prepare(`PRAGMA table_info(${JSON.stringify(artifact.table)})`).all() as Array<{
      name: string
    }>
    return columns.some((column) => column.name === artifact.name)
  }

  const existing = sqlite
    .prepare('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(artifact.kind, artifact.name) as { sql: string | null } | undefined
  if (!existing?.sql) return false
  if (strictSql && normalizeMigrationSql(existing.sql) !== normalizeMigrationSql(statement)) return false

  if (artifact.kind === 'table') {
    const columns = sqlite.prepare(`PRAGMA table_info(${JSON.stringify(artifact.name)})`).all() as Array<{
      name: string
    }>
    const names = new Set(columns.map((column) => column.name))
    return artifact.columns.every((column) => names.has(column))
  }

  const listed = sqlite.prepare(`PRAGMA index_list(${JSON.stringify(artifact.table)})`).all() as Array<{
    name: string
    unique: number
  }>
  const index = listed.find((candidate) => candidate.name === artifact.name)
  if (!index || Boolean(index.unique) !== artifact.unique) return false
  const columns = sqlite.prepare(`PRAGMA index_info(${JSON.stringify(artifact.name)})`).all() as Array<{
    name: string
    seqno: number
  }>
  const names = columns.sort((left, right) => left.seqno - right.seqno).map((column) => column.name)
  return names.length === artifact.columns.length && names.every((column, index) => column === artifact.columns[index])
}

function isKnownDuplicateArtifactError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || !('message' in error)) return false
  if (error.code !== 'SQLITE_ERROR' || typeof error.message !== 'string') return false
  return /^(?:table|index) .+ already exists$|^duplicate column name: .+$/.test(error.message)
}

function ensureMigrationStatement(statement: string, strictSql: boolean): void {
  if (migrationArtifactIsComplete(statement, strictSql)) return
  try {
    sqlite.exec(statement)
  } catch (error) {
    if (!isKnownDuplicateArtifactError(error) || !migrationArtifactIsComplete(statement, strictSql)) throw error
  }
  if (!migrationArtifactIsComplete(statement, strictSql)) {
    throw new Error('Legacy migration artifact is incomplete')
  }
}

function legacyMigrationsAreComplete(migrations: MigrationFile[]): boolean {
  const hasMigrationsTable = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get()
  if (!hasMigrationsTable) return false

  const countCanonical = sqlite.prepare(
    'SELECT count(*) AS count FROM __drizzle_migrations WHERE hash = ? AND created_at = ?',
  )
  const countInvalid = sqlite.prepare(`
    SELECT count(*) AS count
    FROM __drizzle_migrations
    WHERE hash = ?
       OR (hash = ? AND created_at <> ?)
       OR (created_at = ? AND hash <> ?)
  `)
  return migrations.every((migration) => {
    const strictSql = migration.tag === '0004_xiaobao_usage_ledger'
    if (!migration.statements.every((statement) => migrationArtifactIsComplete(statement, strictSql))) return false
    const canonical = countCanonical.get(migration.hash, migration.createdAt) as { count: number }
    const invalid = countInvalid.get(
      migration.tag,
      migration.hash,
      migration.createdAt,
      migration.createdAt,
      migration.hash,
    ) as { count: number }
    return canonical.count === 1 && invalid.count === 0
  })
}

function repairLegacyMigrations(migrations: MigrationFile[]): void {
  sqlite.transaction(() => {
    ensureLegacyUsersTableCompatibility()
    sqlite.exec(
      `CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)`,
    )
    const removeInvalid = sqlite.prepare(`
      DELETE FROM __drizzle_migrations
      WHERE hash = ?
         OR (hash = ? AND created_at <> ?)
         OR (created_at = ? AND hash <> ?)
    `)
    const countCanonical = sqlite.prepare(
      'SELECT count(*) AS count FROM __drizzle_migrations WHERE hash = ? AND created_at = ?',
    )
    const removeCanonical = sqlite.prepare('DELETE FROM __drizzle_migrations WHERE hash = ? AND created_at = ?')
    const insertCanonical = sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')

    for (const migration of migrations) {
      for (const statement of migration.statements) {
        ensureMigrationStatement(statement, migration.tag === '0004_xiaobao_usage_ledger')
      }
      removeInvalid.run(migration.tag, migration.hash, migration.createdAt, migration.createdAt, migration.hash)
      const existing = countCanonical.get(migration.hash, migration.createdAt) as { count: number }
      if (existing.count !== 1) {
        removeCanonical.run(migration.hash, migration.createdAt)
        insertCanonical.run(migration.hash, migration.createdAt)
      }
    }
  })()
}

// Migration management
const migrationsFolder = resolveMigrationsFolder()
const hasUsersTable = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()

if (hasUsersTable) {
  const migrations = readMigrationFiles(migrationsFolder)
  if (!legacyMigrationsAreComplete(migrations)) repairLegacyMigrations(migrations)
  console.log('[DB] Bootstrapped migration tracking for existing database')
} else {
  migrate(drizzleDb, { migrationsFolder })
  console.log('[DB] Database migrated successfully')
}

function ensureLegacyUsersTableCompatibility() {
  const rows = sqlite.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
  const columns = new Set(rows.map((row) => row.name))
  const addColumn = (name: string, definition: string) => {
    if (!columns.has(name)) {
      sqlite.exec(`ALTER TABLE users ADD ${definition}`)
      columns.add(name)
    }
  }

  addColumn('refresh_token', '`refresh_token` text')
  addColumn('scope', '`scope` text')
  addColumn('email', '`email` text')
  addColumn('name', '`name` text')
  addColumn('avatar_url', '`avatar_url` text')
  addColumn('role', "`role` text DEFAULT 'user' NOT NULL")
  addColumn('status', "`status` text DEFAULT 'active' NOT NULL")
  addColumn('disabled_reason', '`disabled_reason` text')
  addColumn('disabled_at', '`disabled_at` integer')
  addColumn('disabled_by', '`disabled_by` text')
  addColumn('api_key', '`api_key` text')
  addColumn('phone', '`phone` text')
  addColumn('phone_verified', '`phone_verified` integer DEFAULT false')
  addColumn('created_at', '`created_at` integer DEFAULT 0 NOT NULL')
  addColumn('updated_at', '`updated_at` integer DEFAULT 0 NOT NULL')
  addColumn('last_login_at', '`last_login_at` integer DEFAULT 0 NOT NULL')
}
