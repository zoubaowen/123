import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { TeacherLessonProgressList } from './teacher-lesson-progress-list'
import { TeacherStudentRoster } from './teacher-student-roster'

describe('teacher class detail sections', () => {
  const detail = teacherDashboardDemo.classDetails[0]

  it('展示学生学习状态和任务进度', () => {
    const markup = renderToStaticMarkup(<TeacherStudentRoster students={detail.students} />)

    expect(markup).toContain('学生名单')
    expect(markup).toContain('需要关注')
    expect(markup).toContain('任务完成')
  })

  it('展示已完成、下一节和未开始课节', () => {
    const markup = renderToStaticMarkup(<TeacherLessonProgressList lessons={detail.lessonProgress} />)

    expect(markup).toContain('课程进度')
    expect(markup).toContain('已完成')
    expect(markup).toContain('下一节')
    expect(markup).toContain('未开始')
  })
})
