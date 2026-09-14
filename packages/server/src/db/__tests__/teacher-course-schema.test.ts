import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { classCourses, courseChapters, courseLessons, courses, lessonProgress, lessonResources } from '../schema.js'

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

describe('teacher course and lesson schema', () => {
  it('ships the course model through the migration journal so the runtime client applies it', () => {
    const tags = readJournalTags()

    expect(tags).toContain('0008_teacher_course_model')
    // 只断言顺序，不断言"末位"：末位由最新迁移自己的 schema 测试负责
    expect(tags.indexOf('0008_teacher_course_model')).toBeGreaterThan(
      tags.indexOf('0007_teacher_class_model'),
    )
  })

  it('declares the six course tables with the expected columns', () => {
    const course = getTableColumns(courses)
    expect(Object.keys(course)).toEqual(
      expect.arrayContaining([
        'id',
        'institutionId',
        'title',
        'description',
        'coverAsset',
        'stage',
        'topic',
        'status',
        'ageRange',
        'goals',
        'expectedOutcome',
        'createdAt',
        'updatedAt',
      ]),
    )

    const chapter = getTableColumns(courseChapters)
    expect(Object.keys(chapter)).toEqual(expect.arrayContaining(['id', 'courseId', 'title', 'sortOrder']))

    const lesson = getTableColumns(courseLessons)
    expect(Object.keys(lesson)).toEqual(
      expect.arrayContaining([
        'id',
        'chapterId',
        'title',
        'sortOrder',
        'durationMinutes',
        'objectives',
        'steps',
        'teacherTips',
        'assignment',
        'capabilities',
        'skills',
        'mcpServers',
      ]),
    )

    const resource = getTableColumns(lessonResources)
    expect(Object.keys(resource)).toEqual(expect.arrayContaining(['id', 'lessonId', 'title', 'type', 'status']))

    const classCourse = getTableColumns(classCourses)
    expect(Object.keys(classCourse)).toEqual(expect.arrayContaining(['classId', 'courseId', 'assignedAt']))

    const progress = getTableColumns(lessonProgress)
    expect(Object.keys(progress)).toEqual(
      expect.arrayContaining(['id', 'classId', 'lessonId', 'status', 'completedAt']),
    )
    // 未完成的课时没有完成时间，必须是可空的，而不是用 0 冒充时间戳
    expect(progress.completedAt.notNull).toBe(false)
  })

  it('creates the tables on a fresh database with JSON columns defaulting to an empty array', () => {
    const database = createMigratedDatabase()
    try {
      for (const table of [
        'courses',
        'course_chapters',
        'course_lessons',
        'lesson_resources',
        'class_courses',
        'lesson_progress',
      ]) {
        expect(tableColumns(database, table).length).toBeGreaterThan(0)
      }

      database.exec(`
        INSERT INTO institutions (id, name, status, created_at, updated_at)
          VALUES ('i1', '示例机构', 'active', 1, 1);
        INSERT INTO courses (id, institution_id, title, stage, topic, created_at, updated_at)
          VALUES ('course-1', 'i1', 'AI 太空海报创作营', 'lower_primary', '视觉创作', 1, 1);
        INSERT INTO course_chapters (id, course_id, title, sort_order)
          VALUES ('chapter-1', 'course-1', '第一章', 1);
        INSERT INTO course_lessons (id, chapter_id, title, sort_order, duration_minutes)
          VALUES ('lesson-1', 'chapter-1', '让太空校园海报动起来', 1, 40);
      `)

      const lesson = database
        .prepare('SELECT objectives AS objectives, skills AS skills FROM course_lessons WHERE id = ?')
        .get('lesson-1') as { objectives: string; skills: string }
      expect(lesson.objectives).toBe('[]')
      expect(lesson.skills).toBe('[]')

      const course = database
        .prepare('SELECT description AS description, goals AS goals, status AS status FROM courses WHERE id = ?')
        .get('course-1') as { description: string; goals: string; status: string }
      expect(course.description).toBe('')
      expect(course.goals).toBe('[]')
      expect(course.status).toBe('draft')
    } finally {
      database.close()
    }
  })

  it('enforces one progress row per class and lesson, and one course assignment per class', () => {
    const database = createMigratedDatabase()
    try {
      database.exec(`
        INSERT INTO institutions (id, name, status, created_at, updated_at)
          VALUES ('i1', '示例机构', 'active', 1, 1);
        INSERT INTO classes (id, institution_id, name, created_at, updated_at)
          VALUES ('c1', 'i1', '二年级创作 A 班', 1, 1);
        INSERT INTO courses (id, institution_id, title, stage, topic, created_at, updated_at)
          VALUES ('course-1', 'i1', '课程一', 'lower_primary', '主题', 1, 1);
        INSERT INTO course_chapters (id, course_id, title, sort_order)
          VALUES ('chapter-1', 'course-1', '第一章', 1);
        INSERT INTO course_lessons (id, chapter_id, title, sort_order, duration_minutes)
          VALUES ('lesson-1', 'chapter-1', '课时一', 1, 40);
        INSERT INTO class_courses (class_id, course_id, assigned_at) VALUES ('c1', 'course-1', 1);
        INSERT INTO lesson_progress (id, class_id, lesson_id, status) VALUES ('p1', 'c1', 'lesson-1', 'completed');
      `)

      expect(() =>
        database.exec(`INSERT INTO class_courses (class_id, course_id, assigned_at) VALUES ('c1', 'course-1', 2);`),
      ).toThrow()

      expect(() =>
        database.exec(
          `INSERT INTO lesson_progress (id, class_id, lesson_id, status) VALUES ('p2', 'c1', 'lesson-1', 'next');`,
        ),
      ).toThrow()
    } finally {
      database.close()
    }
  })
})
