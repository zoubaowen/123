import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StudentCoursePanel } from './student-course-panel'

describe('StudentCoursePanel', () => {
  it('shows three actionable student courses with progress and next tasks', () => {
    const markup = renderToStaticMarkup(<StudentCoursePanel onContinue={() => undefined} />)
    expect(markup).toContain('AI 绘画入门')
    expect(markup).toContain('小游戏制作')
    expect(markup).toContain('故事写作')
    expect(markup).toContain('学习进度')
    expect(markup).toContain('下一步')
    expect(markup.match(/继续学习/g)).toHaveLength(3)
  })
})
