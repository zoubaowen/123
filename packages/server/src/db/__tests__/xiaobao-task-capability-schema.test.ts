import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { tasks } from '../schema.js'

function readJournalTags(): string[] {
  const journal = JSON.parse(
    readFileSync(fileURLToPath(new URL('../migrations/meta/_journal.json', import.meta.url)), 'utf8'),
  ) as { entries: Array<{ tag: string }> }
  return journal.entries.map((entry) => entry.tag)
}

function readMigrationSqlInOrder(): string[] {
  return readJournalTags().map((tag) =>
    readFileSync(fileURLToPath(new URL(`../migrations/${tag}.sql`, import.meta.url)), 'utf8'),
  )
}

function createMigratedDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = OFF')
  for (const sql of readMigrationSqlInOrder()) database.exec(sql)
  return database
}

function insertTask(database: Database.Database, id: string, capability: string | null): void {
  database
    .prepare(
      `INSERT INTO tasks (id, user_id, prompt, created_at, updated_at, xiaobao_capability)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, 'user-1', 'prompt', 1, 1, capability)
}

function readCapability(database: Database.Database, id: string): unknown {
  const row = database.prepare('SELECT xiaobao_capability AS capability FROM tasks WHERE id = ?').get(id) as
    | { capability: unknown }
    | undefined
  return row?.capability
}

describe('xiaobao task capability schema', () => {
  it('declares a nullable xiaobaoCapability column on the tasks table', () => {
    const columns = getTableColumns(tasks)

    expect(Object.keys(columns)).toContain('xiaobaoCapability')
    expect(columns.xiaobaoCapability.notNull).toBe(false)
  })

  it('ships the column through the migration journal so the runtime client applies it', () => {
    const tags = readJournalTags()

    expect(tags).toContain('0005_xiaobao_task_capability')
    expect(tags.indexOf('0005_xiaobao_task_capability')).toBeGreaterThan(tags.indexOf('0004_xiaobao_usage_ledger'))
  })

  it('adds a nullable xiaobao_capability column on a fresh database', () => {
    const database = createMigratedDatabase()
    try {
      const columns = database.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string; notnull: number }>
      const column = columns.find((entry) => entry.name === 'xiaobao_capability')

      expect(column).toBeDefined()
      expect(column?.notnull).toBe(0)
    } finally {
      database.close()
    }
  })

  it('round-trips a capability value and leaves unset tasks null', () => {
    const database = createMigratedDatabase()
    try {
      insertTask(database, 'task-value', 'learning')
      insertTask(database, 'task-unset', null)

      expect(readCapability(database, 'task-value')).toBe('learning')
      expect(readCapability(database, 'task-unset')).toBeNull()
    } finally {
      database.close()
    }
  })
})
