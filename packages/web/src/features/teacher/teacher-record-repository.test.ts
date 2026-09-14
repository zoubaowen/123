import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { filterTeacherRecords, getTeacherRecordMetrics } from './teacher-record-repository'

describe('teacher record repository', () => {
  it('filters classroom records by keyword and class together', () => {
    const records = filterTeacherRecords(teacherDashboardDemo.recentSessions, {
      keyword: '设计第一关',
      className: '四年级游戏 B 班',
    })

    expect(records.map((record) => record.id)).toEqual(['record-1'])
  })

  it('summarizes record count, minutes, average duration and covered students', () => {
    expect(getTeacherRecordMetrics(teacherDashboardDemo.recentSessions)).toEqual({
      sessionCount: 3,
      totalMinutes: 140,
      averageMinutes: 47,
      coveredStudents: 68,
    })
  })
})
