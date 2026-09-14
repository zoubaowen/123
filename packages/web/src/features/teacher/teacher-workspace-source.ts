import { api } from '../../lib/api'
import { teacherDashboardDemo } from './demo-data'
import type {
  ActiveClassSettingsInput,
  ClassTeacherRole,
  CreateClassInput,
  InstitutionRole,
  StartClassInput,
  TeacherCapability,
  TeacherClassSummary,
  TeacherDashboardData,
  TeacherMemberOption,
  TeacherStudentOption,
} from './types'

export type TeacherWorkspaceLoad =
  | { status: 'ready'; data: TeacherDashboardData }
  /** 调用者不属于任何机构（或未登录）：应渲染空状态，**不能退回演示数据**。 */
  | { status: 'no-institution' }
  | { status: 'error' }

export type TeacherWriteResult = { ok: true } | { ok: false; message: string }

/** 调用方可见的静态提示：不含班级 id、课程 id 等动态值。 */
export const TEACHER_WRITE_FAILED = '保存失败，请稍后重试'
export const TEACHER_WRITE_UNSUPPORTED = '该操作尚未接入后端，请稍后再试'

/**
 * 写操作口子。
 *
 * 只声明**后端真实支持**的写操作：班级、名单、课包关联、班级共享额度、任课老师与课堂
 * （开课 / 课中调整 / 下课）都有接口；作品点评还没有作品存储。
 */
export interface TeacherWorkspaceWriter {
  /** 把课包关联到某个班级。 */
  assignCourse(classId: string, courseId: string): Promise<TeacherWriteResult>
  /** 新建班级（仅机构 owner/admin）。 */
  createClass(input: CreateClassInput): Promise<TeacherWriteResult>
  /** 按用户 id 加入学生（仅机构 owner/admin）。 */
  addStudent(classId: string, studentUserId: string): Promise<TeacherWriteResult>
  /** 移出学生：后端写退班标记而不是删除记录（仅机构 owner/admin）。 */
  removeStudent(classId: string, studentUserId: string): Promise<TeacherWriteResult>
  /** 设置或清空班级共享额度（仅机构 owner/admin）。 */
  setClassBudget(classId: string, creditLimit: number | null): Promise<TeacherWriteResult>
  /** 分配任课老师（仅机构 owner/admin）。 */
  assignTeacher(classId: string, userId: string, role: ClassTeacherRole): Promise<TeacherWriteResult>
  /** 解除任课关系（仅机构 owner/admin）。 */
  removeTeacher(classId: string, userId: string): Promise<TeacherWriteResult>
  start(input: StartClassInput): Promise<TeacherWriteResult>
  updateActiveSettings(classId: string, sessionId: string, input: ActiveClassSettingsInput): Promise<TeacherWriteResult>
  end(classId: string, sessionId: string): Promise<TeacherWriteResult>
}

export interface TeacherWorkspaceSource {
  /** 同步可用的初始数据：演示数据源提供它，接口数据源不提供（需要先请求）。 */
  readonly initial?: TeacherDashboardData
  /**
   * 该数据源是否把写操作真正持久化。
   *
   * 演示源为 `false`：写操作只改本地状态（当前演示体验依赖这一点）。
   * 接口源为 `true`：写操作必须走后端，失败时**不得**改本地状态假装成功。
   */
  readonly persistsWrites: boolean
  load(): Promise<TeacherWorkspaceLoad>
  /** 机构内学生查找；`null` 表示没查到结果（网络/权限失败），由调用方如实提示。 */
  searchStudents?(query: string): Promise<TeacherStudentOption[] | null>
  /** 机构成员查找（分配任课老师用）；同样是 `null` 表示查找失败。 */
  searchTeachers?(query: string): Promise<TeacherMemberOption[] | null>
  readonly writer?: TeacherWorkspaceWriter
}

