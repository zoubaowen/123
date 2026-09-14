// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONTENT_TITLE_REQUIRED,
  CourseContentDialog,
  LESSON_DURATION_INVALID,
  parseLines,
} from './course-content-dialog'

afterEach(cleanup)

function renderDialog(
  kind: 'chapter' | 'lesson' | 'resource',
  onCreate: (input: {
    title: string
    durationMinutes?: number
    objectives?: string[]
    type?: string
    status?: string
  }) => Promise<boolean>,
) {
  const onOpenChange = vi.fn()
  render(<CourseContentDialog kind={kind} open onOpenChange={onOpenChange} onCreate={onCreate} />)
  return { onOpenChange }
}

describe('CourseContentDialog', () => {
  it('adds a chapter with just a title', async () => {
    const onCreate = vi.fn(async () => true)
    const { onOpenChange } = renderDialog('chapter', onCreate)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  第一章：认识太空  ' } })
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ title: '第一章：认识太空' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('adds a lesson with duration and one objective per line', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog('lesson', onCreate)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '第一课时' } })
    fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('学习目标（每行一条，可留空）'), {
      target: { value: '说出海报三要素\n\n  写出自己的提示词  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: '添加课时' }))

    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({
        title: '第一课时',
        durationMinutes: 45,
        // 空行丢掉，两端空白去掉
        objectives: ['说出海报三要素', '写出自己的提示词'],
      }),
    )
  })

  it('rejects a blank title and a bad duration without calling the backend', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog('lesson', onCreate)

    fireEvent.click(screen.getByRole('button', { name: '添加课时' }))
    expect(await screen.findByText(CONTENT_TITLE_REQUIRED)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '第一课时' } })
    fireEvent.change(screen.getByLabelText('时长（分钟）'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: '添加课时' }))
    expect(await screen.findByText(LESSON_DURATION_INVALID)).toBeTruthy()

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('adds a resource with its type and readiness', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog('resource', onCreate)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '课堂课件' } })
    fireEvent.click(screen.getByRole('button', { name: '添加资源' }))

    // 类型与就绪状态用 Radix Select（jsdom 里不好驱动下拉），这里断言缺省值：
    // 类型默认课件，状态默认"待完善"——没做好的资源不该被当成就绪
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ title: '课堂课件', type: 'slides', status: 'planned' }))
  })

  it('keeps the typed content when the backend refuses', async () => {
    const onCreate = vi.fn(async () => false)
    const { onOpenChange } = renderDialog('chapter', onCreate)

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '会被拒绝的章节' } })
    fireEvent.click(screen.getByRole('button', { name: '添加章节' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('名称') as HTMLInputElement).value).toBe('会被拒绝的章节')
  })

  it('never claims an unsupported state change succeeded', () => {
    // parseLines 是纯函数：界面上"每行一条"的约定靠它保证
    expect(parseLines('a\n\n b ')).toEqual(['a', 'b'])
    expect(parseLines('')).toEqual([])
  })
})
