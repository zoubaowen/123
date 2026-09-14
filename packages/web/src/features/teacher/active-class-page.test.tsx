import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ActiveClassPage } from './active-class-page'
import { teacherDashboardDemo } from './demo-data'
import { startClass } from './teacher-store'
import { TeacherWorkspaceProvider } from './teacher-provider'

describe('ActiveClassPage', () => {
  it('展示老师上课时需要掌握的实时课堂信息', () => {
    const activeData = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 80,
      capabilities: ['chat', 'image'],
      skills: ['创意海报助手'],
      mcpServers: ['安全素材库'],
    })

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherWorkspaceProvider initialData={activeData}>
          <ActiveClassPage />
        </TeacherWorkspaceProvider>
      </MemoryRouter>,
    )

    expect(markup).toContain('课堂进行中')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('让太空校园海报动起来')
    expect(markup).toContain('学生在线情况')
    expect(markup).toContain('本节课 AI 能力')
    expect(markup).toContain('结束课堂')
    expect(markup).toContain('href="/teacher/students?classId=creative-2a"')
    expect(markup).toContain('href="/teacher/students?classId=creative-2a&amp;status=needs_attention"')
  })
})
