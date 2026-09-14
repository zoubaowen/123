import { describe, expect, it, vi } from 'vitest'
import type { MediaToolClient } from '../media-tools.js'
import {
  MEDIA_TOOL_BY_CAPABILITY,
  MEDIA_TOOL_DEFINITIONS,
  MEDIA_TOOL_WHITELIST,
  MediaToolsProvider,
  normalizeMediaResult,
} from '../media-tools.js'

function client(overrides: Partial<MediaToolClient> = {}): MediaToolClient {
  return {
    generate: vi.fn(async () => ({ ok: true as const, result: { url: 'https://cdn.example/art.png' } })),
    healthCheck: vi.fn(async () => true),
    ...overrides,
  }
}

const request = (toolName: string, input: unknown = { prompt: '一只太空猫' }) => ({
  taskId: 'task-1',
  action: { id: 'action-1', toolName, input },
})

describe('media tool whitelist', () => {
  it('maps exactly the three media tools and rejects everything else', () => {
    expect(MEDIA_TOOL_WHITELIST).toEqual({
      generate_image: 'image',
      generate_video: 'video',
      generate_music: 'music',
    })
    expect(Object.keys(MEDIA_TOOL_WHITELIST)).toHaveLength(3)
  })

  it('declares one required tool per media capability', () => {
    expect(MEDIA_TOOL_BY_CAPABILITY).toEqual({
      image: 'generate_image',
      video: 'generate_video',
      music: 'generate_music',
    })
    for (const toolName of Object.values(MEDIA_TOOL_BY_CAPABILITY)) {
      expect(MEDIA_TOOL_WHITELIST[toolName]).toBeDefined()
    }
  })

  it('ships a model-visible definition for every whitelisted tool', () => {
    const names = MEDIA_TOOL_DEFINITIONS.map((definition) => definition.function.name)

    expect(names.sort()).toEqual(['generate_image', 'generate_music', 'generate_video'])
    for (const definition of MEDIA_TOOL_DEFINITIONS) {
      expect(definition.type).toBe('function')
      expect(definition.function.parameters).toMatchObject({ type: 'object', additionalProperties: false })
      expect((definition.function.parameters as { required: string[] }).required).toContain('prompt')
    }
  })
})

describe('MediaToolsProvider', () => {
  it('routes each whitelisted tool to its media service kind', async () => {
    const mediaClient = client()
    const provider = new MediaToolsProvider(mediaClient)

    await expect(provider.execute(request('generate_video'), new AbortController().signal)).resolves.toMatchObject({
      actionId: 'action-1',
      ok: true,
      output: { url: 'https://cdn.example/art.png' },
    })
    expect(mediaClient.generate).toHaveBeenCalledWith('video', { prompt: '一只太空猫' }, 120_000)
  })

  it('rejects a non-whitelisted tool without touching the media service', async () => {
    const mediaClient = client()
    const provider = new MediaToolsProvider(mediaClient)

    await expect(provider.execute(request('run_command'), new AbortController().signal)).resolves.toMatchObject({
      ok: false,
      errorCode: 'unknown_tool',
    })
    expect(mediaClient.generate).not.toHaveBeenCalled()
  })

  it('maps a service failure to a stable code without leaking upstream text', async () => {
    const provider = new MediaToolsProvider(
      client({ generate: vi.fn(async () => ({ ok: false as const, error: 'upstream 500 secret-body' })) }),
    )

    const observation = await provider.execute(request('generate_image'), new AbortController().signal)

    expect(observation).toMatchObject({ ok: false, errorCode: 'tool_failed' })
    expect(JSON.stringify(observation)).not.toContain('secret-body')
  })

  it('reports a throwing client as unavailable and never as a fabricated artifact', async () => {
    const provider = new MediaToolsProvider(
      client({
        generate: vi.fn(async () => {
          throw new Error('connect ECONNREFUSED 10.0.0.1')
        }),
      }),
    )

    const observation = await provider.execute(request('generate_music'), new AbortController().signal)

    expect(observation).toMatchObject({ ok: false, output: null, errorCode: 'tool_unavailable' })
    expect(JSON.stringify(observation)).not.toContain('10.0.0.1')
  })

  it('reports cancellation when the caller aborts', async () => {
    const controller = new AbortController()
    const provider = new MediaToolsProvider(
      client({
        generate: vi.fn(async () => {
          controller.abort()
          throw Object.assign(new Error('aborted'), { name: 'AbortError' })
        }),
      }),
    )

    await expect(provider.execute(request('generate_image'), controller.signal)).resolves.toMatchObject({
      ok: false,
      errorCode: 'cancelled',
    })
  })

  it('forwards the health check', async () => {
    const healthy = new MediaToolsProvider(client({ healthCheck: vi.fn(async () => true) }))
    const unhealthy = new MediaToolsProvider(client({ healthCheck: vi.fn(async () => false) }))

    await expect(healthy.healthCheck()).resolves.toBe(true)
    await expect(unhealthy.healthCheck()).resolves.toBe(false)
  })
})

describe('normalizeMediaResult', () => {
  it('keeps normal media results untouched', () => {
    const result = { url: 'https://cdn.example/a.mp4', durationSeconds: 6 }
    expect(normalizeMediaResult(result)).toEqual(result)
  })

  it('truncates an oversized payload instead of passing it through', () => {
    const huge = { url: 'https://cdn.example/a.png', debug: 'x'.repeat(50_000) }

    const normalized = normalizeMediaResult(huge) as { truncated?: boolean; value?: string }

    expect(normalized.truncated).toBe(true)
    expect(normalized.value?.length).toBeLessThanOrEqual(20_000)
  })
})
