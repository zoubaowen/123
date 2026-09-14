export interface CentralAuthUser {
  id: string
  username: string
  email?: string | null
  name?: string | null
  avatar?: string | null
  role?: string | null
}

export interface CentralAuthSuccess {
  success?: boolean
  user: CentralAuthUser
  envId?: string
}

export interface CentralAuthFailure {
  status: number
  error: string
}

export type CentralAuthResult = { ok: true; data: CentralAuthSuccess } | { ok: false; failure: CentralAuthFailure }

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

export function isDesktopCloudAuthRequired(env: NodeJS.ProcessEnv = process.env) {
  return env.NODE_ENV === 'desktop' && env.DESKTOP_AUTH_MODE !== 'local'
}

export function getCentralAuthBaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.CENTRAL_AUTH_BASE_URL || env.XIAOBAO_CLOUD_API_URL
  if (!raw) return undefined

  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    const serverPort = env.PORT || '3001'
    const urlPort = url.port || (url.protocol === 'https:' ? '443' : '80')
    if (isLoopbackHost(url.hostname) && urlPort === serverPort) return undefined
    return url.toString().replace(/\/+$/, '')
  } catch {
    return undefined
  }
}

export function getDesktopCloudAuthRequirement(env: NodeJS.ProcessEnv = process.env) {
  return {
    required: isDesktopCloudAuthRequired(env),
    configured: Boolean(getCentralAuthBaseUrl(env)),
  }
}

function normalizeError(value: unknown): string {
  if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string') {
    return value.error
  }
  return 'Authentication failed'
}

function normalizeUser(value: unknown): CentralAuthUser | undefined {
  if (!value || typeof value !== 'object') return undefined
  const user = value as Partial<CentralAuthUser>
  if (!user.id || !user.username || typeof user.id !== 'string' || typeof user.username !== 'string') return undefined
  return {
    id: user.id,
    username: user.username.trim().toLowerCase(),
    email: typeof user.email === 'string' ? user.email : null,
    name: typeof user.name === 'string' ? user.name : null,
    avatar: typeof user.avatar === 'string' ? user.avatar : null,
    role: typeof user.role === 'string' ? user.role : null,
  }
}

export async function callCentralAuth(
  action: 'login' | 'register',
  body: Record<string, unknown>,
  baseUrl = getCentralAuthBaseUrl(),
): Promise<CentralAuthResult | undefined> {
  if (!baseUrl) return undefined

  const response = await fetch(`${baseUrl}/api/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    return { ok: false, failure: { status: response.status, error: normalizeError(payload) } }
  }

  const value = payload as Partial<CentralAuthSuccess> | undefined
  const user = normalizeUser(value?.user)
  if (!user) {
    return { ok: false, failure: { status: 502, error: 'Authentication failed' } }
  }

  return {
    ok: true,
    data: {
      success: true,
      user,
      envId: typeof value?.envId === 'string' ? value.envId : undefined,
    },
  }
}
