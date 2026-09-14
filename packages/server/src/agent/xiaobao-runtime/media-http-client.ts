import { z } from 'zod'
import type { MediaToolClient } from './media-tools.js'

export interface MediaToolEnvironment {
  readonly url: string
  readonly authToken: string
  readonly timeoutMs: number
}

const requiredText = z.string().trim().min(1)
const positiveInteger = z.number().int().positive()

const environmentSchema = z.object({
  XIAOBAO_MEDIA_URL: requiredText.refine((value) => {
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
  XIAOBAO_MEDIA_AUTH_TOKEN: requiredText,
  XIAOBAO_MEDIA_TIMEOUT_MS: z.preprocess(
    (value) => (value === undefined || value === '' ? 120_000 : Number(value)),
    positiveInteger,
  ),
})

/**
 * 读取媒体服务配置：缺任一必填项或格式非法时返回 null（fail-closed），
 * 调用方据此保持媒体能力不可用，不得使用默认值或空实现顶替。
 */
export function loadMediaToolEnvironment(
  environment: Record<string, string | undefined> = process.env,
): MediaToolEnvironment | null {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) return null
  return {
    url: result.data.XIAOBAO_MEDIA_URL,
    authToken: result.data.XIAOBAO_MEDIA_AUTH_TOKEN,
    timeoutMs: result.data.XIAOBAO_MEDIA_TIMEOUT_MS,
  }
}

/**
 * 真实媒体服务 HTTP 客户端：携带服务端鉴权头调用 `POST {url}/api/media/{kind}`。
 * 只把 `{ ok, error }` 的最小结果返回给上层；HTTP/网络/格式失败一律归一化为
 * `{ ok: false, error: '' }`，不透传上游状态行、正文或异常消息。
 * `healthCheck` 走无生成成本的 `GET {url}/health`。
 */
export function createMediaToolHttpClient(
  environment: MediaToolEnvironment,
  fetchImplementation: typeof fetch = fetch,
): MediaToolClient {
  const { url, authToken, timeoutMs } = environment

  return {
    async generate(kind, input, requestedTimeoutMs) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), requestedTimeoutMs ?? timeoutMs)
      try {
        const response = await fetchImplementation(`${url}/api/media/${encodeURIComponent(kind)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        })
        if (!response.ok) {
          if (response.body) await response.body.cancel().catch(() => undefined)
          return { ok: false, error: '' }
        }
        let payload: unknown
        try {
          payload = await response.json()
        } catch {
          return { ok: false, error: '' }
        }
        if (!payload || typeof payload !== 'object' || !('success' in payload)) {
          return { ok: false, error: '' }
        }
        const data = payload as { success?: unknown; result?: unknown }
        if (data.success !== true) return { ok: false, error: '' }
        return { ok: true, result: data.result }
      } catch {
        return { ok: false, error: '' }
      } finally {
        clearTimeout(timeout)
      }
    },

    async healthCheck() {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const response = await fetchImplementation(`${url}/health`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${authToken}` },
          signal: controller.signal,
        })
        if (response.body) await response.body.cancel().catch(() => undefined)
        return response.ok
      } catch {
        return false
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}
