import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudentResourcePanel } from './student-resource-panel'

describe('StudentResourcePanel', () => {
  it('shows project and asset tabs with an honest empty state', () => {
    const markup = renderToStaticMarkup(<StudentResourcePanel />)

    expect(markup).toContain('项目文件')
    expect(markup).toContain('创作素材')
    expect(markup).toContain('作品还没有文件')
    expect(markup).toContain('开始创作后')
    expect(markup).not.toContain('demo.png')
    expect(markup).not.toContain('project.tsx')
  })

  it('labels resource actions as upcoming instead of pretending they work', () => {
    const markup = renderToStaticMarkup(<StudentResourcePanel />)

    expect(markup).toContain('整理素材')
    expect(markup).toContain('即将开放')
    expect(markup).toContain('aria-label="打开项目与素材面板"')
  })

  it('includes honest course resources and mobile drawer controls', () => {
    const markup = renderToStaticMarkup(<StudentResourcePanel />)

    expect(markup).toContain('课程资料')
    expect(markup).toContain('课程资料正在准备中')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('关闭项目与素材面板')
  })
})
