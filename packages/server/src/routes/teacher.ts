import { Hono } from 'hono'
import { nanoid } from 'nanoid'
import { getDb } from '../db/index.js'
import { requireClassAccess, requireInstitutionMember } from '../middleware/teacher'
import { parseCreditLimit } from '../agent/xiaobao-runtime/budget-policy.js'
import { XIAOBAO_CAPABILITIES } from '../agent/xiaobao-runtime/domain.js'
import type { AppEnv } from '../middleware/auth'
import type {
  ClassAiUsageMode,
  ClassSession,
  ClassSessionPatch,
  ClassTeacherRole,
  Course,
  CourseOutline,
  InstitutionMember,
  LessonProgress,
  LessonResource,
  TeacherClass,
} from '../db/types'

/**
 * 教师端接口（只读 + 班级与名单维护）。
 *
 * 字段名尽量沿用前端 `packages/web/src/features/teacher/types.ts` 的既有命名，避免前后端两套名字互相翻译。
 *
 * **只返回真实存在的数据**。前端还有两个字段本阶段刻意不返回，因为它们的来源与语义各不相同：
 * - `completionRate`（完成率）= 学生的**任务完成率**，需要按班级聚合 `tasks`，属于独立的一步；
 * - `completion`（完善进度）= 课程 / 课时的**内容完善度**，当前没有任何存储承载它。
 * 返回 0 会被读成"完成率 0%"或"完善度 0%"，比缺字段更糟。
 */
export interface TeacherClassCourseView {
  id: string
  title: string
  lessonCount: number
  completedLessonCount: number
  /** 课程进度百分比（已完成课时 / 总课时）；总课时为 0 时为 0。 */
  progress: number
}

export interface TeacherClassView {
  id: string
  name: string
  aiUsageMode: 'class_only' | 'anytime'
  /** 班级共享额度；null 表示未设上限。 */
  xiaobaoCreditLimit: number | null
  status: 'active' | 'archived'
  /** 在班学生数；**null 表示无法确定**（名单读取被截断），与 0 含义不同。 */
  studentCount: number | null
  /** 关联课包与课程进度；**null 表示该班尚未关联课包**，与"进度 0%"不同。 */
  course: TeacherClassCourseView | null
}

export interface TeacherWorkspacePayload {
  institution: { id: string; name: string }
  teacher: { id: string; name: string }
  /** 调用者在本机构的角色：界面据此显隐"加学生 / 设额度 / 分配老师"等管理员动作。 */
  role: InstitutionMember['role']
  classes: TeacherClassView[]
  /**
   * 每个可见班级的详情（任课老师、在班学生、课时进度）。
   *
   * 首页一次带回，班级详情页就不必再发一次请求；代价是每个班多几次查询（量级与 `/classes` 相同），
   * 班级数上来后应改成按需拉取 `GET /classes/:classId`。
   */
  classDetails: TeacherClassDetailPayload[]
  /**
   * 机构课包列表。
   *
   * 与班级详情一并带回：接口模式下"课程中心"要能直接渲染。课包是机构级资源、量级可控；
   * **读不出大纲的课包直接跳过**——给一份课时数不完整的课包，会让老师以为课都排好了。
   */
  courses: TeacherCourseView[]
  /** 正在上的那节课；null 表示当前没有课堂。 */
  activeSession: TeacherClassSessionView | null
}

/**
 * 课堂记录视图。
 *
 * 字段沿用前端 `ClassSessionRecord` / `ClassSession` 的命名；时间用毫秒时间戳（与本文件其他负载一致）。
 */
export interface TeacherClassSessionView {
  id: string
  classId: string
  className: string
  lessonId: string
  /** null 表示该课时已不在当前课包大纲里（例如课包被换过）；不编造标题。 */
  lessonTitle: string | null
  startedAt: number
  endedAt: number | null
  /** 进行中的课堂没有时长。 */
  durationMinutes: number | null
  /** 开课时的人数快照；null 表示当时名单就读不出来。 */
  studentCount: number | null
  pointLimit: number
  capabilities: string[]
  skills: string[]
  mcpServers: string[]
}

export interface TeacherLessonProgressView {
  lessonId: string
  title: string
  /** 课程内的线性序号（从 1 开始）。 */
  order: number
  status: 'completed' | 'next' | 'locked'
  completedAt: number | null
}

export interface TeacherClassDetailPayload {
  class: TeacherClassView
  /** `name` 为 null 表示用户行缺失；不隐藏该行，避免任课名单静默变短。 */
  teachers: Array<{ userId: string; role: 'lead' | 'assistant'; name: string | null }>
  /** `name` 为 null 表示学生用户行缺失；不隐藏该行，避免名单静默变短。 */
  students: Array<{ id: string; name: string | null; joinedAt: number }>
  /** 课时进度；该班未关联课包时为空数组。 */
  lessonProgress: TeacherLessonProgressView[]
}

export interface TeacherCourseView {
  id: string
  title: string
  description: string
  coverAsset: string
  stage: Course['stage']
  topic: string
  status: Course['status']
  ageRange: string
  goals: string[]
  expectedOutcome: string
  /** 课时总数。机构课程量级有限，这里按课程逐个读大纲取数；量级上来后应换成一次聚合查询。 */
  lessonCount: number
  assignedClassIds: string[]
}

export interface TeacherCourseDetailPayload {
  course: TeacherCourseView
  chapters: Array<{
    id: string
    title: string
    order: number
    lessons: Array<{
      id: string
      title: string
      order: number
      durationMinutes: number
      objectives: string[]
      steps: string[]
      teacherTips: string[]
      assignment: string
      capabilities: string[]
      skills: string[]
      mcpServers: string[]
      resources: Array<{ id: string; title: string; type: string; status: string }>
    }>
  }>
}

const teacher = new Hono<AppEnv>()

function displayName(name: string | null | undefined, username: string): string {
  return name && name.trim() !== '' ? name : username
}

function isInstitutionAdministrator(member: InstitutionMember): boolean {
  return member.role === 'owner' || member.role === 'admin'
}

function classView(
  teacherClass: TeacherClass,
  studentCount: number | null,
  course: TeacherClassCourseView | null,
): TeacherClassView {
  return {
    id: teacherClass.id,
    name: teacherClass.name,
    aiUsageMode: teacherClass.aiUsageMode,
    xiaobaoCreditLimit: teacherClass.xiaobaoCreditLimit,
    status: teacherClass.status,
    studentCount,
    course,
  }
}

/** 解析 JSON 数组列；内容非法时退回空数组，避免一条脏数据把整个页面打挂。 */
function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function flattenLessons(
  outline: CourseOutline,
): Array<{ lesson: CourseOutline['chapters'][number]['lessons'][number]['lesson'] }> {
  return outline.chapters.flatMap((chapter) => chapter.lessons)
}

