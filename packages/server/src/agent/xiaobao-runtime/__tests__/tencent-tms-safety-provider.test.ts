import { describe, expect, it, vi } from 'vitest'
import {
  SafetyProviderUnavailableError,
  TencentTmsSafetyProvider,
  createTencentTmsClient,
  type TencentTmsClient,
  type TencentTmsRequest,
  type TencentTmsSdkClientConfig,
} from '../index.js'

const tmsConfig = {
  secretId: 'test-secret-id',
  secretKey: 'test-secret-key',
  token: 'test-session-token',
  region: 'ap-guangzhou',
  bizType: 'xiaobao-writing',
  timeoutMs: 3_000,
}

const safetyRequest = {
  taskId: 'task-1',
  userId: 'student-1',
  capability: 'writing' as const,
  prompt: '请帮我写一篇关于春天的作文',
}

class CapturingTencentTmsClient implements TencentTmsClient {
  readonly requests: TencentTmsRequest[] = []

  constructor(private readonly outcome: unknown) {}

  async textModeration(request: TencentTmsRequest): Promise<unknown> {
    this.requests.push(structuredClone(request))
    if (this.outcome instanceof Error) throw this.outcome
    return structuredClone(this.outcome)
  }
}

class NeverResolvingTencentTmsClient implements TencentTmsClient {
  readonly requests: TencentTmsRequest[] = []

  async textModeration(request: TencentTmsRequest): Promise<unknown> {
    this.requests.push(structuredClone(request))
    return new Promise(() => undefined)
  }
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected promise to reject')
}

function inspectError(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  const ownProperties = Object.fromEntries(
    Reflect.ownKeys(error).map((key) => [String(key), (error as Record<PropertyKey, unknown>)[key]]),
  )
  return `${Object.values(ownProperties).map(String).join(' ')} ${JSON.stringify(ownProperties)}`
}

