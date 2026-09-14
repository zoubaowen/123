import { z } from 'zod'
import type { MediaToolClient } from './media-tools.js'

/**
 * 火山方舟（Ark）媒体配置。
 *
 * 刻意**不引入官方 SDK**：Ark 的图片与视频生成都是标准 HTTP + Bearer 鉴权，
 * 用可注入的 fetch 实现即可被完整测试覆盖，且不增加依赖面。
 */
export interface VolcengineMediaEnvironment {
  readonly baseUrl: string
  readonly apiKey: string
  readonly imageModel: string
  readonly videoModel: string
  readonly timeoutMs: number
  readonly pollIntervalMs: number
  readonly pollTimeoutMs: number
}

export const DEFAULT_VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
/** Seedream 4.0：支持的尺寸档位最宽松（1K/2K/4K），单图约 10~15 秒。 */
export const DEFAULT_VOLCENGINE_IMAGE_MODEL = 'doubao-seedream-4-0-250828'
/** Seedance 1.5 Pro：文生视频/图生视频，异步任务式。 */
export const DEFAULT_VOLCENGINE_VIDEO_MODEL = 'doubao-seedance-1-5-pro-251215'

const DEFAULT_TIMEOUT_MS = 240_000
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_POLL_TIMEOUT_MS = 900_000

const requiredText = z.string().trim().min(1)

const environmentSchema = z.object({
  ARK_API_KEY: requiredText,
  XIAOBAO_VOLC_BASE_URL: z.preprocess(
    (value) => (value === undefined || value === '' ? DEFAULT_VOLCENGINE_BASE_URL : value),
    requiredText.refine((value) => {
      try {
        const url = new URL(value)
        return (
          (url.protocol === 'http:' || url.protocol === 'https:') &&
          url.search === '' &&
          url.hash === '' &&
          url.username === '' &&
          url.password === ''
        )
      } catch {
        return false
      }
    }),
  ),
  XIAOBAO_VOLC_IMAGE_MODEL: z.preprocess(
    (value) => (value === undefined || value === '' ? DEFAULT_VOLCENGINE_IMAGE_MODEL : value),
    requiredText,
  ),
  XIAOBAO_VOLC_VIDEO_MODEL: z.preprocess(
    (value) => (value === undefined || value === '' ? DEFAULT_VOLCENGINE_VIDEO_MODEL : value),
    requiredText,
  ),
})

function positiveIntegerWithDefault(fallback: number) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : Number(value)),
    z.number().int().positive(),
  )
}

const timeoutSchema = z.object({
  XIAOBAO_VOLC_TIMEOUT_MS: positiveIntegerWithDefault(DEFAULT_TIMEOUT_MS),
  XIAOBAO_VOLC_POLL_INTERVAL_MS: positiveIntegerWithDefault(DEFAULT_POLL_INTERVAL_MS),
  XIAOBAO_VOLC_POLL_TIMEOUT_MS: positiveIntegerWithDefault(DEFAULT_POLL_TIMEOUT_MS),
})

/**
 * 读取火山方舟媒体配置：缺少 `ARK_API_KEY`（或格式非法）时返回 null（fail-closed），
 * 调用方据此保持媒体能力不可用。baseUrl 与模型 ID 有默认值，但同样经过校验。
 */
export function loadVolcengineMediaEnvironment(
  environment: Record<string, string | undefined> = process.env,
): VolcengineMediaEnvironment | null {
  const parsed = environmentSchema.merge(timeoutSchema).safeParse(environment)
  if (!parsed.success) return null
  return {
    baseUrl: parsed.data.XIAOBAO_VOLC_BASE_URL,
    apiKey: parsed.data.ARK_API_KEY,
    imageModel: parsed.data.XIAOBAO_VOLC_IMAGE_MODEL,
    videoModel: parsed.data.XIAOBAO_VOLC_VIDEO_MODEL,
    timeoutMs: parsed.data.XIAOBAO_VOLC_TIMEOUT_MS,
    pollIntervalMs: parsed.data.XIAOBAO_VOLC_POLL_INTERVAL_MS,
    pollTimeoutMs: parsed.data.XIAOBAO_VOLC_POLL_TIMEOUT_MS,
  }
}

/** 常见比例 → Ark 显式像素尺寸；未列出的比例交给服务端默认值处理。 */
const IMAGE_SIZE_BY_ASPECT_RATIO: Readonly<Record<string, string>> = Object.freeze({
  '1:1': '2048x2048',
  '16:9': '2560x1440',
  '9:16': '1440x2560',
  '4:3': '2048x1536',
  '3:4': '1536x2048',
})

/** 视频支持的宽高比取值；未列出的比例不传，交给服务端默认。 */
const VIDEO_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'])

type ToolInput = Record<string, unknown>

