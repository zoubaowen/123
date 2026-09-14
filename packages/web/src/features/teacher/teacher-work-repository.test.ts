import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { filterTeacherWorks, reviewTeacherWork, toggleFeaturedTeacherWork } from './teacher-work-repository'

describe('teacher work repository', () => {
  it('filters works by keyword, class and review status together', () => {
    const results = filterTeacherWorks(teacherDashboardDemo.works, {
      keyword: '弹跳球',
      classId: 'game-4b',
      status: 'pending',
    })

    expect(results.map((work) => work.id)).toEqual(['work-2'])
  })

  it('saves a review and removes the work from the pending dashboard queue', () => {
    const next = reviewTeacherWork(teacherDashboardDemo, 'work-1', {
      rating: 'excellent',
      comment: '画面主题鲜明，讲解也很清楚。',
    })

    expect(next.works.find((work) => work.id === 'work-1')).toMatchObject({
      status: 'reviewed',
      rating: 'excellent',
      comment: '画面主题鲜明，讲解也很清楚。',
    })
    expect(next.pendingReviews.map((work) => work.id)).not.toContain('work-1')
  })

  it('toggles whether a work is featured without changing other works', () => {
    const next = toggleFeaturedTeacherWork(teacherDashboardDemo, 'work-2')

    expect(next.works.find((work) => work.id === 'work-2')?.featured).toBe(true)
    expect(next.works.find((work) => work.id === 'work-1')?.featured).toBe(false)
  })
})
