// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { TeacherCourseDetailPage } from './teacher-course-detail-page'
import { TeacherWorkspaceProvider } from './teacher-provider'

afterEach(cleanup)

function renderCourseDetail(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <TeacherWorkspaceProvider>
        <CourseNavigationControls />
        <Routes>
          <Route path="/teacher/courses/:courseId" element={<TeacherCourseDetailPage />} />
          <Route path="/teacher/courses" element={<p data-testid="course-center">课程中心</p>} />
        </Routes>
      </TeacherWorkspaceProvider>
    </MemoryRouter>,
  )
}

function CourseNavigationControls() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <div>
      <button type="button" onClick={() => navigate('/teacher/courses/space-poster')}>
        前往太空海报课程
      </button>
      <button type="button" onClick={() => navigate('/teacher/courses/bounce-game')}>
        前往弹跳球课程
      </button>
      <output data-testid="location">{location.pathname}</output>
    </div>
  )
}

describe('TeacherCourseDetailPage', () => {
  it('saves changed class assignments, clears feedback, and resets controls when the route switches courses', async () => {
    renderCourseDetail('/teacher/courses/space-poster')

    expect(await screen.findByRole('heading', { name: 'AI 太空海报创作营' })).toBeTruthy()
    expect(screen.getByText('课程目标')).toBeTruthy()
    expect(screen.getByText('让太空校园海报动起来')).toBeTruthy()
    expect(screen.getByText('章节与课时')).toBeTruthy()

    const creativeClass = screen.getByRole('checkbox', { name: '分配给二年级创作 A 班' })
    const gameClass = screen.getByRole('checkbox', { name: '分配给四年级游戏 B 班' })
    expect(creativeClass.getAttribute('data-state')).toBe('checked')
    expect(gameClass.getAttribute('data-state')).toBe('unchecked')

    fireEvent.click(creativeClass)
    fireEvent.click(screen.getByRole('button', { name: '保存本次演示配置' }))
    expect(screen.getByText('本次演示配置已保存')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '前往弹跳球课程' }))
    expect(await screen.findByRole('heading', { name: '弹跳球游戏设计' })).toBeTruthy()
    expect(screen.queryByText('本次演示配置已保存')).toBeNull()
    expect(screen.getByRole('checkbox', { name: '分配给二年级创作 A 班' }).getAttribute('data-state')).toBe('unchecked')
    expect(screen.getByRole('checkbox', { name: '分配给四年级游戏 B 班' }).getAttribute('data-state')).toBe('checked')

    fireEvent.click(screen.getByRole('button', { name: '前往太空海报课程' }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'AI 太空海报创作营' })).toBeTruthy()
    })
    expect(screen.getByRole('checkbox', { name: '分配给二年级创作 A 班' }).getAttribute('data-state')).toBe('unchecked')
    expect(screen.getByRole('checkbox', { name: '分配给四年级游戏 B 班' }).getAttribute('data-state')).toBe('unchecked')
  })

  it('replaces an invalid course route with the course center', async () => {
    renderCourseDetail('/teacher/courses/unknown-course')

    expect(await screen.findByTestId('course-center')).toBeTruthy()
    expect(screen.getByTestId('location').textContent).toBe('/teacher/courses')
    expect(screen.queryByRole('heading', { name: 'AI 太空海报创作营' })).toBeNull()
  })
})
