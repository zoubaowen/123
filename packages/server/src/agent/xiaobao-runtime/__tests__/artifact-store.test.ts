import { describe, expect, it, vi } from 'vitest'
import {
  artifactPublicUrlBase,
  buildArtifactKey,
  createArtifactStore,
  createCosArtifactUploader,
  loadArtifactStoreEnvironment,
  withArtifactStore,
  type ArtifactStoreEnvironment,
  type ArtifactUploader,
} from '../artifact-store.js'
import type { ToolProvider } from '../ports.js'

const baseEnvironment: Record<string, string> = {
  XIAOBAO_ARTIFACT_COS_SECRET_ID: 'cos-secret-id',
  XIAOBAO_ARTIFACT_COS_SECRET_KEY: 'cos-secret-key',
  XIAOBAO_ARTIFACT_COS_BUCKET: 'xiaobao-artifacts',
  XIAOBAO_ARTIFACT_COS_REGION: 'ap-shanghai',
}

function environment(overrides: Partial<ArtifactStoreEnvironment> = {}): ArtifactStoreEnvironment {
  return {
    secretId: 'cos-secret-id',
    secretKey: 'cos-secret-key',
    bucket: 'xiaobao-artifacts',
    region: 'ap-shanghai',
    prefix: 'xiaobao-artifacts',
    domain: null,
    timeoutMs: 60_000,
    ...overrides,
  }
}

function uploader(ok = true): ArtifactUploader & { put: ReturnType<typeof vi.fn> } {
  return { put: vi.fn(async () => ok) } as unknown as ArtifactUploader & { put: ReturnType<typeof vi.fn> }
}

function artifactResponse(body: string, contentType = 'image/png'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': contentType } })
}

describe('loadArtifactStoreEnvironment', () => {
  it('returns null unless all four cosmos credentials are present', () => {
    expect(loadArtifactStoreEnvironment({})).toBeNull()
    for (const key of Object.keys(baseEnvironment)) {
      const partial = { ...baseEnvironment }
      delete partial[key]
      expect(loadArtifactStoreEnvironment(partial)).toBeNull()
    }
    expect(loadArtifactStoreEnvironment({ ...baseEnvironment, XIAOBAO_ARTIFACT_COS_BUCKET: '  ' })).toBeNull()
  })

  it('applies defaults and rejects a malformed domain', () => {
    expect(loadArtifactStoreEnvironment(baseEnvironment)).toMatchObject({
      prefix: 'xiaobao-artifacts',
      domain: null,
      timeoutMs: 60_000,
    })
    expect(
      loadArtifactStoreEnvironment({ ...baseEnvironment, XIAOBAO_ARTIFACT_COS_DOMAIN: 'https://cdn.example.test' }),
    ).toMatchObject({ domain: 'https://cdn.example.test' })

    for (const domain of ['ftp://cdn.test', 'https://cdn.test?a=1', 'https://user:pass@cdn.test', 'nope']) {
      expect(loadArtifactStoreEnvironment({ ...baseEnvironment, XIAOBAO_ARTIFACT_COS_DOMAIN: domain })).toBeNull()
    }
    expect(loadArtifactStoreEnvironment({ ...baseEnvironment, XIAOBAO_ARTIFACT_COS_TIMEOUT_MS: '0' })).toBeNull()
  })

  it('prefers the configured domain and falls back to the COS endpoint', () => {
    expect(artifactPublicUrlBase(environment())).toBe('https://xiaobao-artifacts.cos.ap-shanghai.myqcloud.com')
    expect(artifactPublicUrlBase(environment({ domain: 'https://cdn.example.test/' }))).toBe('https://cdn.example.test')
  })
})

describe('buildArtifactKey', () => {
  it('derives the extension from the content type', () => {
    expect(buildArtifactKey('prefix', { taskId: 'task-1', kind: 'generate_image' }, 'image/png', 'abc')).toBe(
      'prefix/task-1/generate_image-abc.png',
    )
    expect(
      buildArtifactKey('prefix', { taskId: 'task-1', kind: 'generate_video' }, 'video/mp4; charset=utf-8', 'abc'),
    ).toBe('prefix/task-1/generate_video-abc.mp4')
    expect(buildArtifactKey('prefix', { taskId: 'task-1', kind: 'generate_image' }, undefined, 'abc')).toBe(
      'prefix/task-1/generate_image-abc',
    )
  })

  it('sanitizes path traversal attempts in every segment', () => {
    const key = buildArtifactKey('../x', { taskId: '../../etc', kind: 'a/b' }, 'image/png', 'id')

    expect(key).not.toContain('..')
    expect(key.split('/')).toHaveLength(3)
  })
})

