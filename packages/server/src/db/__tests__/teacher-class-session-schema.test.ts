import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { classSessions } from '../schema.js'

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

function seedSession(database: Database.Database, id: string, endedAt: number | null, startedAt = 1): void {
  database
    .prepare(
      `INSERT INTO class_sessions (
        id, class_id, lesson_id, started_by_user_id, started_at, ended_at, point_limit
      ) VALUES (?, 'c1', 'lesson-1', 'teacher-1', ?, ?, 100)`,
    )
    .run(id, startedAt, endedAt)
}

describe('teacher class session schema', () => {
  it('ships the session table through the migration journal so the runtime client applies it', () => {
    const tags = readJournalTags()

    expect(tags).toContain('0009_teacher_class_sessions')
    expect(tags.at(-1)).toBe('0009_teacher_class_sessions')
  })

  it('declares the session columns with the nullable ones kept nullable', () => {
    const columns = getTableColumns(classSessions)

    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'id',
        'classId',
        'lessonId',
        'startedByUserId',
        'startedAt',
        'endedAt',
        'durationMinutes',
        'pointLimit',
        'capabilities',
        'skills',
        'mcpServers',
        'studentCount',
      ]),
    )
    // 进行中的会话没有结束时间与时长；人数无法确定时也不编造 0
    expect(columns.endedAt.notNull).toBe(false)
    expect(columns.durationMinutes.notNull).toBe(false)
    expect(columns.studentCount.notNull).toBe(false)
  })

  it('creates the table with JSON defaults on a fresh database', () => {
    const database = createMigratedDatabase()
    try {
      expect(tableColumns(database, 'class_sessions').length).toBeGreaterThan(0)

      database.exec(`
        INSERT INTO institutions (id, name, status, created_at, updated_at)
          VALUES ('i1', '示例机构', 'active', 1, 1);
        INSERT INTO classes (id, institution_id, name, created_at, updated_at)
          VALUES ('c1', 'i1', '二年级创作 A 班', 1, 1);
        INSERT INTO users (id, provider, external_id, access_token, username, created_at, updated_at, last_login_at)
          VALUES ('teacher-1', 'local', 'teacher-1', '', 'teacher-1', 1, 1, 1);
        INSERT INTO courses (id, institution_id, title, stage, topic, created_at, updated_at)
          VALUES ('course-1', 'i1', '课程一', 'lower_primary', '主题', 1, 1);
        INSERT INTO course_chapters (id, course_id, title, sort_order) VALUES ('chapter-1', 'course-1', '第一章', 1);
        INSERT INTO course_lessons (id, chapter_id, title, sort_order, duration_minutes)
          VALUES ('lesson-1', 'chapter-1', '课时一', 1, 40);
      `)
      seedSession(database, 'session-1', null)

      const row = database
        .prepare('SELECT capabilities AS capabilities, ended_at AS endedAt FROM class_sessions WHERE id = ?')
        .get('session-1') as { capabilities: string; endedAt: number | null }
      expect(row.capabilities).toBe('[]')
      expect(row.endedAt).toBeNull()
    } finally {
      database.close()
    }
  })

  it('allows only one active session per class while keeping every finished one', () => {
    const database = createMigratedDatabase()
    try {
      database.exec(`
        INSERT INTO institutions (id, name, status, created_at, updated_at)
          VALUES ('i1', '示例机构', 'active', 1, 1);
        INSERT INTO classes (id, institution_id, name, created_at, updated_at)
          VALUES ('c1', 'i1', '二年级创作 A 班', 1, 1);
        INSERT INTO users (id, provider, external_id, access_token, username, created_at, updated_at, last_login_at)
          VALUES ('teacher-1', 'local', 'teacher-1', '', 'teacher-1', 1, 1, 1);
        INSERT INTO courses (id, institution_id, title, stage, topic, created_at, updated_at)
          VALUES ('course-1', 'i1', '课程一', 'lower_primary', '主题', 1, 1);
        INSERT INTO course_chapters (id, course_id, title, sort_order) VALUES ('chapter-1', 'course-1', '第一章', 1);
        INSERT INTO course_lessons (id, chapter_id, title, sort_order, duration_minutes)
          VALUES ('lesson-1', 'chapter-1', '课时一', 1, 40);
      `)

      // 历史课堂可以有很多节
      seedSession(database, 'session-old-1', 100, 10)
      seedSession(database, 'session-old-2', 200, 20)
      // 进行中的只能有一节
      seedSession(database, 'session-active', null, 30)

      expect(() => seedSession(database, 'session-second-active', null, 40)).toThrow()

      // 下课后可以再开一节
      database.prepare('UPDATE class_sessions SET ended_at = 300 WHERE id = ?').run('session-active')
      seedSession(database, 'session-next-active', null, 50)

      const total = database.prepare('SELECT count(*) AS count FROM class_sessions').get() as { count: number }
      expect(total.count).toBe(4)
    } finally {
      database.close()
    }
  })
})
