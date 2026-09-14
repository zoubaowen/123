import type { ClassSessionRecord } from './types'

export interface TeacherRecordFilters {
  keyword: string
  className: string
}

export function filterTeacherRecords(records: ClassSessionRecord[], filters: TeacherRecordFilters) {
  const keyword = filters.keyword.trim().toLocaleLowerCase('zh-CN')
  return records.filter((record) => {
    const matchesKeyword =
      !keyword || `${record.lessonTitle} ${record.className}`.toLocaleLowerCase('zh-CN').includes(keyword)
    const matchesClass = filters.className === 'all' || record.className === filters.className
    return matchesKeyword && matchesClass
  })
}

export function getTeacherRecordMetrics(records: ClassSessionRecord[]) {
  const totalMinutes = records.reduce((total, record) => total + record.durationMinutes, 0)
  return {
    sessionCount: records.length,
    totalMinutes,
    averageMinutes: records.length ? Math.round(totalMinutes / records.length) : 0,
    coveredStudents: records.reduce((total, record) => total + record.studentCount, 0),
  }
}
