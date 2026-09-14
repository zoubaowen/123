import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherWorkspaceProvider } from './teacher-provider'
import { TeacherWorksPage } from './teacher-works-page'

describe('TeacherWorksPage', () => {
  it('renders review metrics, filters and complete artwork previews', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherWorkspaceProvider>
          <TeacherWorksPage />
        </TeacherWorkspaceProvider>
      </MemoryRouter>,
    )

    expect(markup).toContain('作业与作品')
    expect(markup).toContain('待点评')
    expect(markup).toContain('搜索作品或学生')
    expect(markup).toContain('月球上的未来学校')
    expect(markup).toContain('object-contain')
    expect(markup).toContain('点评作品')
  })
})
