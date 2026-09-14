import { xiaobaoActionSchema } from './domain.js'
import {
  ModelProviderError,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ModelUsage,
  type XiaobaoModelInfo,
} from './ports.js'

export interface OpenAICompatibleToolDefinition {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description?: string
    readonly parameters: Readonly<Record<string, unknown>>
  }
}

export interface OpenAICompatibleModelProviderConfig {
  readonly baseUrl: string
  readonly apiKey: string
  readonly modelId: string
  readonly modelName: string
  readonly timeoutMs: number
  readonly contextWindow?: number
  readonly tools?: readonly OpenAICompatibleToolDefinition[]
}

const completeTool: OpenAICompatibleToolDefinition = {
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
}

const askTool: OpenAICompatibleToolDefinition = {
  type: 'function',
  function: {
    name: 'xiaobao_ask',
    description: '向学生提出本次创作或学习需要的 1 到多个问题，然后等待学生回答',
    parameters: {
      type: 'object',
      properties: {
        header: { type: 'string', description: '问题主题' },
        questions: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['header', 'questions'],
      additionalProperties: false,
    },
  },
}

const reservedToolNames = new Set([completeTool.function.name, askTool.function.name])

export class OpenAICompatibleModelProvider implements ModelProvider {
  readonly name: string

  constructor(
    private readonly config: OpenAICompatibleModelProviderConfig,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    if (config.tools?.some((tool) => reservedToolNames.has(tool.function.name))) {
      throw new Error('A xiaobao reserved tool name is configured externally.')
    }
    this.name = config.modelName
  }

  async healthCheck(): Promise<boolean> {
    return this.hasValidConfiguration()
  }

  async listModels(): Promise<XiaobaoModelInfo[]> {
    return [
      {
        id: this.config.modelId,
        name: this.config.modelName,
        contextWindow: this.config.contextWindow,
      },
    ]
  }

  async complete(input: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    if (signal.aborted) throw getCallerAbortReason(signal)
    const timeoutController = new AbortController()
    const abortFromCaller = () => timeoutController.abort(getCallerAbortReason(signal))
    signal.addEventListener('abort', abortFromCaller, { once: true })
    let didTimeout = false
    const timeout = setTimeout(() => {
      didTimeout = true
      timeoutController.abort()
    }, this.config.timeoutMs)

    try {
      const response = await this.fetchImplementation(this.getCompletionsUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.modelId,
          messages: this.buildMessages(input),
          tools: [...(this.config.tools ?? []), askTool, completeTool],
          tool_choice: 'auto',
        }),
        signal: timeoutController.signal,
      })
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined)
        throw new ModelProviderError(getHttpErrorCode(response.status))
      }

      let payload: unknown
      try {
        payload = await response.json()
      } catch (error) {
        if (error instanceof ModelProviderError) throw error
        throw new ModelProviderError('invalid_response')
      }
      return parseModelResponse(payload)
    } catch (error) {
      if (signal.aborted) throw getCallerAbortReason(signal)
      if (error instanceof ModelProviderError) throw error
      if (didTimeout) throw new ModelProviderError('timeout')
      throw new ModelProviderError('unavailable')
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abortFromCaller)
    }
  }

  private getCompletionsUrl(): string {
    return this.getEndpointUrl('chat/completions')
  }

  private getEndpointUrl(endpoint: string): string {
    const url = new URL(this.config.baseUrl)
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${endpoint}`
    url.search = ''
    url.hash = ''
    return url.toString()
  }

  private hasValidConfiguration(): boolean {
    try {
      const baseUrl = new URL(this.config.baseUrl)
      return (
        (baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:') &&
        this.config.apiKey.trim().length > 0 &&
        this.config.modelId.trim().length > 0 &&
        Number.isInteger(this.config.timeoutMs) &&
        this.config.timeoutMs > 0
      )
    } catch {
      return false
    }
  }

  private buildMessages(input: ModelRequest): Array<Record<string, unknown>> {
    const qualityGates = input.skill.qualityGates.map((gate) => `- ${gate}`).join('\n') || '- 暂无额外门禁'
    const messages: Array<Record<string, unknown>> = [
      {
        role: 'system',
        content: [
          '你是小宝，一位面向儿童的创作与学习伙伴。',
          '儿童安全：内容必须适龄、友善，不生成危险、暴力、色情、欺凌或隐私泄露内容。',
          `当前任务能力：${input.task.capability}。`,
          `大师 Skill：${input.skill.name} v${input.skill.version}。`,
          'Skill instructions:',
          input.skill.instructions,
          'Quality gates:',
          qualityGates,
        ].join('\n'),
      },
      { role: 'user', content: buildUserMessage(input) },
    ]

    for (const observation of input.observations) {
      messages.push({
        role: 'assistant',
        tool_calls: [
          {
            id: observation.actionId,
            type: 'function',
            function: { name: observation.toolName ?? 'xiaobao_observation', arguments: '{}' },
          },
        ],
      })
      messages.push({
        role: 'tool',
        tool_call_id: observation.actionId,
        content: JSON.stringify({
          ok: observation.ok,
          output: observation.output,
          ...(observation.errorCode ? { errorCode: observation.errorCode } : {}),
        }),
      })
    }

    return messages
  }
}

/**
 * 用户消息：没有图片时保持纯字符串（与不支持视觉时逐字节一致）；
 * 有图片时切换为 OpenAI 兼容的内容数组，图片以内联 data URL 形式提供。
 */
function buildUserMessage(input: ModelRequest): unknown {
  const images = input.imageBlocks ?? []
  if (images.length === 0) return input.prompt
  return [
    { type: 'text', text: input.prompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.data}` },
    })),
  ]
}