interface ClassCourseContext {
  /** null 表示该班**尚未关联课包**（与"进度 0%"不同）。 */
  course: TeacherClassCourseView | null
  outline: CourseOutline | null
  progressRows: LessonProgress[]
}

function buildClassCourseView(outline: CourseOutline, progressRows: LessonProgress[]): TeacherClassCourseView {
  const lessons = flattenLessons(outline)
  const completed = new Set(progressRows.filter((row) => row.status === 'completed').map((row) => row.lessonId))
  const completedLessonCount = lessons.filter((item) => completed.has(item.lesson.id)).length
  const lessonCount = lessons.length

  return {
    id: outline.course.id,
    title: outline.course.title,
    lessonCount,
    completedLessonCount,
    progress: lessonCount === 0 ? 0 : Math.round((completedLessonCount / lessonCount) * 100),
  }
}

/**
 * 班级的课包上下文：关联课包 + 课程大纲 + 课时进度行。
 *
 * **返回 null 表示无法确定**（列表被截断，或课程大纲读不出来），由调用方回 503；
 * `course` 为 null 则表示该班确实没有关联课包。两种"没有"必须分开，否则界面会把
 * "读不出来"显示成"还没排课"。
 */
async function loadClassCourseContext(classId: string): Promise<ClassCourseContext | null> {
  const db = getDb()
  const assignments = await db.classCourses.listByClass(classId)
  if (assignments === null) return null
  if (assignments.length === 0) return { course: null, outline: null, progressRows: [] }

  // 一个班可能关联多门课；取最早关联的一门作为"当前课包"，结果确定
  const chosen = [...assignments].sort(
    (left, right) => left.assignedAt - right.assignedAt || left.courseId.localeCompare(right.courseId),
  )[0]

  let outline: CourseOutline | null
  try {
    outline = await db.courses.loadOutline(chosen.courseId)
  } catch {
    // 仓储在大纲被截断时抛错；这里映射为"无法确定"，由调用方回 503
    return null
  }
  if (outline === null) return { course: null, outline: null, progressRows: [] }

  const progressRows = await db.lessonProgress.listByClass(classId)
  if (progressRows === null) return null

  return { course: buildClassCourseView(outline, progressRows), outline, progressRows }
}

/**
 * 课时进度视图。
 *
 * 有进度行时以行为准；没有行的课时按线性课程推导：**第一个非 completed 的课时为 `next`，其余为 `locked`**。
 * 这是视图层推导，不落库——将来若要支持老师手动解锁，只需改这里。
 */
function lessonProgressViews(outline: CourseOutline, rows: LessonProgress[]): TeacherLessonProgressView[] {
  const byLesson = new Map(rows.map((row) => [row.lessonId, row]))
  let nextAssigned = false

  return flattenLessons(outline).map((item, index) => {
    const row = byLesson.get(item.lesson.id)
    let status: TeacherLessonProgressView['status']

    if (row) {
      status = row.status === 'completed' ? 'completed' : row.status === 'next' ? 'next' : 'locked'
      if (status === 'next') nextAssigned = true
    } else if (!nextAssigned) {
      status = 'next'
      nextAssigned = true
    } else {
      status = 'locked'
    }

    return {
      lessonId: item.lesson.id,
      title: item.lesson.title,
      order: index + 1,
      status,
      completedAt: row?.completedAt ?? null,
    }
  })
}

function courseViewFrom(
  course: Course,
  outline: CourseOutline,
  assignments: Array<{ classId: string }>,
): TeacherCourseView {
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    coverAsset: course.coverAsset,
    stage: course.stage,
    topic: course.topic,
    status: course.status,
    ageRange: course.ageRange,
    goals: parseStringArray(course.goals),
    expectedOutcome: course.expectedOutcome,
    lessonCount: flattenLessons(outline).length,
    assignedClassIds: assignments.map((assignment) => assignment.classId).sort(),
  }
}

/** 列表用的课程视图；大纲或关联读取失败时抛错，由调用方回 503。 */
async function courseView(course: Course): Promise<TeacherCourseView> {
  const db = getDb()
  const [outline, assignments] = await Promise.all([
    db.courses.loadOutline(course.id),
    db.classCourses.listByCourse(course.id),
  ])

  if (outline === null) throw new Error('COURSE_OUTLINE_UNKNOWN')
  if (assignments === null) throw new Error('COURSE_ASSIGNMENT_UNKNOWN')

  return courseViewFrom(course, outline, assignments)
}

/**
 * 机构管理员看到本机构全部在办班级，普通老师只看到自己任课的班级。
 *
 * 任一类列表为 `null`（无法确定）时返回 null，由调用方回 503，而不是给出不完整的班级列表。
 */
async function listVisibleClassViews(
  institutionId: string,
  member: InstitutionMember,
): Promise<TeacherClassView[] | null> {
  const db = getDb()
  const classes = isInstitutionAdministrator(member)
    ? await db.classes.listByInstitution(institutionId)
    : await db.classes.listByTeacher(member.userId)

  if (classes === null) return null

  const views: TeacherClassView[] = []
  for (const teacherClass of classes) {
    const roster = await db.classEnrollments.listByClass(teacherClass.id)
    const courseContext = await loadClassCourseContext(teacherClass.id)
    if (courseContext === null) return null

    views.push(classView(teacherClass, roster === null ? null : roster.length, courseContext.course))
  }
  return views
}

teacher.get('/workspace', requireInstitutionMember(), async (c) => {
  const institution = c.get('institution')!
  const member = c.get('institutionMember')!
  const user = c.get('teacherUser')!

  const classes = await listVisibleClassViews(institution.id, member)
  if (classes === null) {
    return c.json({ error: 'Classes unavailable' }, 503)
  }

  let activeSession: TeacherClassSessionView | null
  try {
    activeSession = await loadActiveSessionView(classes)
  } catch {
    return c.json({ error: 'Class session state unavailable' }, 503)
  }

  // 班级详情与班级列表一起返回：班级详情页在接口模式下必须能直接渲染。
  // 某个班的详情读不出来时**跳过它**而不是整条 503——班级列表本身仍按 `studentCount: null`
  // 的既有语义展示（"人数无法确定"），少一个详情只会让那个班的详情页回列表。
  const classDetails: TeacherClassDetailPayload[] = []
  for (const visibleClass of classes) {
    const teacherClass = await getDb().classes.findById(visibleClass.id)
    if (teacherClass === null) continue
    const detail = await buildClassDetail(teacherClass)
    if (detail === null) continue
    classDetails.push(detail)
  }

  // 机构课包一并返回：接口模式下课程中心要能直接渲染（读不出大纲的课包跳过，返回残缺课包更糟）
  const courses: TeacherCourseView[] = []
  const institutionCourses = await getDb().courses.listByInstitution(institution.id)
  if (institutionCourses !== null) {
    for (const course of institutionCourses) {
      try {
        courses.push(await courseView(course))
      } catch {
        // 跳过这一门：宁可在列表里少一门，也不给一个课时数不对的课包
      }
    }
  }

  const payload: TeacherWorkspacePayload = {
    institution: { id: institution.id, name: institution.name },
    teacher: { id: user.id, name: displayName(user.name, user.username) },
    role: member.role,
    classes,
    classDetails,
    courses,
    activeSession,
  }
  return c.json(payload)
})