describe('createArtifactStore', () => {
  it('downloads the artifact, uploads it, and returns the durable url', async () => {
    const target = uploader()
    const fetchMock = vi.fn(async () => artifactResponse('image-bytes'))
    const store = createArtifactStore({
      uploader: target,
      publicUrlBase: 'https://cdn.example.test',
      prefix: 'artifacts',
      fetchImplementation: fetchMock as unknown as typeof fetch,
      idFactory: () => 'fixed-id',
    })

    await expect(
      store.mirror({ taskId: 'task-1', sourceUrl: 'https://tos.example/a.png', kind: 'image' }),
    ).resolves.toEqual({ ok: true, url: 'https://cdn.example.test/artifacts/task-1/image-fixed-id.png' })
    expect(target.put).toHaveBeenCalledWith('artifacts/task-1/image-fixed-id.png', expect.any(Buffer), 'image/png')
  })

  it.each([
    ['non-200 download', () => new Response('', { status: 404 })],
    ['empty body', () => artifactResponse('')],
  ])('fails closed on %s', async (_case, respond) => {
    const target = uploader()
    const store = createArtifactStore({
      uploader: target,
      publicUrlBase: 'https://cdn.example.test',
      prefix: 'artifacts',
      fetchImplementation: (async () => respond()) as unknown as typeof fetch,
    })

    await expect(store.mirror({ taskId: 't', sourceUrl: 'https://tos.example/a.png', kind: 'image' })).resolves.toEqual(
      {
        ok: false,
      },
    )
  })

  it('fails closed when the upload fails or the download throws', async () => {
    const failingUpload = createArtifactStore({
      uploader: uploader(false),
      publicUrlBase: 'https://cdn.example.test',
      prefix: 'artifacts',
      fetchImplementation: (async () => artifactResponse('bytes')) as unknown as typeof fetch,
    })
    await expect(
      failingUpload.mirror({ taskId: 't', sourceUrl: 'https://tos.example/a.png', kind: 'image' }),
    ).resolves.toEqual({ ok: false })

    const throwing = createArtifactStore({
      uploader: uploader(),
      publicUrlBase: 'https://cdn.example.test',
      prefix: 'artifacts',
      fetchImplementation: (async () => {
        throw new Error('ENOTFOUND tos.example')
      }) as unknown as typeof fetch,
    })
    const outcome = await throwing.mirror({ taskId: 't', sourceUrl: 'https://tos.example/a.png', kind: 'image' })
    expect(outcome).toEqual({ ok: false })
    expect(JSON.stringify(outcome)).not.toContain('ENOTFOUND')
  })

  it('reports health from its own configuration', async () => {
    const store = createArtifactStore({
      uploader: uploader(),
      publicUrlBase: 'https://cdn.example.test',
      prefix: 'artifacts',
    })

    await expect(store.healthCheck()).resolves.toBe(true)
  })
})

describe('createCosArtifactUploader', () => {
  it('resolves true on a successful put and false on an SDK error', async () => {
    const putObject = vi.fn((_params: unknown, callback: (error: unknown) => void) => callback(null))
    const onSuccess = createCosArtifactUploader(environment(), () => ({ putObject }) as never)
    await expect(onSuccess.put('key', Buffer.from('x'), 'image/png')).resolves.toBe(true)

    const failing = vi.fn((_params: unknown, callback: (error: unknown) => void) => callback(new Error('AccessDenied')))
    const onFailure = createCosArtifactUploader(environment(), () => ({ putObject: failing }) as never)
    await expect(onFailure.put('key', Buffer.from('x'), undefined)).resolves.toBe(false)
  })
})

describe('withArtifactStore', () => {
  const action = { id: 'action-1', toolName: 'generate_image', input: { prompt: 'x' } }

  function mediaProvider(output: unknown, ok = true): ToolProvider {
    return {
      name: 'media_tools',
      healthCheck: vi.fn(async () => true),
      execute: vi.fn(async () => ({ actionId: 'action-1', ok, output })) as never,
    }
  }

  it('returns the provider untouched when no store is configured', () => {
    const provider = mediaProvider({ url: 'https://tos.example/a.png' })

    expect(withArtifactStore(provider, null)).toBe(provider)
  })

  it('replaces the upstream url with the durable url', async () => {
    const store = {
      mirror: vi.fn(async () => ({ ok: true as const, url: 'https://cdn.example.test/a.png' })),
      healthCheck: async () => true,
    }
    const wrapped = withArtifactStore(mediaProvider({ url: 'https://tos.example/a.png', model: 'm' }), store)

    await expect(
      wrapped.execute({ taskId: 'task-1', action } as never, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true, output: { url: 'https://cdn.example.test/a.png', model: 'm' } })
    expect(store.mirror).toHaveBeenCalledWith({
      taskId: 'task-1',
      sourceUrl: 'https://tos.example/a.png',
      kind: 'generate_image',
    })
  })

  it('keeps the upstream url when mirroring fails, so the student still sees the work', async () => {
    const store = { mirror: vi.fn(async () => ({ ok: false as const })), healthCheck: async () => true }
    const wrapped = withArtifactStore(mediaProvider({ url: 'https://tos.example/a.png' }), store)

    await expect(
      wrapped.execute({ taskId: 'task-1', action } as never, new AbortController().signal),
    ).resolves.toMatchObject({ ok: true, output: { url: 'https://tos.example/a.png' } })
  })

  it.each([
    ['a failed observation', { url: 'https://tos.example/a.png' }, false],
    ['an observation without a url', { stdout: 'ok' }, true],
    ['a non-object output', 'plain text', true],
  ])('passes %s through without mirroring', async (_case, output, ok) => {
    const store = {
      mirror: vi.fn(async () => ({ ok: true as const, url: 'https://cdn.example.test/a.png' })),
      healthCheck: async () => true,
    }
    const wrapped = withArtifactStore(mediaProvider(output, ok), store)

    await wrapped.execute({ taskId: 'task-1', action } as never, new AbortController().signal)

    expect(store.mirror).not.toHaveBeenCalled()
  })

  it('forwards the health check', async () => {
    const store = { mirror: vi.fn(async () => ({ ok: false as const })), healthCheck: async () => true }
    const wrapped = withArtifactStore(mediaProvider({}), store)

    await expect(wrapped.healthCheck()).resolves.toBe(true)
    expect(wrapped.name).toBe('media_tools')
  })
})
