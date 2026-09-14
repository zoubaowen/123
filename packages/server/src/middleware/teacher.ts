import type { Context, Next } from 'hono'
import { getDb } from '../db/index.js'
import type { AppEnv } from './auth'
import type { InstitutionMemberRole, User } from '../db/types'

/**
 * 教师端权限中间件。
 *
 * 与 `requireAdmin` 同构：**每个请求都按 `session.user.id` 回查数据库**，不信任令牌里的任何角色信息。
 * 好处是改权限立即生效，也不会出现"令牌里还带着旧角色"这种很难排查的问题。
 */

const INSTITUTION_ADMIN_ROLES: readonly InstitutionMemberRole[] = ['owner', 'admin']

type ActiveUserResult = { ok: true; userId: string; user: User } | { ok: false; response: Response }

/** 校验会话与账号状态；禁用或已不存在的账号一律拒绝。 */
async function requireActiveUser(c: Context<AppEnv>): Promise<ActiveUserResult> {
  const session = c.get('session')
  if (!session?.user?.id) {
    return { ok: false, response: c.json({ error: 'Unauthorized' }, 401) }
  }

  const user = await getDb().users.findById(session.user.id)
  if (!user) {
    return { ok: false, response: c.json({ error: 'Account is unavailable' }, 403) }
  }
  if (user.status === 'disabled') {
    return { ok: false, response: c.json({ error: 'Account is disabled' }, 403) }
  }

  return { ok: true, userId: user.id, user }
}

/**
 * 要求调用者是某个机构的在册成员，可选限定机构角色。
 *
 * 机构 id 依次取自：路由参数 `:institutionId` → 查询参数 `institutionId` → 该用户唯一的在册机构。
 * 一人多机构时必须显式指定，否则无法判断本次请求为哪个机构服务。
 */
export function requireInstitutionMember(requiredRoles?: readonly InstitutionMemberRole[]) {
  return async (c: Context<AppEnv>, next: Next) => {
    const authenticated = await requireActiveUser(c)
    if (!authenticated.ok) return authenticated.response
    c.set('teacherUser', authenticated.user)

    const db = getDb()
    const memberships = await db.institutionMembers.listByUserId(authenticated.userId)
    // null = 无法确定（读取被截断）。绝不能把不确定当成"没有机构"而改变判断结果。
    if (memberships === null) {
      return c.json({ error: 'Institution membership unavailable' }, 503)
    }

    const activeMemberships = memberships.filter((membership) => membership.status === 'active')
    const queryInstitutionId = c.req.query('institutionId')
    const requested = c.req.param('institutionId') ?? (queryInstitutionId ? queryInstitutionId : null)
    const institutionId = requested ?? (activeMemberships.length === 1 ? activeMemberships[0].institutionId : null)

    if (institutionId === null) {
      return c.json({ error: 'Institution required' }, 400)
    }

    const institution = await db.institutions.findById(institutionId)
    if (!institution) {
      return c.json({ error: 'Institution not found' }, 404)
    }

    const membership = activeMemberships.find((item) => item.institutionId === institutionId)
    if (!membership) {
      return c.json({ error: 'Institution access required' }, 403)
    }

    if (requiredRoles && !requiredRoles.includes(membership.role)) {
      return c.json({ error: 'Institution role required' }, 403)
    }

    c.set('institution', institution)
    c.set('institutionMember', membership)
    await next()
  }
}

/**
 * 要求调用者能访问路由参数 `:classId` 指向的班级。
 *
 * 放行条件：该机构在册的 owner/admin，或该班的任课老师（`leadOnly` 时必须是 lead）。
 * 协助老师默认不能开课/下课，因此写操作要用 `leadOnly: true`。
 */
export function requireClassAccess(options: { leadOnly?: boolean; institutionAdminOnly?: boolean } = {}) {
  return async (c: Context<AppEnv>, next: Next) => {
    const authenticated = await requireActiveUser(c)
    if (!authenticated.ok) return authenticated.response
    c.set('teacherUser', authenticated.user)

    const classId = c.req.param('classId')
    const db = getDb()

    const teacherClass = classId ? await db.classes.findById(classId) : null
    if (!teacherClass) {
      return c.json({ error: 'Class not found' }, 404)
    }

    const membership = await db.institutionMembers.findByInstitutionAndUser(
      teacherClass.institutionId,
      authenticated.userId,
    )

    // 本机构在册的 owner/admin 可以管理该机构的任意班级（读写都放行）
    if (membership && membership.status === 'active' && INSTITUTION_ADMIN_ROLES.includes(membership.role)) {
      c.set('teacherClass', teacherClass)
      c.set('institutionMember', membership)
      await next()
      return
    }

    const assignment = await db.classTeachers.findByClassAndUser(teacherClass.id, authenticated.userId)
    const isClassTeacher = assignment !== null && (!options.leadOnly || assignment.role === 'lead')

    // 先判"够不够得着这个班"，再判"这个操作允不允许"：两者的拒绝文案不同，
    // 混在一起会让人分不清是"无权访问该班"还是"有访问权但此操作仅限管理员"。
    if (!isClassTeacher) {
      return c.json({ error: 'Class access required' }, 403)
    }
    if (options.institutionAdminOnly) {
      return c.json({ error: 'Institution role required' }, 403)
    }

    c.set('teacherClass', teacherClass)
    await next()
  }
}
