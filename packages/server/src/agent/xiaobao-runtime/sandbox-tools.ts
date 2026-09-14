import type { XiaobaoAction, XiaobaoObservation } from './domain.js'
import type { OpenAICompatibleToolDefinition } from './openai-compatible-provider.js'
import type { ToolExecutionRequest, ToolProvider } from './ports.js'

/** 白名单：Runtime 工具名 → 沙箱 HTTP 端点工具名。禁止任意工具名穿透。 */
export const SANDBOX_TOOL_WHITELIST: Readonly<Record<string, string>> = Object.freeze({
  write_file: 'write',
  read_file: 'read',
  edit_file: 'edit',
  run_command: 'bash',
})

const DEFAULT_TIMEOUT_MS = 30_000
/** 文本型沙箱输出的最大长度；超出即截断以避免撑爆模型上下文与前端渲染。 */
const MAX_TEXT_OUTPUT_CHARS = 80_000
/** 任意沙箱结果序列化后的保险上限。 */
const MAX_SERIALIZED_OUTPUT_CHARS = 100_000

/**
 * 归一化沙箱结果：常见文本型输出（字符串、含 output/content 字段）裁剪到上限并标记；
 * 任意对象若整体序列化超限也降级为裁剪文本，避免巨型结构进入观察、模型回放与前端渲染。
 */
function normalizeSandboxResult(result: unknown): unknown {
  const textCandidate = extractTextOutput(result)
  if (textCandidate !== undefined) {
    if (textCandidate.length <= MAX_TEXT_OUTPUT_CHARS) {
      return isPlainStringResult(result) ? textCandidate : { ...(result as object), output: textCandidate }
    }
    return {
      value: textCandidate.slice(0, MAX_TEXT_OUTPUT_CHARS),
      truncated: true,
    }
  }

  const serialized = JSON.stringify(result)
  if (serialized !== undefined && serialized.length <= MAX_SERIALIZED_OUTPUT_CHARS) return result
  const fallback = JSON.stringify(result)
  const safe = fallback ?? String(result)
  return {
    value: safe.slice(0, MAX_TEXT_OUTPUT_CHARS),
    truncated: true,
  }
}

function extractTextOutput(result: unknown): string | undefined {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const candidate = (result as Record<string, unknown>).output ?? (result as Record<string, unknown>).content
    if (typeof candidate === 'string') return candidate
  }
  return undefined
}

function isPlainStringResult(result: unknown): boolean {
  return typeof result === 'string'
}

/**
 * 沙箱 HTTP 客户端契约：生产实现携带服务端鉴权头访问 SCF 沙箱，
 * 测试注入假客户端，绝不访问真实沙箱。
 */
export interface SandboxToolClient {
  execute(
    tool: string,
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

/** 模型可见的沙箱工具 schema（仅当装配注入健康沙箱客户端时随请求发送）。 */
export const SANDBOX_TOOL_DEFINITIONS: readonly OpenAICompatibleToolDefinition[] = Object.freeze([
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在工作区写入或覆盖一个文件',
      parameters: objectParameters(
        {
          path: { type: 'string', description: '相对工作区的文件路径' },
          content: { type: 'string', description: '完整文件内容' },
        },
        ['path', 'content'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区文件内容',
      parameters: objectParameters(
        {
          path: { type: 'string', description: '相对工作区的文件路径' },
          offset: { type: 'integer', description: '起始行（可选）' },
          limit: { type: 'integer', description: '读取行数（可选）' },
        },
        ['path'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '替换文件中一处文本',
      parameters: objectParameters(
        {
          path: { type: 'string', description: '相对工作区的文件路径' },
          oldString: { type: 'string', description: '被替换的原文' },
          newString: { type: 'string', description: '替换后的文本' },
          replaceAll: { type: 'boolean', description: '是否替换所有匹配（可选）' },
        },
        ['path', 'oldString', 'newString'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: '在工作区运行命令（构建、启动预览或验证产物）',
      parameters: objectParameters(
        {
          command: { type: 'string', description: '要执行的命令' },
          timeout: { type: 'integer', description: '超时毫秒（可选，默认 30000）' },
        },
        ['command'],
      ),
    },
  },
])

/**
 * 把沙箱文件/命令工具适配成小宝 Runtime 的 ToolProvider。
 * 只放行白名单工具；客户端失败映射为稳定 errorCode 观察，不携带上游原文。
 */
export class SandboxToolsProvider implements ToolProvider {
  readonly name = 'sandbox_tools'

  constructor(
    private readonly client: SandboxToolClient,
    private readonly timeoutMs: () => number = () => DEFAULT_TIMEOUT_MS,
  ) {}

  async healthCheck(): Promise<boolean> {
    return this.client.healthCheck()
  }

  async execute(input: ToolExecutionRequest, signal: AbortSignal): Promise<XiaobaoObservation> {
    return this.executeAction(input.taskId, input.action, signal)
  }

  private async executeAction(taskId: string, action: XiaobaoAction, signal: AbortSignal): Promise<XiaobaoObservation> {
    const endpoint = SANDBOX_TOOL_WHITELIST[action.toolName]
    if (!endpoint) {
      return { actionId: action.id, ok: false, output: null, errorCode: 'unknown_tool' }
    }

    try {
      const outcome = await this.client.execute(endpoint, action.input ?? {}, this.timeoutMs())
      if (!outcome.ok) {
        return { actionId: action.id, ok: false, output: null, errorCode: 'tool_failed' }
      }
      return { actionId: action.id, ok: true, output: normalizeSandboxResult(outcome.result) }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        return { actionId: action.id, ok: false, output: null, errorCode: 'cancelled' }
      }
      return { actionId: action.id, ok: false, output: null, errorCode: 'tool_unavailable' }
    }
  }
}
