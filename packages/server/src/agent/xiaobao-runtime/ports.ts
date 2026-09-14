import type { XiaobaoAction, XiaobaoCapability, XiaobaoObservation, XiaobaoTaskSnapshot } from './domain.js'

export interface XiaobaoModelInfo {
  id: string
  name: string
  contextWindow?: number
}

export interface SkillSnapshot {
  name: string
  version: string
  instructions: string
  qualityGates: readonly string[]
}

/** 学生上传的参考图：`data` 为**不含 `data:` 前缀**的原始 base64。 */
export interface XiaobaoImageBlock {
  readonly data: string
  readonly mimeType: string
}

export interface ModelRequest {
  task: XiaobaoTaskSnapshot
  prompt: string
  skill: SkillSnapshot
  observations: readonly XiaobaoObservation[]
  /** 视觉理解用的图片；为空时请求体与不支持视觉时逐字节一致。 */
  imageBlocks?: readonly XiaobaoImageBlock[]
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type ModelResponse =
  | { kind: 'text'; text: string; usage?: ModelUsage }
  | { kind: 'tool'; action: XiaobaoAction; usage?: ModelUsage }
  | { kind: 'ask'; toolCallId: string; header: string; questions: readonly string[]; usage?: ModelUsage }
  | { kind: 'complete'; text: string; usage?: ModelUsage }

export type ModelProviderErrorCode = 'authentication' | 'rate_limit' | 'unavailable' | 'timeout' | 'invalid_response'

const modelProviderErrorMessages: Record<ModelProviderErrorCode, string> = {
  authentication: '小宝暂时无法连接模型服务，请联系老师或管理员检查设置。',
  rate_limit: '小宝正在稍作休息，请稍后再试。',
  unavailable: '模型服务暂时不可用，请稍后再试。',
  timeout: '等待模型回复超时，请稍后再试。',
  invalid_response: '模型回复格式有问题，请稍后再试。',
}

export class ModelProviderError extends Error {
  constructor(readonly code: ModelProviderErrorCode) {
    super(modelProviderErrorMessages[code])
    this.name = 'ModelProviderError'
  }
}

export interface ModelProvider {
  readonly name: string
  healthCheck(): Promise<boolean>
  listModels(): Promise<XiaobaoModelInfo[]>
  complete(input: ModelRequest, signal: AbortSignal): Promise<ModelResponse>
}

export interface ToolExecutionRequest {
  taskId: string
  action: XiaobaoAction
}

export interface ToolProvider {
  readonly name: string
  healthCheck(): Promise<boolean>
  execute(input: ToolExecutionRequest, signal: AbortSignal): Promise<XiaobaoObservation>
}

export interface SkillProvider {
  getByCapability(capability: XiaobaoCapability): Promise<SkillSnapshot | null>
}

export interface CheckpointStore {
  load(taskId: string): Promise<XiaobaoTaskSnapshot | null>
  save(snapshot: XiaobaoTaskSnapshot): Promise<void>
}

export interface SafetyCheckRequest {
  taskId: string
  userId: string
  capability: XiaobaoCapability
  prompt: string
}

export type SafetyCheckResult = { allowed: true } | { allowed: false; reason: string }

export interface SafetyProvider {
  check(input: SafetyCheckRequest, signal: AbortSignal): Promise<SafetyCheckResult>
}

export interface UsageReservation {
  taskId: string
  userId: string
  category: 'model' | 'tool' | 'sandbox' | 'media'
  units: number
}

export type UsageReservationResult = { allowed: true; reservationId: string } | { allowed: false; reason: string }

export interface UsageRecord {
  taskId: string
  reservationId: string
  category: UsageReservation['category']
  units: number
}

export interface UsageProvider {
  /** Must be idempotent by taskId and category; conflicting userId or units must fail without dynamic details. */
  reserve(input: UsageReservation): Promise<UsageReservationResult>
  /** Must be idempotent for identical reservationId records; conflicting fields must fail without dynamic details. */
  record(input: UsageRecord): Promise<void>
}

export interface RuntimeClock {
  now(): number
}

/** 需要长期保存的媒体产物：把上游临时 URL 转存到自己可控的对象存储。 */
export interface ArtifactMirrorRequest {
  readonly taskId: string
  /** 上游返回的临时地址（例如火山方舟 TOS 签名链接，约 24 小时失效）。 */
  readonly sourceUrl: string
  /** 产物种类，用于命名与分类（例如工具名或 `image` / `video`）。 */
  readonly kind: string
}

export type ArtifactMirrorResult = { readonly ok: true; readonly url: string } | { readonly ok: false }

export interface ArtifactStore {
  /**
   * 转存一个产物并返回长期地址。
   *
   * 失败必须返回 `{ ok: false }` 而不是抛错或返回假地址：调用方会退回上游 URL，
   * 让学生至少还能看到作品，同时不会把临时链接伪装成长期链接。
   */
  mirror(request: ArtifactMirrorRequest): Promise<ArtifactMirrorResult>
  healthCheck(): Promise<boolean>
}

export interface XiaobaoRuntimeDependencies {
  model: ModelProvider
  tools: ReadonlyMap<string, ToolProvider>
  skills: SkillProvider
  checkpoints: CheckpointStore
  safety: SafetyProvider
  usage: UsageProvider
  clock: RuntimeClock
}
