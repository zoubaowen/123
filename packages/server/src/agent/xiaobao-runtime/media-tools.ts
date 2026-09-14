import type { XiaobaoAction, XiaobaoObservation } from './domain.js'
import type { OpenAICompatibleToolDefinition } from './openai-compatible-provider.js'
import type { ToolExecutionRequest, ToolProvider } from './ports.js'

/** 白名单：Runtime 媒体工具名 → 媒体服务端点种类。禁止任意工具名穿透。 */
export const MEDIA_TOOL_WHITELIST: Readonly<Record<string, string>> = Object.freeze({
  generate_image: 'image',
  generate_video: 'video',
  generate_music: 'music',
})

/**
 * 能力 → 该能力必需的工具名。运行时用它判断"该能力所需的媒体工具是否已装配"，
 * 未装配时必须 fail-closed，不能进入 Agent Loop 后才发现无工具可用。
 */
export const MEDIA_TOOL_BY_CAPABILITY: Readonly<Record<string, string>> = Object.freeze({
  image: 'generate_image',
  video: 'generate_video',
  music: 'generate_music',
})

/** 媒体生成远慢于文件/命令操作，默认超时给足。 */
const DEFAULT_TIMEOUT_MS = 120_000
/** 媒体服务返回结果的序列化上限，避免巨型结构进入观察、模型回放与前端渲染。 */
const MAX_SERIALIZED_OUTPUT_CHARS = 20_000

/**
 * 媒体服务客户端契约：生产实现携带服务端鉴权头访问选定的媒体服务，
 * 测试注入假客户端，**绝不访问真实媒体服务**。
 */
export interface MediaToolClient {
  generate(
    kind: string,
    input: unknown,
    timeoutMs: number,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
  healthCheck(): Promise<boolean>
}

const objectParameters = (properties: Record<string, unknown>, required: readonly string[]) => ({
  type: 'object',
  properties,
  required: [...required],
  additionalProperties: false,
})

/** 模型可见的媒体工具 schema（仅当装配注入健康媒体客户端时随请求发送）。 */
export const MEDIA_TOOL_DEFINITIONS: readonly OpenAICompatibleToolDefinition[] = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'generate_image',
      description: '根据文字描述生成一张图片，返回可展示的图片地址',
      parameters: objectParameters(
        {
          prompt: { type: 'string', description: '画面的完整文字描述' },
          aspectRatio: { type: 'string', description: '画面比例，如 1:1、16:9（可选）' },
          style: { type: 'string', description: '画面风格（可选）' },
        },
        ['prompt'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_video',
      description: '根据文字描述生成一段视频，返回可播放的视频地址',
      parameters: objectParameters(
        {
          prompt: { type: 'string', description: '视频内容的完整文字描述' },
          durationSeconds: { type: 'integer', description: '时长秒数（可选）' },
          aspectRatio: { type: 'string', description: '画面比例，如 16:9（可选）' },
        },
        ['prompt'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_music',
      description: '根据文字描述生成一段音乐或歌曲，返回可播放的音频地址',
      parameters: objectParameters(
        {
          prompt: { type: 'string', description: '音乐风格、情绪与用途的完整描述' },
          durationSeconds: { type: 'integer', description: '时长秒数（可选）' },
          lyrics: { type: 'string', description: '歌词（可选）' },
        },
        ['prompt'],
      ),
    },
  },
])

/**
 * 归一化媒体服务结果：正常结果原样返回（模型需要地址与元信息）；
 * 序列化超限时降级为裁剪文本，避免巨型结构进入观察与前端。
 */
export function normalizeMediaResult(result: unknown): unknown {
  const serialized = JSON.stringify(result)
  if (serialized !== undefined && serialized.length <= MAX_SERIALIZED_OUTPUT_CHARS) return result
  const safe = serialized ?? String(result)
  return { value: safe.slice(0, MAX_SERIALIZED_OUTPUT_CHARS), truncated: true }
}

/**
 * 把媒体生成工具适配成小宝 Runtime 的 ToolProvider。
 * 只放行白名单工具；客户端失败映射为稳定 errorCode 观察，不携带上游原文。
 */
export class MediaToolsProvider implements ToolProvider {
  readonly name = 'media_tools'

  constructor(
    private readonly client: MediaToolClient,
    private readonly timeoutMs: () => number = () => DEFAULT_TIMEOUT_MS,
  ) {}

  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck()
  }

  async execute(input: ToolExecutionRequest, signal: AbortSignal): Promise<XiaobaoObservation> {
    return this.executeAction(input.action, signal)
  }

  private async executeAction(action: XiaobaoAction, signal: AbortSignal): Promise<XiaobaoObservation> {
    const kind = MEDIA_TOOL_WHITELIST[action.toolName]
    if (!kind) {
      return { actionId: action.id, ok: false, output: null, errorCode: 'unknown_tool' }
    }

    try {
      const outcome = await this.client.generate(kind, action.input ?? {}, this.timeoutMs())
      if (!outcome.ok) {
        return { actionId: action.id, ok: false, output: null, errorCode: 'tool_failed' }
      }
      return { actionId: action.id, ok: true, output: normalizeMediaResult(outcome.result) }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { actionId: action.id, ok: false, output: null, errorCode: 'cancelled' }
      }
      return { actionId: action.id, ok: false, output: null, errorCode: 'tool_unavailable' }
    }
  }
}
