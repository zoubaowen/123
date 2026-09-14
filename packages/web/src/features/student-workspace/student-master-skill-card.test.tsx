import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { getStudentCapability } from './student-capabilities'
import { StudentMasterSkillCard } from './student-master-skill-card'

describe('StudentMasterSkillCard', () => {
  it('shows the child-friendly seven-stage workflow', () => {
    const markup = renderToStaticMarkup(<StudentMasterSkillCard capability={getStudentCapability('image')} />)

    expect(markup).toContain('小宝绘画大师')
    expect(markup).toContain('理解想法')
    expect(markup).toContain('制定方案')
    expect(markup).toContain('开始创作')
    expect(markup).toContain('作品体检')
    expect(markup).toContain('认真修改')
    expect(markup).toContain('交付作品')
    expect(markup).toContain('学习复盘')
  })

  it('shows video confirmation gates and honest tool state', () => {
    const markup = renderToStaticMarkup(<StudentMasterSkillCard capability={getStudentCapability('video')} />)

    expect(markup).toContain('角色参考图')
    expect(markup).toContain('九宫格分镜')
    expect(markup).toContain('火山引擎视频生成待接入')
  })

  it('does not claim that planned music audio is complete', () => {
    const markup = renderToStaticMarkup(<StudentMasterSkillCard capability={getStudentCapability('music')} />)

    expect(markup).toContain('音乐生成服务待选择')
    expect(markup).not.toContain('已生成音频')
  })
})
