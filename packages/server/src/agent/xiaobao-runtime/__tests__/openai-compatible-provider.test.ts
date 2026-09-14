import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleModelProvider, type OpenAICompatibleToolDefinition } from '../openai-compatible-provider.js'
import { ModelProviderError, type ModelProviderErrorCode } from '../ports.js'
import { createTaskSnapshot } from '../state-machine.js'

const task = createTaskSnapshot({
  taskId: 'task-1',
  userId: 'student-1',
  capability: 'learning',
  prompt: '帮我学习分数',
  now: 100,
})

const skill = {
  name: 'learning-coach',
  version: '1.0.0',
  instructions: '先用孩子听得懂的方式解释，再给一道练习题。',
  qualityGates: ['内容适龄', '给出练习'],
}

function createProvider(
  baseUrl: string,
  fetchImplementation: typeof fetch,
  tools: readonly OpenAICompatibleToolDefinition[] = [],
) {
  return new OpenAICompatibleModelProvider(
    {
      baseUrl,
      apiKey: 'test-api-key',
      modelId: 'xiaobao-test-model',
      modelName: '小宝测试模型',
      timeoutMs: 25,
      tools,
    },
    fetchImplementation,
  )
}

function successfulFetch(captured: { url?: string; init?: RequestInit }): typeof fetch {
  return async (url, init) => {
    captured.url = url.toString()
    captured.init = init
    return Response.json({
      choices: [{ finish_reason: 'stop', message: { content: '当然可以，我们从分数的意义开始。' } }],
    })
  }
}

const modelRequest = { task, prompt: '帮我学习分数', skill, observations: [] }

function jsonFetch(payload: unknown): typeof fetch {
  return async () => Response.json(payload)
}

function responsePayload(
  message: Record<string, unknown>,
  usage?: Record<string, unknown>,
  finishReason: unknown = 'stop',
): Record<string, unknown> {
  return { choices: [{ finish_reason: finishReason, message }], ...(usage ? { usage } : {}) }
}

function toolCallPayload(...toolCalls: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  return responsePayload({ tool_calls: toolCalls }, undefined, 'tool_calls')
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected promise to reject')
}

