import { describe, expect, it, vi } from 'vitest'
import { createMediaToolHttpClient, loadMediaToolEnvironment } from '../media-http-client.js'

const baseEnvironment = {
  XIAOBAO_MEDIA_URL: 'https://media.example.test',
  XIAOBAO_MEDIA_AUTH_TOKEN: 'media-token',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('loadMediaToolEnvironment', () => {
  it('returns null when any required value is missing or blank', () => {
    expect(loadMediaToolEnvironment({})).toBeNull()
    expect(loadMediaToolEnvironment({ XIAOBAO_MEDIA_URL: 'https://media.example.test' })).toBeNull()
    expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_AUTH_TOKEN: '   ' })).toBeNull()
  })

  it('rejects non-http, query-bearing and relative urls', () => {
    for (const url of ['ftp://media.example.test', 'https://media.example.test?a=1', '/api/media', 'not-a-url']) {
      expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_URL: url })).toBeNull()
    }
  })

  it('defaults the timeout and rejects a non-positive one', () => {
    expect(loadMediaToolEnvironment(baseEnvironment)).toMatchObject({ timeoutMs: 120_000 })
    expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_TIMEOUT_MS: '5000' })).toMatchObject({
      timeoutMs: 5_000,
    })
    expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_TIMEOUT_MS: '0' })).toBeNull()
    expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_TIMEOUT_MS: 'abc' })).toBeNull()
  })

  it('rejects a url that embeds credentials', () => {
    for (const url of ['https://user:pass@media.example.test', 'https://token@media.example.test']) {
      expect(loadMediaToolEnvironment({ ...baseEnvironment, XIAOBAO_MEDIA_URL: url })).toBeNull()
    }
  })

  it('keeps credentials out of the parsed url', () => {
    const environment = loadMediaToolEnvironment(baseEnvironment)

    expect(environment?.url).toBe('https://media.example.test')
    expect(environment?.url).not.toContain('media-token')
  })
})

describe('createMediaToolHttpClient', () => {
  it('posts the input to the kind endpoint with a bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, result: { url: 'https://cdn/a.png' } }))
    const client = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      fetchMock as unknown as typeof fetch,
    )

    await expect(client.generate('image', { prompt: '太空猫' }, 5_000)).resolves.toEqual({
      ok: true,
      result: { url: 'https://cdn/a.png' },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://media.example.test/api/media/image',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer media-token' }),
        body: JSON.stringify({ prompt: '太空猫' }),
      }),
    )
  })

  it.each([
    ['non-200 status', () => jsonResponse({ success: true }, 500)],
    ['success false', () => jsonResponse({ success: false, error: 'moderation blocked' })],
    ['missing success flag', () => jsonResponse({ result: { url: 'https://cdn/a.png' } })],
    ['non-json body', () => new Response('<html>gateway</html>', { status: 200 })],
  ])('normalizes %s into a sanitized failure', async (_case, respond) => {
    const fetchMock = vi.fn(async () => respond())
    const client = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      fetchMock as unknown as typeof fetch,
    )

    const outcome = await client.generate('video', { prompt: 'x' }, 5_000)

    expect(outcome.ok).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('moderation blocked')
    expect(JSON.stringify(outcome)).not.toContain('gateway')
  })

  it('normalizes a network failure without leaking the exception', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND media.example.test')
    })
    const client = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      fetchMock as unknown as typeof fetch,
    )

    const outcome = await client.generate('music', { prompt: 'x' }, 5_000)

    expect(outcome).toEqual({ ok: false, error: '' })
    expect(JSON.stringify(outcome)).not.toContain('ENOTFOUND')
  })

  it('probes the dedicated health endpoint instead of spending a generation', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 200 }))
    const client = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      fetchMock as unknown as typeof fetch,
    )

    await expect(client.healthCheck()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://media.example.test/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('reports an unhealthy service when the probe fails or throws', async () => {
    const failing = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch,
    )
    const throwing = createMediaToolHttpClient(
      { url: 'https://media.example.test', authToken: 'media-token', timeoutMs: 5_000 },
      vi.fn(async () => {
        throw new Error('down')
      }) as unknown as typeof fetch,
    )

    await expect(failing.healthCheck()).resolves.toBe(false)
    await expect(throwing.healthCheck()).resolves.toBe(false)
  })
})
