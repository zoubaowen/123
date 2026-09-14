import { z } from 'zod'
import type { SandboxToolClient } from './sandbox-tools.js'

export interface SandboxToolEnvironment {
  readonly url: string
  readonly sessionId: string
  readonly authToken: string
  readonly timeoutMs: number
}

const requiredText = z.string().trim().min(1)
const positiveInteger = z.number().int().positive()

const environmentSchema = z.object({
  XIAOBAO_SANDBOX_URL: requiredText.url().refine((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.search === '' && url.hash === ''
    } catch {
      return false
    }
  }),
  XIAOBAO_SANDBOX_SESSION_ID: requiredText,
  XIAOBAO_SANDBOX_AUTH_TOKEN: requiredText,
  XIAOBAO_SANDBOX_TIMEOUT_MS: z.preprocess(
    (value) => (value === undefined || value === '' ? 30_000 : Number(value)),
    positiveInteger,
  ),
})

export function loadSandboxToolEnvironment(environment: Record<string, string | undefined> = process.env) {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) return null
  return {
    url: result.data.XIAOBAO_SANDBOX_URL,
    sessionId: result.data.XIAOBAO_SANDBOX_SESSION_ID,
    authToken: result.data.XIAOBAO_SANDBOX_AUTH_TOKEN,
    timeoutMs: result.data.XIAOBAO_SANDBOX_TIMEOUT_MS,
  }
}

const healthCheckCommand = 'true'

/**
 * 真实沙箱 HTTP 客户端：携带服务端鉴权头调用 `POST {url}/api/tools/{tool}`。
 * 只把 `{ ok, error }` 的最小结果返回给上层；HTTP/网络/格式失败一律归一化为
 * `{ ok: false, error: '' }`，不透传上游状态行、正文或异常消息。
 */
export function createSandboxToolHttpClient(
  environment: SandboxToolEnvironment,
  fetchImplementation: typeof fetch = fetch,
): SandboxToolClient {
  const { url, sessionId, authToken, timeoutMs } = environment

  return {
    async execute(tool, input, requestedTimeoutMs) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), requestedTimeoutMs ?? timeoutMs)
      try {
        const response = await fetchImplementation(`${url}/api/tools/${encodeURIComponent(tool)}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'X-Cloudbase-Session-Id': sessionId,
            'X-Tcb-Webfn': 'true',
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
        const data = payload as { success?: unknown; result?: unknown; error?: unknown }
        if (data.success !== true) return { ok: false, error: '' }
        return { ok: true, result: data.result }
      } catch {
        return { ok: false, error: '' }
      } finally {
        clearTimeout(timeout)
      }
    },

    async healthCheck() {
      const outcome = await this.execute('bash', { command: healthCheckCommand, timeout: timeoutMs }, timeoutMs)
      return outcome.ok
    },
  }
}