function readString(input: ToolInput, key: string): string | undefined {
  const value = input[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function readPositiveInteger(input: ToolInput, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** 把模型的风格要求并入提示词，作为独立一行，避免与主体描述混写。 */
function buildPrompt(input: ToolInput): string | undefined {
  const prompt = readString(input, 'prompt')
  if (!prompt) return undefined
  const style = readString(input, 'style')
  return style ? `${prompt}\n风格：${style}` : prompt
}

interface VolcengineDependencies {
  readonly fetchImplementation: typeof fetch
  readonly sleep: (ms: number) => Promise<void>
  readonly now: () => number
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const FAILURE = { ok: false as const, error: '' }

/**
 * 火山方舟媒体客户端（图片 + 视频）。
 *
 * - 图片：`POST /images/generations`，同步返回 `data[0].url`。
 * - 视频：`POST /contents/generations/tasks` 创建任务后轮询 `GET /contents/generations/tasks/{id}`，
 *   直到 `succeeded` / `failed` / `expired` 或超时。
 * - `music` 不在 Ark 能力范围内，直接返回稳定失败，不伪造产物。
 * - 所有失败（HTTP、网络、格式、审核拦截、超时）一律归一化为 `{ ok: false, error: '' }`，
 *   不透传上游状态行、正文或异常消息。
 *
 * `healthCheck` 只校验**配置完整性**（Ark 没有健康端点），这是刻意的设计取舍：
 * 密钥无效时工具仍会装配，但每次生成都会以脱敏失败结束，不会产生假产物。
 */
export function createVolcengineMediaClient(
  environment: VolcengineMediaEnvironment,
  dependencies: Partial<VolcengineDependencies> = {},
): MediaToolClient {
  const fetchImplementation = dependencies.fetchImplementation ?? fetch
  const sleep = dependencies.sleep ?? defaultSleep
  const now = dependencies.now ?? Date.now
  const { baseUrl, apiKey, imageModel, videoModel, pollIntervalMs, pollTimeoutMs } = environment

  async function post(path: string, body: unknown, timeoutMs: number): Promise<unknown | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImplementation(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined)
        return undefined
      }
      return (await response.json()) as unknown
    } catch {
      return undefined
    } finally {
      clearTimeout(timeout)
    }
  }

  async function get(path: string, timeoutMs: number): Promise<unknown | undefined> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImplementation(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        if (response.body) await response.body.cancel().catch(() => undefined)
        return undefined
      }
      return (await response.json()) as unknown
    } catch {
      return undefined
    } finally {
      clearTimeout(timeout)
    }
  }

  async function generateImage(input: ToolInput, timeoutMs: number) {
    const prompt = buildPrompt(input)
    if (!prompt) return FAILURE

    const aspectRatio = readString(input, 'aspectRatio')
    const size = aspectRatio ? IMAGE_SIZE_BY_ASPECT_RATIO[aspectRatio] : undefined
    const payload = await post(
      '/images/generations',
      {
        model: imageModel,
        prompt,
        response_format: 'url',
        watermark: false,
        ...(size ? { size } : {}),
      },
      timeoutMs,
    )
    if (!payload || typeof payload !== 'object') return FAILURE

    const data = (payload as { data?: unknown }).data
    if (!Array.isArray(data) || data.length === 0) return FAILURE
    const first = data[0]
    if (!first || typeof first !== 'object') return FAILURE

    const url = (first as { url?: unknown }).url
    if (typeof url === 'string' && url.trim() !== '') {
      return { ok: true as const, result: { url, model: imageModel, kind: 'image' } }
    }
    // b64_json 形态：把纯 base64 包装成 data URL，前端才可直接展示。
    const base64 = (first as { b64_json?: unknown }).b64_json
    if (typeof base64 === 'string' && base64.trim() !== '') {
      return {
        ok: true as const,
        result: { url: `data:image/png;base64,${base64}`, model: imageModel, kind: 'image' },
      }
    }
    return FAILURE
  }

  async function generateVideo(input: ToolInput, timeoutMs: number) {
    const prompt = buildPrompt(input)
    if (!prompt) return FAILURE

    const durationSeconds = readPositiveInteger(input, 'durationSeconds')
    const aspectRatio = readString(input, 'aspectRatio')
    const created = await post(
      '/contents/generations/tasks',
      {
        model: videoModel,
        content: [{ type: 'text', text: prompt }],
        resolution: '720p',
        ...(durationSeconds ? { duration: durationSeconds } : {}),
        ...(aspectRatio && VIDEO_RATIOS.has(aspectRatio) ? { ratio: aspectRatio } : {}),
        watermark: false,
      },
      timeoutMs,
    )
    const taskId = created && typeof created === 'object' ? (created as { id?: unknown }).id : undefined
    if (typeof taskId !== 'string' || taskId.trim() === '') return FAILURE

    const deadline = now() + pollTimeoutMs
    while (now() < deadline) {
      await sleep(pollIntervalMs)
      const task = await get(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, timeoutMs)
      if (!task || typeof task !== 'object') return FAILURE

      const status = (task as { status?: unknown }).status
      if (status === 'succeeded') {
        const videoUrl = (task as { content?: { video_url?: unknown } }).content?.video_url
        if (typeof videoUrl !== 'string' || videoUrl.trim() === '') return FAILURE
        const lastFrameUrl = (task as { content?: { last_frame_url?: unknown } }).content?.last_frame_url
        return {
          ok: true as const,
          result: {
            url: videoUrl,
            model: videoModel,
            kind: 'video',
            ...(typeof lastFrameUrl === 'string' && lastFrameUrl.trim() !== '' ? { lastFrameUrl } : {}),
          },
        }
      }
      if (status === 'failed' || status === 'expired' || status === 'cancelled') return FAILURE
      if (status !== 'queued' && status !== 'running' && status !== 'pending') return FAILURE
    }
    return FAILURE
  }

  return {
    async generate(kind, input, timeoutMs) {
      const toolInput: ToolInput = input && typeof input === 'object' ? (input as ToolInput) : {}
      if (kind === 'image') return generateImage(toolInput, timeoutMs)
      if (kind === 'video') return generateVideo(toolInput, timeoutMs)
      return FAILURE
    },

    async healthCheck() {
      // Ark 无健康端点：这里只表示"配置完整、可以发起调用"。
      return Boolean(baseUrl && apiKey && imageModel && videoModel)
    },
  }
}
