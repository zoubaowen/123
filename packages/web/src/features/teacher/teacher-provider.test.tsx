// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TeacherWorkspaceProvider, useTeacherWorkspace } from './teacher-provider'
import type { TeacherWorkspaceSource } from './teacher-workspace-source'

afterEach(cleanup)

function Probe() {
  const { data } = useTeacherWorkspace()
  return (
    <div>
      <p data-testid="institution">{data.institutionName}</p>
      <p data-testid="classes">{data.classes.map((item) => item.name).join(',')}</p>
    </div>
  )
}

function readySource(institutionName: string, className: string): TeacherWorkspaceSource {
  return {
    persistsWrites: true,
    async load() {
      return {
        status: 'ready',
        data: {
          institutionName,
          teacherName: '李老师',
          classes: [{ id: 'c1', name: className, studentCount: 26, courseTitle: '课程', progress: 25 }],
          lessons: [],
          courses: [],
          todaySchedule: [],
          pendingReviews: [],
          works: [],
          recentSessions: [],
          activeSession: null,
          classDetails: [],
        },
      }
    },
  }
}

describe('TeacherWorkspaceProvider with an API source', () => {
  it('renders the data returned by the source, not the demo data', async () => {
    render(
      <TeacherWorkspaceProvider source={readySource('真实机构', '真实班级')}>
        <Probe />
      </TeacherWorkspaceProvider>,
    )

    expect(await screen.findByTestId('institution')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('institution').textContent).toBe('真实机构'))
    expect(screen.getByTestId('classes').textContent).toBe('真实班级')
    // 演示班级不能出现在真实数据下
    expect(screen.queryByText('二年级创作 A 班')).toBeNull()
  })

  it('shows an empty state instead of demo data when the caller has no institution', async () => {
    render(
      <TeacherWorkspaceProvider
        source={{
          persistsWrites: true,
          async load() {
            return { status: 'no-institution' }
          },
        }}
      >
        <Probe />
      </TeacherWorkspaceProvider>,
    )

    expect(await screen.findByText('尚未加入任何机构')).toBeTruthy()
    // 关键：这时绝不能退回演示数据
    expect(screen.queryByTestId('classes')).toBeNull()
    expect(screen.queryByText(/二年级创作 A 班/)).toBeNull()
  })

  it('shows a retryable error state when the workspace cannot be loaded', async () => {
    const load = vi.fn(async () => ({ status: 'error' as const }))
    render(
      <TeacherWorkspaceProvider source={{ persistsWrites: true, load }}>
        <Probe />
      </TeacherWorkspaceProvider>,
    )

    expect(await screen.findByText('教学工作区加载失败')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新加载' })).toBeTruthy()
  })

  it('renders the demo data synchronously when no source is given', () => {
    render(
      <TeacherWorkspaceProvider>
        <Probe />
      </TeacherWorkspaceProvider>,
    )

    expect(screen.getByTestId('institution').textContent).toBe('星河青少年创新中心')
    expect(screen.getByTestId('classes').textContent).toContain('二年级创作 A 班')
  })
})