/** 与后端 `GET /api/teacher/workspace` 对齐的负载。 */
export interface TeacherWorkspacePayload {
  institution: { id: string; name: string }
  teacher: { id: string; name: string }
  /** 调用者在本机构的角色；旧后端不返回时按"未知"处理。 */
  role?: InstitutionRole
  classes: Array<{
    id: string
    name: string
    aiUsageMode: 'class_only' | 'anytime'
    xiaobaoCreditLimit: number | null
    status: 'active' | 'archived'
    studentCount: number | null
    course: { id: string; title: string; lessonCount: number; completedLessonCount: number; progress: number } | null
  }>
  /** 正在上的那节课；null 表示当前没有课堂。旧后端不返回该字段时按 null 处理。 */
  activeSession?: TeacherWorkspaceSession | null
  /**
   * 每个可见班级的详情；旧后端不返回时班级详情页会回列表。
   *
   * 这里**只带后端确实提供的字段**：任课老师、在班学生（姓名/入班时间）、课时进度。
   * 学生的任务完成数与学习状态后端还没有，因此不映射（界面显示占位符而不是 0）。
   */
  classDetails?: TeacherWorkspaceClassDetail[]
  /** 机构课包；旧后端不返回时"课程中心"为空列表。 */
  courses?: TeacherWorkspaceCourse[]
}

/** 与后端 `TeacherCourseView` 对齐的课包负载（不含大纲：章节按需拉详情接口）。 */
export interface TeacherWorkspaceCourse {
  id: string
  title: string
  description: string
  coverAsset: string
  stage: 'lower_primary' | 'upper_primary' | 'middle_school'
  topic: string
  status: 'ready' | 'draft'
  ageRange: string
  goals: string[]
  expectedOutcome: string
  lessonCount: number
  assignedClassIds: string[]
}

/** 与后端 `TeacherClassDetailPayload` 对齐的班级详情负载。 */
export interface TeacherWorkspaceClassDetail {
  class: {
    id: string
    name: string
    aiUsageMode: 'class_only' | 'anytime'
    xiaobaoCreditLimit: number | null
    status: 'active' | 'archived'
    studentCount: number | null
    course: { id: string; title: string; lessonCount: number; completedLessonCount: number; progress: number } | null
  }
  teachers: Array<{ userId: string; role: ClassTeacherRole; name: string | null }>
  students: Array<{ id: string; name: string | null; joinedAt: number }>
  lessonProgress: Array<{
    lessonId: string
    title: string
    order: number
    status: 'completed' | 'next' | 'locked'
    completedAt: number | null
  }>
}

/** 与后端 `TeacherClassSessionView` 对齐的课堂负载。 */
export interface TeacherWorkspaceSession {
  id: string
  classId: string
  className: string
  lessonId: string
  lessonTitle: string | null
  startedAt: number
  endedAt: number | null
  durationMinutes: number | null
  studentCount: number | null
  pointLimit: number
  capabilities: string[]
  skills: string[]
  mcpServers: string[]
}

/**
 * 课堂能力在两套词汇之间对不上：课堂记录里存的是小宝运行时的能力 id
 * （`writing` / `learning` / `game` / `image` / `video` / `music`），教师端界面用的是
 * `chat` / `image` / `music` / `video` / `code`。只有 image / music / video 是同名的，
 * 其余对应关系属于产品口径（页面上的"AI 对话""编程助手"分别对应哪个运行时能力），本轮不替产品拍板，
 * 因此**只展示两边都认得的能力**——猜一个映射会让老师看到与实际放行不符的能力。
 */
const TEACHER_CAPABILITY_IDS: readonly TeacherCapability[] = ['chat', 'image', 'music', 'video', 'code']

function toTeacherCapabilities(raw: string[]): TeacherCapability[] {
  return raw.filter((item): item is TeacherCapability => (TEACHER_CAPABILITY_IDS as readonly string[]).includes(item))
}

/**
 * 把接口负载映射成前端既有的 `TeacherDashboardData`。
 *
 * **只填后端真实提供的数据**：机构名、老师名、班级列表、课程进度与正在进行的课堂。其余部分（今日安排、
 * 待点评、作品、课堂记录、课程与课时内容）后端尚未提供，一律留空，由使用它们的页面显示空状态——
 * 给它们填演示数据会让真机上出现"假班级、假作品"。
 *
 * 班级的 `completionRate`（学生任务完成率）后端目前不提供，因此**留空**，界面显示占位符而不是 0%。
 */
