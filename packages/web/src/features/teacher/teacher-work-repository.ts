import type { TeacherDashboardData, TeacherWork, TeacherWorkReviewInput, TeacherWorkStatus } from './types'

export interface TeacherWorkFilters {
  keyword: string
  classId: string
  status: TeacherWorkStatus | 'all'
}

export function filterTeacherWorks(works: TeacherWork[], filters: TeacherWorkFilters) {
  const keyword = filters.keyword.trim().toLocaleLowerCase('zh-CN')
  return works.filter((work) => {
    const matchesKeyword =
      !keyword || `${work.title} ${work.studentName} ${work.courseTitle}`.toLocaleLowerCase('zh-CN').includes(keyword)
    const matchesClass = filters.classId === 'all' || work.classId === filters.classId
    const matchesStatus = filters.status === 'all' || work.status === filters.status
    return matchesKeyword && matchesClass && matchesStatus
  })
}

export function reviewTeacherWork(
  data: TeacherDashboardData,
  workId: string,
  input: TeacherWorkReviewInput,
): TeacherDashboardData {
  if (!input.comment.trim()) throw new Error('请填写点评内容')
  return {
    ...data,
    works: data.works.map((work) =>
      work.id === workId ? { ...work, status: 'reviewed', rating: input.rating, comment: input.comment.trim() } : work,
    ),
    pendingReviews: data.pendingReviews.filter((work) => work.id !== workId),
  }
}

export function toggleFeaturedTeacherWork(data: TeacherDashboardData, workId: string): TeacherDashboardData {
  return {
    ...data,
    works: data.works.map((work) => (work.id === workId ? { ...work, featured: !work.featured } : work)),
  }
}
