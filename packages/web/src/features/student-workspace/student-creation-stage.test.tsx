import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudentCreationStage } from './student-creation-stage'

describe('StudentCreationStage', () => {
  it('renders Xiaobao, all creation journeys, and the existing composer slot', () => {
    const markup = renderToStaticMarkup(
      <StudentCreationStage onCapabilitySelect={() => undefined} composer={<div>真实创作输入框</div>} />,
    )

    expect(markup).toContain('我是小宝')
    expect(markup).toContain('把你的奇思妙想告诉我')
    expect(markup).toContain('画一张图')
    expect(markup).toContain('做一段视频')
    expect(markup).toContain('创作音乐')
    expect(markup).toContain('做小游戏')
    expect(markup).toContain('写作表达')
    expect(markup).toContain('学习辅导')
    expect(markup).toContain('真实创作输入框')
  })

  it('exposes every journey as an accessible selection button', () => {
    const markup = renderToStaticMarkup(
      <StudentCreationStage onCapabilitySelect={() => undefined} composer={<div />} />,
    )

    expect(markup.match(/<button/g)).toHaveLength(6)
    expect(markup).toContain('aria-label="开始画一张图"')
    expect(markup).toContain('aria-label="开始学习辅导"')
  })

  it('keeps the welcome stage centered while the creation dock stays at the bottom', () => {
    const markup = renderToStaticMarkup(
      <StudentCreationStage onCapabilitySelect={() => undefined} composer={<div />} />,
    )

    expect(markup).toContain('data-student-welcome-stage="true"')
    expect(markup).toContain('data-student-creation-dock="true"')
    expect(markup).toContain('backdrop-blur-xl')
  })
})
