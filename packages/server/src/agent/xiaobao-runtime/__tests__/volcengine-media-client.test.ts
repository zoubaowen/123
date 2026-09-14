import { describe, expect, it, vi } from 'vitest'
import {
  createVolcengineMediaClient,
  loadVolcengineMediaEnvironment,
  type VolcengineMediaEnvironment,
} from '../volcengine-media-client.js'

const baseEnvironment: Record<string, string> = {
  ARK_API_KEY: 'ark-secret-key',
}

function environment(overrides: Partial<VolcengineMediaEnvironment> = {}): VolcengineMediaEnvironment {
  return {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKey: 'ark-secret-key',
    imageModel: 'doubao-seedream-4-0-250828',
    videoModel: 'doubao-seedance-1-5-pro-251215',
    timeoutMs: 120_000,
    pollIntervalMs: 5_000,
    pollTimeoutMs: 900_000,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function createClient(
  respond: (url: string, init?: RequestInit) => Promise<Response> | Response,
  options: { now?: () => number; environment?: Partial<VolcengineMediaEnvironment> } = {},
) {
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => respond(url.toString(), init))
  const client = createVolcengineMediaClient(environment(options.environment), {
    fetchImplementation: fetchMock as unknown as typeof fetch,
    sleep: async () => undefined,
    now: options.now ?? (() => 0),
  })
  return { client, fetchMock }
}

describe('loadVolcengineMediaEnvironment', () => {
  it('returns null without an ARK api key or with a blank one', () => {
    expect(loadVolcengineMediaEnvironment({})).toBeNull()
    expect(loadVolcengineMediaEnvironment({ ARK_API_KEY: '   ' })).toBeNull()
  })

  it('applies production defaults for base url and models', () => {
    const loaded = loadVolcengineMediaEnvironment(baseEnvironment)

    expect(loaded).toMatchObject({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      imageModel: 'doubao-seedream-4-0-250828',
      videoModel: 'doubao-seedance-1-5-pro-251215',
      timeoutMs: 240_000,
      pollIntervalMs: 5_000,
      pollTimeoutMs: 900_000,
    })
  })

  it('honours explicit overrides and rejects malformed ones', () => {
    expect(
      loadVolcengineMediaEnvironment({
        ...baseEnvironment,
        XIAOBAO_VOLC_BASE_URL: 'https://proxy.example.test/api/v3',
        XIAOBAO_VOLC_IMAGE_MODEL: 'custom-image',
        XIAOBAO_VOLC_VIDEO_MODEL: 'custom-video',
        XIAOBAO_VOLC_TIMEOUT_MS: '60000',
        XIAOBAO_VOLC_POLL_INTERVAL_MS: '1000',
        XIAOBAO_VOLC_POLL_TIMEOUT_MS: '120000',
      }),
    ).toMatchObject({
      baseUrl: 'https://proxy.example.test/api/v3',
      imageModel: 'custom-image',
      videoModel: 'custom-video',
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      pollTimeoutMs: 120_000,
    })

    for (const url of ['ftp://x.test', 'https://x.test?a=1', 'https://user:pass@x.test', 'nope']) {
      expect(loadVolcengineMediaEnvironment({ ...baseEnvironment, XIAOBAO_VOLC_BASE_URL: url })).toBeNull()
    }
    expect(loadVolcengineMediaEnvironment({ ...baseEnvironment, XIAOBAO_VOLC_POLL_TIMEOUT_MS: '0' })).toBeNull()
  })
})

describe('volcengine image generation', () => {
  it('posts the documented seedream payload and returns the produced url', async () => {
    const { client, fetchMock } = createClient(() =>
      jsonResponse({ created: 1, data: [{ url: 'https://tos.example/art.png' }] }),
    )

    await expect(
      client.generate('image', { prompt: '一只太空猫', style: '水彩', aspectRatio: '16:9' }, 120_000),
    ).resolves.toEqual({
      ok: true,
      result: { url: 'https://tos.example/art.png', model: 'doubao-seedream-4-0-250828', kind: 'image' },
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://ark.cn-beijing.volces.com/api/v3/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer ark-secret-key' }),
      }),
    )
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).toEqual({
      model: 'doubao-seedream-4-0-250828',
      prompt: '一只太空猫\n风格：水彩',
      response_format: 'url',
      watermark: false,
      size: '2560x1440',
    })
  })

  it('omits size for an unknown aspect ratio instead of guessing', async () => {
    const { client, fetchMock } = createClient(() => jsonResponse({ data: [{ url: 'https://tos.example/a.png' }] }))

    await client.generate('image', { prompt: 'x', aspectRatio: '7:3' }, 120_000)

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(body).not.toHaveProperty('size')
  })

  it('wraps a b64_json response into a data url', async () => {
    const { client } = createClient(() => jsonResponse({ data: [{ b64_json: 'QUJD' }] }))

    await expect(client.generate('image', { prompt: 'x' }, 120_000)).resolves.toEqual({
      ok: true,
      result: { url: 'data:image/png;base64,QUJD', model: 'doubao-seedream-4-0-250828', kind: 'image' },
    })
  })

  it.each([
    ['non-200', () => jsonResponse({ data: [{ url: 'x' }] }, 403)],
    ['empty data', () => jsonResponse({ data: [] })],
    ['missing data', () => jsonResponse({})],
    ['non-object entry', () => jsonResponse({ data: ['nope'] })],
    ['no url or b64', () => jsonResponse({ data: [{}] })],
    ['non-json body', () => new Response('<html>gateway</html>', { status: 200 })],
  ])('normalizes %s into a sanitized failure', async (_case, respond) => {
    const { client } = createClient(respond)

    const outcome = await client.generate('image', { prompt: 'x' }, 120_000)

    expect(outcome).toEqual({ ok: false, error: '' })
  })

  it('fails closed for a blank prompt and for a network error', async () => {
    const blank = createClient(() => jsonResponse({ data: [{ url: 'x' }] }))
    await expect(blank.client.generate('image', { prompt: '   ' }, 120_000)).resolves.toEqual({
      ok: false,
      error: '',
    })
    expect(blank.fetchMock).not.toHaveBeenCalled()

    const throwing = createClient(() => {
      throw new Error('getaddrinfo ENOTFOUND ark.cn-beijing.volces.com')
    })
    const outcome = await throwing.client.generate('image', { prompt: 'x' }, 120_000)
    expect(outcome).toEqual({ ok: false, error: '' })
    expect(JSON.stringify(outcome)).not.toContain('ENOTFOUND')
  })
})

