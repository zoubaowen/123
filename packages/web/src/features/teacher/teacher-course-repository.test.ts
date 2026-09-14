import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import {
  assignCourseToClasses,
  createCourseLessonStartInput,
  filterTeacherCourses,
  getTeacherCourseDetail,
  getTeacherCourseLesson,
  getTeacherCourseMetrics,
} from './teacher-course-repository'

describe('teacher course repository', () => {
  it('用关键词、学段、主题和状态筛选课程', () => {
    expect(
      filterTeacherCourses(teacherDashboardDemo, {
        query: '太空',
        stage: 'lower_primary',
        topic: 'AI 创作',
        status: 'ready',
      }).map((item) => item.id),
    ).toEqual(['space-poster'])
  })

  it('汇总课程、课时、已分配班级和草稿指标', () => {
    expect(getTeacherCourseMetrics(teacherDashboardDemo)).toEqual({
      courseCount: 2,
      lessonCount: 8,
      assignedClassCount: 2,
      draftCourseCount: 1,
    })
  })

  it('仅在课时属于指定课程时返回课时详情', () => {
    expect(getTeacherCourseDetail(teacherDashboardDemo, 'space-poster')?.chapters).toHaveLength(2)
    expect(getTeacherCourseLesson(teacherDashboardDemo, 'space-poster', 'space-poster-03')?.id).toBe('space-poster-03')
    expect(getTeacherCourseLesson(teacherDashboardDemo, 'space-poster', 'bounce-game-02')).toBeUndefined()
  })

  it('分配班级时去重并忽略不存在的班级', () => {
    const next = assignCourseToClasses(teacherDashboardDemo, 'space-poster', [
      'creative-2a',
      'game-4b',
      'game-4b',
      'missing-class',
    ])

    expect(getTeacherCourseDetail(next, 'space-poster')?.assignedClassIds).toEqual(['creative-2a', 'game-4b'])
    expect(getTeacherCourseDetail(teacherDashboardDemo, 'space-poster')?.assignedClassIds).toEqual(['creative-2a'])
  })

  it('为已分配班级的课时构造推荐能力的开课输入', () => {
    expect(
      createCourseLessonStartInput(teacherDashboardDemo, 'space-poster', 'space-poster-03', 'creative-2a'),
    ).toMatchObject({
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 80,
      capabilities: ['chat', 'image', 'video'],
    })
    expect(
      createCourseLessonStartInput(teacherDashboardDemo, 'space-poster', 'space-poster-03', 'game-4b'),
    ).toBeUndefined()
  })
})
