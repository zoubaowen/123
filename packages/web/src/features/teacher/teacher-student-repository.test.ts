import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { filterTeacherStudents, listTeacherStudents, updateTeacherStudentStatus } from './teacher-student-repository'

describe('teacher student repository', () => {
  it('combines class rosters with their class and course context', () => {
    const students = listTeacherStudents(teacherDashboardDemo)

    expect(students).toHaveLength(12)
    expect(students[0]).toMatchObject({
      id: 'student-01',
      name: '陈小雨',
      classId: 'creative-2a',
      className: '二年级创作 A 班',
      courseTitle: 'AI 太空海报创作营',
    })
  })

  it('filters students by name, class and learning status together', () => {
    const students = filterTeacherStudents(listTeacherStudents(teacherDashboardDemo), {
      keyword: '吴思远',
      classId: 'game-4b',
      status: 'needs_attention',
    })

    expect(students.map((student) => student.id)).toEqual(['student-10'])
  })

  it('updates a student status inside the owning class only', () => {
    const next = updateTeacherStudentStatus(teacherDashboardDemo, 'student-01', 'needs_attention')

    expect(next.classDetails[0].students.find((student) => student.id === 'student-01')?.status).toBe('needs_attention')
    expect(next.classDetails[1]).toBe(teacherDashboardDemo.classDetails[1])
  })
})
