import type { DatabaseProvider } from '../../db/types.js'
import {
  XIAOBAO_CLASS_CAPABILITY_NOT_GRANTED_REASON,
  XIAOBAO_CLASS_NOT_IN_SESSION_REASON,
  type XiaobaoClassSessionGate,
} from './class-session-gate.js'
import { XIAOBAO_PRODUCTION_CAPABILITIES, type XiaobaoCapability } from './domain.js'
import { isXiaobaoRolloutUser } from './rollout.js'

export type XiaobaoTaskCreationDecision =
  | { readonly ok: true; readonly capability: XiaobaoCapability | null }
  | { readonly ok: false; readonly status: 400 | 403; readonly error: string }

export interface XiaobaoTaskCreationInput {
  readonly rawCapability: unknown
  readonly selectedRuntime: unknown
  readonly userId: string
  readonly database: Pick<DatabaseProvider, 'users' | 'tasks'>
  readonly environment?: Record<string, string | undefined>
  /**
   * 课堂能力门禁（可省）。
   *
   * 省略时行为与加门禁之前逐字节一致——这是既有测试与灰度链路的基线，不能被门禁顺手改掉。
   */
  readonly classSessionGate?: XiaobaoClassSessionGate
}

const INVALID_CAPABILITY: XiaobaoTaskCreationDecision = {
  ok: false,
  status: 400,
  error: 'Invalid XiaoBao capability',
}
const RESTRICTED_RUNTIME: XiaobaoTaskCreationDecision = {
  ok: false,
  status: 403,
  error: 'Xiaobao runtime is restricted',
}

/**
 * 课堂时间之外，`class_only` 班级的学生不获得任何小宝能力。
 *
 * 选 Runtime 时不带能力也算"要用小宝"：这时候同样拒绝，而不是让请求走到运行期才失败。
 */
const CLASS_NOT_IN_SESSION: XiaobaoTaskCreationDecision = {
  ok: false,
  status: 403,
  error: XIAOBAO_CLASS_NOT_IN_SESSION_REASON,
}

const CLASS_CAPABILITY_NOT_GRANTED: XiaobaoTaskCreationDecision = {
  ok: false,
  status: 403,
  error: XIAOBAO_CLASS_CAPABILITY_NOT_GRANTED_REASON,
}

/**
 * 创建任务时的小宝裁决（全部 fail-closed）：
 * - 既没传 capability 也没选小宝 Runtime → 放行，capability 为 null，行为与今天逐字节一致；
 * - capability 不在生产放行集合内（`study`、`image`、`video`、`music`、任意字符串、非字符串）→ 400，且不读取用户；
 *   这里直接以 `XIAOBAO_PRODUCTION_CAPABILITIES` 为准，避免创建出运行时必然拒绝的任务；
 * - capability 合法但 `selectedRuntime !== 'xiaobao'` → 400，避免产生"挂着能力却不是小宝"的脏行；
 * - `selectedRuntime === 'xiaobao'` → 必须通过用户级灰度资格（active 且 admin 或白名单），否则 403；
 * - 再叠一层课堂门禁（传入 `classSessionGate` 时）：`class_only` 班的学生非上课时间 403，
 *   上课期间只能使用这节课配置的能力；`anytime` 班的学生不受此限制。
 *
 * 运行期 `resolveProductionXiaobaoCapability` 仍会独立复检同一集合（防御性双保险）。
 */
export async function resolveXiaobaoTaskCreation(
  input: XiaobaoTaskCreationInput,
): Promise<XiaobaoTaskCreationDecision> {
  const capability =
    typeof input.rawCapability === 'string' &&
    (XIAOBAO_PRODUCTION_CAPABILITIES as readonly string[]).includes(input.rawCapability)
      ? (input.rawCapability as XiaobaoCapability)
      : undefined
  const hasCapabilityInput = input.rawCapability !== undefined && input.rawCapability !== null

  if (hasCapabilityInput && !capability) return INVALID_CAPABILITY
  if (capability && input.selectedRuntime !== 'xiaobao') return INVALID_CAPABILITY

  if (input.selectedRuntime === 'xiaobao') {
    const allowed = await isXiaobaoRolloutUser({
      userId: input.userId,
      database: input.database,
      environment: input.environment,
    })
    if (!allowed) return RESTRICTED_RUNTIME

    // 灰度通过之后再看课堂：只上 `class_only` 班的学生，非上课时间一律拒绝，
    // 上课期间也只有这节课配置的能力可用。
    if (input.classSessionGate) {
      const state = await input.classSessionGate.resolveForStudent(input.userId)
      if (state.mode === 'class_only') {
        if (!state.inSession) return CLASS_NOT_IN_SESSION
        if (capability && !state.capabilities.includes(capability)) return CLASS_CAPABILITY_NOT_GRANTED
      }
    }
  }

  return { ok: true, capability: capability ?? null }
}
