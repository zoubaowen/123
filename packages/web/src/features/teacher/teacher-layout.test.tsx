import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherLayout } from './teacher-layout'

describe('TeacherLayout', () => {
  it('shows teacher navigation without student or platform operations', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherLayout />
      </MemoryRouter>,
    )

    expect(markup).toContain('教学首页')
    expect(markup).toContain('班级管理')
    expect(markup).toContain('课程中心')
    expect(markup).toContain('作业与作品')
    expect(markup).toContain('学生管理')
    expect(markup).toContain('课堂记录')
    expect(markup).not.toContain('运行环境')
    expect(markup).not.toContain('系统日志')
    expect(markup).not.toContain('学生创作工具')
  })
})