teacher.get('/classes', requireInstitutionMember(), async (c) => {
  const institution = c.get('institution')!
  const member = c.get('institutionMember')!

  const classes = await listVisibleClassViews(institution.id, member)
  if (classes === null) {
    return c.json({ error: 'Classes unavailable' }, 503)
  }

  return c.json({ classes })
})

/**
 * 单个班级的详情（任课老师、在班学生、课时进度）。
 *
 * 返回 null 表示**某一部分读不出来**（名单/任课/课包任一被截断），由调用方回 503：
 * 给一份少了学生的名单，比报错更危险。
 */
async function buildClassDetail(teacherClass: TeacherClass): Promise<TeacherClassDetailPayload | null> {
  const db = getDb()

  const [assignments, roster] = await Promise.all([
    db.classTeachers.listByClass(teacherClass.id),
    db.classEnrollments.listByClass(teacherClass.id),
  ])
  if (assignments === null || roster === null) return null

  const students: TeacherClassDetailPayload['students'] = []
  for (const enrollment of roster) {
    const student = await db.users.findById(enrollment.studentUserId)
    students.push({
      id: enrollment.studentUserId,
      // 用户行缺失时姓名留 null：名单不静默变短，界面显示"未知学生"
      name: student ? displayName(student.name, student.username) : null,
      joinedAt: enrollment.joinedAt,
    })
  }

  // 任课老师也要姓名：界面上显示一串用户 id 没有意义
  const teachers: TeacherClassDetailPayload['teachers'] = []
  for (const assignment of assignments) {
    const user = await db.users.findById(assignment.userId)
    teachers.push({
      userId: assignment.userId,
      role: assignment.role,
      name: user ? displayName(user.name, user.username) : null,
    })
  }

  const courseContext = await loadClassCourseContext(teacherClass.id)
  if (courseContext === null) return null

  return {
    class: classView(teacherClass, roster.length, courseContext.course),
    teachers,
    students,
    lessonProgress:
      courseContext.outline === null ? [] : lessonProgressViews(courseContext.outline, courseContext.progressRows),
  }
}

teacher.get('/classes/:classId', requireClassAccess(), async (c) => {
  const teacherClass = c.get('teacherClass')!

  const detail = await buildClassDetail(teacherClass)
  if (detail === null) {
    return c.json({ error: 'Class members unavailable' }, 503)
  }

  return c.json(detail)
})

// ─── 课程中心 ───────────────────────────────────────────────────────────────

teacher.get('/courses', requireInstitutionMember(), async (c) => {
  const institution = c.get('institution')!
  const db = getDb()

  const institutionCourses = await db.courses.listByInstitution(institution.id)
  if (institutionCourses === null) {
    return c.json({ error: 'Courses unavailable' }, 503)
  }

  try {
    const views: TeacherCourseView[] = []
    for (const course of institutionCourses) {
      views.push(await courseView(course))
    }
    return c.json({ courses: views })
  } catch {
    // 有大纲或关联读不出来时不返回一份"看起来完整"的课程列表
    return c.json({ error: 'Courses unavailable' }, 503)
  }
})

teacher.get('/courses/:courseId', requireInstitutionMember(), async (c) => {
  const institution = c.get('institution')!
  const courseId = c.req.param('courseId')
  const db = getDb()

  const course = courseId ? await db.courses.findById(courseId) : null
  // 跨机构课程按"不存在"处理，不泄露别的机构有什么课
  if (!course || course.institutionId !== institution.id) {
    return c.json({ error: 'Course not found' }, 404)
  }

  let outline: CourseOutline | null
  try {
    outline = await db.courses.loadOutline(course.id)
  } catch {
    return c.json({ error: 'Course outline unavailable' }, 503)
  }
  if (outline === null) {
    return c.json({ error: 'Course not found' }, 404)
  }

  const assignments = await db.classCourses.listByCourse(course.id)
  if (assignments === null) {
    return c.json({ error: 'Course assignments unavailable' }, 503)
  }

  const payload: TeacherCourseDetailPayload = {
    course: courseViewFrom(course, outline, assignments),
    chapters: outline.chapters.map((chapter, chapterIndex) => ({
      id: chapter.chapter.id,
      title: chapter.chapter.title,
      order: chapterIndex + 1,
      lessons: chapter.lessons.map((item, lessonIndex) => ({
        id: item.lesson.id,
        title: item.lesson.title,
        order: lessonIndex + 1,
        durationMinutes: item.lesson.durationMinutes,
        objectives: parseStringArray(item.lesson.objectives),
        steps: parseStringArray(item.lesson.steps),
        teacherTips: parseStringArray(item.lesson.teacherTips),
        assignment: item.lesson.assignment,
        capabilities: parseStringArray(item.lesson.capabilities),
        skills: parseStringArray(item.lesson.skills),
        mcpServers: parseStringArray(item.lesson.mcpServers),
        resources: item.resources.map((resource) => ({
          id: resource.id,
          title: resource.title,
          type: resource.type,
          status: resource.status,
        })),
      })),
    })),
  }
  return c.json(payload)
})

// ─── 班级与名单维护 ─────────────────────────────────────────────────────────

const CLASS_NAME_MAX_LENGTH = 80
const AI_USAGE_MODES: readonly ClassAiUsageMode[] = ['class_only', 'anytime']

/** 班级名：去空白后必须是 1–80 个字符。 */
function parseClassName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > CLASS_NAME_MAX_LENGTH) return null
  return name
}

/** 缺省为 `class_only`（仅上课可用），与数据库默认值一致。 */
function parseAiUsageMode(value: unknown): ClassAiUsageMode | null {
  if (value === undefined || value === null) return 'class_only'
  if (typeof value === 'string' && (AI_USAGE_MODES as readonly string[]).includes(value)) {
    return value as ClassAiUsageMode
  }
  return null
}

// 新建班级：只有机构 owner/admin 可以建班
teacher.post('/classes', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const body = (await c.req.json().catch(() => null)) as { name?: unknown; aiUsageMode?: unknown } | null

  const name = parseClassName(body?.name)
  if (name === null) {
    return c.json({ error: 'Invalid class name' }, 400)
  }

  const aiUsageMode = parseAiUsageMode(body?.aiUsageMode)
  if (aiUsageMode === null) {
    return c.json({ error: 'Invalid AI usage mode' }, 400)
  }

  const created = await getDb().classes.create({
    id: nanoid(),
    institutionId: institution.id,
    name,
    aiUsageMode,
    xiaobaoCreditLimit: null,
    status: 'active',
    archivedAt: null,
  })

  // 新建班级必然还没有学生与关联课包：这里的 0 / null 都是确定值，不是"无法确定"
  return c.json({ class: classView(created, 0, null) })
})