function inspectError(error: unknown): { ownPropertyText: string; serialized: string } {
  if (typeof error !== 'object' || error === null) {
    return { ownPropertyText: String(error), serialized: JSON.stringify(error) }
  }
  const ownProperties = Object.fromEntries(
    Reflect.ownKeys(error).map((key) => [String(key), (error as Record<PropertyKey, unknown>)[key]]),
  )
  return {
    ownPropertyText: Object.values(ownProperties).map(String).join(' '),
    serialized: JSON.stringify(ownProperties),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenAICompatibleModelProvider', () => {
  it('rejects an externally configured reserved completion tool', () => {
    const captured: { url?: string; init?: RequestInit } = {}

    expect(() =>
      createProvider('https://models.example.test/v1', successfulFetch(captured), [
        {
          type: 'function',
          function: {
            name: 'xiaobao_complete',
            parameters: { type: 'object' },
          },
        },
      ]),
    ).toThrow(/reserved/)
  })

  it.each(['xiaobao_complete', 'xiaobao_ask'])('rejects externally configured reserved tool %s', (name) => {
    const captured: { url?: string; init?: RequestInit } = {}

    expect(() =>
      createProvider('https://models.example.test/v1', successfulFetch(captured), [
        {
          type: 'function',
          function: {
            name,
            parameters: { type: 'object' },
          },
        },
      ]),
    ).toThrow(/reserved/)
  })

  it.each([
    ['https://models.example.test/v1', 'https://models.example.test/v1/chat/completions'],
    ['https://models.example.test/v1/', 'https://models.example.test/v1/chat/completions'],
    ['https://models.example.test/v1/?tenant=school#models', 'https://models.example.test/v1/chat/completions'],
  ])('posts to one normalized chat completions path for %s', async (baseUrl, expectedUrl) => {
    const captured: { url?: string; init?: RequestInit } = {}
    const provider = createProvider(baseUrl, successfulFetch(captured))

    const result = await provider.complete(
      { task, prompt: '帮我学习分数', skill, observations: [] },
      new AbortController().signal,
    )

    expect(captured.url).toBe(expectedUrl)
    expect(captured.init?.method).toBe('POST')
    expect(result).toEqual({ kind: 'text', text: '当然可以，我们从分数的意义开始。' })
  })

  it('maps the runtime request into the OpenAI-compatible model, messages, and tools contract', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    const extraTool = {
      type: 'function' as const,
      function: {
        name: 'make_practice_card',
        description: '生成一道练习卡片',
        parameters: {
          type: 'object',
          properties: { topic: { type: 'string' } },
          required: ['topic'],
          additionalProperties: false,
        },
      },
    }
    const provider = createProvider('https://models.example.test/v1/', successfulFetch(captured), [extraTool])

    await provider.complete(
      {
        task,
        prompt: '请出一道关于分数的练习题',
        skill,
        observations: [{ actionId: 'call-1', ok: true, output: { answer: '二分之一' } }],
      },
      new AbortController().signal,
    )

    const headers = new Headers(captured.init?.headers)
    const body = JSON.parse(captured.init?.body as string) as {
      model: string
      messages: Array<Record<string, unknown>>
      tools: unknown[]
      tool_choice: string
    }

    expect(headers.get('authorization')).toBe('Bearer test-api-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(body.model).toBe('xiaobao-test-model')
    expect(body.tool_choice).toBe('auto')
    expect(body.messages[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('儿童安全'),
    })
    expect(body.messages[0]?.content).toContain(skill.instructions)
    expect(body.messages[0]?.content).toContain('内容适龄')
    expect(body.messages[0]?.content).toContain('给出练习')
    expect(body.messages).toContainEqual({ role: 'user', content: '请出一道关于分数的练习题' })
    expect(body.messages).toContainEqual({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'xiaobao_observation', arguments: '{}' },
        },
      ],
    })
    expect(body.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-1',
      content: '{"ok":true,"output":{"answer":"二分之一"}}',
    })
    expect(body.tools).toContainEqual(extraTool)
    expect(body.tools).toContainEqual({
      type: 'function',
      function: {
        name: 'xiaobao_complete',
        description: '完成当前任务并返回最终内容',
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
    })
    expect(
      body.tools.filter(
        (tool) =>
          typeof tool === 'object' &&
          tool !== null &&
          (tool as { function?: { name?: unknown } }).function?.name === 'xiaobao_complete',
      ),
    ).toHaveLength(1)
  })

  it('replays a real tool observation under its original tool name for protocol pairing', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    const provider = createProvider('https://models.example.test/v1/', successfulFetch(captured))

    await provider.complete(
      {
        task,
        prompt: '写一个游戏文件',
        skill,
        observations: [
          { actionId: 'call-write-1', ok: true, output: { bytesWritten: 12 }, toolName: 'write_file' },
          { actionId: 'call-run-1', ok: true, output: { exitCode: 0 }, toolName: 'run_command' },
        ],
      },
      new AbortController().signal,
    )

    const body = JSON.parse(captured.init?.body as string) as {
      messages: Array<Record<string, unknown>>
    }
    expect(body.messages).toContainEqual({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-write-1',
          type: 'function',
          function: { name: 'write_file', arguments: '{}' },
        },
      ],
    })
    expect(body.messages).toContainEqual({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call-run-1',
          type: 'function',
          function: { name: 'run_command', arguments: '{}' },
        },
      ],
    })
    expect(body.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-write-1',
      content: '{"ok":true,"output":{"bytesWritten":12}}',
    })
    expect(body.messages).toContainEqual({
      role: 'tool',
      tool_call_id: 'call-run-1',
      content: '{"ok":true,"output":{"exitCode":0}}',
    })
  })

  it('parses a text response and attaches complete normalized usage', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        responsePayload(
          { content: '分数表示整体中的一部分。' },
          { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
        ),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'text',
      text: '分数表示整体中的一部分。',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    })
  })

  it('maps xiaobao_complete to a completion result', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload({
          id: 'complete-1',
          type: 'function',
          function: { name: 'xiaobao_complete', arguments: '{"text":"今天的分数练习完成啦！"}' },
        }),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'complete',
      text: '今天的分数练习完成啦！',
    })
  })

  it('maps a valid xiaobao_ask call to a student question', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload({
          id: 'ask-1',
          type: 'function',
          function: {
            name: 'xiaobao_ask',
            arguments: '{"header":"写作主题","questions":["你想写什么故事？","给谁看？"]}',
          },
        }),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'ask',
      toolCallId: 'ask-1',
      header: '写作主题',
      questions: ['你想写什么故事？', '给谁看？'],
    })
  })

  it('skips an invalid xiaobao_ask call and scans the next valid tool call', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload(
          {
            id: 'bad-ask',
            type: 'function',
            function: { name: 'xiaobao_ask', arguments: '{"header":"只有标题"}' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
          },
        ),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'tool',
      action: {
        id: 'call-2',
        toolName: 'make_practice_card',
        input: { topic: '分数' },
      },
    })
  })

  it('maps an ordinary function call to a schema-validated XiaoBao action', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload({
          id: 'call-1',
          type: 'function',
          function: { name: 'make_practice_card', arguments: '{"topic":"分数","difficulty":2}' },
        }),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'tool',
      action: {
        id: 'call-1',
        toolName: 'make_practice_card',
        input: { topic: '分数', difficulty: 2 },
      },
    })
  })

  it('skips invalid tool calls and returns the first schema-valid action', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload(
          {
            id: 'broken-call',
            type: 'function',
            function: { name: 'make_practice_card', arguments: '{not-json' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
          },
        ),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'tool',
      action: {
        id: 'call-2',
        toolName: 'make_practice_card',
        input: { topic: '分数' },
      },
    })
  })

  it('continues scanning after an invalid reserved completion call', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(
        toolCallPayload(
          {
            id: 'bad-complete',
            type: 'function',
            function: { name: 'xiaobao_complete', arguments: '{"extra":true}' },
          },
          {
            id: 'call-2',
            type: 'function',
            function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
          },
        ),
      ),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'tool',
      action: { id: 'call-2', toolName: 'make_practice_card', input: { topic: '分数' } },
    })
  })

  it.each([
    ['missing choices', {}],
    ['empty choices', { choices: [] }],
    ['empty text', responsePayload({ content: '' })],
    ['whitespace-only text', responsePayload({ content: '   ' })],
    [
      'malformed arguments JSON',
      toolCallPayload({
        id: 'call-1',
        type: 'function',
        function: { name: 'make_practice_card', arguments: '{bad' },
      }),
    ],
    [
      'array arguments',
      toolCallPayload({
        id: 'call-1',
        type: 'function',
        function: { name: 'make_practice_card', arguments: '[]' },
      }),
    ],
    [
      'primitive arguments',
      toolCallPayload({
        id: 'call-1',
        type: 'function',
        function: { name: 'make_practice_card', arguments: '"topic"' },
      }),
    ],
    [
      'non-function tool type',
      toolCallPayload({
        id: 'call-1',
        type: 'custom',
        function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
      }),
    ],
    [
      'missing tool call id',
      toolCallPayload({
        type: 'function',
        function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
      }),
    ],
    [
      'missing tool function name',
      toolCallPayload({ id: 'call-1', type: 'function', function: { arguments: '{"topic":"分数"}' } }),
    ],
    [
      'missing tool arguments',
      toolCallPayload({ id: 'call-1', type: 'function', function: { name: 'make_practice_card' } }),
    ],
    [
      'missing completion text',
      toolCallPayload({
        id: 'complete-1',
        type: 'function',
        function: { name: 'xiaobao_complete', arguments: '{}' },
      }),
    ],
    [
      'extra completion argument',
      toolCallPayload({
        id: 'complete-1',
        type: 'function',
        function: { name: 'xiaobao_complete', arguments: '{"text":"完成","extra":true}' },
      }),
    ],
  ])('rejects an invalid response with %s', async (_description, payload) => {
    const provider = createProvider('https://models.example.test/v1', jsonFetch(payload))

    await expect(provider.complete(modelRequest, new AbortController().signal)).rejects.toMatchObject({
      name: 'ModelProviderError',
      code: 'invalid_response',
    })
  })

  it.each([
    ['unknown text finish reason', responsePayload({ content: '继续学习。' }, undefined, 'length')],
    ['mismatched text finish reason', responsePayload({ content: '继续学习。' }, undefined, 'tool_calls')],
    ['missing text finish reason', { choices: [{ message: { content: '继续学习。' } }] }],
    [
      'mismatched tool finish reason',
      responsePayload(
        {
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
            },
          ],
        },
        undefined,
        'stop',
      ),
    ],
    [
      'missing tool finish reason',
      {
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'call-1',
                  type: 'function',
                  function: { name: 'make_practice_card', arguments: '{"topic":"分数"}' },
                },
              ],
            },
          },
        ],
      },
    ],
  ])('rejects %s', async (_description, payload) => {
    const provider = createProvider('https://models.example.test/v1', jsonFetch(payload))

    await expect(provider.complete(modelRequest, new AbortController().signal)).rejects.toMatchObject({
      name: 'ModelProviderError',
      code: 'invalid_response',
    })
  })

  it.each([
    ['missing prompt tokens', { completion_tokens: 8, total_tokens: 20 }],
    ['missing completion tokens', { prompt_tokens: 12, total_tokens: 20 }],
    ['missing total tokens', { prompt_tokens: 12, completion_tokens: 8 }],
    ['negative prompt tokens', { prompt_tokens: -1, completion_tokens: 8, total_tokens: 20 }],
    ['fractional completion tokens', { prompt_tokens: 12, completion_tokens: 8.5, total_tokens: 20 }],
    ['string total tokens', { prompt_tokens: 12, completion_tokens: 8, total_tokens: '20' }],
  ])('omits all usage when %s', async (_description, usage) => {
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(responsePayload({ content: '继续学习。' }, usage)),
    )

    await expect(provider.complete(modelRequest, new AbortController().signal)).resolves.toEqual({
      kind: 'text',
      text: '继续学习。',
    })
  })

  it.each<[number, ModelProviderErrorCode]>([
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate_limit'],
    [500, 'unavailable'],
    [599, 'unavailable'],
    [400, 'invalid_response'],
    [302, 'invalid_response'],
  ])('maps HTTP %i without reading the error response body', async (status, code) => {
    const bodyReads = { json: 0, text: 0, arrayBuffer: 0, blob: 0, formData: 0 }
    const fetchImplementation: typeof fetch = async () =>
      ({
        ok: false,
        status,
        json: async () => {
          bodyReads.json += 1
          throw new Error('raw-provider-body-marker')
        },
        text: async () => {
          bodyReads.text += 1
          return 'raw-provider-body-marker'
        },
        arrayBuffer: async () => {
          bodyReads.arrayBuffer += 1
          return new ArrayBuffer(0)
        },
        blob: async () => {
          bodyReads.blob += 1
          return new Blob()
        },
        formData: async () => {
          bodyReads.formData += 1
          return new FormData()
        },
      }) as Response
    const provider = createProvider('https://models.example.test/v1', fetchImplementation)

    const error = await captureError(provider.complete(modelRequest, new AbortController().signal))
    const inspected = inspectError(error)

    expect(error).toMatchObject({ name: 'ModelProviderError', code })
    expect(bodyReads).toEqual({ json: 0, text: 0, arrayBuffer: 0, blob: 0, formData: 0 })
    expect(`${inspected.ownPropertyText} ${inspected.serialized}`).not.toMatch(
      /raw-provider-body-marker|test-api-key|Authorization|Bearer/,
    )
  })

  it('cancels a non-success response body without consuming provider error details', async () => {
    const response = new Response('raw-provider-body-marker', { status: 429 })
    const cancelBody = vi.spyOn(response.body!, 'cancel')
    const provider = createProvider('https://models.example.test/v1', async () => response)

    await expect(provider.complete(modelRequest, new AbortController().signal)).rejects.toMatchObject({
      code: 'rate_limit',
    })
    expect(cancelBody).toHaveBeenCalledOnce()
  })

  it('maps malformed success JSON to a safe invalid-response error', async () => {
    const provider = createProvider(
      'https://models.example.test/v1',
      async () => new Response('raw-provider-body-marker test-api-key Authorization Bearer', { status: 200 }),
    )

    const error = await captureError(provider.complete(modelRequest, new AbortController().signal))
    const inspected = inspectError(error)

    expect(error).toMatchObject({ name: 'ModelProviderError', code: 'invalid_response' })
    expect(`${inspected.ownPropertyText} ${inspected.serialized}`).not.toMatch(
      /raw-provider-body-marker|test-api-key|Authorization|Bearer/,
    )
  })

  it('maps the configured provider timeout to a timeout failure', async () => {
    vi.useFakeTimers()
    const fetchImplementation: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    const provider = createProvider('https://models.example.test/v1', fetchImplementation)

    const timedOut = captureError(provider.complete(modelRequest, new AbortController().signal))
    await vi.advanceTimersByTimeAsync(25)

    await expect(timedOut).resolves.toMatchObject({ name: 'ModelProviderError', code: 'timeout' })
  })

  it('preserves the caller abort reason instead of mapping it to timeout', async () => {
    const caller = new AbortController()
    const abortReason = new DOMException('student cancelled', 'AbortError')
    const fetchImplementation: typeof fetch = async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
      })
    const provider = createProvider('https://models.example.test/v1', fetchImplementation)

    const request = provider.complete(modelRequest, caller.signal)
    caller.abort(abortReason)

    await expect(request).rejects.toBe(abortReason)
  })

  it('falls back to a stable AbortError when an aborted signal has no reason', async () => {
    const signalWithoutReason = {
      aborted: true,
      reason: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal
    const provider = createProvider(
      'https://models.example.test/v1',
      jsonFetch(responsePayload({ content: '不应返回这段文本。' })),
    )

    await expect(provider.complete(modelRequest, signalWithoutReason)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Request aborted',
    })
  })

  it('maps unknown fetch failures to unavailable and preserves existing provider errors', async () => {
    const unavailableProvider = createProvider('https://models.example.test/v1', async () => {
      throw new TypeError('network socket exposed raw-provider-body-marker')
    })
    const existingError = new ModelProviderError('rate_limit')
    const passthroughProvider = createProvider('https://models.example.test/v1', async () => {
      throw existingError
    })

    const unavailableError = await captureError(
      unavailableProvider.complete(modelRequest, new AbortController().signal),
    )

    expect(unavailableError).toMatchObject({ name: 'ModelProviderError', code: 'unavailable' })
    expect((unavailableError as Error).message).not.toContain('raw-provider-body-marker')
    await expect(passthroughProvider.complete(modelRequest, new AbortController().signal)).rejects.toBe(existingError)
  })

  it('checks only provider configuration and does not depend on an optional models endpoint', async () => {
    let fetchCalls = 0
    const provider = createProvider('https://models.example.test/v1', async () => {
      fetchCalls += 1
      throw new Error('healthCheck must not perform vendor-specific network discovery')
    })

    await expect(provider.healthCheck()).resolves.toBe(true)
    await expect(provider.listModels()).resolves.toEqual([
      { id: 'xiaobao-test-model', name: '小宝测试模型', contextWindow: undefined },
    ])
    expect(fetchCalls).toBe(0)
  })

  it.each([
    ['invalid URL', { baseUrl: 'not-a-url' }],
    ['non-HTTP URL', { baseUrl: 'ftp://models.example.test/v1' }],
    ['empty API key', { apiKey: '   ' }],
    ['empty model ID', { modelId: '' }],
    ['zero timeout', { timeoutMs: 0 }],
    ['fractional timeout', { timeoutMs: 1.5 }],
  ])('reports unhealthy local configuration for %s', async (_description, override) => {
    const provider = new OpenAICompatibleModelProvider(
      {
        baseUrl: 'https://models.example.test/v1',
        apiKey: 'test-api-key',
        modelId: 'xiaobao-test-model',
        modelName: '小宝测试模型',
        timeoutMs: 25,
        ...override,
      },
      async () => {
        throw new Error('invalid local configuration must not fetch')
      },
    )

    await expect(provider.healthCheck()).resolves.toBe(false)
  })
})
