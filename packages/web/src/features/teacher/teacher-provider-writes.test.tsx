// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherWorkspaceProvider, useTeacherWorkspace } from './teacher-provider'
import {
  TEACHER_WRITE_UNSUPPORTED,
  type TeacherWorkspaceSource,
  type TeacherWorkspaceWriter,
  type TeacherWriteResult,
} from './teacher-workspace-source'
import type { TeacherDashboardData } from './types'

const mocks = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))

vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }))

afterEach(cleanup)

function dataWithCourse(): TeacherDashboardData {
  return {
    institutionName: '真实机构',
    teacherName: '李老师',
    classes: [{ id: 'c1', name: '二年级创作 A 班', studentCount: 26, courseTitle: '', progress: null }],
    lessons: [],
    courses: [
      {
        id: 'course-1',
        title: 'AI 太空海报创作营',
        description: '',
        coverAsset: '',
        stage: 'lower_primary',
        topic: '视觉创作',
        status: 'ready',
        lessonCount: 0,
        completion: 0,
        assignedClassIds: [],
        ageRange: '',
        goals: [],
        expectedOutcome: '',
        chapters: [],
      },
    ],
    todaySchedule: [],
    pendingReviews: [],
    works: [],
    recentSessions: [],
    activeSession: null,
    classDetails: [
      {
        summary: {
          id: 'c1',
          name: '二年级创作 A 班',
          studentCount: 1,
          courseTitle: '',
          progress: null,
          xiaobaoCreditLimit: null,
          status: 'active',
        },
        students: [
          {
            id: 'student-1',
            name: '学生一',
            status: 'creating',
            completedTasks: 0,
            totalTasks: 0,
            lastActiveAt: new Date(0).toISOString(),
          },
        ],
        lessonProgress: [],
        recentSessions: [],
        teachers: [],
      },
    ],
  }
}

function dataWithActiveSession(): TeacherDashboardData {
  return {
    ...dataWithCourse(),
    activeSession: {
      id: 'session-1',
      classId: 'c1',
      className: '二年级创作 A 班',
      lessonId: 'lesson-1',
      lessonTitle: '第一课时',
      startedAt: new Date(0).toISOString(),
      pointLimit: 100,
      capabilities: ['chat'],
      skills: [],
      mcpServers: [],
    },
  }
}

function apiSource(writer: Partial<TeacherWorkspaceWriter> = {}, data: TeacherDashboardData = dataWithCourse()) {
  const load = vi.fn(async () => ({ status: 'ready' as const, data }))
  const source: TeacherWorkspaceSource = {
    persistsWrites: true,
    writer: {
      assignCourse: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      createClass: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      createCourse: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      updateCourse: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      addStudent: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      removeStudent: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      setClassBudget: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      assignTeacher: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      removeTeacher: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      start: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      updateActiveSettings: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      end: vi.fn(async () => ({ ok: true }) as TeacherWriteResult),
      ...writer,
    },
    load,
  }
  return { source, load, writer: source.writer! }
}

function Probe() {
  const {
    data,
    assignCourse,
    start,
    end,
    updateActiveSettings,
    createClass,
    addStudent,
    removeStudent,
    setClassBudget,
    assignTeacher,
    removeTeacher,
    updateStudentStatus,
  } = useTeacherWorkspace()
  const assignedClassIds = data.courses[0]?.assignedClassIds ?? []
  const firstClass = data.classes[0]
  const firstDetail = data.classDetails[0]

  return (
    <div>
      <p data-testid="assigned-classes">{assignedClassIds.join(',')}</p>
      <p data-testid="class-count">{data.classes.length}</p>
      <p data-testid="roster">{firstDetail?.students.map((item) => item.id).join(',') ?? ''}</p>
      <p data-testid="budget">{firstClass ? String(firstClass.xiaobaoCreditLimit ?? '') : ''}</p>
      <p data-testid="teachers">
        {firstDetail?.teachers?.map((item) => `${item.userId}:${item.role}`).join(',') ?? ''}
      </p>
      <button type="button" onClick={() => assignCourse('course-1', ['c1'])}>
        关联课包
      </button>
      <button
        type="button"
        onClick={() =>
          start({
            classId: 'c1',
            lessonId: 'lesson-1',
            pointLimit: 100,
            capabilities: ['chat'],
            skills: [],
            mcpServers: [],
          })
        }
      >
        开始上课
      </button>
      <button type="button" onClick={() => end()}>
        下课
      </button>
      <button type="button" onClick={() => updateActiveSettings({ pointLimit: 200, capabilities: ['chat'] })}>
        课中调整
      </button>
      <button type="button" onClick={() => createClass({ name: '新班级', aiUsageMode: 'class_only' })}>
        新建班级
      </button>
      <button type="button" onClick={() => addStudent('c1', 'student-9')}>
        加入学生
      </button>
      <button type="button" onClick={() => removeStudent('c1', 'student-1')}>
        移出学生
      </button>
      <button type="button" onClick={() => setClassBudget('c1', 300)}>
        设置额度
      </button>
      <button type="button" onClick={() => assignTeacher('c1', 'teacher-9', 'lead')}>
        分配老师
      </button>
      <button type="button" onClick={() => removeTeacher('c1', 'teacher-9')}>
        解除老师
      </button>
      <button type="button" onClick={() => updateStudentStatus('student-1', 'needs_attention')}>
        标记关注
      </button>
    </div>
  )
}

