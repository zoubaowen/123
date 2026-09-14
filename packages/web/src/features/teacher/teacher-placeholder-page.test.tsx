import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherPlaceholderPage, teacherPlaceholderRoutes } from './teacher-placeholder-page'

describe('TeacherPlaceholderPage', () => {
  it('为每个后续教师模块提供诚实的建设说明和返回入口', () => {
    expect(teacherPlaceholderRoutes.map((item) => item.path)).toEqual([])
    for (const route of teacherPlaceholderRoutes) {
      const markup = renderToStaticMarkup(
        <MemoryRouter>
          <TeacherPlaceholderPage title={route.title} description={route.description} />
        </MemoryRouter>,
      )
      expect(markup).toContain(route.title)
      expect(markup).toContain('正在建设')
      expect(markup).toContain('返回教学首页')
    }
  })
  it('把三条课程路由准确限定在教师路由树内', () => {
    const mainSource = readFileSync(new URL('../../main.tsx', import.meta.url), 'utf8')
    const teacherRouteTree = mainSource.match(
      /\/\* Teacher teaching workspace: independent from student and platform operations \*\/\}\s*(<Route[\s\S]*?<\/Route>)\s*\{\/\* Regular routes \*\//,
    )?.[1]

    expect(teacherRouteTree).toMatch(/<Route\s+path="\/teacher\/\*"/)

    const courseRoutes = [
      ['courses', 'TeacherCoursesPage'],
      ['courses/:courseId', 'TeacherCourseDetailPage'],
      ['courses/:courseId/lessons/:lessonId', 'TeacherLessonPreparationPage'],
    ]

    for (const [path, component] of courseRoutes) {
      expect(teacherRouteTree).toMatch(
        new RegExp(`<Route\\s+path="${path}"\\s+element=\\{<${component}\\s*\\/>\\}\\s*\\/>`),
      )
    }
  })
})
