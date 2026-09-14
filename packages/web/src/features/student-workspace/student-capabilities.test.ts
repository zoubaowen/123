import { describe, expect, it } from 'vitest'
import { STUDENT_CAPABILITIES, getStudentCapability } from './student-capabilities'

describe('student creation capabilities', () => {
  it('offers the six student creation journeys in a stable order', () => {
    expect(STUDENT_CAPABILITIES.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'image', title: '画一张图' },
      { id: 'video', title: '做一段视频' },
      { id: 'music', title: '创作音乐' },
      { id: 'game', title: '做小游戏' },
      { id: 'writing', title: '写作表达' },
      { id: 'study', title: '学习辅导' },
    ])
  })

  it('gives every journey enough information to render and start a creation', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      expect(capability.description.trim()).not.toBe('')
      expect(capability.prompt.trim()).not.toBe('')
      expect(capability.icon).toMatch(/^[A-Z][A-Za-z]+$/)
      expect(capability.accent).toMatch(/^(violet|sky|amber|emerald|rose|indigo)$/)
      expect(capability.status).toBe('available')
    }
  })

  it('guides learning without directly giving students the answer', () => {
    const study = getStudentCapability('study')

    expect(study.prompt).toContain('先提问')
    expect(study.prompt).toContain('分步引导')
    expect(study.prompt).toContain('不要直接给出答案')
  })

  it('maps every shortcut to one built-in master skill', () => {
    expect(Object.fromEntries(STUDENT_CAPABILITIES.map(({ id, skillName }) => [id, skillName]))).toEqual({
      image: 'student-image-master',
      video: 'student-video-master',
      music: 'student-music-master',
      game: 'scratch-game-coach',
      writing: 'student-writing-coach',
      study: 'student-learning-master',
    })

    expect(new Set(STUDENT_CAPABILITIES.map(({ skillName }) => skillName))).toHaveLength(6)
  })

  it('describes the same seven-stage master workflow for every shortcut', () => {
    for (const capability of STUDENT_CAPABILITIES) {
      expect(capability.masterTitle.trim()).not.toBe('')
      expect(capability.masterDescription.trim()).not.toBe('')
      expect(capability.stages).toEqual(['discover', 'plan', 'produce', 'inspect', 'revise', 'deliver', 'reflect'])
    }

    expect(getStudentCapability('video').toolMessage).toContain('火山引擎')
    expect(getStudentCapability('music').toolMessage).toContain('待选择')
  })

  it('maps each shortcut to the XiaoBao capability it may request', () => {
    expect(
      Object.fromEntries(STUDENT_CAPABILITIES.map(({ id, xiaobaoCapability }) => [id, xiaobaoCapability])),
    ).toEqual({
      image: 'image',
      video: 'video',
      music: null,
      game: 'game',
      writing: 'writing',
      study: 'learning',
    })
  })

  it('keeps the planned media shortcuts and their tool messages unchanged', () => {
    // 入口已映射到小宝能力，但在媒体服务未配置时前端仍走默认通道（由能力清单决定）。
    for (const id of ['video', 'music'] as const) {
      const capability = getStudentCapability(id)
      expect(capability.toolState).toBe('planned')
      expect(capability.toolMessage?.trim()).not.toBe('')
    }
    for (const id of ['image', 'game', 'writing', 'study'] as const) {
      expect(getStudentCapability(id).toolState).toBe('available')
    }
  })
})