function renderWithSource(source: TeacherWorkspaceSource) {
  render(
    <TeacherWorkspaceProvider source={source}>
      <Probe />
    </TeacherWorkspaceProvider>,
  )
}

beforeEach(() => {
  mocks.error.mockReset()
  mocks.success.mockReset()
})

describe('teacher workspace writes through the API source', () => {
  it('calls the backend before reflecting the assignment, and reports success', async () => {
    const assignCourse = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    renderWithSource(apiSource({ assignCourse }).source)
    await screen.findByText('关联课包')

    fireEvent.click(screen.getByRole('button', { name: '关联课包' }))

    await waitFor(() => expect(assignCourse).toHaveBeenCalledWith('c1', 'course-1'))
    // 只有后端成功之后界面才更新
    await waitFor(() => expect(screen.getByTestId('assigned-classes').textContent).toBe('c1'))
    expect(mocks.success).toHaveBeenCalled()
  })

  it('does not fake success when the backend write fails', async () => {
    const assignCourse = vi.fn(async () => ({ ok: false, message: '保存失败，请稍后重试' }) as TeacherWriteResult)
    renderWithSource(apiSource({ assignCourse }).source)
    await screen.findByText('关联课包')

    fireEvent.click(screen.getByRole('button', { name: '关联课包' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('保存失败，请稍后重试'))
    // 关键：失败时不做乐观更新，界面必须保持原样
    expect(screen.getByTestId('assigned-classes').textContent).toBe('')
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('opens a class through the backend and reloads the workspace', async () => {
    const start = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    const { source, load } = apiSource({ start })
    renderWithSource(source)
    await screen.findByText('开始上课')
    const loadsBefore = load.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '开始上课' }))

    await waitFor(() =>
      expect(start).toHaveBeenCalledWith({
        classId: 'c1',
        lessonId: 'lesson-1',
        pointLimit: 100,
        capabilities: ['chat'],
        skills: [],
        mcpServers: [],
      }),
    )
    // 课堂状态以后端记录为准：写完必须重新拉取工作区，而不是本地推演一节课
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(loadsBefore))
    expect(mocks.success).not.toHaveBeenCalled()
  })

  it('does not fake a class start when the backend refuses it', async () => {
    const start = vi.fn(async () => ({ ok: false, message: '保存失败，请稍后重试' }) as TeacherWriteResult)
    const { source, load } = apiSource({ start })
    renderWithSource(source)
    await screen.findByText('开始上课')
    const loadsBefore = load.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '开始上课' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('保存失败，请稍后重试'))
    expect(load.mock.calls.length).toBe(loadsBefore)
  })

  it('adjusts and ends the running class through the backend using its own session id', async () => {
    const end = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    const updateActiveSettings = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    const { source } = apiSource({ end, updateActiveSettings }, dataWithActiveSession())
    renderWithSource(source)
    await screen.findByText('课中调整')

    fireEvent.click(screen.getByRole('button', { name: '课中调整' }))
    fireEvent.click(screen.getByRole('button', { name: '下课' }))

    await waitFor(() =>
      expect(updateActiveSettings).toHaveBeenCalledWith('c1', 'session-1', { pointLimit: 200, capabilities: ['chat'] }),
    )
    await waitFor(() => expect(end).toHaveBeenCalledWith('c1', 'session-1'))
  })

  it('keeps class actions silent when no class is running', async () => {
    const end = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    const updateActiveSettings = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    const { source } = apiSource({ end, updateActiveSettings })
    renderWithSource(source)
    await screen.findByText('下课')

    fireEvent.click(screen.getByRole('button', { name: '下课' }))
    fireEvent.click(screen.getByRole('button', { name: '课中调整' }))

    // 没有进行中的课堂就没什么可下课/可调整的：既不该调接口，也不该弹"尚未接入"
    expect(end).not.toHaveBeenCalled()
    expect(updateActiveSettings).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('reports actions that have no backend yet instead of silently changing local state', async () => {
    renderWithSource(apiSource().source)
    await screen.findByText('标记关注')

    fireEvent.click(screen.getByRole('button', { name: '标记关注' }))

    expect(mocks.error).toHaveBeenCalledWith(TEACHER_WRITE_UNSUPPORTED)
  })

  it('sends every institution and class admin action to the backend', async () => {
    const { source, writer } = apiSource()
    renderWithSource(source)
    await screen.findByText('新建班级')

    fireEvent.click(screen.getByRole('button', { name: '新建班级' }))
    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.click(screen.getByRole('button', { name: '移出学生' }))
    fireEvent.click(screen.getByRole('button', { name: '设置额度' }))
    fireEvent.click(screen.getByRole('button', { name: '分配老师' }))
    fireEvent.click(screen.getByRole('button', { name: '解除老师' }))

    await waitFor(() => expect(writer.createClass).toHaveBeenCalledWith({ name: '新班级', aiUsageMode: 'class_only' }))
    expect(writer.addStudent).toHaveBeenCalledWith('c1', 'student-9')
    expect(writer.removeStudent).toHaveBeenCalledWith('c1', 'student-1')
    expect(writer.setClassBudget).toHaveBeenCalledWith('c1', 300)
    expect(writer.assignTeacher).toHaveBeenCalledWith('c1', 'teacher-9', 'lead')
    expect(writer.removeTeacher).toHaveBeenCalledWith('c1', 'teacher-9')
  })

  it('does not change the roster or budget when the backend refuses', async () => {
    const { source } = apiSource({
      addStudent: vi.fn(async () => ({ ok: false, message: '保存失败，请稍后重试' }) as TeacherWriteResult),
      setClassBudget: vi.fn(async () => ({ ok: false, message: '保存失败，请稍后重试' }) as TeacherWriteResult),
    })
    renderWithSource(source)
    await screen.findByText('加入学生')

    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.click(screen.getByRole('button', { name: '设置额度' }))

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('保存失败，请稍后重试'))
    // 关键：失败时不做乐观更新
    expect(screen.getByTestId('roster').textContent).toBe('student-1')
    expect(screen.getByTestId('budget').textContent).toBe('')
  })

  it('keeps institution and class admin writes local in the demo source', async () => {
    renderWithSource({
      persistsWrites: false,
      initial: dataWithCourse(),
      async load() {
        return { status: 'ready', data: dataWithCourse() }
      },
    })
    await screen.findByText('新建班级')

    fireEvent.click(screen.getByRole('button', { name: '新建班级' }))
    fireEvent.click(screen.getByRole('button', { name: '加入学生' }))
    fireEvent.click(screen.getByRole('button', { name: '设置额度' }))
    fireEvent.click(screen.getByRole('button', { name: '分配老师' }))

    // 演示源直接改本地状态：离线演示不能变成一堆"尚未接入"的提示
    expect(screen.getByTestId('class-count').textContent).toBe('2')
    expect(screen.getByTestId('roster').textContent).toBe('student-1,student-9')
    expect(screen.getByTestId('budget').textContent).toBe('300')
    expect(screen.getByTestId('teachers').textContent).toBe('teacher-9:lead')
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('keeps demo writes local so the offline demo experience still works', async () => {
    const assignCourse = vi.fn(async () => ({ ok: true }) as TeacherWriteResult)
    // 演示源不持久化：写操作直接改本地状态，也不弹"尚未接入"的提示
    renderWithSource({
      persistsWrites: false,
      initial: dataWithCourse(),
      async load() {
        return { status: 'ready', data: dataWithCourse() }
      },
    })
    await screen.findByText('关联课包')

    fireEvent.click(screen.getByRole('button', { name: '关联课包' }))

    expect(screen.getByTestId('assigned-classes').textContent).toBe('c1')
    expect(assignCourse).not.toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