// 加入学生：名单维护仅限机构 owner/admin
teacher.post('/classes/:classId/students', requireClassAccess({ institutionAdminOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const body = (await c.req.json().catch(() => null)) as { studentUserId?: unknown } | null

  const studentUserId = typeof body?.studentUserId === 'string' ? body.studentUserId.trim() : ''
  if (studentUserId === '') {
    return c.json({ error: 'Invalid student' }, 400)
  }

  const db = getDb()
  const student = await db.users.findById(studentUserId)
  if (!student) {
    return c.json({ error: 'Student not found' }, 404)
  }
  // 平台运维管理员不属于任何班级名单，加进来只会造成权限语义混乱
  if (student.role !== 'user') {
    return c.json({ error: 'Invalid student' }, 400)
  }

  // 仓储保证幂等：已在班返回原记录，退班学生复用同一条记录复活，不会产生第二行
  const enrollment = await db.classEnrollments.enroll({
    id: nanoid(),
    classId: teacherClass.id,
    studentUserId,
    status: 'active',
  })

  return c.json({ enrollment })
})

// 移出学生：写退班标记而不是删除记录，历史课堂与作品仍能定位归属
teacher.delete(
  '/classes/:classId/students/:studentId',
  requireClassAccess({ institutionAdminOnly: true }),
  async (c) => {
    const teacherClass = c.get('teacherClass')!
    const studentUserId = c.req.param('studentId')
    if (!studentUserId) {
      return c.json({ error: 'Invalid student' }, 400)
    }

    const enrollment = await getDb().classEnrollments.leave(teacherClass.id, studentUserId, Date.now())
    if (enrollment === null) {
      return c.json({ error: 'Student is not enrolled' }, 404)
    }

    return c.json({ enrollment })
  },
)

// 设置或取消班级共享额度：仅机构 owner/admin
teacher.put('/classes/:classId/budget', requireClassAccess({ institutionAdminOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const body = (await c.req.json().catch(() => null)) as { creditLimit?: unknown } | null

  // 与运行时预算读取器同一口径：只接受正整数或显式 null
  const parsed = parseCreditLimit(body?.creditLimit)
  if (!parsed.ok) {
    return c.json({ error: 'Invalid credit limit' }, 400)
  }

  const db = getDb()
  // 先取上下文再写入：读不出来时直接 503，避免"写成功却回了失败"让管理员重复操作
  const roster = await db.classEnrollments.listByClass(teacherClass.id)
  const courseContext = await loadClassCourseContext(teacherClass.id)
  if (courseContext === null) {
    return c.json({ error: 'Class course progress unavailable' }, 503)
  }

  const updated = await db.classes.update(teacherClass.id, { xiaobaoCreditLimit: parsed.value })
  if (updated === null) {
    return c.json({ error: 'Class not found' }, 404)
  }

  return c.json({
    class: classView(updated, roster === null ? null : roster.length, courseContext.course),
  })
})

// ─── 课堂（开课 / 课中调整 / 下课）────────────────────────────────────────────
//
// 接口路径挂在班级下面（`/classes/:classId/sessions`）而不是设计草案里的 `/sessions`：
// 班级是权限判定的主体，复用同一套 `requireClassAccess` 才不用为"从请求体里取 classId"
// 再写一份权限逻辑，避免两处判定漂移。

/** 课堂额度上限：与班级共享额度同一口径（正整数），但**不允许 null**——没有"不限额度"的课堂。 */
const POINT_LIMIT_MAX = 10_000

function parsePointLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > POINT_LIMIT_MAX) return null
  return value
}

/** 课堂能力：只接受小宝运行时认得的能力 id；未知能力一律拒绝，不写进记录。 */
function parseSessionCapabilities(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null

  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(XIAOBAO_CAPABILITIES as readonly string[]).includes(item)) return null
    if (!result.includes(item)) result.push(item)
  }
  return result
}

/** Skills / MCP 名单：只接受字符串数组，内容原样保存。 */
function parseStringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) return null
  return value.every((item) => typeof item === 'string') ? (value as string[]) : null
}

function findLesson(outline: CourseOutline | null, lessonId: string) {
  if (outline === null) return null
  return flattenLessons(outline).find((item) => item.lesson.id === lessonId) ?? null
}

function classSessionView(
  session: ClassSession,
  className: string,
  lessonTitle: string | null,
): TeacherClassSessionView {
  return {
    id: session.id,
    classId: session.classId,
    className,
    lessonId: session.lessonId,
    lessonTitle,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMinutes: session.durationMinutes,
    studentCount: session.studentCount,
    pointLimit: session.pointLimit,
    capabilities: parseStringArray(session.capabilities),
    skills: parseStringArray(session.skills),
    mcpServers: parseStringArray(session.mcpServers),
  }
}

/**
 * 老师正在上的那节课。
 *
 * 同时只展示一节：取**开始时间最早**的一节，时间相同时取班级 id 较小的那个，
 * 保证同一份数据库状态下接口每次给出同一个答案（不依赖 Map / 查询的顺序）。
 * 课堂状态读不出来时抛错，由调用方回 503——不能把"读不到"说成"当前没有课堂"。
 */
async function loadActiveSessionView(classes: TeacherClassView[]): Promise<TeacherClassSessionView | null> {
  const db = getDb()
  let chosen: { session: ClassSession; className: string } | null = null

  for (const view of classes) {
    const active = await db.classSessions.findActiveByClass(view.id)
    if (!active) continue
    const earlier =
      chosen === null ||
      active.startedAt < chosen.session.startedAt ||
      (active.startedAt === chosen.session.startedAt && active.classId < chosen.session.classId)
    if (earlier) chosen = { session: active, className: view.name }
  }

  if (chosen === null) return null

  const courseContext = await loadClassCourseContext(chosen.session.classId)
  const lesson = courseContext === null ? null : findLesson(courseContext.outline, chosen.session.lessonId)
  return classSessionView(chosen.session, chosen.className, lesson?.lesson.title ?? null)
}

/** 某班的历史课堂记录（新课在前）；列表读不全时返回 null，由调用方回 503。 */
teacher.get('/classes/:classId/sessions', requireClassAccess(), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const db = getDb()

  const sessions = await db.classSessions.listByClass(teacherClass.id)
  if (sessions === null) {
    return c.json({ error: 'Class sessions unavailable' }, 503)
  }

  const courseContext = await loadClassCourseContext(teacherClass.id)
  if (courseContext === null) {
    return c.json({ error: 'Class course progress unavailable' }, 503)
  }

  return c.json({
    sessions: sessions.map((session) =>
      classSessionView(
        session,
        teacherClass.name,
        findLesson(courseContext.outline, session.lessonId)?.lesson.title ?? null,
      ),
    ),
  })
})

