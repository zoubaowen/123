import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { filterTeacherClasses, getTeacherClassDetail, getTeacherClassMetrics } from './teacher-class-repository'

describe('teacher class repository', () => {
  it('按课程关键词和状态筛选班级', () => {
    expect(filterTeacherClasses(teacherDashboardDemo, { query: '太空', status: 'active' }).map((item) => item.id)).toEqual([
      'creative-2a',
    ])
  })

  it('返回班级详情及下一课节', () => {
    const detail = getTeacherClassDetail(teacherDashboardDemo, 'creative-2a')

    expect(detail?.students).toHaveLength(6)
    expect(detail?.lessonProgress.find((item) => item.status === 'next')?.lessonId).toBe('space-poster-03')
  })

  it('汇总教师负责班级指标', () => {
    expect(getTeacherClassMetrics(teacherDashboardDemo)).toEqual({
      classCount: 2,
      studentCount: 44,
      averageProgress: 50,
      pendingReviewCount: 2,
    })
  })
})
