// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherStudentRoster } from './teacher-student-roster'
import type { TeacherStudentSummary } from './types'

afterEach(cleanup)

function students(): TeacherStudentSummary[] {
  return [
    {
      id: 'student-1',
      name: '陈小雨',
      status: 'creating',
      completedTasks: 2,
      totalTasks: 4,
      lastActiveAt: '刚刚',
    },
  ]
}

describe('TeacherStudentRoster', () => {
  it('shows the roster without management controls for a plain teacher', () => {
    render(<TeacherStudentRoster students={students()} />)

    expect(screen.getByText('陈小雨')).toBeTruthy()
    // 普通老师加不了也移不了学生：按钮不该出现，避免点了才知道没权限
    expect(screen.queryByRole('button', { name: '加入学生' })).toBeNull()
    expect(screen.queryByRole('button', { name: '移出 陈小雨' })).toBeNull()
  })

  it('adds a student picked from the institution search', async () => {
    const onSearch = vi.fn(async () => [{ id: 'student-9', name: '周星宇', username: 'zhouy' }])
    const onAdd = vi.fn(async () => true)
    render(<TeacherStudentRoster students={students()} canManage onSearch={onSearch} onAdd={onAdd} />)

    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.change(screen.getByLabelText('搜索学生'), { target: { value: '周' } })

    await waitFor(() => expect(onSearch).toHaveBeenCalledWith('周'))
    fireEvent.click(await screen.findByRole('button', { name: /周星宇/ }))

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('student-9'))
  })

  it('keeps the search open when the backend refuses the new student', async () => {
    const onSearch = vi.fn(async () => [{ id: 'student-9', name: '周星宇', username: 'zhouy' }])
    const onAdd = vi.fn(async () => false)
    render(<TeacherStudentRoster students={students()} canManage onSearch={onSearch} onAdd={onAdd} />)

    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.change(screen.getByLabelText('搜索学生'), { target: { value: '周' } })
    fireEvent.click(await screen.findByRole('button', { name: /周星宇/ }))

    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    // 失败还关掉窗口，用户既看不到提示也不知道没加上
    expect(screen.getByLabelText('搜索学生')).toBeTruthy()
  })

  it('tells the truth when the search cannot reach the backend', async () => {
    const onSearch = vi.fn(async () => null)
    render(<TeacherStudentRoster students={students()} canManage onSearch={onSearch} onAdd={vi.fn(async () => true)} />)

    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.change(screen.getByLabelText('搜索学生'), { target: { value: '周' } })

    expect(await screen.findByText('没有查到学生，请稍后再试')).toBeTruthy()
  })

  it('removes a student through the backend action', async () => {
    const onRemove = vi.fn(async () => true)
    render(<TeacherStudentRoster students={students()} canManage onRemove={onRemove} />)

    fireEvent.click(screen.getByRole('button', { name: '移出 陈小雨' }))

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith('student-1'))
  })

  it('shows placeholders instead of zeroes for counters the backend does not provide', () => {
    // 接口只给姓名与入班时间时，不能显示成"任务完成 0/0、最近活跃 空"——那会被读成学生什么都没做
    render(<TeacherStudentRoster students={[{ id: 'student-1', name: '陈小雨' }]} />)

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('0/0')).toBeNull()
  })
})
