import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { StudentWorkspace } from './student-workspace'

describe('StudentWorkspace', () => {
  it('combines the creation stage and project resource panel', () => {
    const markup = renderToStaticMarkup(
      <StudentWorkspace
        composer={<div>原有任务创作表单</div>}
        onPromptChange={() => undefined}
        onMasterSkillChange={() => undefined}
        onCapabilityChange={() => undefined}
      />,
    )

    expect(markup).toContain('学生创作区')
    expect(markup).toContain('原有任务创作表单')
    expect(markup).toContain('项目与素材')
    expect(markup).toContain('我的创作空间')
  })

  it('fills the existing composer with the selected student journey prompt', () => {
    const onPromptChange = vi.fn()
    const onMasterSkillChange = vi.fn()
    const onCapabilityChange = vi.fn()
    const tree = StudentWorkspace({
      composer: <div />,
      onPromptChange,
      onMasterSkillChange,
      onCapabilityChange,
    }) as ReactElement<{ children: ReactElement<{ onCapabilitySelect: (id: 'game') => void }>[] }>
    const stage = tree.props.children[0]

    stage.props.onCapabilitySelect('game')

    expect(onPromptChange).toHaveBeenCalledOnce()
    expect(onPromptChange).toHaveBeenCalledWith(expect.stringContaining('小游戏'))
    expect(onMasterSkillChange).toHaveBeenCalledOnce()
    expect(onMasterSkillChange).toHaveBeenCalledWith('scratch-game-coach')
    expect(onCapabilityChange).toHaveBeenCalledOnce()
    expect(onCapabilityChange).toHaveBeenCalledWith('game')
  })
})
