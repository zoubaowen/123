import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherDashboardPage } from './teacher-dashboard-page'

describe('TeacherDashboardPage', () => {
  it('prioritizes today teaching and pending reviews', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('今天要上的课')
    expect(markup).toContain('开始上课')
    expect(markup).toContain('待点评作品')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('最近课堂记录')
    expect(markup).toContain('小宝教学助手')
  })

  it('connects every dashboard shortcut to a real destination', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherDashboardPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('查看今日安排')
    expect(markup).toContain('id="today-schedule"')
    expect(markup).toContain('href="/teacher/courses/space-poster/lessons/space-poster-03"')
    expect(markup).toContain('href="/teacher/courses"')
    expect(markup).not.toContain('查看教学日历')
  })
})
