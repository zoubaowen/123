import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherWorkspaceProvider } from './teacher-provider'
import { teacherDashboardDemo } from './demo-data'
import { TeacherRecordReview, TeacherRecordsPage } from './teacher-records-page'

describe('TeacherRecordsPage', () => {
  it('renders classroom metrics, filters and review actions', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherWorkspaceProvider>
          <TeacherRecordsPage />
        </TeacherWorkspaceProvider>
      </MemoryRouter>,
    )

    expect(markup).toContain('课堂记录')
    expect(markup).toContain('累计课时')
    expect(markup).toContain('搜索课节或班级')
    expect(markup).toContain('设计第一关')
    expect(markup).toContain('查看课堂回顾')
  })

  it('uses explicit dark text for values shown on light review cards', () => {
    const markup = renderToStaticMarkup(<TeacherRecordReview record={teacherDashboardDemo.recentSessions[0]} />)

    expect(markup.match(/text-slate-900/g)).toHaveLength(3)
    expect(markup).toContain('text-emerald-600')
  })
})
