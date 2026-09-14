import type { ActiveClassSettingsInput, ClassSessionRecord, StartClassInput, TeacherDashboardData } from './types'

export function startClass(data: TeacherDashboardData, input: StartClassInput): TeacherDashboardData {
  if (data.activeSession) throw new Error('已有课堂正在进行')

  const classInfo = data.classes.find((item) => item.id === input.classId)
  const lesson = data.lessons.find((item) => item.id === input.lessonId)
  if (!classInfo || !lesson) throw new Error('班级或课节不存在')
  if (!input.capabilities.includes('chat')) throw new Error('课堂必须保留 AI 对话能力')
  if (input.pointLimit < 10 || input.pointLimit > 500) throw new Error('课堂额度必须在 10 到 500 之间')

  return {
    ...data,
    activeSession: {
      id: `${input.classId}-${input.lessonId}-active`,
      classId: classInfo.id,
      className: classInfo.name,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      startedAt: new Date().toISOString(),
      pointLimit: input.pointLimit,
      capabilities: [...input.capabilities],
      skills: [...input.skills],
      mcpServers: [...input.mcpServers],
    },
  }
}

export function endClass(data: TeacherDashboardData): TeacherDashboardData {
  if (!data.activeSession) return data

  const endedAt = new Date()
  const startedAt = new Date(data.activeSession.startedAt)
  const classInfo = data.classes.find((item) => item.id === data.activeSession?.classId)
  const record: ClassSessionRecord = {
    id: `${data.activeSession.id}-record`,
    classId: data.activeSession.classId,
    className: data.activeSession.className,
    lessonId: data.activeSession.lessonId,
    lessonTitle: data.activeSession.lessonTitle,
    startedAt: data.activeSession.startedAt,
    endedAt: endedAt.toISOString(),
    durationMinutes: Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000)),
    studentCount: classInfo?.studentCount ?? 0,
    pointLimit: data.activeSession.pointLimit,
    capabilities: [...data.activeSession.capabilities],
    skills: [...data.activeSession.skills],
    mcpServers: [...data.activeSession.mcpServers],
  }

  return {
    ...data,
    activeSession: null,
    recentSessions: [record, ...data.recentSessions],
  }
}

export function updateActiveClassSettings(
  data: TeacherDashboardData,
  input: ActiveClassSettingsInput,
): TeacherDashboardData {
  if (!data.activeSession) throw new Error('当前没有进行中的课堂')
  if (!input.capabilities.includes('chat')) throw new Error('课堂必须保留 AI 对话能力')
  if (input.pointLimit < 10 || input.pointLimit > 500) throw new Error('课堂额度必须在 10 到 500 之间')

  return {
    ...data,
    activeSession: {
      ...data.activeSession,
      pointLimit: input.pointLimit,
      capabilities: [...input.capabilities],
    },
  }
}
