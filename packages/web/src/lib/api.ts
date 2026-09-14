const CONFIGURED_BASE_URL = import.meta.env.VITE_API_URL || ''
const BASE_URL = resolveApiBaseUrl(CONFIGURED_BASE_URL)
export const API_BASE = BASE_URL
const REQUEST_TIMEOUT = 10000

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`
}

function resolveApiBaseUrl(configuredBaseUrl: string): string {
  if (!configuredBaseUrl || typeof window === 'undefined') return configuredBaseUrl

  try {
    const configured = new URL(configuredBaseUrl, window.location.origin)
    const current = new URL(window.location.origin)

    if (
      import.meta.env.PROD &&
      isLoopbackHost(configured.hostname) &&
      isLoopbackHost(current.hostname) &&
      configured.origin !== current.origin
    ) {
      return ''
    }
  } catch {
    return configuredBaseUrl
  }

  return configuredBaseUrl
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      signal: controller.signal,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      // 带上状态码：调用方要能区分"没有权限 / 没有机构"（渲染空状态）与真正的失败（可重试）
      throw Object.assign(new Error(err.error || `HTTP ${res.status}`), { status: res.status })
    }
    return res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
