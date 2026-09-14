import type { DatabaseProvider } from '../../db/types.js'

export type XiaobaoRolloutDatabase = Pick<DatabaseProvider, 'users' | 'tasks'>

export interface XiaobaoRolloutAccessInput {
  readonly runtimeName: string
  readonly userId: string
  readonly taskId: string
  readonly database: XiaobaoRolloutDatabase
  readonly environment?: Record<string, string | undefined>
}

export interface XiaobaoRolloutUserInput {
  readonly userId: string
  readonly database: XiaobaoRolloutDatabase
  readonly environment?: Record<string, string | undefined>
}

/** 逗号分隔白名单：缺省、空串、只有逗号或空白一律得到空集合（fail-closed）。 */
function parseIdList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

async function loadActiveUser(input: XiaobaoRolloutUserInput) {
  const user = await input.database.users.findById(input.userId)
  if (!user || user.status !== 'active') return null
  return user
}

/**
 * 用户级灰度资格：用于"尚未创建的新任务"是否能进入小宝 Runtime。
 * 只认 active 用户；admin 自动放行；其余必须命中 XIAOBAO_TEST_USER_IDS。
 * 不参考 taskId 白名单（taskId 只授权既有任务）。
 */
export async function isXiaobaoRolloutUser(input: XiaobaoRolloutUserInput): Promise<boolean> {
  try {
    const user = await loadActiveUser(input)
    if (!user) return false
    if (user.role === 'admin') return true

    const allowlist = parseIdList((input.environment ?? process.env).XIAOBAO_TEST_USER_IDS)
    return allowlist.has(input.userId)
  } catch {
    return false
  }
}

export async function canAccessXiaobaoRollout(input: XiaobaoRolloutAccessInput): Promise<boolean> {
  if (input.runtimeName !== 'xiaobao') return true

  try {
    const user = await loadActiveUser(input)
    if (!user) return false
    if (user.role === 'admin') return true

    const environment = input.environment ?? process.env
    const allowlistedUsers = parseIdList(environment.XIAOBAO_TEST_USER_IDS)
    const allowlistedTasks = parseIdList(environment.XIAOBAO_TEST_TASK_IDS)
    if (!allowlistedUsers.has(input.userId) && !allowlistedTasks.has(input.taskId)) return false

    return Boolean(await input.database.tasks.findByIdAndUserId(input.taskId, input.userId))
  } catch {
    return false
  }
}
