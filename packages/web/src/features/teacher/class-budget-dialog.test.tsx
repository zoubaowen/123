// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUDGET_INVALID, ClassBudgetDialog } from './class-budget-dialog'

afterEach(cleanup)

function renderDialog(creditLimit: number | null, onSave: (value: number | null) => Promise<boolean>) {
  const onOpenChange = vi.fn()
  render(<ClassBudgetDialog open creditLimit={creditLimit} onOpenChange={onOpenChange} onSave={onSave} />)
  return { onOpenChange }
}

describe('ClassBudgetDialog', () => {
  it('shows the current cap and saves a positive integer', async () => {
    const onSave = vi.fn(async () => true)
    const { onOpenChange } = renderDialog(300, onSave)

    expect((screen.getByLabelText('额度上限') as HTMLInputElement).value).toBe('300')

    fireEvent.change(screen.getByLabelText('额度上限'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: '保存额度' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(500))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('clears the cap only through the explicit clear action', async () => {
    const onSave = vi.fn(async () => true)
    renderDialog(300, onSave)

    // 输入框留空再点"保存"不能等于清空上限：那是误操作，不是本意
    fireEvent.change(screen.getByLabelText('额度上限'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存额度' }))
    expect(await screen.findByText(BUDGET_INVALID)).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '清除上限' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
  })

  it('rejects zero, negative and fractional caps before hitting the backend', async () => {
    const onSave = vi.fn(async () => true)
    renderDialog(null, onSave)

    for (const value of ['0', '-5', '1.5', 'abc']) {
      fireEvent.change(screen.getByLabelText('额度上限'), { target: { value } })
      fireEvent.click(screen.getByRole('button', { name: '保存额度' }))
      expect(await screen.findByText(BUDGET_INVALID)).toBeTruthy()
    }

    // 这些值会被运行时读取器判为配置错误，从而拒绝学生开始任务：必须在写入口挡住
    expect(onSave).not.toHaveBeenCalled()
  })

  it('stays open when the backend refuses the new cap', async () => {
    const onSave = vi.fn(async () => false)
    const { onOpenChange } = renderDialog(null, onSave)

    fireEvent.change(screen.getByLabelText('额度上限'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: '保存额度' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(500))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect((screen.getByLabelText('额度上限') as HTMLInputElement).value).toBe('500')
  })
})
