import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherClassesPage } from './teacher-classes-page'

describe('TeacherClassesPage', () => {
  it('展示班级指标和全部负责班级', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherClassesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('班级管理')
    expect(markup).toContain('44')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('四年级游戏 B 班')
    expect(markup).toContain('查看班级')
  })

  it('在筛选无结果时提供清除入口', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherClassesPage initialQuery="不存在" />
      </MemoryRouter>,
    )

    expect(markup).toContain('没有找到班级')
    expect(markup).toContain('清除筛选')
    expect(markup).not.toContain('二年级创作 A 班')
  })

  it('提供新建班级入口', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherClassesPage />
      </MemoryRouter>,
    )

    // 没有这个入口，机构管理员就只能靠 curl 建班，浏览器验收走不通
    expect(markup).toContain('新建班级')
  })
})
