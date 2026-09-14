import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherCoursesPage } from './teacher-courses-page'

describe('TeacherCoursesPage', () => {
  it('displays the course center, both courses, total lessons, and course actions by default', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherCoursesPage />
      </MemoryRouter>,
    )

    expect(markup).toContain('课程中心')
    expect(markup).toContain('AI 太空海报创作营')
    expect(markup).toContain('弹跳球游戏设计')
    expect(markup).toContain('aria-label="总课时：8课时"')
    expect(markup).toContain('查看课程')
  })

  it('offers a clear action without course actions when no course matches the initial query', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherCoursesPage initialQuery="不存在" />
      </MemoryRouter>,
    )

    expect(markup).toContain('没有找到课程')
    expect(markup).toContain('清除筛选')
    expect(markup).not.toContain('查看课程')
  })

  it('offers a new-course entry for institution administrators', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherCoursesPage />
      </MemoryRouter>,
    )

    // 没有这个入口，机构管理员就只能靠接口建课包，"无课可开"的缺口在界面上补不上
    expect(markup).toContain('新建课包')
  })

  it('keeps each character cover fully visible instead of cropping the artwork', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherCoursesPage />
      </MemoryRouter>,
    )

    const cover = markup.match(/<img[^>]+alt="AI 太空海报创作营课程封面"[^>]*>/)?.[0]

    expect(cover).toContain('object-contain')
    expect(cover).not.toContain('object-cover')
  })
})
