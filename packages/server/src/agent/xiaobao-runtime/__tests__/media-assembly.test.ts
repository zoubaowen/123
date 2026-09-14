import { describe, expect, it, vi } from 'vitest'
import type { CheckpointRepository } from '../../../db/types.js'
import { XIAOBAO_PRODUCTION_CAPABILITIES } from '../domain.js'
import { createXiaobaoProductionDependenciesFactory, type ProductionAdapterFactory } from '../dependencies.js'
import { MEDIA_TOOL_WHITELIST, type MediaToolClient } from '../media-tools.js'
import type { ArtifactStore } from '../ports.js'
import type { SafetyProvider, UsageProvider } from '../ports.js'
import type { SandboxToolClient } from '../sandbox-tools.js'
import { resolveProductionXiaobaoCapability, xiaobaoProductionCapabilities } from '../runtime.js'

function validEnvironment(): Record<string, string | undefined> {
  return {
    XIAOBAO_MODEL_BASE_URL: 'https://models.example.test/v1/',
    XIAOBAO_MODEL_HEALTHCHECK_URL: 'https://health.example.test/xiaobao',
    XIAOBAO_MODEL_API_KEY: 'test-api-key',
    XIAOBAO_MODEL_ID: 'xiaobao-model',
    XIAOBAO_MODEL_NAME: 'XiaoBao Model',
    XIAOBAO_MODEL_TIMEOUT_MS: '2500',
    XIAOBAO_MODEL_CONTEXT_WINDOW: '32768',
  }
}

const checkpointRepository: CheckpointRepository = {
  async healthCheck() {
    return true
  },
  async checkReadWriteReadiness() {
    return { readable: true, writable: true }
  },
  async findByTaskId() {
    return null
  },
  async create(record) {
    return record
  },
  async compareAndSwap(_taskId, _expectedRevision, next) {
    return next
  },
}

