// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { afterEach, describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { TeacherLessonPreparationPage } from './teacher-lesson-preparation-page'
import { TeacherWorkspaceProvider, useTeacherWorkspace } from './teacher-provider'
import type { TeacherDashboardData } from './types'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
})

afterEach(cleanup)

function renderPreparation(path: string, initialData: TeacherDashboardData = teacherDashboardDemo) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <TeacherWorkspaceProvider initialData={initialData}>
        <Routes>
          <Route path="/teacher/courses/:courseId/lessons/:lessonId" element={<TeacherLessonPreparationPage />} />
          <Route path="/teacher/courses/:courseId" element={<LocationPage name="course-detail" />} />
          <Route path="/teacher/courses" element={<LocationPage name="course-center" />} />
          <Route path="/teacher/classroom/active" element={<LocationPage name="active-classroom" />} />
        </Routes>
        <ActiveSessionProbe />
        <Toaster />
      </TeacherWorkspaceProvider>
    </MemoryRouter>,
  )
}

function LocationPage({ name }: { name: string }) {
  const location = useLocation()
  return <output data-testid={name}>{location.pathname}</output>
}

function ActiveSessionProbe() {
  const { data } = useTeacherWorkspace()
  const session = data.activeSession
  return (
    <output data-testid="active-session">
      {session
        ? JSON.stringify({
            classId: session.classId,
            lessonId: session.lessonId,
            capabilities: session.capabilities,
            skills: session.skills,
            mcpServers: session.mcpServers,
          })
        : 'none'}
    </output>
  )
}
function cloneDashboardData() {
  return structuredClone(teacherDashboardDemo)
}

describe('TeacherLessonPreparationPage', () => {
  it('shows the selected lesson preparation content and translated learning resources', async () => {
    const data = cloneDashboardData()
    const lesson = data.courses[0].chapters[1].lessons[0]
    lesson.resources = [
      { id: 'slides', title: '课堂演示稿', type: 'slides', status: 'ready' },
      { id: 'demo', title: '动态演示', type: 'demo', status: 'ready' },
      { id: 'worksheet', title: '创作练习单', type: 'worksheet', status: 'planned' },
      { id: 'assignment', title: '课后挑战', type: 'assignment', status: 'planned' },
    ]

    renderPreparation('/teacher/courses/space-poster/lessons/space-poster-03', data)

    expect(await screen.findByRole('heading', { name: '让太空校园海报动起来' })).toBeTruthy()
    expect(screen.getByText('教学目标')).toBeTruthy()
    expect(screen.getByText('课堂步骤')).toBeTruthy()
    expect(screen.getByText('教师提示')).toBeTruthy()
    expect(screen.getByText('课后作业')).toBeTruthy()
    expect(screen.getByText('教学资源')).toBeTruthy()
    expect(screen.getByText('为海报设计一个动态效果')).toBeTruthy()
    expect(screen.getByText('选择要动起来的画面元素')).toBeTruthy()
    expect(screen.getByText('先完成一个简单动作，再尝试更多变化')).toBeTruthy()
    expect(screen.getByText('完成一张至少有一个动态效果的海报。')).toBeTruthy()
    expect(screen.getByText('课件 · 已就绪')).toBeTruthy()
    expect(screen.getByText('演示 · 已就绪')).toBeTruthy()
    expect(screen.getByText('练习单 · 待准备')).toBeTruthy()
    expect(screen.getByText('作业 · 待准备')).toBeTruthy()
    expect(screen.getByText('AI 能力')).toBeTruthy()
    expect(screen.getByText('课堂 Skills')).toBeTruthy()
    expect(screen.getByText('MCP')).toBeTruthy()
    expect(screen.getByText('AI 对话')).toBeTruthy()
    expect(screen.getByText('图片生成')).toBeTruthy()
    expect(screen.getByText('视频创作')).toBeTruthy()
    expect(screen.getByText('poster-designer')).toBeTruthy()
    expect(screen.getByText('motion-maker')).toBeTruthy()
    expect(screen.getByText('safe-image-library')).toBeTruthy()
    expect(screen.getByText('video-studio')).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '选择上课班级' }).textContent).toContain('二年级创作 A 班')
  })

  it('shows clear empty states for a lesson without resources or AI configuration', async () => {
    const data = cloneDashboardData()
    const lesson = data.courses[0].chapters[1].lessons[0]
    lesson.resources = []
    lesson.capabilities = []
    lesson.skills = []
    lesson.mcpServers = []

    renderPreparation('/teacher/courses/space-poster/lessons/space-poster-03', data)

    expect(await screen.findByText('本课时暂无教学资源')).toBeTruthy()
    expect(screen.getAllByText('本课时未配置')).toHaveLength(3)
  })
  it('replaces an invalid course route with the course center', async () => {
    renderPreparation('/teacher/courses/unknown-course/lessons/space-poster-03')

    expect((await screen.findByTestId('course-center')).textContent).toBe('/teacher/courses')
  })

  it('replaces an invalid lesson route with its course detail', async () => {
    renderPreparation('/teacher/courses/space-poster/lessons/bounce-game-01')

    expect((await screen.findByTestId('course-detail')).textContent).toBe('/teacher/courses/space-poster')
  })

  it('disables starting class when the course has no valid assigned class', async () => {
    const data = cloneDashboardData()
    data.courses[0].assignedClassIds = ['not-a-class']

    renderPreparation('/teacher/courses/space-poster/lessons/space-poster-03', data)

    expect(await screen.findByText('请先返回课程详情分配班级')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始上课' }).hasAttribute('disabled')).toBe(true)
  })

  it('disables starting class while another classroom is active', async () => {
    const data = cloneDashboardData()
    data.activeSession = {
      id: 'current-class',
      classId: 'game-4b',
      className: '四年级游戏 B 班',
      lessonId: 'bounce-game-02',
      lessonTitle: '给弹跳球加上得分规则',
      startedAt: '2026-08-16T10:00:00.000Z',
      pointLimit: 80,
      capabilities: ['chat', 'code'],
      skills: ['game-builder'],
      mcpServers: [],
    }

    renderPreparation('/teacher/courses/space-poster/lessons/space-poster-03', data)

    expect(await screen.findByText('已有课堂进行中')).toBeTruthy()
    expect(screen.getByRole('button', { name: '开始上课' }).hasAttribute('disabled')).toBe(true)
  })

  it('starts the selected course lesson and takes the teacher to the active classroom', async () => {
    renderPreparation('/teacher/courses/space-poster/lessons/space-poster-03')

    fireEvent.click(await screen.findByRole('button', { name: '开始上课' }))
    expect(await screen.findByRole('heading', { name: '开始上课' })).toBeTruthy()
    expect(screen.getByText('二年级创作 A 班 · 让太空校园海报动起来')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '确认开始上课' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-classroom').textContent).toBe('/teacher/classroom/active')
    })
    expect(JSON.parse(screen.getByTestId('active-session').textContent ?? 'null')).toEqual({
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      capabilities: ['chat', 'image', 'video'],
      skills: ['poster-designer', 'motion-maker'],
      mcpServers: ['safe-image-library', 'video-studio'],
    })
    expect(screen.getByText('课堂已开始')).toBeTruthy()
  })
})
