// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CREATE_CLASS_NAME_REQUIRED, CREATE_CLASS_NAME_TOO_LONG, CreateClassDialog } from './create-class-dialog'

afterEach(cleanup)

function renderDialog(onCreate: (input: { name: string; aiUsageMode: 'class_only' | 'anytime' }) => Promise<boolean>) {
  const onOpenChange = vi.fn()
  render(<CreateClassDialog open onOpenChange={onOpenChange} onCreate={onCreate} />)
  return { onOpenChange }
}

describe('CreateClassDialog', () => {
  it('creates a class with the trimmed name and the selected AI usage mode', async () => {
    const onCreate = vi.fn(async () => true)
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '  三年级编程 C 班  ' } })
    fireEvent.click(screen.getByLabelText('随时可用'))
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: '三年级编程 C 班', aiUsageMode: 'anytime' }))
    // 只有成功才关闭对话框
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('defaults to "仅上课可用" so a new class does not silently open AI after school', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog(onCreate)

    expect((screen.getByLabelText('仅上课可用') as HTMLInputElement).checked).toBe(true)
    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '默认模式班' } })
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: '默认模式班', aiUsageMode: 'class_only' }))
  })

  it('rejects an empty or over-long name without calling the backend', async () => {
    const onCreate = vi.fn(async () => true)
    renderDialog(onCreate)

    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))
    expect(await screen.findByText(CREATE_CLASS_NAME_REQUIRED)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))
    expect(await screen.findByText(CREATE_CLASS_NAME_REQUIRED)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '班'.repeat(81) } })
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))
    expect(await screen.findByText(CREATE_CLASS_NAME_TOO_LONG)).toBeTruthy()

    expect(onCreate).not.toHaveBeenCalled()
  })

  it('stays open with the typed name when the backend refuses', async () => {
    const onCreate = vi.fn(async () => false)
    const { onOpenChange } = renderDialog(onCreate)

    fireEvent.change(screen.getByLabelText('班级名称'), { target: { value: '会被拒绝的班' } })
    fireEvent.click(screen.getByRole('button', { name: '创建班级' }))

    await waitFor(() => expect(onCreate).toHaveBeenCalled())
    expect(onOpenChange).not.toHaveBeenCalled()
    // 内容必须还在：否则用户要重新输入，还不知道刚才失败在哪一步
    expect((screen.getByLabelText('班级名称') as HTMLInputElement).value).toBe('会被拒绝的班')
  })
})