export function toTeacherDashboardData(payload: TeacherWorkspacePayload): TeacherDashboardData {
  const classes: TeacherClassSummary[] = payload.classes.map((item) => ({
    id: item.id,
    name: item.name,
    studentCount: item.studentCount,
    courseTitle: item.course?.title ?? '',
    progress: item.course ? item.course.progress : null,
    xiaobaoCreditLimit: item.xiaobaoCreditLimit,
  }))

  const session = payload.activeSession ?? null

  return {
    institutionName: payload.institution.name,
    teacherName: payload.teacher.name,
    institutionRole: payload.role ?? null,
    classes,
    lessons: [],
    courses: (payload.courses ?? []).map((course) => ({
      id: course.id,
      title: course.title,
      description: course.description,
      coverAsset: course.coverAsset,
      stage: course.stage,
      topic: course.topic,
      status: course.status,
      lessonCount: course.lessonCount,
      ageRange: course.ageRange,
      goals: course.goals,
      expectedOutcome: course.expectedOutcome,
      // 内容完善度后端不提供：**不填 0**，界面显示占位符
      assignedClassIds: course.assignedClassIds,
      // 章节与课时内容按需拉 `GET /courses/:courseId`（工作区不带大纲）
      chapters: [],
    })),
    todaySchedule: [],
    pendingReviews: [],
    works: [],
    recentSessions: [],
    activeSession: session
      ? {
          id: session.id,
          classId: session.classId,
          className: session.className,
          lessonId: session.lessonId,
          // 课时已不在当前课包大纲里时后端给 null：显示空标题，不编造
          lessonTitle: session.lessonTitle ?? '',
          startedAt: new Date(session.startedAt).toISOString(),
          pointLimit: session.pointLimit,
          capabilities: toTeacherCapabilities(session.capabilities),
          skills: session.skills,
          mcpServers: session.mcpServers,
        }
      : null,
    /**
     * 班级详情：只映射后端确实给出的字段。学生的任务完成数与学习状态后端还没有，
     * 因此**不填 0**——界面会显示占位符，不会被读成"这个学生什么都没做"。
     */
    classDetails: (payload.classDetails ?? []).map((detail) => ({
      summary: {
        id: detail.class.id,
        name: detail.class.name,
        studentCount: detail.class.studentCount,
        courseTitle: detail.class.course?.title ?? '',
        progress: detail.class.course ? detail.class.course.progress : null,
        xiaobaoCreditLimit: detail.class.xiaobaoCreditLimit,
        // 两套词汇：后端是 active/archived，界面是 active/completed（已归档＝这个班结课了）
        status: detail.class.status === 'archived' ? 'completed' : 'active',
      },
      students: detail.students.map((student) => ({
        id: student.id,
        // 用户行缺失时后端给 null：显示"未知学生"，不隐藏这一行
        name: student.name ?? '未知学生',
      })),
      lessonProgress: detail.lessonProgress.map((item) => ({
        lessonId: item.lessonId,
        title: item.title,
        order: item.order,
        status: item.status,
        ...(item.completedAt === null ? {} : { completedAt: new Date(item.completedAt).toISOString() }),
      })),
      recentSessions: [],
      teachers: detail.teachers.map((teacher) => ({
        userId: teacher.userId,
        name: teacher.name ?? teacher.userId,
        role: teacher.role,
      })),
    })),
  }
}

/** 演示数据源：当前默认。保留它，前端在没有真实教师后端时仍可完整演示。 */
export function createDemoTeacherWorkspaceSource(): TeacherWorkspaceSource {
  return {
    initial: teacherDashboardDemo,
    persistsWrites: false,
    async load() {
      return { status: 'ready', data: teacherDashboardDemo }
    },
  }
}

