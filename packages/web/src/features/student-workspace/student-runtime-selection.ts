import { STUDENT_CAPABILITIES, type StudentXiaobaoCapability } from './student-capabilities'

export interface StudentRuntimeSelection {
  readonly selectedRuntime?: 'xiaobao'
  readonly xiaobaoCapability?: StudentXiaobaoCapability
}

export interface StudentRuntimeSelectionInput {
  readonly capabilityId: unknown
  /**
   * 服务端资格端点返回的**已放行能力清单**。
   * 空数组表示当前无资格、或该能力尚未配置（例如没有 ARK_API_KEY）。
   */
  readonly xiaobaoCapabilities: readonly StudentXiaobaoCapability[]
}

/**
 * 解析入口 id 对应的小宝能力。
 *
 * 只做查表 + 类型收窄：未知 id、`null`、`undefined`、非字符串一律返回 `null`，
 * 且**不抛异常**（不使用会抛错的 `getStudentCapability`），保证前端 fail-closed。
 */
export function resolveStudentXiaobaoCapability(capabilityId: unknown): StudentXiaobaoCapability | null {
  if (typeof capabilityId !== 'string') return null
  const capability = STUDENT_CAPABILITIES.find((entry) => entry.id === capabilityId)
  return capability?.xiaobaoCapability ?? null
}

/**
 * 决定是否覆盖任务的 Runtime。
 *
 * 只有"入口已映射小宝能力 **且** 该能力在服务端放行清单里"时才返回覆盖字段；
 * 其余情况返回空对象，调用方展开后请求字段与今天完全一致。
 * 这样即使入口已经映射（例如 image/video），只要服务端还没配置媒体服务，学生仍走默认通道。
 */
export function resolveStudentRuntimeSelection(input: StudentRuntimeSelectionInput): StudentRuntimeSelection {
  const xiaobaoCapability = resolveStudentXiaobaoCapability(input.capabilityId)
  if (!xiaobaoCapability) return {}
  if (!input.xiaobaoCapabilities.includes(xiaobaoCapability)) return {}

  return { selectedRuntime: 'xiaobao', xiaobaoCapability }
}

const knownXiaobaoCapabilities: readonly StudentXiaobaoCapability[] = ['writing', 'learning', 'game', 'image', 'video']

function isXiaobaoCapability(value: unknown): value is StudentXiaobaoCapability {
  return typeof value === 'string' && (knownXiaobaoCapabilities as readonly string[]).includes(value)
}

/**
 * 资格响应解析：只有 `eligible: true` 时才读取 `capabilities`，
 * 并逐个收窄为已知能力名。缺字段、非布尔、非数组、异常对象一律返回空数组（fail-closed）。
 */
export function parseXiaobaoCapabilities(payload: unknown): readonly StudentXiaobaoCapability[] {
  if (!payload || typeof payload !== 'object') return []
  if ((payload as { eligible?: unknown }).eligible !== true) return []
  const capabilities = (payload as { capabilities?: unknown }).capabilities
  if (!Array.isArray(capabilities)) return []
  return capabilities.filter(isXiaobaoCapability)
}
