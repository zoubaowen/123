// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClassTeachersDialog } from './class-teachers-dialog'
import type { ClassTeacherRecord, TeacherMemberOption } from './types'

afterEach(cleanup)

function teachers(): ClassTeacherRecord[] {
  return [
    { userId: 'teacher-1', name: '李老师', role: 'lead' },
    { userId: 'teacher-2', name: '王助教', role: 'assistant' },
  ]
}

function member(overrides: Partial<TeacherMemberOption> = {}): TeacherMemberOption {
  return { userId: 'teacher-9', name: '周老师', username: 'zhou', role: 'teacher', ...overrides }
}

function renderDialog(
  onAssign: (userId: string, role: 'lead' | 'assistant') => Promise<boolean>,
  onRemove: (userId: string) => Promise<boolean> = vi.fn(async () => true),
  onSearch: (query: string) => Promise<TeacherMemberOption[] | null> = vi.fn(async () => []),
) {
  const onOpenChange = vi.fn()
  render(
    <ClassTeachersDialog
      open
      teachers={teachers()}
      onOpenChange={onOpenChange}
      onSearch={onSearch}
      onAssign={onAssign}
      onRemove={onRemove}
    />,
  )
  return { onOpenChange }
}

describe('ClassTeachersDialog', () => {
  it('lists the assigned teachers with their roles', () => {
    renderDialog(vi.fn(async () => true))

    expect(screen.getByText('李老师')).toBeTruthy()
    expect(screen.getByText('主班老师')).toBeTruthy()
    expect(screen.getByText('协助老师')).toBeTruthy()
  })

  it('assigns a teacher picked from the institution search as an assistant', async () => {
    const onSearch = vi.fn(async () => [member()])
    const onAssign = vi.fn(async () => true)
    const { onOpenChange } = renderDialog(
      onAssign,
      vi.fn(async () => true),
      onSearch,
    )

    fireEvent.click(screen.getByRole('button', { name: '分配老师' }))
    fireEvent.change(screen.getByLabelText('搜索老师'), { target: { value: '周' } })
    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('周'))

    fireEvent.click(screen.getByRole('radio', { name: '协助老师' }))
    fireEvent.click(await screen.findByRole('button', { name: /周老师/ }))

    await waitFor(() => expect(onAssign).toHaveBeenCalledWith('teacher-9', 'assistant'))
    // 成功后回到名单视图：一个班常常要连加几位老师，不必每次重开对话框
    await waitFor(() => expect(screen.queryByLabelText('搜索老师')).toBeNull())
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('keeps the search open when the assignment is refused', async () => {
    const onSearch = vi.fn(async () => [member()])
    const onAssign = vi.fn(async () => false)
    renderDialog(
      onAssign,
      vi.fn(async () => true),
      onSearch,
    )

    fireEvent.click(screen.getByRole('button', { name: '分配老师' }))
    fireEvent.change(screen.getByLabelText('搜索老师'), { target: { value: '周' } })
    fireEvent.click(await screen.findByRole('button', { name: /周老师/ }))

    await waitFor(() => expect(onAssign).toHaveBeenCalled())
    // 失败还关掉窗口，管理员既看不到提示也不知道没分配上
    expect(screen.getByLabelText('搜索老师')).toBeTruthy()
  })

  it('tells the truth when the search cannot reach the backend', async () => {
    const onSearch = vi.fn(async () => null)
    renderDialog(
      vi.fn(async () => true),
      vi.fn(async () => true),
      onSearch,
    )

    fireEvent.click(screen.getByRole('button', { name: '分配老师' }))
    fireEvent.change(screen.getByLabelText('搜索老师'), { target: { value: '周' } })

    expect(await screen.findByText('没有查到机构成员，请稍后再试')).toBeTruthy()
  })

  it('removes an assignment through the backend action', async () => {
    const onRemove = vi.fn(async () => true)
    renderDialog(
      vi.fn(async () => true),
      onRemove,
    )

    fireEvent.click(screen.getByRole('button', { name: '解除 李老师' }))

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('teacher-1'))
  })
})
