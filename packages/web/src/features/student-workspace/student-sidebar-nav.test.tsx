import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { filterStudentCreations, StudentSidebarNav } from './student-sidebar-nav'

describe('StudentSidebarNav', () => {
  it('presents the academy navigation in student language', () => {
    const markup = renderToStaticMarkup(<StudentSidebarNav recentCreationCount={3} onNewCreation={() => undefined} />)

    expect(markup).toContain('AI小宝学院')
    expect(markup).toContain('新建创作')
    expect(markup).toContain('作品广场')
    expect(markup).toContain('我的课程')
    expect(markup).toContain('成长中心')
    expect(markup).toContain('搜索创作')
    expect(markup).toContain('最近创作')
    expect(markup).toContain('3')
  })

  it('marks unavailable destinations instead of linking to missing pages', () => {
    const markup = renderToStaticMarkup(<StudentSidebarNav recentCreationCount={0} onNewCreation={() => undefined} />)

    expect(markup.match(/即将开放/g)).toHaveLength(1)
    expect(markup).not.toContain('href="/courses"')
    expect(markup).not.toContain('href="/growth"')
  })

  it('offers enabled course and Xiaobao companion sections', () => {
    const markup = renderToStaticMarkup(<StudentSidebarNav recentCreationCount={0} onNewCreation={() => undefined} />)

    expect(markup).toContain('我的课程')
    expect(markup).toContain('小宝伙伴')
    expect(markup).toContain('AI 绘画入门')
    expect(markup).toContain('小游戏制作')
    expect(markup).toContain('故事写作')
    expect(markup).toContain('aria-pressed="false"')
  })
})

describe('student creation search', () => {
  it('matches trimmed keywords against creation titles and prompts without case sensitivity', () => {
    const creations = [
      { title: '太空校园海报', prompt: '设计蓝色星球' },
      { title: '弹跳球 GAME', prompt: '制作得分规则' },
      { title: null, prompt: '写一个校园冒险故事' },
    ]

    expect(filterStudentCreations(creations, '  game ')).toEqual([creations[1]])
    expect(filterStudentCreations(creations, '冒险')).toEqual([creations[2]])
    expect(filterStudentCreations(creations, '   ')).toEqual(creations)
  })

  it('renders the search field as a controlled filter with result context', () => {
    const markup = renderToStaticMarkup(
      <StudentSidebarNav
        recentCreationCount={1}
        onNewCreation={() => undefined}
        searchQuery="太空"
        onSearchQueryChange={() => undefined}
      />,
    )

    expect(markup).toContain('value="太空"')
    expect(markup).toContain('搜索结果')
  })
})
