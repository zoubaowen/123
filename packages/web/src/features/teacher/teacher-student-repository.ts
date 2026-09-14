import type { TeacherDashboardData, TeacherStudentLearningStatus, TeacherStudentSummary } from './types'

export interface TeacherStudentListItem extends TeacherStudentSummary {
  classId: string
  className: string
  courseTitle: string
}

export interface TeacherStudentFilters {
  keyword: string
  classId: string
  status: TeacherStudentLearningStatus | 'all'
}

export function listTeacherStudents(data: TeacherDashboardData): TeacherStudentListItem[] {
  return data.classDetails.flatMap((detail) =>
    detail.students.map((student) => ({
      ...student,
      classId: detail.summary.id,
      className: detail.summary.name,
      courseTitle: detail.summary.courseTitle,
    })),
  )
}

export function filterTeacherStudents(students: TeacherStudentListItem[], filters: TeacherStudentFilters) {
  const keyword = filters.keyword.trim().toLocaleLowerCase('zh-CN')
  return students.filter((student) => {
    const matchesKeyword = !keyword || student.name.toLocaleLowerCase('zh-CN').includes(keyword)
    const matchesClass = filters.classId === 'all' || student.classId === filters.classId
    const matchesStatus = filters.status === 'all' || student.status === filters.status
    return matchesKeyword && matchesClass && matchesStatus
  })
}

export function updateTeacherStudentStatus(
  data: TeacherDashboardData,
  studentId: string,
  status: TeacherStudentLearningStatus,
): TeacherDashboardData {
  return {
    ...data,
    classDetails: data.classDetails.map((detail) => {
      if (!detail.students.some((student) => student.id === studentId)) return detail
      return {
        ...detail,
        students: detail.students.map((student) => (student.id === studentId ? { ...student, status } : student)),
      }
    }),
  }
}