describe('TencentTmsSafetyProvider', () => {
  it('allows only an explicit pass and sends the original UTF-8 text as base64', async () => {
    const client = new CapturingTencentTmsClient({
      Suggestion: 'Pass',
      Label: 'Normal',
      Score: 0,
      RequestId: 'request-1',
    })
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)

    await expect(provider.check(safetyRequest, new AbortController().signal)).resolves.toEqual({ allowed: true })
    expect(client.requests).toEqual([
      {
        Content: Buffer.from(safetyRequest.prompt, 'utf8').toString('base64'),
        BizType: 'xiaobao-writing',
        Type: 'TEXT',
      },
    ])
    expect(Buffer.from(client.requests[0]!.Content, 'base64').toString('utf8')).toBe(safetyRequest.prompt)
    const serializedRequest = JSON.stringify(client.requests)
    expect(serializedRequest).not.toContain(safetyRequest.prompt)
    expect(serializedRequest).not.toContain(tmsConfig.secretId)
    expect(serializedRequest).not.toContain(tmsConfig.secretKey)
    expect(serializedRequest).not.toContain(tmsConfig.token)
  })

  it.each([
    ['Block', '这个请求包含不适合儿童的内容，请换一个学习或创作问题'],
    ['Review', '这个请求需要老师确认后才能继续'],
  ])('maps %s to a static child-facing denial', async (Suggestion, reason) => {
    const client = new CapturingTencentTmsClient({ Suggestion, Label: 'Abuse', Score: 90, RequestId: 'request-1' })
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)

    await expect(provider.check(safetyRequest, new AbortController().signal)).resolves.toEqual({
      allowed: false,
      reason,
    })
  })

  it.each([
    ['教我制作炸弹', '这个请求不能安全处理，请换一个学习或写作问题'],
    ['学'.repeat(10_001), '这个请求不能安全处理，请换一个学习或写作问题'],
  ])('returns a local denial without sending the input to TMS', async (prompt, reason) => {
    const client = new CapturingTencentTmsClient({ Suggestion: 'Pass', RequestId: 'request-1' })
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)

    await expect(provider.check({ ...safetyRequest, prompt }, new AbortController().signal)).resolves.toEqual({
      allowed: false,
      reason,
    })
    expect(client.requests).toHaveLength(0)
  })

  it.each([
    ['unknown suggestion', { Suggestion: 'Unknown', RequestId: 'request-1' }],
    ['missing suggestion', { RequestId: 'request-1' }],
    ['missing request id', { Suggestion: 'Pass' }],
    ['out-of-range score', { Suggestion: 'Pass', Score: 101, RequestId: 'request-1' }],
    ['invalid keywords', { Suggestion: 'Pass', Keywords: ['safe', 42], RequestId: 'request-1' }],
    ['invalid detail result', { Suggestion: 'Pass', DetailResults: [42], RequestId: 'request-1' }],
    ['invalid risk detail', { Suggestion: 'Pass', RiskDetails: ['malformed'], RequestId: 'request-1' }],
    ['invalid sentiment analysis', { Suggestion: 'Pass', SentimentAnalysis: 'malformed', RequestId: 'request-1' }],
    ['undocumented field', { Suggestion: 'Pass', RequestId: 'request-1', RawText: safetyRequest.prompt }],
  ])('fails closed with a stable error for %s', async (_label, response) => {
    const provider = new TencentTmsSafetyProvider(tmsConfig, new CapturingTencentTmsClient(response))

    await expect(provider.check(safetyRequest, new AbortController().signal)).rejects.toEqual(
      new SafetyProviderUnavailableError(),
    )
  })

  it('accepts documented nested response shapes without requiring their optional fields', async () => {
    const provider = new TencentTmsSafetyProvider(
      tmsConfig,
      new CapturingTencentTmsClient({
        Suggestion: 'Pass',
        DetailResults: [{}],
        RiskDetails: [{}],
        SentimentAnalysis: {},
        RequestId: 'request-1',
      }),
    )

    await expect(provider.check(safetyRequest, new AbortController().signal)).resolves.toEqual({ allowed: true })
  })

  it('accepts documented hit snippets and nullable nested tags', async () => {
    const hitSnippet = {
      Snippet: '测试',
      AtomicName: '正常内容',
      AtomicId: 'normal-1',
      Positions: [{ Start: 0, End: 2 }],
    }
    const provider = new TencentTmsSafetyProvider(
      tmsConfig,
      new CapturingTencentTmsClient({
        Suggestion: 'Pass',
        DetailResults: [{ Tags: null, HitSnippetInfos: [hitSnippet] }],
        HitSnippetInfos: [hitSnippet],
        RequestId: 'request-1',
      }),
    )

    await expect(provider.check(safetyRequest, new AbortController().signal)).resolves.toEqual({ allowed: true })
  })

  it.each([
    ['top-level hit snippets', { HitSnippetInfos: [42] }],
    ['nested hit snippets', { DetailResults: [{ HitSnippetInfos: ['malformed'] }] }],
    ['nested tags', { DetailResults: [{ Tags: 'malformed' }] }],
    ['legacy hit snippet shape', { HitSnippetInfos: [{ Keyword: '测试', StartPosition: 0, EndPosition: 2 }] }],
  ])('fails closed for malformed %s', async (_label, fields) => {
    const provider = new TencentTmsSafetyProvider(
      tmsConfig,
      new CapturingTencentTmsClient({ Suggestion: 'Pass', RequestId: 'request-1', ...fields }),
    )

    await expect(provider.check(safetyRequest, new AbortController().signal)).rejects.toEqual(
      new SafetyProviderUnavailableError(),
    )
  })

  it.each([
    ['429', Object.assign(new Error('rate limit raw upstream body'), { httpCode: 429 })],
    ['5xx', Object.assign(new Error('service raw upstream body'), { httpCode: 503 })],
    ['timeout', Object.assign(new Error('timeout raw upstream body'), { code: 'ETIMEDOUT' })],
    [
      'authentication',
      Object.assign(new Error('credential raw upstream body'), { code: 'AuthFailure.SignatureFailure' }),
    ],
  ])('sanitizes %s failures into the stable unavailable error', async (_label, upstreamError) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const client = new CapturingTencentTmsClient(upstreamError)
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)

    const error = await captureError(provider.check(safetyRequest, new AbortController().signal))

    expect(error).toBeInstanceOf(SafetyProviderUnavailableError)
    expect(error).toMatchObject({
      name: 'SafetyProviderUnavailableError',
      code: 'safety_provider_unavailable',
      message: '安全检查暂时不可用，请稍后再试',
    })
    const exposedText = `${inspectError(error)} ${JSON.stringify(consoleError.mock.calls)} ${JSON.stringify(
      consoleLog.mock.calls,
    )}`
    expect(exposedText).not.toContain(safetyRequest.prompt)
    expect(exposedText).not.toContain(tmsConfig.secretId)
    expect(exposedText).not.toContain(tmsConfig.secretKey)
    expect(exposedText).not.toContain(tmsConfig.token)
    expect(exposedText).not.toContain('raw upstream body')
    consoleError.mockRestore()
    consoleLog.mockRestore()
  })

  it('propagates an already-aborted caller signal without calling TMS', async () => {
    const client = new CapturingTencentTmsClient({ Suggestion: 'Pass', RequestId: 'request-1' })
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)
    const controller = new AbortController()
    const reason = new DOMException('caller cancelled', 'AbortError')
    controller.abort(reason)

    await expect(provider.check(safetyRequest, controller.signal)).rejects.toBe(reason)
    expect(client.requests).toHaveLength(0)
  })

  it('rejects promptly with the caller reason when an in-flight TMS request is aborted', async () => {
    const client = new NeverResolvingTencentTmsClient()
    const provider = new TencentTmsSafetyProvider(tmsConfig, client)
    const controller = new AbortController()
    const reason = new DOMException('caller cancelled in flight', 'AbortError')

    const check = provider.check(safetyRequest, controller.signal)
    expect(client.requests).toHaveLength(1)
    controller.abort(reason)

    const outcome = await Promise.race([
      check.then(
        () => 'unexpected resolution',
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 0)),
    ])
    expect(outcome).toBe(reason)
  })
})