/**
 * 接口数据源。
 *
 * 权限类失败（401/403）与"没有机构"（400）都视为 `no-institution`：教师后台没有机构就没有可展示的内容，
 * 这时必须显示空状态而不是演示数据。其余失败是 `error`，由 provider 提示重试。
 */
export function createApiTeacherWorkspaceSource(): TeacherWorkspaceSource {
  return {
    persistsWrites: true,
    async searchStudents(query: string) {
      try {
        // 机构范围由后端按调用者的成员关系推导，这里不传机构 id
        const payload = (await api.get(`/api/teacher/students?query=${encodeURIComponent(query)}`)) as {
          students?: TeacherStudentOption[]
        }
        return payload?.students ?? []
      } catch {
        // 失败与"没查到"必须分开：返回 null 让界面说"请稍后再试"而不是"没有这个学生"
        return null
      }
    },
    async searchTeachers(query: string) {
      try {
        const payload = (await api.get(`/api/teacher/teachers?query=${encodeURIComponent(query)}`)) as {
          teachers?: TeacherMemberOption[]
        }
        return payload?.teachers ?? []
      } catch {
        return null
      }
    },
    writer: {
      async assignCourse(classId, courseId) {
        try {
          await api.post(`/api/teacher/classes/${classId}/courses`, { courseId })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async createClass(input) {
        try {
          await api.post('/api/teacher/classes', { name: input.name, aiUsageMode: input.aiUsageMode })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async addStudent(classId, studentUserId) {
        try {
          await api.post(`/api/teacher/classes/${classId}/students`, { studentUserId })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async removeStudent(classId, studentUserId) {
        try {
          // 退班是写标记而不是删除：历史课堂与作品仍要能定位归属
          await api.delete(`/api/teacher/classes/${classId}/students/${studentUserId}`)
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async setClassBudget(classId, creditLimit) {
        try {
          await api.put(`/api/teacher/classes/${classId}/budget`, { creditLimit })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async assignTeacher(classId, userId, role) {
        try {
          await api.put(`/api/teacher/classes/${classId}/teachers`, { userId, role })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async removeTeacher(classId, userId) {
        try {
          await api.delete(`/api/teacher/classes/${classId}/teachers/${userId}`)
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async start(input) {
        try {
          // 不替产品拍板能力映射：不传 capabilities，开课放行的能力由这节课的课时配置决定
          await api.post(`/api/teacher/classes/${input.classId}/sessions`, {
            lessonId: input.lessonId,
            pointLimit: input.pointLimit,
            skills: input.skills,
            mcpServers: input.mcpServers,
          })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async updateActiveSettings(classId, sessionId, input) {
        try {
          await api.put(`/api/teacher/classes/${classId}/sessions/${sessionId}`, { pointLimit: input.pointLimit })
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
      async end(classId, sessionId) {
        try {
          await api.post(`/api/teacher/classes/${classId}/sessions/${sessionId}/end`)
          return { ok: true }
        } catch {
          return { ok: false, message: TEACHER_WRITE_FAILED }
        }
      },
    },
    async load() {
      try {
        const payload = (await api.get('/api/teacher/workspace')) as TeacherWorkspacePayload
        if (!payload?.institution?.id) return { status: 'no-institution' }
        return { status: 'ready', data: toTeacherDashboardData(payload) }
      } catch (error) {
        const status = (error as { status?: number } | undefined)?.status
        if (status === 401 || status === 403 || status === 400) return { status: 'no-institution' }
        return { status: 'error' }
      }
    },
  }
}

/**
 * 当前使用的数据源。
 *
 * 默认仍是演示数据源：接口还不提供今日安排、待点评、作品与课堂记录，教育现场的演示体验不能被清空。
 * 置 `VITE_TEACHER_WORKSPACE_API=1` 可切到接口数据源（Task 13 的浏览器验收会用这个开关）。
 */
export function resolveTeacherWorkspaceSource(environment: Record<string, string | undefined>): TeacherWorkspaceSource {
  return environment.VITE_TEACHER_WORKSPACE_API === '1'
    ? createApiTeacherWorkspaceSource()
    : createDemoTeacherWorkspaceSource()
}
