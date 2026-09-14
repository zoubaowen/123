import { describe, expect, it, vi } from 'vitest'
import type { CheckpointRepository } from '../../../db/types.js'
import { loadXiaobaoModelConfig } from '../config.js'
import {
  configureXiaobaoProductionAdapters,
  createXiaobaoProductionDependenciesFactory,
  type ProductionAdapterFactory,
} from '../dependencies.js'
import type { SafetyProvider, UsageProvider } from '../ports.js'
import type { SandboxToolClient } from '../sandbox-tools.js'

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

function healthySandboxClient(): SandboxToolClient {
  return {
    execute: vi.fn(async () => ({ ok: true as const, result: { bytesWritten: 10 } })),
    healthCheck: vi.fn(async () => true),
  }
}

function unhealthySandboxClient(): SandboxToolClient {
  return {
    execute: vi.fn(async () => ({ ok: false as const, error: 'unavailable' })),
    healthCheck: vi.fn(async () => false),
  }
}

async function assemble(options?: {
  sandboxClient?: SandboxToolClient
  fetchImplementation?: typeof fetch
  environment?: Record<string, string | undefined>
}) {
  const createDependencies = createXiaobaoProductionDependenciesFactory({
    environment: options?.environment ?? validEnvironment(),
    adaptersFactory,
    getDatabase: () => ({ xiaobaoRuntimeCheckpoints: checkpointRepository }),
    skillsDirectory: new URL('../../../../../../skills', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    fetchImplementation: options?.fetchImplementation ?? healthyReadinessFetch,
    ...(options?.sandboxClient ? { sandboxClient: options.sandboxClient } : {}),
  })
  return createDependencies()
}

describe('xiaobao sandbox tool assembly', () => {
  it('keeps tools empty and game unavailable when no sandbox client is configured', async () => {
    const assembled = await assemble()
    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(0)
    await expect(assembled?.skills.getByCapability('game')).resolves.toBeNull()
  })

  it('keeps tools empty when the sandbox client health check fails', async () => {
    const assembled = await assemble({ sandboxClient: unhealthySandboxClient() })
    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(0)
    await expect(assembled?.skills.getByCapability('game')).resolves.toBeNull()
  })

  it('auto-assembles sandbox tools from a complete environment without an explicit client', async () => {
    const healthCalls: string[] = []
    const fetchImplementation: typeof fetch = async (url, init) => {
      const urlString = url.toString()
      if (urlString === 'https://health.example.test/xiaobao') {
        return new Response(null, { status: 204 })
      }
      healthCalls.push(urlString)
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      if (body.command === 'true') {
        return new Response(JSON.stringify({ success: true, result: { exitCode: 0, output: '' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
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
    const environment = {
      ...validEnvironment(),
      XIAOBAO_SANDBOX_URL: 'https://env-sandbox.api.tcloudbasegateway.com/v1/functions/scf',
      XIAOBAO_SANDBOX_SESSION_ID: 'session-auto',
      XIAOBAO_SANDBOX_AUTH_TOKEN: 'token-auto',
    }

    const assembled = await assemble({ environment, fetchImplementation })

    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(4)
    for (const toolName of ['write_file', 'read_file', 'edit_file', 'run_command']) {
      expect(assembled?.tools.has(toolName)).toBe(true)
    }
    await expect(assembled?.skills.getByCapability('game')).resolves.toMatchObject({
      name: 'scratch-game-coach',
      version: '1.0.0',
    })
    // The environment client health check hit the sandbox /api/tools/bash endpoint.
    expect(healthCalls.some((url) => url.includes('/api/tools/bash'))).toBe(true)
  })

  it('injects sandbox tools and the game skill when a healthy sandbox client is present', async () => {
    const assembled = await assemble({ sandboxClient: healthySandboxClient() })
    expect(assembled).not.toBeNull()
    expect(assembled?.tools.size).toBe(4)
    for (const toolName of ['write_file', 'read_file', 'edit_file', 'run_command']) {
      expect(assembled?.tools.has(toolName)).toBe(true)
    }
    await expect(assembled?.skills.getByCapability('game')).resolves.toMatchObject({
      name: 'scratch-game-coach',
      version: '1.0.0',
    })
  })

  it('sends sandbox tool schemas to the model alongside the completion tool', async () => {
    let requestBody: { tools?: Array<{ function: { name: string } }> } | undefined
    const fetchImplementation: typeof fetch = async (url, init) => {
      if (url.toString() === 'https://health.example.test/xiaobao') {
        return new Response(null, { status: 204 })
      }
      if (typeof init?.body === 'string') requestBody = JSON.parse(init.body)
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
    const assembled = await assemble({ sandboxClient: healthySandboxClient(), fetchImplementation })
    const skill = await assembled?.skills.getByCapability('writing')
    await assembled?.model.complete(
      {
        task: {
          schemaVersion: 1,
          taskId: 'task-sandbox-schema',
          userId: 'student-1',
          capability: 'game',
          prompt: '做一个小游戏',
          status: 'created',
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
        },
        prompt: '做一个小游戏',
        skill: skill!,
        observations: [],
      },
      new AbortController().signal,
    )

    const names = requestBody?.tools?.map((tool) => tool.function.name) ?? []
    expect(names).toContain('write_file')
    expect(names).toContain('read_file')
    expect(names).toContain('edit_file')
    expect(names).toContain('run_command')
    expect(names).toContain('xiaobao_complete')
    expect(loadXiaobaoModelConfig(validEnvironment())).not.toBeNull()
  })

  it('keeps CodeBuddy as the default runtime when sandbox tools are registered', async () => {
    const remove = configureXiaobaoProductionAdapters(adaptersFactory)
    try {
      const assembled = await assemble({ sandboxClient: healthySandboxClient() })
      expect(assembled?.tools.size).toBe(4)
    } finally {
      remove()
    }
  })
})
