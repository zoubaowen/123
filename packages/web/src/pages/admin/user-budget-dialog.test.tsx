// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UserBudgetDialog } from './user-budget-dialog'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('../../lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

afterEach(cleanup)

const user = { id: 'student-1', username: 'student-1' }

function renderDialog(onSaved = vi.fn()) {
  render(<UserBudgetDialog user={user} open onOpenChange={vi.fn()} onSaved={onSaved} />)
  return onSaved
}

describe('UserBudgetDialog', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.post.mockResolvedValue({ success: true })
  })

  it('shows the stored cap together with how much the student already used', async () => {
    mocks.get.mockResolvedValue({ creditLimit: 120, settledCredits: 42 })

    renderDialog()

    expect(await screen.findByText('当前上限 120 点')).toBeTruthy()
    expect(screen.getByText('已用 42 点')).toBeTruthy()
    expect(mocks.get).toHaveBeenCalledWith('/api/admin/users/student-1/budget')
  })

  it('says the student is unlimited when no cap is configured', async () => {
    mocks.get.mockResolvedValue({ creditLimit: null, settledCredits: 42 })

    renderDialog()

    expect(await screen.findByText('当前未设上限')).toBeTruthy()
  })

  it('does not present unknown usage as zero', async () => {
    mocks.get.mockResolvedValue({ creditLimit: 120, settledCredits: null })

    renderDialog()

    expect(await screen.findByText('已用额度暂时无法确定')).toBeTruthy()
    expect(screen.queryByText('已用 0 点')).toBeNull()
  })

  it('breaks the settled usage down by what the student spent it on', async () => {
    mocks.get.mockResolvedValue({
      creditLimit: 120,
      settledCredits: 42,
      usageByCategory: { model: 30, tool: 5, sandbox: 7, media: 0 },
    })

    renderDialog()

    expect(await screen.findByText('用途明细：模型 30 · 工具 5 · 沙箱 7 · 媒体 0')).toBeTruthy()
  })

  it('does not present an unknown breakdown as all zeros', async () => {
    mocks.get.mockResolvedValue({ creditLimit: 120, settledCredits: null, usageByCategory: null })

    renderDialog()

    expect(await screen.findByText('用途明细暂时无法确定')).toBeTruthy()
  })

  it('refuses a cap that the runtime would treat as misconfigured', async () => {
    mocks.get.mockResolvedValue({ creditLimit: null, settledCredits: 0 })

    renderDialog()
    await screen.findByText('当前未设上限')

    for (const invalid of ['0', '-5', '1.5', 'abc']) {
      fireEvent.change(screen.getByLabelText('额度上限（点）'), { target: { value: invalid } })
      fireEvent.click(screen.getByRole('button', { name: '保存额度' }))

      expect(screen.getByText('请输入大于 0 的整数')).toBeTruthy()
    }
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('saves a positive whole-number cap and reports the save', async () => {
    mocks.get.mockResolvedValue({ creditLimit: null, settledCredits: 10 })
    const onSaved = renderDialog()
    await screen.findByText('当前未设上限')

    fireEvent.change(screen.getByLabelText('额度上限（点）'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: '保存额度' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/admin/users/student-1/budget', { creditLimit: 300 }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('clears the cap when the administrator removes the limit', async () => {
    mocks.get.mockResolvedValue({ creditLimit: 120, settledCredits: 42 })
    const onSaved = renderDialog()
    await screen.findByText('当前上限 120 点')

    fireEvent.click(screen.getByRole('button', { name: '取消限制' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/admin/users/student-1/budget', { creditLimit: null }),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
  })

  it('reports a failed save without claiming the cap changed', async () => {
    mocks.get.mockResolvedValue({ creditLimit: null, settledCredits: 0 })
    mocks.post.mockRejectedValue(new Error('down'))
    const onSaved = renderDialog()
    await screen.findByText('当前未设上限')

    fireEvent.change(screen.getByLabelText('额度上限（点）'), { target: { value: '50' } })
    fireEvent.click(screen.getByRole('button', { name: '保存额度' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('保存额度失败'))
    expect(onSaved).not.toHaveBeenCalled()
  })
})
