// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminUsersPage } from './users-page'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), success: vi.fn(), error: vi.fn() }))

vi.mock('../../lib/api', () => ({ api: { get: mocks.get, post: mocks.post } }))
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }))

afterEach(cleanup)

const student = {
  id: 'student-1',
  username: 'student-1',
  email: null,
  role: 'user' as const,
  status: 'active' as const,
  provider: 'local',
  createdAt: 1700000000000,
  lastLoginAt: 1700000000000,
  envId: null,
  envStatus: null,
  credentialType: null,
  apiKey: null,
  xiaobaoCreditLimit: 120,
}

function renderPage() {
  render(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>,
  )
}

describe('admin users page budget wiring', () => {
  beforeEach(() => {
    mocks.get.mockReset()
    mocks.post.mockReset()
    mocks.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/admin/users?')) return { users: [student], pagination: { totalPages: 1 } }
      if (url === '/api/admin/users/student-1/budget') return { creditLimit: 120, settledCredits: 42 }
      throw new Error('unexpected request')
    })
  })

  it('shows the configured cap in the user table', async () => {
    renderPage()

    expect(await screen.findByText('120 点')).toBeTruthy()
  })

  it('opens the budget dialog from the row action and loads that student budget', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '额度' }))

    expect(await screen.findByText('当前上限 120 点')).toBeTruthy()
    expect(screen.getByText('已用 42 点')).toBeTruthy()
    expect(mocks.get).toHaveBeenCalledWith('/api/admin/users/student-1/budget')
  })
})