describe('volcengine video generation', () => {
  const succeeded = {
    id: 'cgt-1',
    status: 'succeeded',
    content: { video_url: 'https://tos.example/clip.mp4', last_frame_url: 'https://tos.example/frame.png' },
  }

  it('creates a task, polls it, and returns the produced video url', async () => {
    const { client, fetchMock } = createClient((url) => {
      if (url.endsWith('/contents/generations/tasks')) return jsonResponse({ id: 'cgt-1' })
      return jsonResponse(succeeded)
    })

    await expect(
      client.generate('video', { prompt: '小猫在太空', durationSeconds: 10, aspectRatio: '16:9' }, 120_000),
    ).resolves.toEqual({
      ok: true,
      result: {
        url: 'https://tos.example/clip.mp4',
        model: 'doubao-seedance-1-5-pro-251215',
        kind: 'video',
        lastFrameUrl: 'https://tos.example/frame.png',
      },
    })

    const createBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(createBody).toEqual({
      model: 'doubao-seedance-1-5-pro-251215',
      content: [{ type: 'text', text: '小猫在太空' }],
      resolution: '720p',
      duration: 10,
      ratio: '16:9',
      watermark: false,
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-1',
    )
    expect((fetchMock.mock.calls[1]![1] as RequestInit).method).toBe('GET')
  })

  it('keeps polling while the task is queued or running', async () => {
    let polls = 0
    const { client } = createClient((url) => {
      if (url.endsWith('/contents/generations/tasks')) return jsonResponse({ id: 'cgt-2' })
      polls += 1
      return jsonResponse(polls < 3 ? { id: 'cgt-2', status: 'running' } : succeeded)
    })

    await expect(client.generate('video', { prompt: 'x' }, 120_000)).resolves.toMatchObject({ ok: true })
    expect(polls).toBe(3)
  })

  it('omits an unsupported ratio instead of sending an invalid value', async () => {
    const { client, fetchMock } = createClient((url) =>
      url.endsWith('/contents/generations/tasks') ? jsonResponse({ id: 'cgt-3' }) : jsonResponse(succeeded),
    )

    await client.generate('video', { prompt: 'x', aspectRatio: '7:3' }, 120_000)

    const createBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)
    expect(createBody).not.toHaveProperty('ratio')
  })

  it.each(['failed', 'expired', 'cancelled'])('fails closed for a %s task', async (status) => {
    const { client } = createClient((url) =>
      url.endsWith('/contents/generations/tasks') ? jsonResponse({ id: 'cgt-4' }) : jsonResponse({ status }),
    )

    await expect(client.generate('video', { prompt: 'x' }, 120_000)).resolves.toEqual({ ok: false, error: '' })
  })

  it('fails closed when the task is created without an id or a video url is missing', async () => {
    const noId = createClient(() => jsonResponse({}))
    await expect(noId.client.generate('video', { prompt: 'x' }, 120_000)).resolves.toEqual({ ok: false, error: '' })

    const noUrl = createClient((url) =>
      url.endsWith('/contents/generations/tasks')
        ? jsonResponse({ id: 'cgt-5' })
        : jsonResponse({ status: 'succeeded', content: {} }),
    )
    await expect(noUrl.client.generate('video', { prompt: 'x' }, 120_000)).resolves.toEqual({
      ok: false,
      error: '',
    })
  })

  it('stops polling at the configured deadline instead of hanging', async () => {
    // 第 1 次取时间用于计算 deadline；第 2 次仍在期限内（放行一次轮询）；第 3 次已超期。
    const clock = [0, 1_000, 1_000_000]
    let reads = 0
    const { client, fetchMock } = createClient(
      (url) =>
        url.endsWith('/contents/generations/tasks')
          ? jsonResponse({ id: 'cgt-6' })
          : jsonResponse({ status: 'running' }),
      { now: () => clock[Math.min(reads++, clock.length - 1)]! },
    )

    await expect(client.generate('video', { prompt: 'x' }, 120_000)).resolves.toEqual({ ok: false, error: '' })
    // 一次创建 + 一次轮询：超出 deadline 后不再继续轮询。
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('volcengine unsupported kinds and health', () => {
  it('fails closed for music instead of fabricating audio', async () => {
    const { client, fetchMock } = createClient(() => jsonResponse({}))

    await expect(client.generate('music', { prompt: 'x' }, 120_000)).resolves.toEqual({ ok: false, error: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports configuration completeness as its health signal', async () => {
    const { client } = createClient(() => jsonResponse({}))

    await expect(client.healthCheck()).resolves.toBe(true)
  })
})