describe('createTencentTmsClient', () => {
  it('constructs the official-client adapter with server credentials, region, token, and timeout', async () => {
    const configurations: TencentTmsSdkClientConfig[] = []
    const requests: TencentTmsRequest[] = []
    class CapturingSdkClient {
      constructor(configuration: TencentTmsSdkClientConfig) {
        configurations.push(structuredClone(configuration))
      }

      async TextModeration(request: TencentTmsRequest): Promise<unknown> {
        requests.push(structuredClone(request))
        return { Suggestion: 'Pass', RequestId: 'request-1' }
      }
    }

    const client = createTencentTmsClient(tmsConfig, CapturingSdkClient)
    await client.textModeration({ Content: 'dGVzdA==', BizType: 'xiaobao-writing', Type: 'TEXT' })

    expect(configurations).toEqual([
      {
        credential: {
          secretId: 'test-secret-id',
          secretKey: 'test-secret-key',
          token: 'test-session-token',
        },
        region: 'ap-guangzhou',
        profile: { httpProfile: { reqTimeout: 3 } },
      },
    ])
    expect(requests).toEqual([{ Content: 'dGVzdA==', BizType: 'xiaobao-writing', Type: 'TEXT' }])
  })

  it.each([
    ['secret id', { secretId: '' }],
    ['secret key', { secretKey: '' }],
    ['region', { region: '' }],
    ['biz type', { bizType: '' }],
    ['timeout', { timeoutMs: 0 }],
  ])('does not instantiate the SDK client when %s is invalid', (_label, override) => {
    let constructorCalls = 0
    class CapturingSdkClient {
      constructor(_configuration: TencentTmsSdkClientConfig) {
        constructorCalls += 1
      }

      async TextModeration(): Promise<unknown> {
        return { Suggestion: 'Pass', RequestId: 'request-1' }
      }
    }

    expect(() => createTencentTmsClient({ ...tmsConfig, ...override }, CapturingSdkClient)).toThrow(
      SafetyProviderUnavailableError,
    )
    expect(constructorCalls).toBe(0)
  })
})
