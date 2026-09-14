import { z } from 'zod'

export const XIAOBAO_CAPABILITIES = ['image', 'video', 'music', 'game', 'writing', 'learning'] as const
export const xiaobaoCapabilitySchema = z.enum(XIAOBAO_CAPABILITIES)
export type XiaobaoCapability = z.infer<typeof xiaobaoCapabilitySchema>

/**
 * 生产装配实际放行的能力集合：唯一事实来源，runtime 放行与灰度资格端点都读取它，
 * 避免"端点告知前端可用"与"runtime 实际放行"两处漂移。
 */
export const XIAOBAO_PRODUCTION_CAPABILITIES = ['writing', 'learning', 'game'] as const

export const XIAOBAO_TASK_STATUSES = [
  'created',
  'safety_check',
  'requirements',
  'planned',
  'running',
  'waiting_for_student',
  'quality_check',
  'revising',
  'retrying',
  'paused_budget',
  'failed_recoverable',
  'failed_terminal',
  'cancelled',
  'completed',
] as const
export const xiaobaoTaskStatusSchema = z.enum(XIAOBAO_TASK_STATUSES)
export type XiaobaoTaskStatus = z.infer<typeof xiaobaoTaskStatusSchema>

export const xiaobaoActionSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
})
export type XiaobaoAction = z.infer<typeof xiaobaoActionSchema>

export const xiaobaoObservationSchema = z.object({
  actionId: z.string().min(1),
  ok: z.boolean(),
  output: z.unknown(),
  errorCode: z.string().min(1).optional(),
  /** 原始工具名；旧快照缺省时回放为内部观察名。 */
  toolName: z.string().min(1).optional(),
})
export type XiaobaoObservation = z.infer<typeof xiaobaoObservationSchema>

export const xiaobaoTaskSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  userId: z.string(),
  capability: xiaobaoCapabilitySchema,
  prompt: z.string(),
  status: xiaobaoTaskStatusSchema,
  revision: z.number().int().nonnegative(),
  turnCount: z.number().int().nonnegative(),
  usageReservationId: z.string().min(1).nullable().default(null),
  modelUsageTokens: z.number().int().nonnegative().default(0),
  hasExactModelUsage: z.boolean().default(false),
  observations: z.array(xiaobaoObservationSchema),
  resultText: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  currentStepId: z.string().min(1).nullable(),
})
export type XiaobaoTaskSnapshot = z.infer<typeof xiaobaoTaskSnapshotSchema>

interface XiaobaoEventBase {
  taskId: string
  sequence: number
  timestamp: number
}

export type XiaobaoRuntimeEvent =
  | (XiaobaoEventBase & { type: 'phase'; phase: string })
  | (XiaobaoEventBase & { type: 'text'; text: string })
  | (XiaobaoEventBase & { type: 'tool_started'; action: XiaobaoAction })
  | (XiaobaoEventBase & { type: 'tool_finished'; observation: XiaobaoObservation })
  | (XiaobaoEventBase & {
      type: 'artifact'
      artifact: { title: string; contentType: 'link' | 'image' | 'audio' | 'video' | 'json'; data: string }
    })
  | (XiaobaoEventBase & {
      type: 'waiting_for_student'
      toolCallId: string
      header: string
      questions: readonly string[]
    })
  | (XiaobaoEventBase & { type: 'failed'; message: string; recoverable: boolean })
  | (XiaobaoEventBase & { type: 'completed'; text: string })

/**
 * 事件载荷：与 `XiaobaoRuntimeEvent` 同构，但去掉运行时补全的 `taskId` / `sequence` / `timestamp`。
 *
 * 必须使用分配式 Omit：直接写 `Omit<联合类型, K>` 只会保留公共字段（即只剩 `type`），
 * 各分支的专有字段会被静默丢掉，导致 `emit({ type: 'failed', message })` 之类的调用报错。
 */
export type XiaobaoRuntimeEventPayload = XiaobaoRuntimeEvent extends infer Event
  ? Event extends XiaobaoRuntimeEvent
    ? Omit<Event, 'taskId' | 'sequence' | 'timestamp'>
    : never
  : never