// 开课：该班 lead 老师或机构管理员
teacher.post('/classes/:classId/sessions', requireClassAccess({ leadOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const teacherUser = c.get('teacherUser')!
  const body = (await c.req.json().catch(() => null)) as {
    lessonId?: unknown
    pointLimit?: unknown
    capabilities?: unknown
    skills?: unknown
    mcpServers?: unknown
  } | null

  const lessonId = typeof body?.lessonId === 'string' ? body.lessonId.trim() : ''
  if (lessonId === '') {
    return c.json({ error: 'Invalid lesson' }, 400)
  }

  const pointLimit = parsePointLimit(body?.pointLimit)
  if (pointLimit === null) {
    return c.json({ error: 'Invalid point limit' }, 400)
  }

  const requestedCapabilities = parseSessionCapabilities(body?.capabilities)
  if (requestedCapabilities === null) {
    return c.json({ error: 'Invalid capability' }, 400)
  }
  const skills = parseStringList(body?.skills)
  if (skills === null) {
    return c.json({ error: 'Invalid skills' }, 400)
  }
  const mcpServers = parseStringList(body?.mcpServers)
  if (mcpServers === null) {
    return c.json({ error: 'Invalid MCP servers' }, 400)
  }

  const db = getDb()
  const courseContext = await loadClassCourseContext(teacherClass.id)
  if (courseContext === null) {
    return c.json({ error: 'Class course progress unavailable' }, 503)
  }

  const lesson = findLesson(courseContext.outline, lessonId)
  if (lesson === null) {
    // 只能开本班当前课包里的课时：否则课堂记录会指向一节这个班根本不上的课
    return c.json({ error: 'Lesson is not in this class course' }, 400)
  }

  // 名单读不出来时人数快照存 null，不编造 0
  const roster = await db.classEnrollments.listByClass(teacherClass.id)

  let active: ClassSession | null
  try {
    active = await db.classSessions.findActiveByClass(teacherClass.id)
  } catch {
    return c.json({ error: 'Class session state unavailable' }, 503)
  }

  // 重复开课幂等：正在上的那一节原样返回，不产生第二节课
  if (active) {
    const activeLesson = findLesson(courseContext.outline, active.lessonId)
    return c.json({ session: classSessionView(active, teacherClass.name, activeLesson?.lesson.title ?? null) })
  }

  // 没显式指定能力时按课时配置放行：课时里配置了哪些能力，这节课就开放哪些
  const capabilities =
    requestedCapabilities.length > 0 ? requestedCapabilities : parseStringArray(lesson.lesson.capabilities)

  const session = await db.classSessions.create({
    id: nanoid(),
    classId: teacherClass.id,
    lessonId,
    startedByUserId: teacherUser.id,
    startedAt: Date.now(),
    pointLimit,
    capabilities: JSON.stringify(capabilities),
    skills: JSON.stringify(skills),
    mcpServers: JSON.stringify(mcpServers),
    studentCount: roster === null ? null : roster.length,
  })

  return c.json({ session: classSessionView(session, teacherClass.name, lesson.lesson.title) })
})

// 课中调整：只改额度和名单类配置，不动结束时间
teacher.put('/classes/:classId/sessions/:sessionId', requireClassAccess({ leadOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const sessionId = c.req.param('sessionId')
  if (!sessionId) {
    return c.json({ error: 'Invalid session' }, 400)
  }

  const body = (await c.req.json().catch(() => null)) as {
    pointLimit?: unknown
    capabilities?: unknown
    skills?: unknown
    mcpServers?: unknown
  } | null

  const patch: ClassSessionPatch = {}
  if (body?.pointLimit !== undefined) {
    const pointLimit = parsePointLimit(body.pointLimit)
    if (pointLimit === null) return c.json({ error: 'Invalid point limit' }, 400)
    patch.pointLimit = pointLimit
  }
  if (body?.capabilities !== undefined) {
    const capabilities = parseSessionCapabilities(body.capabilities)
    if (capabilities === null) return c.json({ error: 'Invalid capability' }, 400)
    patch.capabilities = JSON.stringify(capabilities)
  }
  if (body?.skills !== undefined) {
    const skills = parseStringList(body.skills)
    if (skills === null) return c.json({ error: 'Invalid skills' }, 400)
    patch.skills = JSON.stringify(skills)
  }
  if (body?.mcpServers !== undefined) {
    const mcpServers = parseStringList(body.mcpServers)
    if (mcpServers === null) return c.json({ error: 'Invalid MCP servers' }, 400)
    patch.mcpServers = JSON.stringify(mcpServers)
  }
  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No changes' }, 400)
  }

  const db = getDb()
  const existing = await db.classSessions.findById(sessionId)
  // 不存在与跨班都回 404：不能让老师换个 sessionId 就改到别的班的课堂
  if (!existing || existing.classId !== teacherClass.id) {
    return c.json({ error: 'Class session not found' }, 404)
  }
  if (existing.endedAt !== null) {
    return c.json({ error: 'Class session already ended' }, 409)
  }

  const updated = await db.classSessions.update(sessionId, patch)
  if (updated === null) {
    return c.json({ error: 'Class session not found' }, 404)
  }

  const courseContext = await loadClassCourseContext(teacherClass.id)
  const lesson = courseContext === null ? null : findLesson(courseContext.outline, updated.lessonId)
  return c.json({ session: classSessionView(updated, teacherClass.name, lesson?.lesson.title ?? null) })
})

// 下课：写结束时间与时长，收回该班的课堂临时能力（能力放行由会话记录决定）
teacher.post('/classes/:classId/sessions/:sessionId/end', requireClassAccess({ leadOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const sessionId = c.req.param('sessionId')
  if (!sessionId) {
    return c.json({ error: 'Invalid session' }, 400)
  }

  const db = getDb()
  const existing = await db.classSessions.findById(sessionId)
  if (!existing || existing.classId !== teacherClass.id) {
    return c.json({ error: 'Class session not found' }, 404)
  }

  const courseContext = await loadClassCourseContext(teacherClass.id)
  if (courseContext === null) {
    return c.json({ error: 'Class course progress unavailable' }, 503)
  }
  const lesson = findLesson(courseContext.outline, existing.lessonId)

  // 重复下课幂等：已经下课的课堂原样返回，不重算时长
  if (existing.endedAt !== null) {
    return c.json({ session: classSessionView(existing, teacherClass.name, lesson?.lesson.title ?? null) })
  }

  const endedAt = Date.now()
  // 不足一分钟的课堂记 1 分钟：记录为 0 会被读成"没上课"
  const durationMinutes = Math.max(1, Math.round((endedAt - existing.startedAt) / 60_000))
  const updated = await db.classSessions.update(sessionId, { endedAt, durationMinutes })
  if (updated === null) {
    return c.json({ error: 'Class session not found' }, 404)
  }

  return c.json({ session: classSessionView(updated, teacherClass.name, lesson?.lesson.title ?? null) })
})

// ─── 机构学生查找 ────────────────────────────────────────────────────────────
//
// 有了它，机构管理员在界面上按姓名/账号加学生，而不是让老师去抄 20 位的用户 id。
// 机构范围只从**调用者的在册成员关系**推导，绝不接受请求里的 institutionId——那会变成跨机构名单泄露。
// 只给 owner/admin：加学生本来就是管理员动作，让普通老师也能查全机构名单没有必要。

teacher.get('/students', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const query = (c.req.query('query') ?? '').trim().toLocaleLowerCase('zh-CN')
  const db = getDb()

  const classes = await db.classes.listByInstitution(institution.id)
  if (classes === null) {
    return c.json({ error: 'Students unavailable' }, 503)
  }

  // 在班学生 = 本机构在办班级里 status='active' 的选课记录（退班学生不在其中）
  const studentIds = new Set<string>()
  for (const teacherClass of classes) {
    const roster = await db.classEnrollments.listByClass(teacherClass.id)
    if (roster === null) {
      // 读不全就报错：给一份"看起来完整"的短名单会让人以为学生不在机构里
      return c.json({ error: 'Students unavailable' }, 503)
    }
    for (const enrollment of roster) studentIds.add(enrollment.studentUserId)
  }

  const students: Array<{ id: string; name: string; username: string }> = []
  for (const studentId of studentIds) {
    const user = await db.users.findById(studentId)
    // 用户行缺失时跳过查找结果；班级名单不静默变短是班级详情那边的责任
    if (!user) continue
    const name = displayName(user.name, user.username)
    if (query !== '' && !`${name} ${user.username}`.toLocaleLowerCase('zh-CN').includes(query)) continue
    students.push({ id: user.id, name, username: user.username })
  }

  students.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.id.localeCompare(right.id))
  return c.json({ students })
})

