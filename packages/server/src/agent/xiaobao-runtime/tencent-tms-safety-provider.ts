import { tms } from 'tencentcloud-sdk-nodejs'
import { z } from 'zod'
import { checkLocalChildSafety } from './local-child-safety.js'
import type { XiaobaoProductionGuardConfig } from './production-guard-config.js'
import type { SafetyCheckRequest, SafetyCheckResult, SafetyProvider } from './ports.js'

export interface TencentTmsRequest {
  Content: string
  BizType: string
  Type: 'TEXT'
}

export interface TencentTmsClient {
  textModeration(request: TencentTmsRequest): Promise<unknown>
}

export interface TencentTmsSdkClientConfig {
  credential: {
    secretId: string
    secretKey: string
    token?: string
  }
  region: string
  profile: { httpProfile: { reqTimeout: number } }
}

export interface TencentTmsSdkClient {
  TextModeration(request: TencentTmsRequest): Promise<unknown>
}

export type TencentTmsSdkClientConstructor = new (configuration: TencentTmsSdkClientConfig) => TencentTmsSdkClient

const unavailableMessage = '安全检查暂时不可用，请稍后再试'

export class SafetyProviderUnavailableError extends Error {
  readonly code = 'safety_provider_unavailable' as const

  constructor() {
    super(unavailableMessage)
    this.name = 'SafetyProviderUnavailableError'
  }
}

export function createTencentTmsClient(
  config: XiaobaoProductionGuardConfig['tms'],
  ClientConstructor: TencentTmsSdkClientConstructor = tms.v20201229.Client as TencentTmsSdkClientConstructor,
): TencentTmsClient {
  if (
    !hasText(config.secretId) ||
    !hasText(config.secretKey) ||
    !hasText(config.region) ||
    !hasText(config.bizType) ||
    !Number.isInteger(config.timeoutMs) ||
    config.timeoutMs <= 0
  ) {
    throw new SafetyProviderUnavailableError()
  }

  let client: TencentTmsSdkClient
  try {
    client = new ClientConstructor({
      credential: {
        secretId: config.secretId,
        secretKey: config.secretKey,
        ...(config.token ? { token: config.token } : {}),
      },
      region: config.region,
      profile: { httpProfile: { reqTimeout: config.timeoutMs / 1_000 } },
    })
  } catch {
    throw new SafetyProviderUnavailableError()
  }

  return {
    textModeration: (request) => client.TextModeration(request),
  }
}

const scoreSchema = z.number().min(0).max(100)
const positionSchema = z.object({ Start: z.number().optional(), End: z.number().optional() }).strict()
const hitInfoSchema = z
  .object({
    Type: z.string().optional(),
    Keyword: z.string().optional(),
    LibName: z.string().optional(),
    Positions: z.array(positionSchema).optional(),
  })
  .strict()
const tagSchema = z
  .object({
    Keyword: z.string().optional(),
    SubLabel: z.string().optional(),
    Score: scoreSchema.optional(),
  })
  .strict()
const hitSnippetInfoSchema = z
  .object({
    Snippet: z.string().optional(),
    AtomicName: z.string().optional(),
    AtomicId: z.string().optional(),
    Positions: z.array(positionSchema).optional(),
  })
  .strict()
const detailResultSchema = z
  .object({
    Label: z.string().optional(),
    Suggestion: z.string().optional(),
    Keywords: z.array(z.string()).optional(),
    Score: scoreSchema.optional(),
    LibType: z.number().optional(),
    LibId: z.string().optional(),
    LibName: z.string().optional(),
    SubLabel: z.string().optional(),
    Tags: z.array(tagSchema).nullable().optional(),
    HitInfos: z.array(hitInfoSchema).optional(),
    HitSnippetInfos: z.array(hitSnippetInfoSchema).nullable().optional(),
  })
  .strict()
const riskDetailSchema = z.object({ Label: z.string().optional(), Level: z.number().optional() }).strict()
const sentimentDetailSchema = z.object({ Positive: scoreSchema.optional(), Negative: scoreSchema.optional() }).strict()
const sentimentAnalysisSchema = z
  .object({
    Label: z.string().optional(),
    Score: scoreSchema.optional(),
    Detail: sentimentDetailSchema.optional(),
    Code: z.string().optional(),
    Message: z.string().optional(),
  })
  .strict()

const responseSchema = z
  .object({
    BizType: z.string().optional(),
    Suggestion: z.enum(['Pass', 'Block', 'Review']),
    Label: z.string().optional(),
    SubLabel: z.string().optional(),
    Score: scoreSchema.optional(),
    Keywords: z.array(z.string()).nullable().optional(),
    DetailResults: z.array(detailResultSchema).nullable().optional(),
    RiskDetails: z.array(riskDetailSchema).nullable().optional(),
    Extra: z.string().optional(),
    DataId: z.string().optional(),
    ContextText: z.string().optional(),
    SentimentAnalysis: sentimentAnalysisSchema.nullable().optional(),
    HitType: z.string().optional(),
    SessionId: z.string().optional(),
    HitSnippetInfos: z.array(hitSnippetInfoSchema).nullable().optional(),
    RequestId: z.string().min(1),
  })
  .strict()

export class TencentTmsSafetyProvider implements SafetyProvider {
  constructor(
    private readonly config: XiaobaoProductionGuardConfig['tms'],
    private readonly client: TencentTmsClient,
  ) {}

  async check(
    input: SafetyCheckRequest,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<SafetyCheckResult> {
    if (signal.aborted) throw getCallerAbortReason(signal)
    const localDecision = checkLocalChildSafety(input.prompt)
    if (!localDecision.allowed) return localDecision

    let response: unknown
    try {
      response = await waitForAbort(
        this.client.textModeration({
          Content: Buffer.from(input.prompt, 'utf8').toString('base64'),
          BizType: this.config.bizType,
          Type: 'TEXT',
        }),
        signal,
      )
    } catch {
      if (signal.aborted) throw getCallerAbortReason(signal)
      throw new SafetyProviderUnavailableError()
    }
    if (signal.aborted) throw getCallerAbortReason(signal)

    const moderation = responseSchema.safeParse(response)
    if (!moderation.success) throw new SafetyProviderUnavailableError()
    if (moderation.data.Suggestion === 'Pass') return { allowed: true }
    return moderation.data.Suggestion === 'Block'
      ? { allowed: false, reason: '这个请求包含不适合儿童的内容，请换一个学习或创作问题' }
      : { allowed: false, reason: '这个请求需要老师确认后才能继续' }
  }
}

function getCallerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Request aborted', 'AbortError')
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(getCallerAbortReason(signal))

  return new Promise<T>((resolve, reject) => {
    const abortFromCaller = () => reject(getCallerAbortReason(signal))
    signal.addEventListener('abort', abortFromCaller, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', abortFromCaller)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abortFromCaller)
        reject(error)
      },
    )
  })
}

function hasText(value: string): boolean {
  return value.trim().length > 0
}
