import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '../../components/ui/button'
import { teacherDashboardDemo } from './demo-data'
import {
  addClassStudent,
  addTeacherClass,
  assignClassTeacher,
  removeClassStudent,
  removeClassTeacher,
  setTeacherClassBudget,
} from './teacher-class-repository'
import { assignCourseToClasses } from './teacher-course-repository'
import { reviewTeacherWork, toggleFeaturedTeacherWork } from './teacher-work-repository'
import { updateTeacherStudentStatus } from './teacher-student-repository'
import { endClass, startClass, updateActiveClassSettings } from './teacher-store'
import { canManageInstitution } from './teacher-permissions'
import {
  createDemoTeacherWorkspaceSource,
  TEACHER_WRITE_FAILED,
  TEACHER_WRITE_UNSUPPORTED,
  type TeacherWorkspaceSource,
  type TeacherWriteResult,
} from './teacher-workspace-source'
import type {
  ActiveClassSettingsInput,
  ClassTeacherRole,
  CreateClassInput,
  StartClassInput,
  TeacherDashboardData,
  TeacherMemberOption,
  TeacherStudentLearningStatus,
  TeacherStudentOption,
  TeacherWorkReviewInput,
} from './types'

interface TeacherWorkspaceContextValue {
  data: TeacherDashboardData
  /** 是否为机构 owner/admin（界面显隐管理员动作；真正的判权在后端）。 */
  canManage: boolean
  start: (input: StartClassInput) => void
  end: () => void
  updateActiveSettings: (input: ActiveClassSettingsInput) => void
  assignCourse: (courseId: string, classIds: string[]) => void
  createClass: (input: CreateClassInput) => Promise<boolean>
  addStudent: (classId: string, studentUserId: string) => Promise<boolean>
  removeStudent: (classId: string, studentUserId: string) => Promise<boolean>
  setClassBudget: (classId: string, creditLimit: number | null) => Promise<boolean>
  assignTeacher: (classId: string, userId: string, role: ClassTeacherRole) => Promise<boolean>
  removeTeacher: (classId: string, userId: string) => Promise<boolean>
  /** 机构内学生查找；null 表示查找失败（与"没查到"区分开）。 */
  searchStudents: (query: string) => Promise<TeacherStudentOption[] | null>
  /** 机构成员查找（分配任课老师用）；null 表示查找失败。 */
  searchTeachers: (query: string) => Promise<TeacherMemberOption[] | null>
  /**
   * 数据源是否支持学生查找。
   *
   * 演示源没有机构学生目录：这时候**不显示"加入学生"**，而不是让老师搜出一堆假学生。
   */
  canSearchStudents: boolean
  /** 演示源同样没有机构成员目录：不显示"分配老师"。 */
  canSearchTeachers: boolean
  reviewWork: (workId: string, input: TeacherWorkReviewInput) => void
  toggleFeaturedWork: (workId: string) => void
  updateStudentStatus: (studentId: string, status: TeacherStudentLearningStatus) => void
}

const defaultValue: TeacherWorkspaceContextValue = {
  data: teacherDashboardDemo,
  canManage: true,
  start: () => undefined,
  end: () => undefined,
  updateActiveSettings: () => undefined,
  assignCourse: () => undefined,
  createClass: async () => false,
  addStudent: async () => false,
  removeStudent: async () => false,
  setClassBudget: async () => false,
  assignTeacher: async () => false,
  removeTeacher: async () => false,
  searchStudents: async () => null,
  searchTeachers: async () => null,
  canSearchStudents: false,
  canSearchTeachers: false,
  reviewWork: () => undefined,
  toggleFeaturedWork: () => undefined,
  updateStudentStatus: () => undefined,
}

const TeacherWorkspaceContext = createContext<TeacherWorkspaceContextValue>(defaultValue)

const demoSource = createDemoTeacherWorkspaceSource()

type WorkspaceState =
  | { phase: 'ready'; data: TeacherDashboardData }
  | { phase: 'loading' }
  | { phase: 'no-institution' }
  | { phase: 'error' }

