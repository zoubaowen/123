import { describe, expect, it, vi } from 'vitest'
import {
  createSandboxToolHttpClient,
  loadSandboxToolEnvironment,
  type SandboxToolEnvironment,
} from '../sandbox-http-client.js'

function validEnvironment(): Record<string, string> {
  return {
    XIAOBAO_SANDBOX_URL: 'https://env-xxxx.api.tcloudbasegateway.com/v1/functions/scf-sandbox',
    XIAOBAO_SANDBOX_SESSION_ID: 'session-1',
    XIAOBAO_SANDBOX_AUTH_TOKEN: 'token-1',
  }
}

function environment(overrides: Partial<SandboxToolEnvironment> = {}): SandboxToolEnvironment {
  return {
    url: 'https://env-xxxx.api.tcloudbasegateway.com/v1/functions/scf-sandbox',
    sessionId: 'session-1',
    authToken: 'token-1',
    timeoutMs: 30_000,
    ...overrides,
  }
}

describe('loadSandboxToolEnvironment', () => {
  it('accepts a complete sandbox tool environment', () => {
    expect(loadSandboxToolEnvironment(validEnvironment())).toEqual({
      url: 'https://env-xxxx.api.tcloudbasegateway.com/v1/functions/scf-sandbox',
      sessionId: 'session-1',
      authToken: 'token-1',
      timeoutMs: 30_000,
    })
  })

  it('returns null when any required value is missing', () => {
    for (const key of Object.keys(validEnvironment())) {
      const incomplete = validEnvironment()
      delete incomplete[key]
      expect(loadSandboxToolEnvironment(incomplete)).toBeNull()
    }
  })

  it('rejects a non-http(s) sandbox URL', () => {
    expect(loadSandboxToolEnvironment({ ...validEnvironment(), XIAOBAO_SANDBOX_URL: 'ftp://example.test' })).toBeNull()
  })

  it('accepts an explicit positive timeout', () => {
    expect(loadSandboxToolEnvironment({ ...validEnvironment(), XIAOBAO_SANDBOX_TIMEOUT_MS: '15000' })).toMatchObject({
      timeoutMs: 15_000,
    })
  })
})

function httpClient(sandboxEnvironment: SandboxToolEnvironment) {
  const requested: Array<{ url: string; init?: RequestInit }> = []
  const fetchImplementation: typeof fetch = async (url, init) => {
    requested.push({ url: url.toString(), init })
    return new Response(JSON.stringify({ success: true, result: { bytesWritten: 4 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  const client = createSandboxToolHttpClient(sandboxEnvironment, fetchImplementation)
  return { client, requested }
}

describe('createSandboxToolHttpClient', () => {
  it('posts to /api/tools/{endpoint} with auth headers and returns the result', async () => {
    const { client, requested } = httpClient(environment())

    const outcome = await client.execute('write', { path: '/tmp/a.js' }, 10_000)

    expect(outcome).toEqual({ ok: true, result: { bytesWritten: 4 } })
    expect(requested).toHaveLength(1)
    expect(requested[0].url).toBe('https://env-xxxx.api.tcloudbasegateway.com/v1/functions/scf-sandbox/api/tools/write')
    const headers = new Headers(requested[0].init?.headers)
    expect(headers.get('authorization')).toBe('Bearer token-1')
    expect(headers.get('x-cloudbase-session-id')).toBe('session-1')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(requested[0].init?.body))).toEqual({ path: '/tmp/a.js' })
  })

  it('maps success:false into a failed outcome without the upstream error string', async () => {
    const fetchImplementation: typeof fetch = async () =>
      new Response(JSON.stringify({ success: false, error: 'write denied: /etc/passwd' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    const client = createSandboxToolHttpClient(environment(), fetchImplementation)

    const outcome = await client.execute('write', { path: '/etc/passwd' }, 10_000)

    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('/etc/passwd')
    expect(JSON.stringify(outcome)).not.toContain('write denied')
  })

  it('treats non-ok http responses as failures without leaking the response body', async () => {
    const fetchImplementation: typeof fetch = async () => new Response('internal error text', { status: 500 })
    const client = createSandboxToolHttpClient(environment(), fetchImplementation)

    const outcome = await client.execute('bash', { command: 'ls' }, 10_000)

    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('internal error text')
  })

  it('normalizes network failure into an unavailable outcome without the error message', async () => {
    const fetchImplementation: typeof fetch = async () => {
      throw new TypeError('fetch failed with secret')
    }
    const client = createSandboxToolHttpClient(environment(), fetchImplementation)

    const outcome = await client.execute('bash', { command: 'ls' }, 10_000)

    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('secret')
  })

  it('healthCheck returns true after a successful round trip and false on failure', async () => {
    const healthyClient = createSandboxToolHttpClient(
      environment(),
      async () =>
        new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    await expect(healthyClient.healthCheck()).resolves.toBe(true)

    const unhealthyClient = createSandboxToolHttpClient(
      environment(),
      async () => new Response('boom', { status: 503 }),
    )
    await expect(unhealthyClient.healthCheck()).resolves.toBe(false)
  })
})
