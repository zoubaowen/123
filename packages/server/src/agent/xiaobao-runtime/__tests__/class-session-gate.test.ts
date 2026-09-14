import { describe, expect, it, vi } from 'vitest'
import type { ClassSession, TeacherClass } from '../../../db/types.js'
import { createClassSessionGate } from '../class-session-gate.js'

function teacherClass(id: string, aiUsageMode: 'class_only' | 'anytime'): TeacherClass {
  return {
    id,
    institutionId: 'i1',
    name: `班级 ${id}`,
    aiUsageMode,
    xiaobaoCreditLimit: null,
    status: 'active',
    archivedAt: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

function session(id: string, capabilities: string): ClassSession {
  return {
    id,
    classId: 'c1',
    lessonId: 'lesson-1',
    startedByUserId: 'teacher-1',
    startedAt: 1,
    endedAt: null,
    durationMinutes: null,
    pointLimit: 100,
    capabilities,
    skills: '[]',
    mcpServers: '[]',
    studentCount: 10,
  }
}

function createDatabase(options: {
  classes?: TeacherClass[] | null
  sessions?: Record<string, ClassSession | null>
  sessionThrows?: boolean
}) {
  const listByStudent = vi.fn(async () => ('classes' in options ? options.classes : []))
  const findActiveByClass = vi.fn(async (classId: string) => {
    if (options.sessionThrows) throw new Error('Class session state unavailable')
    return options.sessions?.[classId] ?? null
  })
  return {
    database: { classes: { listByStudent }, classSessions: { findActiveByClass } } as never,
    listByStudent,
    findActiveByClass,
  }
}

describe('createClassSessionGate', () => {
  it('leaves a student without any class unrestricted', async () => {
    const { database } = createDatabase({ classes: [] })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'unrestricted',
    })
  })

  it('treats an anytime class as unrestricted', async () => {
    const { database } = createDatabase({ classes: [teacherClass('c1', 'anytime')] })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'unrestricted',
    })
  })

  it('unions the capabilities of every running class the student attends', async () => {
    const { database } = createDatabase({
      classes: [teacherClass('c1', 'class_only'), teacherClass('c2', 'class_only')],
      sessions: {
        c1: session('s1', JSON.stringify(['writing'])),
        c2: session('s2', JSON.stringify(['learning', 'writing'])),
      },
    })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'class_only',
      inSession: true,
      capabilities: expect.arrayContaining(['writing', 'learning']),
    })
  })

  it('reports no session and no capabilities between two classes', async () => {
    const { database } = createDatabase({ classes: [teacherClass('c1', 'class_only')], sessions: {} })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'class_only',
      inSession: false,
      capabilities: [],
    })
  })

  it('ignores unknown and malformed capability payloads instead of guessing', async () => {
    const { database } = createDatabase({
      classes: [teacherClass('c1', 'class_only')],
      sessions: { c1: session('s1', JSON.stringify(['music', 'not-a-capability', 42])) },
    })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'class_only',
      inSession: true,
      capabilities: ['music'],
    })

    const broken = createDatabase({
      classes: [teacherClass('c1', 'class_only')],
      sessions: { c1: session('s1', 'not-json') },
    })
    await expect(createClassSessionGate(broken.database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'class_only',
      inSession: true,
      capabilities: [],
    })
  })

  it('denies when the class list cannot be determined', async () => {
    // 读不全就不能说"这个学生不受课堂时间限制"：宁可拒绝
    const { database } = createDatabase({ classes: null })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).resolves.toEqual({
      mode: 'class_only',
      inSession: false,
      capabilities: [],
    })
  })

  it('propagates a truncated session read so callers can fail closed', async () => {
    const { database } = createDatabase({ classes: [teacherClass('c1', 'class_only')], sessionThrows: true })

    await expect(createClassSessionGate(database).resolveForStudent('student-1')).rejects.toThrow(
      'Class session state unavailable',
    )
  })
})
