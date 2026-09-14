import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherWorkspaceProvider } from './teacher-provider'
import { TeacherStudentsPage } from './teacher-students-page'

describe('TeacherStudentsPage', () => {
  it('renders cross-class metrics, filters and student learning summaries', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherWorkspaceProvider>
          <TeacherStudentsPage />
        </TeacherWorkspaceProvider>
      </MemoryRouter>,
    )

    expect(markup).toContain('学生管理')
    expect(markup).toContain('学生总数')
    expect(markup).toContain('搜索学生姓名')
    expect(markup).toContain('陈小雨')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('查看学习概况')
  })

  it('applies class and attention filters from the URL', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/students?classId=game-4b&status=needs_attention']}>
        <TeacherWorkspaceProvider>
          <TeacherStudentsPage />
        </TeacherWorkspaceProvider>
      </MemoryRouter>,
    )
    expect(markup).toContain('吴思远')
    expect(markup).not.toContain('王一诺')
  })
})
