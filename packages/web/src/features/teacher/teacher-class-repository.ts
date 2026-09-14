import { averageOrUnknown, sumOrUnknown } from './teacher-format'
import type {
  ClassTeacherRecord,
  ClassTeacherRole,
  CreateClassInput,
  TeacherClassDetail,
  TeacherClassStatus,
  TeacherDashboardData,
  TeacherStudentSummary,
} from './types'

export type TeacherClassFilter = {
  query: string
  status: 'all' | TeacherClassStatus
}

export function filterTeacherClasses(data: TeacherDashboardData, filter: TeacherClassFilter) {
  const query = filter.query.trim().toLocaleLowerCase('zh-CN')

  return data.classDetails
    .map((item) => item.summary)
    .filter((item) => filter.status === 'all' || item.status === filter.status)
    .filter((item) => !query || `${item.name} ${item.courseTitle}`.toLocaleLowerCase('zh-CN').includes(query))
}

export function getTeacherClassDetail(data: TeacherDashboardData, classId: string) {
  return data.classDetails.find((item) => item.summary.id === classId)
}

export function getTeacherClassMetrics(data: TeacherDashboardData) {
  return {
    classCount: data.classes.length,
    // 未关联课包或人数无法确定时不编造 0：合计与平均只对已知项计算
    studentCount: sumOrUnknown(data.classes.map((item) => item.studentCount)),
    averageProgress: averageOrUnknown(data.classes.map((item) => item.progress)),
    pendingReviewCount: data.pendingReviews.length,
  }
}

/**
 * 下面这些 reducer 只服务**演示数据源**：接口模式下写操作必须走后端，成功后重新拉取工作区，
 * 不允许用本地推演冒充保存成功。
 */

function mapClass(
  data: TeacherDashboardData,
  classId: string,
  update: (detail: TeacherClassDetail) => TeacherClassDetail,
): TeacherDashboardData {
  const detail = data.classDetails.find((item) => item.summary.id === classId)
  const nextDetail = detail ? update(detail) : undefined

  return {
    ...data,
    classes: data.classes.map((item) => {
      // 人数以名单长度为准；名单读不出来（null）时保持 null，不编造 0
      if (item.id !== classId || !detail || !nextDetail) return item
      return { ...item, studentCount: detail.summary.studentCount === null ? null : nextDetail.students.length }
    }),
    classDetails: nextDetail
      ? data.classDetails.map((item) => (item.summary.id === classId ? nextDetail : item))
      : data.classDetails,
  }
}

/** 演示模式下新建班级：同时补一条空的班级详情，页面不会因为找不到详情而空白。 */
export function addTeacherClass(data: TeacherDashboardData, input: CreateClassInput): TeacherDashboardData {
  const id = `demo-class-${data.classes.length + 1}`
  const summary: TeacherClassDetail['summary'] = {
    id,
    name: input.name,
    studentCount: 0,
    courseTitle: '',
    progress: null,
    xiaobaoCreditLimit: null,
    status: 'active',
  }

  return {
    ...data,
    classes: [
      ...data.classes,
      {
        id,
        name: input.name,
        studentCount: 0,
        courseTitle: '',
        progress: null,
        xiaobaoCreditLimit: null,
      },
    ],
    classDetails: [
      ...data.classDetails,
      { summary, students: [], lessonProgress: [], recentSessions: [], teachers: [] },
    ],
  }
}

/** 演示模式下加入学生：名单以用户 id 为准，姓名先用 id 显示（演示数据本来就是编的）。 */
export function addClassStudent(
  data: TeacherDashboardData,
  classId: string,
  studentUserId: string,
): TeacherDashboardData {
  return mapClass(data, classId, (detail) => {
    if (detail.students.some((item) => item.id === studentUserId)) return detail
    const student: TeacherStudentSummary = {
      id: studentUserId,
      name: studentUserId,
      status: 'creating',
      completedTasks: 0,
      totalTasks: 0,
      lastActiveAt: new Date().toISOString(),
    }
    return { ...detail, students: [...detail.students, student] }
  })
}

export function removeClassStudent(
  data: TeacherDashboardData,
  classId: string,
  studentUserId: string,
): TeacherDashboardData {
  return mapClass(data, classId, (detail) => ({
    ...detail,
    students: detail.students.filter((item) => item.id !== studentUserId),
  }))
}

export function setTeacherClassBudget(
  data: TeacherDashboardData,
  classId: string,
  creditLimit: number | null,
): TeacherDashboardData {
  return {
    ...data,
    classes: data.classes.map((item) => (item.id === classId ? { ...item, xiaobaoCreditLimit: creditLimit } : item)),
    classDetails: data.classDetails.map((item) =>
      item.summary.id === classId ? { ...item, summary: { ...item.summary, xiaobaoCreditLimit: creditLimit } } : item,
    ),
  }
}

export function assignClassTeacher(
  data: TeacherDashboardData,
  classId: string,
  userId: string,
  role: ClassTeacherRole,
  name?: string,
): TeacherDashboardData {
  return mapClass(data, classId, (detail) => {
    const teachers = detail.teachers ?? []
    const existing = teachers.find((item) => item.userId === userId)
    const record: ClassTeacherRecord = { userId, name: name ?? existing?.name ?? userId, role }
    return {
      ...detail,
      teachers: existing ? teachers.map((item) => (item.userId === userId ? record : item)) : [...teachers, record],
    }
  })
}

export function removeClassTeacher(data: TeacherDashboardData, classId: string, userId: string): TeacherDashboardData {
  return mapClass(data, classId, (detail) => ({
    ...detail,
    teachers: (detail.teachers ?? []).filter((item) => item.userId !== userId),
  }))
}