const safety: SafetyProvider = {
  async check() {
    return { allowed: true }
  },
}
const usage: UsageProvider = {
  async reserve(input) {
    return { allowed: true, reservationId: `${input.taskId}-reservation` }
  },
  async record() {},
}
const adaptersFactory: ProductionAdapterFactory = () => ({ safety, usage })
const healthyReadinessFetch: typeof fetch = async () => new Response(null, { status: 204 })
const skillsDirectory = new URL('../../../../../../skills', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

function mediaClient(healthy = true): MediaToolClient {
  return {
    generate: vi.fn(async () => ({ ok: true as const, result: { url: 'https://cdn.example/art.png' } })),
    healthCheck: vi.fn(async () => healthy),
  }
}

async function assemble(options?: {
  mediaClient?: MediaToolClient
  sandboxClient?: SandboxToolClient
  artifactStore?: ArtifactStore
  fetchImplementation?: typeof fetch
  environment?: Record<string, string | undefined>
}) {
  const createDependencies = createXiaobaoProductionDependenciesFactory({
    environment: options?.environment ?? validEnvironment(),
    adaptersFactory,
    getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
    skillsDirectory,
    fetchImplementation: options?.fetchImplementation ?? healthyReadinessFetch,
    ...(options?.mediaClient ? { mediaClient: options.mediaClient } : {}),
    ...(options?.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
    ...(options?.artifactStore ? { artifactStore: options.artifactStore } : {}),
  })
  return createDependencies()
}

function modelResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'complete-1',
                type: 'function',
                function: { name: 'xiaobao_complete', arguments: '{"text":"完成"}' },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const taskSnapshot = {
  schemaVersion: 1 as const,
  taskId: 'task-media',
  userId: 'student-1',
  capability: 'image' as const,
  prompt: '画一张太空猫',
  status: 'created' as const,
  revision: 0,
  turnCount: 0,
  usageReservationId: null,
  modelUsageTokens: 0,
  hasExactModelUsage: false,
  observations: [],
  resultText: null,
  createdAt: 1,
  updatedAt: 1,
  currentStepId: null,
}

describe('xiaobao media tool assembly', () => {
  it('registers no media tools when neither a client nor media configuration exists', async () => {
    const assembled = await assemble()

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(0)
    for (const toolName of Object.keys(MEDIA_TOOL_WHITELIST)) {
      expect(assembled?.tools.has(toolName)).toBe(false)
    }
  })

  it('registers no media tools when the media service health check fails', async () => {
    const assembled = await assemble({ mediaClient: mediaClient(false) })

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(0)
  })

  it('registers exactly the three media tools when the media service is healthy', async () => {
    const assembled = await assemble({ mediaClient: mediaClient(true) })

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(3)
    for (const toolName of Object.keys(MEDIA_TOOL_WHITELIST)) {
      expect(assembled?.tools.has(toolName)).toBe(true)
    }
  })

  it('auto-assembles media tools from a complete environment without an explicit client', async () => {
    const probed: string[] = []
    const fetchImplementation: typeof fetch = async (url) => {
      const urlString = url.toString()
      if (urlString === 'https://health.example.test/xiaobao') return new Response(null, { status: 204 })
      if (urlString === 'https://media.example.test/health') {
        probed.push(urlString)
        return new Response(null, { status: 200 })
      }
      return modelResponse()
    }
    const environment = {
      ...validEnvironment(),
      XIAOBAO_MEDIA_URL: 'https://media.example.test',
      XIAOBAO_MEDIA_AUTH_TOKEN: 'media-token',
    }

    const assembled = await assemble({ environment, fetchImplementation })

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(3)
    // 健康探针走无生成成本的 /health，而不是真的生成一次媒体。
    expect(probed).toEqual(['https://media.example.test/health'])
  })

  it('sends media tool schemas to the model alongside the completion tool', async () => {
    let requestBody: { tools?: Array<{ function: { name: string } }> } | undefined
    const fetchImplementation: typeof fetch = async (url, init) => {
      if (url.toString() === 'https://health.example.test/xiaobao') return new Response(null, { status: 204 })
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body)
      return modelResponse()
    }
    const assembled = await assemble({ mediaClient: mediaClient(true), fetchImplementation })
    const skill = await assembled?.skills.getByCapability('writing')

    await assembled?.model.complete(
      { task: taskSnapshot, prompt: '画一张太空猫', skill: skill!, observations: [] },
      new AbortController().signal,
    )

    const names = requestBody?.tools?.map((tool) => tool.function.name) ?? []
    expect(names).toContain('generate_image')
    expect(names).toContain('generate_video')
    expect(names).toContain('generate_music')
    expect(names).toContain('xiaobao_complete')
  })

  it('keeps media capabilities unselectable until they are explicitly enabled', async () => {
    const assembled = await assemble({ mediaClient: mediaClient(true) })

    // 工具已装配，但在能力放行集合更新前，运行期仍必须 fail-closed。
    expect(assembled?.tools.size).toBe(3)
    expect([...XIAOBAO_PRODUCTION_CAPABILITIES]).toEqual(['writing', 'learning', 'game'])
    await expect(
      resolveProductionXiaobaoCapability('画一张太空猫', { xiaobaoCapability: 'image' } as never),
    ).rejects.toMatchObject({ name: 'UnsupportedXiaobaoCapabilityError' })
  })

  it('keeps sandbox and media tools independent', async () => {
    const sandbox: SandboxToolClient = {
      execute: vi.fn(async () => ({ ok: true as const, result: {} })),
      healthCheck: vi.fn(async () => true),
    }
    const both = await assemble({ mediaClient: mediaClient(true), sandboxClient: sandbox })
    const mediaOnly = await assemble({ mediaClient: mediaClient(true) })
    const sandboxOnly = await assemble({ sandboxClient: sandbox })

    expect(both?.tools.size).toBe(7)
    expect(mediaOnly?.tools.size).toBe(3)
    expect(sandboxOnly?.tools.size).toBe(4)
  })

  it('auto-assembles the media tools from a Volcengine ARK key', async () => {
    const assembled = await assemble({ environment: { ...validEnvironment(), ARK_API_KEY: 'ark-secret-key' } })

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(3)
    for (const toolName of Object.keys(MEDIA_TOOL_WHITELIST)) {
      expect(assembled?.tools.has(toolName)).toBe(true)
    }
  })

  it('loads the media master skills only when the media service is assembled', async () => {
    const withoutMedia = await assemble()
    const withMedia = await assemble({ environment: { ...validEnvironment(), ARK_API_KEY: 'ark-secret-key' } })

    await expect(withoutMedia?.skills.getByCapability('image')).resolves.toBeNull()
    await expect(withoutMedia?.skills.getByCapability('video')).resolves.toBeNull()
    await expect(withMedia?.skills.getByCapability('image')).resolves.toMatchObject({
      name: 'student-image-master',
      version: '1.0.0',
    })
    await expect(withMedia?.skills.getByCapability('video')).resolves.toMatchObject({
      name: 'student-video-master',
      version: '1.0.0',
    })
  })

  it('advertises the media capabilities only when the media service is configured', async () => {
    expect([...xiaobaoProductionCapabilities({})]).toEqual(['writing', 'learning', 'game'])
    expect([...xiaobaoProductionCapabilities({ ARK_API_KEY: 'ark-secret-key' })]).toEqual([
      'writing',
      'learning',
      'game',
      'image',
      'video',
    ])
  })

  it('resolves a media capability exactly when it is configured', async () => {
    const request = { xiaobaoCapability: 'image' } as never

    await expect(resolveProductionXiaobaoCapability('画一张太空猫', request, {})).rejects.toMatchObject({
      name: 'UnsupportedXiaobaoCapabilityError',
    })
    await expect(
      resolveProductionXiaobaoCapability('画一张太空猫', request, { ARK_API_KEY: 'ark-secret-key' }),
    ).resolves.toBe('image')
  })

  it('mirrors media artifacts through the configured store', async () => {
    const store: ArtifactStore = {
      mirror: vi.fn(async () => ({ ok: true as const, url: 'https://cdn.example.test/durable.png' })),
      healthCheck: vi.fn(async () => true),
    }
    const assembled = await assemble({ mediaClient: mediaClient(true), artifactStore: store })
    const tool = assembled?.tools.get('generate_image')

    const observation = await tool?.execute(
      {
        taskId: 'task-media',
        action: { id: 'action-1', toolName: 'generate_image', input: { prompt: '太空猫' } },
      } as never,
      new AbortController().signal,
    )

    expect(observation).toMatchObject({ ok: true, output: { url: 'https://cdn.example.test/durable.png' } })
    expect(store.mirror).toHaveBeenCalledWith({
      taskId: 'task-media',
      sourceUrl: 'https://cdn.example/art.png',
      kind: 'generate_image',
    })
  })

  it('reuses the cached dependencies when only the artifact store is injected', async () => {
    const store: ArtifactStore = { mirror: vi.fn(), healthCheck: vi.fn(async () => true) }
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
      mediaClient: mediaClient(true),
      artifactStore: store,
    })

    const first = await createDependencies()
    const second = await createDependencies()

    // 身份对象字面量漏写新字段会让缓存永不命中（本项目已踩过两次），这里显式守住。
    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })
})
