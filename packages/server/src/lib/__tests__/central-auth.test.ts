import { afterEach, describe, expect, it, vi } from 'vitest'
import { callCentralAuth, getCentralAuthBaseUrl, getDesktopCloudAuthRequirement } from '../central-auth'

describe('central auth configuration', () => {
  it('normalizes valid base urls', () => {
    expect(getCentralAuthBaseUrl({ CENTRAL_AUTH_BASE_URL: 'https://api.example.com/' })).toBe('https://api.example.com')
  })

  it('ignores unsupported protocols', () => {
    expect(getCentralAuthBaseUrl({ CENTRAL_AUTH_BASE_URL: 'file:///tmp/auth' })).toBeUndefined()
  })

  it('ignores the current loopback server to avoid self-calls', () => {
    expect(getCentralAuthBaseUrl({ CENTRAL_AUTH_BASE_URL: 'http://localhost:3001', PORT: '3001' })).toBeUndefined()
  })

  it('requires cloud auth in packaged desktop mode', () => {
    expect(getDesktopCloudAuthRequirement({ NODE_ENV: 'desktop' })).toEqual({ required: true, configured: false })
    expect(
      getDesktopCloudAuthRequirement({
        NODE_ENV: 'desktop',
        CENTRAL_AUTH_BASE_URL: 'https://api.example.com',
      }),
    ).toEqual({ required: true, configured: true })
  })

  it('allows local desktop auth only when explicitly requested', () => {
    expect(getDesktopCloudAuthRequirement({ NODE_ENV: 'desktop', DESKTOP_AUTH_MODE: 'local' })).toEqual({
      required: false,
      configured: false,
    })
  })
})

describe('callCentralAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns normalized user data from the central backend', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        success: true,
        user: {
          id: 'user_1',
          username: 'Alice',
          email: 'alice@example.com',
          name: 'Alice',
          avatar: 'https://example.com/avatar.png',
          role: 'admin',
        },
        envId: 'env_1',
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await callCentralAuth(
      'login',
      { username: 'alice', password: 'Password123' },
      'https://api.example.com',
    )

    expect(result).toEqual({
      ok: true,
      data: {
        success: true,
        user: {
          id: 'user_1',
          username: 'alice',
          email: 'alice@example.com',
          name: 'Alice',
          avatar: 'https://example.com/avatar.png',
          role: 'admin',
        },
        envId: 'env_1',
      },
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('preserves central backend auth failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Invalid username or password' }, { status: 401 })),
    )

    const result = await callCentralAuth(
      'login',
      { username: 'alice', password: 'bad-password' },
      'https://api.example.com',
    )

    expect(result).toEqual({
      ok: false,
      failure: { status: 401, error: 'Invalid username or password' },
    })
  })
})