function getHttpErrorCode(status: number): ModelProviderError['code'] {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 429) return 'rate_limit'
  if (status >= 500 && status <= 599) return 'unavailable'
  return 'invalid_response'
}

function getCallerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Request aborted', 'AbortError')
}

function parseModelResponse(payload: unknown): ModelResponse {
  if (!isObject(payload) || !Array.isArray(payload.choices) || payload.choices.length === 0) {
    throw new ModelProviderError('invalid_response')
  }

  const choice = payload.choices[0]
  if (!isObject(choice) || !isObject(choice.message)) {
    throw new ModelProviderError('invalid_response')
  }

  const usage = parseUsage(payload.usage)
  const toolCalls = choice.message.tool_calls
  if (toolCalls !== undefined) {
    if (!Array.isArray(toolCalls)) throw new ModelProviderError('invalid_response')
    if (toolCalls.length > 0) {
      if (choice.finish_reason !== 'tool_calls') throw new ModelProviderError('invalid_response')
      for (const toolCall of toolCalls) {
        const parsedToolCall = parseToolCall(toolCall, usage)
        if (parsedToolCall) return parsedToolCall
      }
      throw new ModelProviderError('invalid_response')
    }
  }

  if (choice.finish_reason !== 'stop') throw new ModelProviderError('invalid_response')
  const text = choice.message.content
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ModelProviderError('invalid_response')
  }
  return { kind: 'text', text, ...(usage ? { usage } : {}) }
}

function parseToolCall(toolCall: unknown, usage: ModelUsage | undefined): ModelResponse | null {
  if (
    !isObject(toolCall) ||
    toolCall.type !== 'function' ||
    !isObject(toolCall.function) ||
    typeof toolCall.function.arguments !== 'string'
  ) {
    return null
  }

  let input: unknown
  try {
    input = JSON.parse(toolCall.function.arguments)
  } catch {
    return null
  }
  if (!isObject(input)) return null

  const action = xiaobaoActionSchema.safeParse({
    id: toolCall.id,
    toolName: toolCall.function.name,
    input,
  })
  if (!action.success) return null

  if (action.data.toolName === askTool.function.name) {
    const input = action.data.input
    if (
      Object.keys(input).length !== 2 ||
      !Object.hasOwn(input, 'header') ||
      !Object.hasOwn(input, 'questions') ||
      typeof input.header !== 'string' ||
      input.header.trim().length === 0 ||
      !Array.isArray(input.questions) ||
      input.questions.length === 0 ||
      !input.questions.every((question) => typeof question === 'string' && question.trim().length > 0)
    ) {
      return null
    }
    return {
      kind: 'ask',
      toolCallId: action.data.id,
      header: input.header,
      questions: input.questions as string[],
      ...(usage ? { usage } : {}),
    }
  }

  if (action.data.toolName === completeTool.function.name) {
    if (Object.keys(action.data.input).length !== 1 || !Object.hasOwn(action.data.input, 'text')) return null
    const text = action.data.input.text
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null
    }
    return { kind: 'complete', text, ...(usage ? { usage } : {}) }
  }

  return { kind: 'tool', action: action.data, ...(usage ? { usage } : {}) }
}

function parseUsage(usage: unknown): ModelUsage | undefined {
  if (!isObject(usage)) return undefined
  const inputTokens = usage.prompt_tokens
  const outputTokens = usage.completion_tokens
  const totalTokens = usage.total_tokens
  if (![inputTokens, outputTokens, totalTokens].every((value) => Number.isInteger(value) && Number(value) >= 0)) {
    return undefined
  }
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
