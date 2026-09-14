import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { endClass, startClass, updateActiveClassSettings } from './teacher-store'

describe('teacher classroom state', () => {
  it('starts the selected lesson with explicit classroom capabilities', () => {
    const next = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 120,
      capabilities: ['chat', 'image'],
      skills: ['poster-designer'],
      mcpServers: ['safe-image-library'],
    })

    expect(next.activeSession?.className).toBe('二年级创作 A 班')
    expect(next.activeSession?.lessonTitle).toBe('让太空校园海报动起来')
    expect(next.activeSession?.capabilities).toEqual(['chat', 'image'])
  })

  it('refuses to replace a classroom that is already active', () => {
    const started = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 120,
      capabilities: ['chat'],
      skills: [],
      mcpServers: [],
    })

    expect(() =>
      startClass(started, {
        classId: 'game-4b',
        lessonId: 'bounce-game-02',
        pointLimit: 80,
        capabilities: ['chat', 'code'],
        skills: ['game-builder'],
        mcpServers: [],
      }),
    ).toThrow('已有课堂正在进行')
  })

  it('ends the active class and appends one classroom record', () => {
    const started = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 120,
      capabilities: ['chat'],
      skills: [],
      mcpServers: [],
    })

    const ended = endClass(started)

    expect(ended.activeSession).toBeNull()
    expect(ended.recentSessions).toHaveLength(teacherDashboardDemo.recentSessions.length + 1)
    expect(ended.recentSessions[0].className).toBe('二年级创作 A 班')
    expect(ended.recentSessions[0]).toMatchObject({
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      studentCount: 24,
      pointLimit: 120,
      capabilities: ['chat'],
    })
  })
})

it('updates active classroom capabilities and point limit safely', () => {
  const started = startClass(teacherDashboardDemo, {
    classId: 'creative-2a',
    lessonId: 'space-poster-03',
    pointLimit: 80,
    capabilities: ['chat'],
    skills: [],
    mcpServers: [],
  })
  const next = updateActiveClassSettings(started, { pointLimit: 120, capabilities: ['chat', 'image'] })
  expect(next.activeSession).toMatchObject({ pointLimit: 120, capabilities: ['chat', 'image'] })
  expect(() => updateActiveClassSettings(started, { pointLimit: 120, capabilities: ['image'] })).toThrow(
    '课堂必须保留 AI 对话能力',
  )
})