function TeacherWorkspaceNotice({
  title,
  description,
  onRetry,
}: {
  title: string
  description: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <h1 className="text-lg font-black text-slate-800">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p>
        {onRetry && (
          <Button type="button" className="mt-6" onClick={onRetry}>
            重新加载
          </Button>
        )}
      </div>
    </div>
  )
}

export function TeacherWorkspaceProvider({
  children,
  initialData,
  source = demoSource,
}: {
  children: ReactNode
  initialData?: TeacherDashboardData
  source?: TeacherWorkspaceSource
}) {
  const initial = initialData ?? source.initial ?? null
  const [state, setState] = useState<WorkspaceState>(() =>
    initial ? { phase: 'ready', data: initial } : { phase: 'loading' },
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // 显式传入 initialData 时不再请求：测试与局部预览都依赖它同步渲染
    if (initialData !== undefined) return undefined

    let cancelled = false
    void source
      .load()
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ready') setState({ phase: 'ready', data: result.data })
        else if (result.status === 'no-institution') setState({ phase: 'no-institution' })
        else setState({ phase: 'error' })
      })
      .catch(() => {
        if (!cancelled) setState({ phase: 'error' })
      })

    return () => {
      cancelled = true
    }
  }, [source, initialData, attempt])

  const data = state.phase === 'ready' ? state.data : null

  const value = useMemo<TeacherWorkspaceContextValue | null>(() => {
    if (!data) return null

    const applyLocally = (reducer: (current: TeacherDashboardData) => TeacherDashboardData) =>
      setState((current) => (current.phase === 'ready' ? { phase: 'ready', data: reducer(current.data) } : current))

    /**
     * 尚无后端存储的操作。
     *
     * 接口模式下必须**明确报"尚未接入"并且不改本地状态**：静默改内存会让人以为保存成功，
     * 刷新后又不翼而飞，比报错更糟。
     */
    const localOnly = (reducer: (current: TeacherDashboardData) => TeacherDashboardData) => {
      if (source.persistsWrites) {
        toast.error(TEACHER_WRITE_UNSUPPORTED)
        return
      }
      applyLocally(reducer)
    }

    /** 写成功之后重新拉一次工作区：界面上的课堂状态来自后端记录本身，不是本地推演。 */
    const reload = () => {
      void source
        .load()
        .then((result) => {
          if (result.status === 'ready') setState({ phase: 'ready', data: result.data })
          else if (result.status === 'no-institution') setState({ phase: 'no-institution' })
          else setState({ phase: 'error' })
        })
        .catch(() => setState({ phase: 'error' }))
    }

    /** 接口模式下的写：成功后重载，失败时给出静态提示且**不做乐观更新**。 */
    const writeThenReload = (write: () => Promise<TeacherWriteResult>) => {
      void writeThenReloadAwaitable(write)
    }

    /**
     * 同上，但把结果交回调用方：表单类动作要据此决定**要不要关闭对话框**——
     * 写失败还关掉对话框，用户既看不到错误也不知道内容没保存。
     */
    const writeThenReloadAwaitable = async (write: () => Promise<TeacherWriteResult>): Promise<boolean> => {
      try {
        const result = await write()
        if (!result.ok) {
          toast.error(result.message)
          return false
        }
        reload()
        return true
      } catch {
        toast.error(TEACHER_WRITE_FAILED)
        return false
      }
    }

    const apiWriter = source.persistsWrites ? source.writer : undefined

    return {
      data,
      canManage: canManageInstitution(data),
      searchStudents: async (query: string) => {
        if (!source.searchStudents) return null
        return source.searchStudents(query)
      },
      searchTeachers: async (query: string) => {
        if (!source.searchTeachers) return null
        return source.searchTeachers(query)
      },
      canSearchStudents: Boolean(source.searchStudents),
      canSearchTeachers: Boolean(source.searchTeachers),
      start: (input: StartClassInput) => {
        if (apiWriter) {
          writeThenReload(() => apiWriter.start(input))
          return
        }
        applyLocally((current) => startClass(current, input))
      },
      end: () => {
        const session = data.activeSession
        if (apiWriter) {
          // 没有进行中的课堂就没什么可下的：接口模式下不报"尚未接入"，也不改本地状态
          if (session) writeThenReload(() => apiWriter.end(session.classId, session.id))
          return
        }
        applyLocally((current) => endClass(current))
      },
      updateActiveSettings: (input: ActiveClassSettingsInput) => {
        const session = data.activeSession
        if (apiWriter) {
          if (session) writeThenReload(() => apiWriter.updateActiveSettings(session.classId, session.id, input))
          return
        }
        applyLocally((current) => updateActiveClassSettings(current, input))
      },
      assignCourse: (courseId: string, classIds: string[]) => {
        const reducer = (current: TeacherDashboardData) => assignCourseToClasses(current, courseId, classIds)

        // 演示源：保持既有行为，直接改本地状态
        if (!apiWriter) {
          applyLocally(reducer)
          return
        }

        void (async () => {
          try {
            for (const classId of classIds) {
              const result = await apiWriter.assignCourse(classId, courseId)
              // 只在**全部成功**后才反映到界面：失败时不做乐观更新，避免"看起来保存了"
              if (!result.ok) {
                toast.error(result.message)
                return
              }
            }
            applyLocally(reducer)
            toast.success('课包已保存')
          } catch {
            toast.error(TEACHER_WRITE_FAILED)
          }
        })()
      },
      reviewWork: (workId: string, input: TeacherWorkReviewInput) =>
        localOnly((current) => reviewTeacherWork(current, workId, input)),
      toggleFeaturedWork: (workId: string) => localOnly((current) => toggleFeaturedTeacherWork(current, workId)),
      updateStudentStatus: (studentId: string, status: TeacherStudentLearningStatus) =>
        localOnly((current) => updateTeacherStudentStatus(current, studentId, status)),

      // 机构与班级管理：接口模式走后端并重载；演示模式仍改本地状态，离线演示不空
      createClass: async (input: CreateClassInput) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.createClass(input))
        applyLocally((current) => addTeacherClass(current, input))
        return true
      },
      addStudent: async (classId: string, studentUserId: string) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.addStudent(classId, studentUserId))
        applyLocally((current) => addClassStudent(current, classId, studentUserId))
        return true
      },
      removeStudent: async (classId: string, studentUserId: string) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.removeStudent(classId, studentUserId))
        applyLocally((current) => removeClassStudent(current, classId, studentUserId))
        return true
      },
      setClassBudget: async (classId: string, creditLimit: number | null) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.setClassBudget(classId, creditLimit))
        applyLocally((current) => setTeacherClassBudget(current, classId, creditLimit))
        return true
      },
      assignTeacher: async (classId: string, userId: string, role: ClassTeacherRole) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.assignTeacher(classId, userId, role))
        applyLocally((current) => assignClassTeacher(current, classId, userId, role))
        return true
      },
      removeTeacher: async (classId: string, userId: string) => {
        if (apiWriter) return writeThenReloadAwaitable(() => apiWriter.removeTeacher(classId, userId))
        applyLocally((current) => removeClassTeacher(current, classId, userId))
        return true
      },
    }
  }, [data, source])

  if (state.phase === 'loading') {
    return <TeacherWorkspaceNotice title="正在加载教学工作区" description="正在读取机构与班级信息，请稍候。" />
  }

  // 没有机构就没有可展示的内容：这里必须显示空状态，绝不能退回演示数据
  if (state.phase === 'no-institution') {
    return (
      <TeacherWorkspaceNotice
        title="尚未加入任何机构"
        description="教师后台只对机构成员开放。请联系机构管理员把你的账号加入机构后重新进入。"
      />
    )
  }

  if (state.phase === 'error' || value === null) {
    return (
      <TeacherWorkspaceNotice
        title="教学工作区加载失败"
        description="没有读取到机构与班级信息，请检查网络后重试。"
        onRetry={() => {
          setState({ phase: 'loading' })
          setAttempt((current) => current + 1)
        }}
      />
    )
  }

  return <TeacherWorkspaceContext.Provider value={value}>{children}</TeacherWorkspaceContext.Provider>
}

export function useTeacherWorkspace() {
  return useContext(TeacherWorkspaceContext)
}
