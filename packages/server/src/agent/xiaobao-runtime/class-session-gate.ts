import type { DatabaseProvider } from '../../db/types.js'
import { XIAOBAO_CAPABILITIES, type XiaobaoCapability } from './domain.js'

/**
 * 课堂能力门禁。
 *
 * 产品口径（设计文档 D4 / §6）：`class_only` 班级的学生**只在开课期间**获得这节课配置的能力，
 * 下课即收回；`anytime` 班级的学生不受课堂时间限制。
 *
 * 这里是"能力放行集合"的第二层，叠在既有生产白名单之上：白名单决定"这个能力在生产里存在吗"，
 * 课堂门禁决定"这个学生此刻能用它吗"。两条都是 fail-closed，任何读不出来的状态都不放行。
 */

export const XIAOBAO_CLASS_NOT_IN_SESSION_REASON = '本节课还没有开始，暂时不能使用小宝'
export const XIAOBAO_CLASS_CAPABILITY_NOT_GRANTED_REASON = '本节课没有开放这个能力'

/**
 * 一个学生此刻的课堂状态。
 *
 * - `unrestricted`：不在任何 `class_only` 班级里（或已经在 `anytime` 班级里）——课堂时间不构成限制；
 * - `class_only`：只上"仅上课可用"的班。`inSession` 表示此刻是否正在上课，`capabilities` 是
 *   正在上的那几节课**配置的能力并集**（没有进行中的课时为空集）。
 */
export type XiaobaoClassCapabilityState =
  | { readonly mode: 'unrestricted' }
  | { readonly mode: 'class_only'; readonly inSession: boolean; readonly capabilities: readonly XiaobaoCapability[] }

export interface XiaobaoClassSessionGate {
  /**
   * 读取该学生此刻的课堂状态。
   *
   * 读取被截断（无法确定）时**抛错**：把"读不到"当成"没有限制"会让学生在非上课时间拿到能力，
   * 当成"没有进行中的课"则会把上课中的学生挡在门外——两种都很糟，所以交给调用方按 fail-closed 处理。
   */
  resolveForStudent(userId: string): Promise<XiaobaoClassCapabilityState>
}

const DENIED: XiaobaoClassCapabilityState = { mode: 'class_only', inSession: false, capabilities: [] }

function parseCapabilities(raw: string): XiaobaoCapability[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 存进去的不是合法 JSON：当作"什么都没放行"，绝不猜
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed.filter((item): item is XiaobaoCapability =>
    (XIAOBAO_CAPABILITIES as readonly string[]).includes(item as string),
  )
}

/**
 * 数据库实现：读学生的在办班级与各班的进行中课堂。
 *
 * 班级数就是学生同时在读的班数（个位数），逐班读进行中的课比新增一条跨表查询更简单，
 * 也能让两个 Provider 共用同一段判断逻辑。
 */
export function createClassSessionGate(
  database: Pick<DatabaseProvider, 'classes' | 'classSessions'>,
): XiaobaoClassSessionGate {
  return {
    async resolveForStudent(userId: string): Promise<XiaobaoClassCapabilityState> {
      const classes = await database.classes.listByStudent(userId)
      // 读不全就无法判断该学生受不受课堂时间限制：拒绝
      if (classes === null) return DENIED
      if (classes.length === 0) return { mode: 'unrestricted' }
      // `anytime` 的含义就是"随时可用"，只要有一个这样的班，课堂时间就不构成限制
      if (classes.some((item) => item.aiUsageMode === 'anytime')) return { mode: 'unrestricted' }

      const capabilities = new Set<XiaobaoCapability>()
      let inSession = false
      for (const item of classes) {
        const active = await database.classSessions.findActiveByClass(item.id)
        if (!active) continue
        inSession = true
        for (const capability of parseCapabilities(active.capabilities)) capabilities.add(capability)
      }

      return { mode: 'class_only', inSession, capabilities: [...capabilities] }
    },
  }
}
