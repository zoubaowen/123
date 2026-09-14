export type TeacherCapability = 'chat' | 'image' | 'music' | 'video' | 'code'
export type TeacherCourseStatus = 'ready' | 'draft'
export type TeacherCourseStage = 'lower_primary' | 'upper_primary' | 'middle_school'
export type TeacherLessonResourceType = 'slides' | 'demo' | 'worksheet' | 'assignment'

export interface TeacherCourseSummary {
  id: string
  title: string
  description: string
  coverAsset: string
  stage: TeacherCourseStage
  topic: string
  status: TeacherCourseStatus
  lessonCount: number
  /** 课程内容完善度；后端不提供时缺省，界面显示占位符而不是 0%。 */
  completion?: number
  assignedClassIds: string[]
}

export interface TeacherLessonResource {
  id: string
  title: string
  type: TeacherLessonResourceType
  status: 'ready' | 'planned'
}

export interface TeacherCourseLessonDetail {
  id: string
  title: string
  durationMinutes: number
  /** 课时内容完善度；后端不提供时缺省，界面显示占位符而不是 0%。 */
  completion?: number
  objectives: string[]
  steps: string[]
  teacherTips: string[]
  resources: TeacherLessonResource[]
  assignment: string
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}

export interface TeacherCourseChapter {
  id: string
  title: string
  order: number
  lessons: TeacherCourseLessonDetail[]
}

export interface TeacherCourseDetail extends TeacherCourseSummary {
  ageRange: string
  goals: string[]
  expectedOutcome: string
  chapters: TeacherCourseChapter[]
}

export interface TeacherClassSummary {
  id: string
  name: string
  /** null 表示后端明确返回"无法确定"（名单读取被截断），界面显示占位符而不是编造 0。 */
  studentCount: number | null
  courseTitle: string
  /** 课程进度；`null`/缺省表示尚未关联课包或无法确定。 */
  progress?: number | null
  /**
   * 学生任务完成率。后端目前不提供（需要按班级聚合任务数据），因此可以由接口数据源留空。
   * 留空时界面显示占位符，**不会**显示成 0%。
   */
  completionRate?: number | null
  /** 班级共享额度上限；`null` 表示未设上限，缺省表示界面还没拿到这个值。 */
  xiaobaoCreditLimit?: number | null
}

/** 机构 AI 使用模式：仅上课可用 / 随时可用。 */
export type ClassAiUsageMode = 'class_only' | 'anytime'

/** 机构成员角色：owner/admin 才能建班、加学生、设额度与分配任课老师。 */
export type InstitutionRole = 'owner' | 'admin' | 'teacher'

/** 机构内学生查找结果（按姓名或账号匹配）。 */
export interface TeacherStudentOption {
  id: string
  name: string
  username: string
}

/** 机构成员查找结果：分配任课老师时用，`role` 是机构角色而不是任课角色。 */
export interface TeacherMemberOption {
  userId: string
  name: string
  username: string
  role: InstitutionRole
}

/** 任课老师角色：主班老师可以开课/下课与改课包，协助老师默认不能。 */
export type ClassTeacherRole = 'lead' | 'assistant'

export interface ClassTeacherRecord {
  userId: string
  name: string
  role: ClassTeacherRole
}

export interface CreateClassInput {
  name: string
  aiUsageMode: ClassAiUsageMode
}

/** 新建课包的入参：后端 `POST /api/teacher/courses`。 */
export interface CreateCourseInput {
  title: string
  stage: TeacherCourseStage
  topic: string
  description?: string
  ageRange?: string
  expectedOutcome?: string
  goals?: string[]
}

/** 课包可改字段：含 `draft ⇄ ready` 发布与退回。 */
export interface UpdateCoursePatch {
  title?: string
  stage?: TeacherCourseStage
  status?: TeacherCourseStatus
  topic?: string
  description?: string
  ageRange?: string
  expectedOutcome?: string
  goals?: string[]
}