// 机构成员查找：分配任课老师时按姓名/账号选人，而不是让管理员去抄用户 id。
// 与 `/students` 同构：机构范围只从**调用者的在册成员关系**推导，只给 owner/admin。
teacher.get('/teachers', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const query = (c.req.query('query') ?? '').trim().toLocaleLowerCase('zh-CN')
  const db = getDb()

  const members = await db.institutionMembers.listByInstitutionId(institution.id)
  if (members === null) {
    return c.json({ error: 'Teachers unavailable' }, 503)
  }

  const teachers: Array<{ userId: string; name: string; username: string; role: InstitutionMember['role'] }> = []
  for (const member of members) {
    if (member.status !== 'active') continue
    const user = await db.users.findById(member.userId)
    // 用户行缺失时跳过：不能编一个名字出来
    if (!user) continue
    const name = displayName(user.name, user.username)
    if (query !== '' && !`${name} ${user.username}`.toLocaleLowerCase('zh-CN').includes(query)) continue
    teachers.push({ userId: user.id, name, username: user.username, role: member.role })
  }

  teachers.sort(
    (left, right) => left.name.localeCompare(right.name, 'zh-CN') || left.userId.localeCompare(right.userId),
  )
  return c.json({ teachers })
})

// ─── 任课老师 ────────────────────────────────────────────────────────────────
//
// 没有这个入口，"老师只能管自己负责的班级"就落不了地：班级建出来之后没有任何接口能把 lead /
// assistant 老师挂上去，普通老师在 `/workspace` 里永远看不到班级，也开不了课。
// 分配权限与名单维护同级（机构 owner/admin）：权限矩阵没有把"增删任课老师"给 lead 老师。

const CLASS_TEACHER_ROLES = ['lead', 'assistant'] as const

/** 缺省按主班老师（lead）处理，与产品口径"默认主班老师"一致。 */
function parseClassTeacherRole(value: unknown): ClassTeacherRole | null {
  if (value === undefined || value === null) return 'lead'
  if (typeof value === 'string' && (CLASS_TEACHER_ROLES as readonly string[]).includes(value)) {
    return value as ClassTeacherRole
  }
  return null
}

