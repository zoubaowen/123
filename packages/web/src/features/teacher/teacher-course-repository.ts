import type {
  CreateCourseInput,
  StartClassInput,
  TeacherCourseDetail,
  TeacherCourseLessonDetail,
  TeacherCourseStage,
  TeacherCourseStatus,
  TeacherCourseSummary,
  TeacherDashboardData,
  UpdateCoursePatch,
} from './types'

export type TeacherCourseFilter = {
  query: string
  stage: 'all' | TeacherCourseStage
  topic: 'all' | string
  status: 'all' | TeacherCourseStatus
}

export function getTeacherCourseDetail(data: TeacherDashboardData, courseId: string): TeacherCourseDetail | undefined {
  return data.courses.find((course) => course.id === courseId)
}

export function getTeacherCourseLesson(
  data: TeacherDashboardData,
  courseId: string,
  lessonId: string,
): TeacherCourseLessonDetail | undefined {
  return getTeacherCourseDetail(data, courseId)
    ?.chapters.flatMap((chapter) => chapter.lessons)
    .find((lesson) => lesson.id === lessonId)
}

export function assignCourseToClasses(
  data: TeacherDashboardData,
  courseId: string,
  classIds: string[],
): TeacherDashboardData {
  const course = getTeacherCourseDetail(data, courseId)
  if (!course) return data

  const availableClassIds = new Set(data.classes.map((item) => item.id))
  const assignedClassIds = [...new Set(classIds)].filter((classId) => availableClassIds.has(classId))

  return {
    ...data,
    courses: data.courses.map((item) => (item.id === courseId ? { ...item, assignedClassIds } : item)),
  }
}

/** 演示模式下新建课包：默认草稿，与后端一致。 */
export function addTeacherCourse(data: TeacherDashboardData, input: CreateCourseInput): TeacherDashboardData {
  const course: TeacherCourseDetail = {
    id: `demo-course-${data.courses.length + 1}`,
    title: input.title,
    description: input.description ?? '',
    coverAsset: '',
    stage: input.stage,
    topic: input.topic,
    status: 'draft',
    lessonCount: 0,
    assignedClassIds: [],
    ageRange: input.ageRange ?? '',
    goals: input.goals ?? [],
    expectedOutcome: input.expectedOutcome ?? '',
    chapters: [],
  }

  return { ...data, courses: [...data.courses, course] }
}

/** 演示模式下编辑课包（含发布/退回）。 */
export function updateTeacherCourse(
  data: TeacherDashboardData,
  courseId: string,
  patch: UpdateCoursePatch,
): TeacherDashboardData {
  return {
    ...data,
    courses: data.courses.map((course) => (course.id === courseId ? { ...course, ...patch } : course)),
  }
}

export function filterTeacherCourses(data: TeacherDashboardData, filter: TeacherCourseFilter): TeacherCourseSummary[] {
  const query = filter.query.trim().toLocaleLowerCase('zh-CN')

  return data.courses
    .filter((course) => filter.stage === 'all' || course.stage === filter.stage)
    .filter((course) => filter.topic === 'all' || course.topic === filter.topic)
    .filter((course) => filter.status === 'all' || course.status === filter.status)
    .filter(
      (course) =>
        !query || `${course.title} ${course.description} ${course.topic}`.toLocaleLowerCase('zh-CN').includes(query),
    )
}

export function getTeacherCourseMetrics(data: TeacherDashboardData): {
  courseCount: number
  lessonCount: number
  assignedClassCount: number
  draftCourseCount: number
} {
  const assignedClassIds = new Set(data.courses.flatMap((course) => course.assignedClassIds))

  return {
    courseCount: data.courses.length,
    lessonCount: data.courses.reduce((count, course) => count + course.lessonCount, 0),
    assignedClassCount: assignedClassIds.size,
    draftCourseCount: data.courses.filter((course) => course.status === 'draft').length,
  }
}

export function createCourseLessonStartInput(
  data: TeacherDashboardData,
  courseId: string,
  lessonId: string,
  classId: string,
): StartClassInput | undefined {
  const course = getTeacherCourseDetail(data, courseId)
  if (!course || !course.assignedClassIds.includes(classId)) return undefined

  const lesson = getTeacherCourseLesson(data, courseId, lessonId)
  if (!lesson) return undefined

  return {
    classId,
    lessonId,
    pointLimit: 80,
    capabilities: [...lesson.capabilities],
    skills: [...lesson.skills],
    mcpServers: [...lesson.mcpServers],
  }
}
