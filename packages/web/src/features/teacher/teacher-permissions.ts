import type { TeacherDashboardData } from './types'

/**
 * 界面要不要显示"建班 / 加学生 / 设班级额度 / 分配任课老师"这类机构管理员动作。
 *
 * **这只是体验，不是权限**：后端对这些接口一律独立判权，未授权请求会拿到 403。
 * 反过来，信息还没拿到时（演示数据、旧后端不返回 role）按"可管理"处理——
 * 把按钮藏起来只会让人以为功能不存在，而不是更安全。
 */
export function canManageInstitution(data: Pick<TeacherDashboardData, 'institutionRole'>): boolean {
  return data.institutionRole === undefined || data.institutionRole === null || data.institutionRole !== 'teacher'
}