// 分配任课老师：机构 owner/admin；重复分配幂等，改角色按"重新分配"处理
teacher.put('/classes/:classId/teachers', requireClassAccess({ institutionAdminOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const body = (await c.req.json().catch(() => null)) as { userId?: unknown; role?: unknown } | null

  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (userId === '') {
    return c.json({ error: 'Invalid user' }, 400)
  }

  const role = parseClassTeacherRole(body?.role)
  if (role === null) {
    return c.json({ error: 'Invalid class teacher role' }, 400)
  }

  const db = getDb()
  const user = await db.users.findById(userId)
  if (!user) {
    return c.json({ error: 'User not found' }, 404)
  }
  // 平台运维管理员与学生都不是任课老师
  if (user.role !== 'user') {
    return c.json({ error: 'Invalid teacher' }, 400)
  }

  // 必须是本机构的在册成员：否则等于把别的机构的老师拉进这个班
  const membership = await db.institutionMembers.findByInstitutionAndUser(teacherClass.institutionId, userId)
  if (!membership || membership.status !== 'active') {
    return c.json({ error: 'User is not an institution member' }, 400)
  }

  const existing = await db.classTeachers.findByClassAndUser(teacherClass.id, userId)
  if (existing && existing.role === role) {
    // 幂等：本来就是这个人这个角色，原样返回
    return c.json({ teacher: existing })
  }
  if (existing) {
    // 改角色（lead ⇄ assistant）＝重新分配：仓储没有 update，先解除再挂上。
    // 解不掉就直接失败，避免同一人在同一班留下两条不同的角色记录。
    const removed = await db.classTeachers.remove(teacherClass.id, userId)
    if (!removed) {
      return c.json({ error: 'Class teacher unavailable' }, 503)
    }
  }

  const created = await db.classTeachers.create({ classId: teacherClass.id, userId, role })
  if (created === null) {
    // 并发下重复写入：已经是任课老师，按幂等返回现有记录
    const current = await db.classTeachers.findByClassAndUser(teacherClass.id, userId)
    if (current) return c.json({ teacher: current })
    return c.json({ error: 'Class teacher unavailable' }, 503)
  }

  return c.json({ teacher: created })
})

// 解除任课关系：机构 owner/admin
teacher.delete('/classes/:classId/teachers/:userId', requireClassAccess({ institutionAdminOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const userId = c.req.param('userId')
  if (!userId) {
    return c.json({ error: 'Invalid user' }, 400)
  }

  const removed = await getDb().classTeachers.remove(teacherClass.id, userId)
  if (!removed) {
    return c.json({ error: 'Teacher is not assigned to this class' }, 404)
  }

  return c.json({ removed: true })
})

// ─── 课包写入（机构级资源，仅 owner/admin）────────────────────────────────────
//
// 课包属于机构（设计文档 D6）：lead 老师可以把自己班的课关联成已有课包，
// 但编辑课包内容会改到别的班正在上的同一份内容，因此只给机构管理员。

const COURSE_STAGES = ['lower_primary', 'upper_primary', 'middle_school'] as const
const COURSE_STATUSES = ['ready', 'draft'] as const
const COURSE_TITLE_MAX_LENGTH = 80

/** 课包名：去空白后 1–80 字。 */
function parseCourseTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.trim()
  if (title === '' || title.length > COURSE_TITLE_MAX_LENGTH) return null
  return title
}

function parseCourseStage(value: unknown): Course['stage'] | null {
  if (typeof value === 'string' && (COURSE_STAGES as readonly string[]).includes(value)) {
    return value as Course['stage']
  }
  return null
}

function parseCourseStatus(value: unknown): Course['status'] | null {
  if (typeof value === 'string' && (COURSE_STATUSES as readonly string[]).includes(value)) {
    return value as Course['status']
  }
  return null
}

/** 可选文本字段：缺省取默认值，传了就必须是字符串。 */
function parseOptionalText(value: unknown, fallback: string): string | null {
  if (value === undefined || value === null) return fallback
  return typeof value === 'string' ? value : null
}

function parseGoals(value: unknown): string | null {
  if (value === undefined || value === null) return JSON.stringify([])
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
  return JSON.stringify(value)
}

/** 课包视图需要大纲与关联；读不出来时按 503 处理，不返回残缺视图。 */
async function courseWithView(course: Course): Promise<TeacherCourseView | null> {
  try {
    return await courseView(course)
  } catch {
    return null
  }
}

// 新建课包
teacher.post('/courses', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

  const title = parseCourseTitle(body?.title)
  if (title === null) {
    return c.json({ error: 'Invalid course title' }, 400)
  }

  const stage = parseCourseStage(body?.stage)
  if (stage === null) {
    return c.json({ error: 'Invalid course stage' }, 400)
  }

  const topic = parseOptionalText(body?.topic, '')
  const description = parseOptionalText(body?.description, '')
  const coverAsset = parseOptionalText(body?.coverAsset, '')
  const ageRange = parseOptionalText(body?.ageRange, '')
  const expectedOutcome = parseOptionalText(body?.expectedOutcome, '')
  const goals = parseGoals(body?.goals)
  if (topic === null || description === null || coverAsset === null || ageRange === null || expectedOutcome === null) {
    return c.json({ error: 'Invalid course text' }, 400)
  }
  if (goals === null) {
    return c.json({ error: 'Invalid course goals' }, 400)
  }

  const course = await getDb().courses.create({
    id: nanoid(),
    // 机构一律来自调用者的成员关系，绝不取请求体里的 institutionId
    institutionId: institution.id,
    title,
    description,
    coverAsset,
    stage,
    topic,
    // 新课程一节课都没有：默认 draft，班级关联它之前必须显式发布
    status: 'draft',
    ageRange,
    goals,
    expectedOutcome,
  })

  const view = await courseWithView(course)
  if (view === null) {
    return c.json({ error: 'Course unavailable' }, 503)
  }

  return c.json({ course: view })
})

// 编辑课包（含发布 / 退回草稿）
teacher.patch('/courses/:courseId', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const courseId = c.req.param('courseId')
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

  const db = getDb()
  const course = courseId ? await db.courses.findById(courseId) : null
  // 跨机构课程按"不存在"处理：否则可以靠猜 id 改别的机构的课包
  if (!course || course.institutionId !== institution.id) {
    return c.json({ error: 'Course not found' }, 404)
  }

  const patch: Partial<Omit<Course, 'id' | 'institutionId' | 'createdAt'>> = {}

  if (body?.title !== undefined) {
    const title = parseCourseTitle(body.title)
    if (title === null) return c.json({ error: 'Invalid course title' }, 400)
    patch.title = title
  }
  if (body?.stage !== undefined) {
    const stage = parseCourseStage(body.stage)
    if (stage === null) return c.json({ error: 'Invalid course stage' }, 400)
    patch.stage = stage
  }
  if (body?.status !== undefined) {
    const status = parseCourseStatus(body.status)
    if (status === null) return c.json({ error: 'Invalid course status' }, 400)
    patch.status = status
  }
  for (const field of ['topic', 'description', 'coverAsset', 'ageRange', 'expectedOutcome'] as const) {
    if (body?.[field] !== undefined) {
      const value = parseOptionalText(body[field], '')
      if (value === null) return c.json({ error: 'Invalid course text' }, 400)
      patch[field] = value
    }
  }
  if (body?.goals !== undefined) {
    const goals = parseGoals(body.goals)
    if (goals === null) return c.json({ error: 'Invalid course goals' }, 400)
    patch.goals = goals
  }

  if (Object.keys(patch).length === 0) {
    return c.json({ error: 'No changes' }, 400)
  }

  const updated = await db.courses.update(course.id, patch)
  if (updated === null) {
    return c.json({ error: 'Course not found' }, 404)
  }

  const view = await courseWithView(updated)
  if (view === null) {
    return c.json({ error: 'Course unavailable' }, 503)
  }

  return c.json({ course: view })
})

/** 追加排序：取当前最大序号 + 1。让客户端传序号，两个管理员同时加就会撞号。 */
function nextSortOrder(orders: number[]): number {
  return orders.length === 0 ? 1 : Math.max(...orders) + 1
}

/** 读课包大纲并确认它属于本机构；跨机构按"不存在"处理，不泄露别的机构有什么课。 */
async function loadOwnedOutline(
  institutionId: string,
  courseId: string | undefined,
): Promise<CourseOutline | null | 'unavailable'> {
  const db = getDb()
  const course = courseId ? await db.courses.findById(courseId) : null
  if (!course || course.institutionId !== institutionId) return null

  try {
    return await db.courses.loadOutline(course.id)
  } catch {
    return 'unavailable'
  }
}

// 追加章节
teacher.post('/courses/:courseId/chapters', requireInstitutionMember(['owner', 'admin']), async (c) => {
  const institution = c.get('institution')!
  const courseId = c.req.param('courseId')
  const body = (await c.req.json().catch(() => null)) as { title?: unknown } | null

  const title = parseCourseTitle(body?.title)
  if (title === null) {
    return c.json({ error: 'Invalid chapter title' }, 400)
  }

  const outline = await loadOwnedOutline(institution.id, courseId)
  if (outline === 'unavailable') {
    return c.json({ error: 'Course outline unavailable' }, 503)
  }
  if (outline === null) {
    return c.json({ error: 'Course not found' }, 404)
  }

  const chapter = await getDb().courses.createChapter({
    id: nanoid(),
    courseId: outline.course.id,
    title,
    sortOrder: nextSortOrder(outline.chapters.map((item) => item.chapter.sortOrder)),
  })

  return c.json({ chapter: { id: chapter.id, title: chapter.title, order: chapter.sortOrder } })
})

