import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { users } from '../schema.js'

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

function insertUser(database: Database.Database, id: string, creditLimit: number | null): void {
  database
    .prepare(
      `INSERT INTO users (id, provider, external_id, access_token, username, xiaobao_credit_limit,
                          created_at, updated_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, 1)`,
    )
    .run(id, 'local', id, '', id, creditLimit)
}

function readCreditLimit(database: Database.Database, id: string): unknown {
  const row = database.prepare('SELECT xiaobao_credit_limit AS creditLimit FROM users WHERE id = ?').get(id) as
    | { creditLimit: unknown }
    | undefined
  return row?.creditLimit
}

describe('xiaobao budget cap schema', () => {
  it('declares a nullable xiaobaoCreditLimit column on the users table', () => {
    const columns = getTableColumns(users)

    expect(Object.keys(columns)).toContain('xiaobaoCreditLimit')
    expect(columns.xiaobaoCreditLimit.notNull).toBe(false)
  })

  it('ships the column through the migration journal so the runtime client applies it', () => {
    const tags = readJournalTags()

    expect(tags).toContain('0006_xiaobao_budget_cap')
    // 只断言顺序，不断言"末位"：否则每新增一个迁移都会让这条旧测试变红。
    // "journal 末位是最新迁移"由最新迁移自己的 schema 测试负责。
    expect(tags.indexOf('0006_xiaobao_budget_cap')).toBeGreaterThan(tags.indexOf('0005_xiaobao_task_capability'))
  })

  it('adds a nullable xiaobao_credit_limit column on a fresh database', () => {
    const database = createMigratedDatabase()
    try {
      const columns = database.prepare('PRAGMA table_info(users)').all() as Array<{ name: string; notnull: number }>
      const column = columns.find((entry) => entry.name === 'xiaobao_credit_limit')

      expect(column).toBeDefined()
      expect(column?.notnull).toBe(0)
    } finally {
      database.close()
    }
  })

  it('round-trips a configured cap and leaves unset students unlimited', () => {
    const database = createMigratedDatabase()
    try {
      insertUser(database, 'student-capped', 120)
      insertUser(database, 'student-uncapped', null)

      expect(readCreditLimit(database, 'student-capped')).toBe(120)
      expect(readCreditLimit(database, 'student-uncapped')).toBeNull()
    } finally {
      database.close()
    }
  })
})
