import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { classEnrollments, classTeachers, classes, institutionMembers, institutions } from '../schema.js'

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

function tableColumns(database: Database.Database, table: string): Array<{ name: string; notnull: number }> {
  return database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; notnull: number }>
}

describe('teacher institution and class schema', () => {
  it('ships the class model through the migration journal so the runtime client applies it', () => {
    const tags = readJournalTags()

    expect(tags).toContain('0007_teacher_class_model')
    // 只断言顺序，不断言"末位"：否则每新增一个迁移都会让这条旧测试变红。
    // "journal 末位是最新迁移"由最新迁移自己的 schema 测试负责。
    expect(tags.indexOf('0007_teacher_class_model')).toBeGreaterThan(tags.indexOf('0006_xiaobao_budget_cap'))
  })

  it('declares the five core tables with the expected columns', () => {
    const institution = getTableColumns(institutions)
    expect(Object.keys(institution)).toEqual(expect.arrayContaining(['id', 'name', 'status', 'createdAt', 'updatedAt']))

    const member = getTableColumns(institutionMembers)
    expect(Object.keys(member)).toEqual(
      expect.arrayContaining(['id', 'institutionId', 'userId', 'role', 'status', 'createdAt', 'updatedAt']),
    )

    const klass = getTableColumns(classes)
    expect(Object.keys(klass)).toEqual(
      expect.arrayContaining([
        'id',
        'institutionId',
        'name',
        'aiUsageMode',
        'xiaobaoCreditLimit',
        'status',
        'archivedAt',
        'createdAt',
        'updatedAt',
      ]),
    )
    // 未设班级共享额度时必须是 null：0 会被运行时预算读取器判为配置错误并锁死学生
    expect(klass.xiaobaoCreditLimit.notNull).toBe(false)
    expect(klass.archivedAt.notNull).toBe(false)

    const teacher = getTableColumns(classTeachers)
    expect(Object.keys(teacher)).toEqual(expect.arrayContaining(['classId', 'userId', 'role', 'createdAt']))

    const enrollment = getTableColumns(classEnrollments)
    expect(Object.keys(enrollment)).toEqual(
      expect.arrayContaining(['id', 'classId', 'studentUserId', 'status', 'joinedAt', 'leftAt']),
    )
    // 退班保留历史，因此 leftAt 可空而不是必填
    expect(enrollment.leftAt.notNull).toBe(false)
  })

  it('creates the tables on a fresh database and leaves the users table untouched', () => {
    const database = createMigratedDatabase()
    try {
      for (const table of ['institutions', 'institution_members', 'classes', 'class_teachers', 'class_enrollments']) {
        expect(tableColumns(database, table).length).toBeGreaterThan(0)
      }

      expect(tableColumns(database, 'classes').find((column) => column.name === 'xiaobao_credit_limit')?.notnull).toBe(
        0,
      )
      expect(tableColumns(database, 'classes').find((column) => column.name === 'archived_at')?.notnull).toBe(0)
      expect(tableColumns(database, 'class_enrollments').find((column) => column.name === 'left_at')?.notnull).toBe(0)

      // 本轮不迁移任何现有用户：users 表不新增机构或班级归属列
      const userColumns = tableColumns(database, 'users').map((column) => column.name)
      expect(userColumns).not.toContain('institution_id')
      expect(userColumns).not.toContain('class_id')
    } finally {
      database.close()
    }
  })

  it('enforces one membership per user per institution and one enrollment per student per class', () => {
    const database = createMigratedDatabase()
    try {
      database.exec(`
        INSERT INTO institutions (id, name, status, created_at, updated_at)
          VALUES ('i1', '示例机构', 'active', 1, 1);
        INSERT INTO users (id, provider, external_id, access_token, username, created_at, updated_at, last_login_at)
          VALUES ('u1', 'local', 'u1', '', 'u1', 1, 1, 1);
        INSERT INTO classes (id, institution_id, name, ai_usage_mode, status, created_at, updated_at)
          VALUES ('c1', 'i1', '二年级创作 A 班', 'class_only', 'active', 1, 1);
        INSERT INTO institution_members (id, institution_id, user_id, role, status, created_at, updated_at)
          VALUES ('m1', 'i1', 'u1', 'teacher', 'active', 1, 1);
        INSERT INTO class_enrollments (id, class_id, student_user_id, status, joined_at)
          VALUES ('e1', 'c1', 'u1', 'active', 1);
      `)

      expect(() =>
        database.exec(`
          INSERT INTO institution_members (id, institution_id, user_id, role, status, created_at, updated_at)
            VALUES ('m2', 'i1', 'u1', 'admin', 'active', 1, 1);
        `),
      ).toThrow()

      expect(() =>
        database.exec(`
          INSERT INTO class_enrollments (id, class_id, student_user_id, status, joined_at)
            VALUES ('e2', 'c1', 'u1', 'active', 2);
        `),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
