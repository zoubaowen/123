import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CheckpointRepository } from '../../../db/types.js'
import { loadXiaobaoModelConfig } from '../config.js'
import {
  configureXiaobaoProductionAdapters,
  createXiaobaoProductionDependenciesFactory,
  loadApprovedProjectSkills,
  type ProductionAdapterFactory,
} from '../dependencies.js'
import type { SafetyProvider, UsageProvider } from '../ports.js'
import { createTaskSnapshot } from '../state-machine.js'

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
const skillsDirectory = fileURLToPath(new URL('../../../../../../skills', import.meta.url))
const repositoryRoot = dirname(skillsDirectory)
const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('xiaobao model configuration', () => {
  it('returns unavailable configuration when required values are absent', () => {
    expect(loadXiaobaoModelConfig({})).toBeNull()
  })

  it('normalizes a complete environment without exposing parser internals', () => {
    expect(loadXiaobaoModelConfig(validEnvironment())).toEqual({
      baseUrl: 'https://models.example.test/v1/',
      healthCheckUrl: 'https://health.example.test/xiaobao',
      apiKey: 'test-api-key',
      modelId: 'xiaobao-model',
      modelName: 'XiaoBao Model',
      timeoutMs: 2500,
      contextWindow: 32768,
    })
  })

  it('uses safe defaults for optional model settings', () => {
    const environment = validEnvironment()
    delete environment.XIAOBAO_MODEL_NAME
    delete environment.XIAOBAO_MODEL_TIMEOUT_MS
    delete environment.XIAOBAO_MODEL_CONTEXT_WINDOW

    expect(loadXiaobaoModelConfig(environment)).toEqual({
      baseUrl: 'https://models.example.test/v1/',
      healthCheckUrl: 'https://health.example.test/xiaobao',
      apiKey: 'test-api-key',
      modelId: 'xiaobao-model',
      modelName: 'xiaobao-model',
      timeoutMs: 30_000,
    })
  })

  it.each(['ftp://models.example.test/v1', 'not-a-url'])('rejects unsupported model URL %s', (baseUrl) => {
    expect(loadXiaobaoModelConfig({ ...validEnvironment(), XIAOBAO_MODEL_BASE_URL: baseUrl })).toBeNull()
  })

  it('requires an explicit vendor-independent production health endpoint', () => {
    const environment = validEnvironment()
    delete environment.XIAOBAO_MODEL_HEALTHCHECK_URL

    expect(loadXiaobaoModelConfig(environment)).toBeNull()
  })

  it.each(['ftp://health.example.test/xiaobao', 'https://user:password@health.example.test/xiaobao', 'not-a-url'])(
    'rejects unsafe health endpoint %s',
    (healthCheckUrl) => {
      expect(
        loadXiaobaoModelConfig({ ...validEnvironment(), XIAOBAO_MODEL_HEALTHCHECK_URL: healthCheckUrl }),
      ).toBeNull()
    },
  )

  it('stays unavailable when checkpoint storage is readable but not safely writable', async () => {
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({
        xiaobaoRuntimeCheckpoints: {
          ...checkpointRepository,
          async checkReadWriteReadiness() {
            return { readable: true, writable: false }
          },
        },
      }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
    })

    await expect(createDependencies()).resolves.toBeNull()
  })

  it('uses the injected fetch implementation for both readiness and model requests', async () => {
    const requestedUrls: string[] = []
    const fetchImplementation: typeof fetch = async (url) => {
      requestedUrls.push(url.toString())
      if (url.toString() === 'https://health.example.test/xiaobao') {
        return new Response(null, { status: 204 })
      }
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
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
      skillsDirectory,
      fetchImplementation,
    })
    const assembled = await createDependencies()
    const skill = await assembled?.skills.getByCapability('writing')

    await expect(
      assembled?.model.complete(
        {
          task: createTaskSnapshot({
            taskId: 'task-fetch-injection',
            userId: 'student-1',
            capability: 'writing',
            prompt: '写作任务',
            now: 1,
          }),
          prompt: '写作任务',
          skill: skill!,
          observations: [],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({ kind: 'complete', text: '完成' })
    expect(requestedUrls).toEqual([
      'https://health.example.test/xiaobao',
      'https://models.example.test/v1/chat/completions',
    ])
  })

  it.each(['https://models.example.test/v1?tenant=school', 'https://models.example.test/v1#models'])(
    'rejects an ambiguous model base URL %s',
    (baseUrl) => {
      expect(loadXiaobaoModelConfig({ ...validEnvironment(), XIAOBAO_MODEL_BASE_URL: baseUrl })).toBeNull()
    },
  )

  it.each(['0', '-1', '1.5', 'later'])('rejects invalid timeout %s', (timeoutMs) => {
    expect(loadXiaobaoModelConfig({ ...validEnvironment(), XIAOBAO_MODEL_TIMEOUT_MS: timeoutMs })).toBeNull()
  })

  it.each(['0', '-1', '1.5', 'many'])('rejects invalid context window %s', (contextWindow) => {
    expect(loadXiaobaoModelConfig({ ...validEnvironment(), XIAOBAO_MODEL_CONTEXT_WINDOW: contextWindow })).toBeNull()
  })
})

describe('xiaobao production dependency assembly', () => {
  it('stays unavailable until production safety and usage adapters are explicitly registered', async () => {
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
    })

    await expect(createDependencies()).resolves.toBeNull()
  })

  it('loads only approved project skills as immutable production snapshots', async () => {
    const skills = await loadApprovedProjectSkills(skillsDirectory)

    expect(await skills?.getByCapability('writing')).toMatchObject({
      name: 'student-writing-coach',
      version: '1.0.0',
    })
    expect(await skills?.getByCapability('learning')).toMatchObject({
      name: 'student-learning-master',
      version: '1.0.0',
    })
    expect(await skills?.getByCapability('image')).toBeNull()
    expect(Object.isFrozen((await skills?.getByCapability('writing'))?.qualityGates)).toBe(true)
  })

  it('assembles and reuses dependencies while configuration remains unchanged', async () => {
    const environment = validEnvironment()
    let adapterFactoryCalls = 0
    let checkpointHealthCalls = 0
    let readinessCalls = 0
    let readinessRequest: { url: string; init?: RequestInit } | undefined
    const readinessResponse = new Response('ready')
    const cancelBody = vi.spyOn(readinessResponse.body!, 'cancel')
    const cachedCheckpointRepository: CheckpointRepository = {
      ...checkpointRepository,
      async checkReadWriteReadiness() {
        checkpointHealthCalls += 1
        return { readable: true, writable: true }
      },
    }
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment,
      adaptersFactory: () => {
        adapterFactoryCalls += 1
        return { safety, usage }
      },
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: cachedCheckpointRepository }),
      skillsDirectory,
      fetchImplementation: async (url, init) => {
        readinessCalls += 1
        readinessRequest = { url: url.toString(), init }
        return readinessResponse
      },
    })

    const first = await createDependencies()
    const second = await createDependencies()

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(adapterFactoryCalls).toBe(1)
    expect(checkpointHealthCalls).toBe(1)
    expect(readinessCalls).toBe(1)
    expect(cancelBody).toHaveBeenCalledOnce()
    expect(readinessRequest?.url).toBe('https://health.example.test/xiaobao')
    expect(new Headers(readinessRequest?.init?.headers).has('authorization')).toBe(false)
    expect(first?.checkpoints.constructor.name).toBe('DatabaseCheckpointStore')
  })

  it('deduplicates concurrent singleton initialization', async () => {
    let releaseAdapters: (() => void) | undefined
    let adapterFactoryCalls = 0
    let checkpointHealthCalls = 0
    let readinessCalls = 0
    const adaptersReady = new Promise<void>((resolve) => {
      releaseAdapters = resolve
    })
    const concurrentCheckpointRepository: CheckpointRepository = {
      ...checkpointRepository,
      async checkReadWriteReadiness() {
        checkpointHealthCalls += 1
        return { readable: true, writable: true }
      },
    }
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory: async () => {
        adapterFactoryCalls += 1
        await adaptersReady
        return { safety, usage }
      },
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: concurrentCheckpointRepository }),
      skillsDirectory,
      fetchImplementation: async () => {
        readinessCalls += 1
        return new Response(null, { status: 204 })
      },
    })

    const firstPromise = createDependencies()
    const secondPromise = createDependencies()
    releaseAdapters?.()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).not.toBeNull()
    expect(second).toBe(first)
    expect(adapterFactoryCalls).toBe(1)
    expect(checkpointHealthCalls).toBe(1)
    expect(readinessCalls).toBe(1)
  })

  it('caches failed readiness briefly and cancels the response body', async () => {
    let checkpointHealthCalls = 0
    let readinessCalls = 0
    const unavailableResponse = new Response('temporarily unavailable', { status: 503 })
    const cancelBody = vi.spyOn(unavailableResponse.body!, 'cancel')
    const unhealthyCheckpointRepository: CheckpointRepository = {
      ...checkpointRepository,
      async checkReadWriteReadiness() {
        checkpointHealthCalls += 1
        return { readable: true, writable: true }
      },
    }
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: unhealthyCheckpointRepository }),
      skillsDirectory,
      fetchImplementation: async () => {
        readinessCalls += 1
        return unavailableResponse
      },
      failureTtlMs: 100,
    })

    await expect(createDependencies()).resolves.toBeNull()
    await expect(createDependencies()).resolves.toBeNull()

    expect(checkpointHealthCalls).toBe(1)
    expect(readinessCalls).toBe(1)
    expect(cancelBody).toHaveBeenCalledOnce()
  })

  it('expires readiness results after a bounded TTL', async () => {
    let currentTime = 1_000
    let checkpointHealthCalls = 0
    let readinessCalls = 0
    const expiringCheckpointRepository: CheckpointRepository = {
      ...checkpointRepository,
      async checkReadWriteReadiness() {
        checkpointHealthCalls += 1
        return { readable: true, writable: true }
      },
    }
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: expiringCheckpointRepository }),
      skillsDirectory,
      fetchImplementation: async () => {
        readinessCalls += 1
        return new Response(null, { status: 204 })
      },
      now: () => currentTime,
      successTtlMs: 100,
    })

    const first = await createDependencies()
    currentTime = 1_099
    const cached = await createDependencies()
    currentTime = 1_100
    const refreshed = await createDependencies()

    expect(first).not.toBeNull()
    expect(cached).toBe(first)
    expect(refreshed).not.toBeNull()
    expect(checkpointHealthCalls).toBe(2)
    expect(readinessCalls).toBe(2)
  })

  it.each([
    ['reports read-only', async () => ({ readable: true, writable: false })],
    ['throws while probing', async () => Promise.reject(new Error('database unavailable'))],
  ])('stays unavailable when the checkpoint repository %s', async (_description, checkReadWriteReadiness) => {
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      adaptersFactory,
      getDatabase: () => ({
        xiaobaoRuntimeCheckpoints: { ...checkpointRepository, checkReadWriteReadiness },
      }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
    })

    await expect(createDependencies()).resolves.toBeNull()
  })

  it('rebuilds the singleton when model configuration changes', async () => {
    const environment = validEnvironment()
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment,
      adaptersFactory,
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
    })
    const first = await createDependencies()

    environment.XIAOBAO_MODEL_ID = 'replacement-model'
    delete environment.XIAOBAO_MODEL_NAME
    const second = await createDependencies()

    expect(second).not.toBe(first)
    await expect(second?.model.listModels()).resolves.toEqual([
      { id: 'replacement-model', name: 'replacement-model', contextWindow: 32768 },
    ])
  })

  it('uses a process registration and lets its owner remove it without a test-only reset export', async () => {
    const removeRegistration = configureXiaobaoProductionAdapters(adaptersFactory)
    const createDependencies = createXiaobaoProductionDependenciesFactory({
      environment: validEnvironment(),
      getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
      skillsDirectory,
      fetchImplementation: healthyReadinessFetch,
    })

    try {
      await expect(createDependencies()).resolves.not.toBeNull()
    } finally {
      removeRegistration()
    }

    await expect(createDependencies()).resolves.toBeNull()
  })

  it('loads both approved skills from the production image layout described by Dockerfile', async () => {
    const imageRoot = await mkdtemp(join(tmpdir(), 'xiaobao-production-image-'))
    temporaryDirectories.push(imageRoot)
    const dockerfile = await readFile(join(repositoryRoot, 'Dockerfile'), 'utf8')
    const copyInstruction = /^COPY --from=build \/app\/(\S+) \.\/(\S+)$/gm

    for (const match of dockerfile.matchAll(copyInstruction)) {
      if (!match[2].startsWith('packages/server/skills/')) continue
      const source = join(repositoryRoot, match[1])
      const destination = join(imageRoot, match[2])
      try {
        await cp(source, destination, { recursive: true, force: true })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    const provider = await loadApprovedProjectSkills(join(imageRoot, 'packages/server/skills'))
    expect(provider).not.toBeNull()
    await expect(provider!.getByCapability('writing')).resolves.toMatchObject({ name: 'student-writing-coach' })
    await expect(provider!.getByCapability('learning')).resolves.toMatchObject({ name: 'student-learning-master' })

    const providerWithGame = await loadApprovedProjectSkills(join(imageRoot, 'packages/server/skills'), {
      includeGame: true,
    })
    expect(providerWithGame).not.toBeNull()
    await expect(providerWithGame!.getByCapability('game')).resolves.toMatchObject({
      name: 'scratch-game-coach',
      version: '1.0.0',
    })
  })
})