/** 课时内容字段（数组）解析：缺省存空数组，给了就必须是字符串数组。 */
function parseLessonArrays(body: Record<string, unknown> | null): Record<string, string> | null {
  const fields = ['objectives', 'steps', 'teacherTips', 'capabilities', 'skills', 'mcpServers'] as const
  const result: Record<string, string> = {}

  for (const field of fields) {
    const value = body?.[field]
    if (value === undefined || value === null) {
      result[field] = JSON.stringify([])
      continue
    }
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null
    result[field] = JSON.stringify(value)
  }

  return result
}

function parseDurationMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 600) return null
  return value
}

// 追加课时
teacher.post(
  '/courses/:courseId/chapters/:chapterId/lessons',
  requireInstitutionMember(['owner', 'admin']),
  async (c) => {
    const institution = c.get('institution')!
    const courseId = c.req.param('courseId')
    const chapterId = c.req.param('chapterId')
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

    const title = parseCourseTitle(body?.title)
    if (title === null) {
      return c.json({ error: 'Invalid lesson title' }, 400)
    }

    const durationMinutes = parseDurationMinutes(body?.durationMinutes)
    if (durationMinutes === null) {
      return c.json({ error: 'Invalid lesson duration' }, 400)
    }

    const arrays = parseLessonArrays(body)
    if (arrays === null) {
      return c.json({ error: 'Invalid lesson content' }, 400)
    }

    const assignment = parseOptionalText(body?.assignment, '')
    if (assignment === null) {
      return c.json({ error: 'Invalid lesson content' }, 400)
    }

    const outline = await loadOwnedOutline(institution.id, courseId)
    if (outline === 'unavailable') {
      return c.json({ error: 'Course outline unavailable' }, 503)
    }
    if (outline === null) {
      return c.json({ error: 'Course not found' }, 404)
    }

    // 章节必须属于这个课包：否则课时会被挂到别的课包里
    const chapter = outline.chapters.find((item) => item.chapter.id === chapterId)
    if (!chapter) {
      return c.json({ error: 'Chapter not found' }, 404)
    }

    const lesson = await getDb().courses.createLesson({
      id: nanoid(),
      chapterId: chapter.chapter.id,
      title,
      sortOrder: nextSortOrder(chapter.lessons.map((item) => item.lesson.sortOrder)),
      durationMinutes,
      assignment,
      objectives: arrays.objectives,
      steps: arrays.steps,
      teacherTips: arrays.teacherTips,
      capabilities: arrays.capabilities,
      skills: arrays.skills,
      mcpServers: arrays.mcpServers,
    })

    return c.json({
      lesson: {
        id: lesson.id,
        title: lesson.title,
        order: lesson.sortOrder,
        durationMinutes: lesson.durationMinutes,
        assignment: lesson.assignment,
        objectives: parseStringArray(arrays.objectives),
        steps: parseStringArray(arrays.steps),
        teacherTips: parseStringArray(arrays.teacherTips),
        capabilities: parseStringArray(arrays.capabilities),
        skills: parseStringArray(arrays.skills),
        mcpServers: parseStringArray(arrays.mcpServers),
      },
    })
  },
)

const LESSON_RESOURCE_TYPES = ['slides', 'demo', 'worksheet', 'assignment'] as const
const LESSON_RESOURCE_STATUSES = ['ready', 'planned'] as const

function parseResourceType(value: unknown): LessonResource['type'] | null {
  if (typeof value === 'string' && (LESSON_RESOURCE_TYPES as readonly string[]).includes(value)) {
    return value as LessonResource['type']
  }
  return null
}

/** 缺省 `planned`：没做好的资源不该被当成"就绪"，否则老师会以为学生能看到它。 */
function parseResourceStatus(value: unknown): LessonResource['status'] | null {
  if (value === undefined || value === null) return 'planned'
  if (typeof value === 'string' && (LESSON_RESOURCE_STATUSES as readonly string[]).includes(value)) {
    return value as LessonResource['status']
  }
  return null
}

// 给课时挂资源（课件 / 演示 / 练习单 / 作业）
teacher.post(
  '/courses/:courseId/chapters/:chapterId/lessons/:lessonId/resources',
  requireInstitutionMember(['owner', 'admin']),
  async (c) => {
    const institution = c.get('institution')!
    const courseId = c.req.param('courseId')
    const chapterId = c.req.param('chapterId')
    const lessonId = c.req.param('lessonId')
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null

    const title = parseCourseTitle(body?.title)
    if (title === null) {
      return c.json({ error: 'Invalid resource title' }, 400)
    }

    const type = parseResourceType(body?.type)
    if (type === null) {
      return c.json({ error: 'Invalid resource type' }, 400)
    }

    const status = parseResourceStatus(body?.status)
    if (status === null) {
      return c.json({ error: 'Invalid resource status' }, 400)
    }

    const outline = await loadOwnedOutline(institution.id, courseId)
    if (outline === 'unavailable') {
      return c.json({ error: 'Course outline unavailable' }, 503)
    }
    if (outline === null) {
      return c.json({ error: 'Course not found' }, 404)
    }

    // 章节与课时都必须属于这个课包：否则资源会挂到别的课包上
    const chapter = outline.chapters.find((item) => item.chapter.id === chapterId)
    const lesson = chapter?.lessons.find((item) => item.lesson.id === lessonId)
    if (!chapter || !lesson) {
      return c.json({ error: 'Lesson not found' }, 404)
    }

    const resource = await getDb().courses.createResource({
      id: nanoid(),
      lessonId: lesson.lesson.id,
      title,
      type,
      status,
    })

    return c.json({ resource })
  },
)

// 关联课包：该班 lead 老师或机构管理员；协助老师默认不能改课包
teacher.post('/classes/:classId/courses', requireClassAccess({ leadOnly: true }), async (c) => {
  const teacherClass = c.get('teacherClass')!
  const body = (await c.req.json().catch(() => null)) as { courseId?: unknown } | null

  const courseId = typeof body?.courseId === 'string' ? body.courseId.trim() : ''
  if (courseId === '') {
    return c.json({ error: 'Invalid course' }, 400)
  }

  const db = getDb()
  const course = await db.courses.findById(courseId)
  if (!course) {
    return c.json({ error: 'Course not found' }, 404)
  }
  // 只能关联本机构的课包：跨机构关联会把别的机构的课程内容带进这个班
  if (course.institutionId !== teacherClass.institutionId) {
    return c.json({ error: 'Course is not in this institution' }, 400)
  }

  // 幂等：重复关联返回原记录，不产生第二行
  const assignment = await db.classCourses.assign({ classId: teacherClass.id, courseId })
  return c.json({ assignment })
})

export default teacher