/** 追加课时的入参：数组字段缺省为空。 */
export interface CreateLessonInput {
  title: string
  durationMinutes: number
  objectives?: string[]
  steps?: string[]
  teacherTips?: string[]
  assignment?: string
  capabilities?: string[]
  skills?: string[]
  mcpServers?: string[]
}

/** 追加课时资源的入参：`status` 缺省由后端存成 `planned`。 */
export interface CreateResourceInput {
  title: string
  type: TeacherLessonResourceType
  status?: 'ready' | 'planned'
}

export interface TeacherLesson {
  id: string
  title: string
  courseTitle: string
}

export interface TeacherScheduleItem {
  id: string
  time: string
  classId: string
  lessonId: string
  status: 'upcoming' | 'completed'
}

export interface TeacherReviewItem {
  id: string
  studentName: string
  title: string
  type: string
  submittedAt: string
}

export type TeacherWorkStatus = 'pending' | 'reviewed'
export type TeacherWorkRating = 'encouraging' | 'good' | 'excellent'

export interface TeacherWork {
  id: string
  studentName: string
  title: string
  type: string
  classId: string
  courseTitle: string
  submittedAt: string
  previewAsset: string
  status: TeacherWorkStatus
  featured: boolean
  rating?: TeacherWorkRating
  comment?: string
}

export interface TeacherWorkReviewInput {
  rating: TeacherWorkRating
  comment: string
}

export interface ClassSessionRecord {
  id: string
  classId: string
  className: string
  lessonId: string
  lessonTitle: string
  startedAt: string
  endedAt: string
  durationMinutes: number
  studentCount: number
  pointLimit: number
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}

export interface ClassSession {
  id: string
  classId: string
  className: string
  lessonId: string
  lessonTitle: string
  startedAt: string
  pointLimit: number
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}

export interface TeacherDashboardData {
  institutionName: string
  teacherName: string
  /**
   * 调用者在本机构的角色。
   *
   * 缺省表示"还没有这个信息"（演示数据、旧后端）：界面按可管理处理——显隐只是体验，
   * 真正的拒绝永远在后端（未授权请求会拿到 403）。
   */
  institutionRole?: InstitutionRole | null
  classes: TeacherClassSummary[]
  lessons: TeacherLesson[]
  courses: TeacherCourseDetail[]
  todaySchedule: TeacherScheduleItem[]
  pendingReviews: TeacherReviewItem[]
  works: TeacherWork[]
  recentSessions: ClassSessionRecord[]
  activeSession: ClassSession | null
  classDetails: TeacherClassDetail[]
}

export type TeacherClassStatus = 'active' | 'completed'
export type TeacherStudentLearningStatus = 'creating' | 'completed' | 'needs_attention'

export interface TeacherStudentSummary {
  id: string
  name: string
  /** 学习状态；后端暂不提供时缺省，界面显示占位符而不是硬塞一个"创作中"。 */
  status?: TeacherStudentLearningStatus
  /** 任务完成数；后端暂不提供时缺省，界面显示占位符而不是 0。 */
  completedTasks?: number
  totalTasks?: number
  lastActiveAt?: string
}

export interface TeacherLessonProgress {
  lessonId: string
  title: string
  order: number
  status: 'completed' | 'next' | 'locked'
  completedAt?: string
}

export interface TeacherClassDetail {
  summary: TeacherClassSummary & { status: TeacherClassStatus; nextLessonId?: string }
  students: TeacherStudentSummary[]
  lessonProgress: TeacherLessonProgress[]
  recentSessions: ClassSessionRecord[]
  /** 任课老师；缺省表示界面还没拿到这个值（接口数据源暂不提供时留空数组）。 */
  teachers?: ClassTeacherRecord[]
}

export interface StartClassInput {
  classId: string
  lessonId: string
  pointLimit: number
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}

export interface ActiveClassSettingsInput {
  pointLimit: number
  capabilities: TeacherCapability[]
}
