// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminInstitutionsPage } from './institutions-page'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  delete: vi.fn(async () => ({})),
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock('../../lib/api', () => ({
  api: { get: mocks.get, post: mocks.post, patch: mocks.patch, delete: mocks.delete },
}))
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))

afterEach(cleanup)

function institutions() {
  return [
    { id: 'i1', name: '示例机构', status: 'active' },
    { id: 'i2', name: '第二个机构', status: 'archived' },
  ]
}

beforeEach(() => {
  mocks.get.mockReset()
  mocks.post.mockReset()
  mocks.patch.mockReset()
  mocks.delete.mockReset()
  mocks.error.mockReset()
  mocks.success.mockReset()
  mocks.post.mockResolvedValue({})
  mocks.patch.mockResolvedValue({})
  mocks.delete.mockResolvedValue({})
  mocks.get.mockImplementation(async (url: string) => {
    if (url === '/api/admin/institutions') return { institutions: institutions() }
    if (url === '/api/admin/institutions/i1/members') {
      return { members: [{ id: 'm1', institutionId: 'i1', userId: 'teacher-1', role: 'teacher', status: 'active' }] }
    }
    if (url === '/api/admin/users/lookup?username=teacher-li') {
      return { user: { id: 'teacher-1', username: 'teacher-li', name: '李老师', role: 'user', status: 'active' } }
    }
    throw Object.assign(new Error('not found'), { status: 404 })
  })
})

describe('AdminInstitutionsPage', () => {
  it('lists the platform institutions', async () => {
    render(<AdminInstitutionsPage />)

    expect(await screen.findByText('示例机构')).toBeTruthy()
    expect(screen.getByText('第二个机构')).toBeTruthy()
    expect(screen.getByText('已归档')).toBeTruthy()
  })

  it('reports a failed load instead of showing an empty platform', async () => {
    mocks.get.mockRejectedValue(Object.assign(new Error('boom'), { status: 503 }))

    render(<AdminInstitutionsPage />)

    expect(await screen.findByText('机构列表读取失败，请稍后重试')).toBeTruthy()
  })

  it('creates an institution with the trimmed name', async () => {
    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')

    fireEvent.click(screen.getByRole('button', { name: '新建机构' }))
    fireEvent.change(screen.getByLabelText('机构名称'), { target: { value: '  新区校区  ' } })
    fireEvent.click(screen.getByRole('button', { name: '创建机构' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith('/api/admin/institutions', { name: '新区校区' }))
    expect(mocks.success).toHaveBeenCalled()
  })

  it('rejects an empty or over-long institution name without calling the backend', async () => {
    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')

    fireEvent.click(screen.getByRole('button', { name: '新建机构' }))
    fireEvent.click(screen.getByRole('button', { name: '创建机构' }))
    expect(await screen.findByText('请填写机构名称')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('机构名称'), { target: { value: '机'.repeat(81) } })
    fireEvent.click(screen.getByRole('button', { name: '创建机构' }))
    expect(await screen.findByText('机构名称不能超过 80 个字')).toBeTruthy()

    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('adds a member by account with the chosen role', async () => {
    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')

    fireEvent.click(screen.getByRole('button', { name: '成员 示例机构' }))
    expect(await screen.findByText('teacher-1')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'teacher-li' } })
    fireEvent.change(screen.getByLabelText('机构角色'), { target: { value: 'teacher' } })
    fireEvent.click(screen.getByRole('button', { name: '加入机构' }))

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/admin/institutions/i1/members', {
        userId: 'teacher-1',
        role: 'teacher',
      }),
    )
  })

  it('tells the truth when the account cannot be found', async () => {
    mocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/admin/institutions') return { institutions: institutions() }
      if (url === '/api/admin/institutions/i1/members') return { members: [] }
      throw Object.assign(new Error('not found'), { status: 404 })
    })

    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')
    fireEvent.click(screen.getByRole('button', { name: '成员 示例机构' }))

    fireEvent.change(await screen.findByLabelText('账号'), { target: { value: 'missing-user' } })
    fireEvent.click(screen.getByRole('button', { name: '加入机构' }))

    expect(await screen.findByText('没有找到这个账号')).toBeTruthy()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('reports an existing membership instead of silently overwriting the role', async () => {
    mocks.post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))

    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')
    fireEvent.click(screen.getByRole('button', { name: '成员 示例机构' }))

    fireEvent.change(await screen.findByLabelText('账号'), { target: { value: 'teacher-li' } })
    fireEvent.click(screen.getByRole('button', { name: '加入机构' }))

    expect(await screen.findByText('该用户已经是这个机构的成员')).toBeTruthy()
  })

  it('changes a member role in place', async () => {
    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')
    fireEvent.click(screen.getByRole('button', { name: '成员 示例机构' }))
    await screen.findByText('teacher-1')

    fireEvent.change(screen.getByLabelText('成员角色 teacher-1'), { target: { value: 'admin' } })

    await waitFor(() =>
      expect(mocks.patch).toHaveBeenCalledWith('/api/admin/institutions/i1/members/teacher-1', { role: 'admin' }),
    )
  })

  it('removes a member and reports the failure honestly when it cannot', async () => {
    render(<AdminInstitutionsPage />)
    await screen.findByText('示例机构')
    fireEvent.click(screen.getByRole('button', { name: '成员 示例机构' }))
    await screen.findByText('teacher-1')

    fireEvent.click(screen.getByRole('button', { name: '移除 teacher-1' }))

    await waitFor(() => expect(mocks.delete).toHaveBeenCalledWith('/api/admin/institutions/i1/members/teacher-1'))

    mocks.delete.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }))
    fireEvent.click(screen.getByRole('button', { name: '移除 teacher-1' }))

    expect(await screen.findByText('保存失败，请稍后重试')).toBeTruthy()
  })
})
