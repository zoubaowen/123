// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { COURSE_TITLE_REQUIRED, CreateCourseDialog } from './create-course-dialog'

afterEach(cleanup)

function renderDialog(onCreate: (input: { title: string; stage: string; topic: string }) => Promise<boolean>) {
  const onOpenChange = vi.fn()
  render(<CreateCourseDialog open onOpenChange={onOpenChange} onCreate={onCreate} />)
  return { onOpenChange }
}

describe('CreateCourseDialog', () => {
  it('creates a course with the trimmed title, stage and topic', async () => {
    const onCreate = vi.fn(async () => true)
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('课包名称'), { target: { value: '  AI 太空海报创作营  ' } })
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '视觉创作' } })
    fireEvent.click(screen.getByRole('button', { name: '创建课包' }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ title: 'AI 太空海报创作营', stage: 'lower_primary', topic: '视觉创作' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('rejects an empty title or topic without calling the backend', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog(onCreate)

    fireEvent.click(screen.getByRole('button', { name: '创建课包' }))
    expect(await screen.findByText(COURSE_TITLE_REQUIRED)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('课包名称'), { target: { value: '有名字的课包' } })
    fireEvent.click(screen.getByRole('button', { name: '创建课包' }))
    expect(await screen.findByText(COURSE_TITLE_REQUIRED)).toBeTruthy()

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('stays open with the typed content when the backend refuses', async () => {
    const onCreate = vi.fn(async () => false)
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('课包名称'), { target: { value: '会被拒绝的课包' } })
    fireEvent.change(screen.getByLabelText('主题'), { target: { value: '视觉创作' } })
    fireEvent.click(screen.getByRole('button', { name: '创建课包' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('课包名称') as HTMLInputElement).value).toBe('会被拒绝的课包')
  })
})
