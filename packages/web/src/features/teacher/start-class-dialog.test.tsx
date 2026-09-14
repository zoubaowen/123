import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Dialog } from '@/components/ui/dialog'
import { StartClassPanel, createDefaultStartClassInput } from './start-class-dialog'
import { teacherDashboardDemo } from './demo-data'

describe('StartClassDialog', () => {
  it('为今日课程准备安全的默认课堂配置', () => {
    const input = createDefaultStartClassInput(teacherDashboardDemo.todaySchedule[0])

    expect(input).toEqual({
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 80,
      capabilities: ['chat', 'image'],
      skills: ['创意海报助手', '学习任务拆解'],
      mcpServers: ['安全素材库'],
    })
  })

  it('展示老师开课前需要确认的能力与资源', () => {
    const input = createDefaultStartClassInput(teacherDashboardDemo.todaySchedule[0])
    const markup = renderToStaticMarkup(
      <Dialog>
        <StartClassPanel
          className="二年级创作 A 班"
          lessonTitle="让太空校园海报动起来"
          value={input}
          onChange={() => undefined}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </Dialog>,
    )

    expect(markup).toContain('开始上课')
    expect(markup).toContain('本节课允许的 AI 能力')
    expect(markup).toContain('图片生成')
    expect(markup).toContain('课堂 Skills')
    expect(markup).toContain('MCP 资源')
    expect(markup).toContain('确认开始上课')
  })
})
