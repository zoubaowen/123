import type { AgentCallbackMessage, AgentOptions } from '@ai-xiaobao/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAgentRun, removeAgent } from '../../agent-registry.js'
import { agentRuntimeRegistry } from '../../runtime/registry.js'
import type { XiaobaoRuntimeDependencies } from '../ports.js'
import { parseXiaobaoCapabilitySelection, XiaobaoRuntime, resolveProductionXiaobaoCapability } from '../runtime.js'
import {
  DeterministicModelProvider,
  FixedSafetyProvider,
  InMemoryCheckpointStore,
  InMemorySkillProvider,
  UnlimitedUsageProvider,
} from '../testing.js'

function dependencies(): XiaobaoRuntimeDependencies {
  return {
    model: new DeterministicModelProvider([{ kind: 'complete', text: '作品完成' }]),
    tools: new Map(),
    skills: new InMemorySkillProvider(
      new Map([
        [
          'game',
          {
            name: 'scratch-game-coach',
            version: '1.0.0',
            instructions: '完成可玩的小游戏。',
            qualityGates: ['真实试玩'],
          },
        ],
      ]),
    ),
    checkpoints: new InMemoryCheckpointStore(),
    safety: new FixedSafetyProvider(),
    usage: new UnlimitedUsageProvider(),
    clock: { now: () => 1000 },
  }
}

function agentOptions(): AgentOptions {
  return { conversationId: 'task-1', userId: 'student-1', maxTurns: 4 }
}

const registryTaskIds = ['task-1', 'xiaobao-delayed-task', 'xiaobao-cancel-task', 'xiaobao-cancel-retry-task']

afterEach(() => {
  for (const taskId of registryTaskIds) removeAgent(taskId)
})

describe('xiaobao runtime adapter', () => {
  it('is explicitly registered without becoming the default runtime', () => {
    expect(agentRuntimeRegistry.get('xiaobao')?.name).toBe('xiaobao')
    expect(agentRuntimeRegistry.resolve({ explicitRuntime: 'xiaobao' }).name).toBe('xiaobao')
    expect(agentRuntimeRegistry.resolve().name).not.toBe('xiaobao')
  })

  it('returns a stable turn id and emits a terminal result through the existing callback', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => dependencies(),
      capabilityResolver: async () => 'game',
      idFactory: () => 'turn-1',
    })
    const messages: AgentCallbackMessage[] = []
    let finish: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })

    const result = await runtime.chatStream(
      '做一个星星游戏',
      (message) => {
        messages.push(message)
        if (message.type === 'result' || message.type === 'error') finish?.()
      },
      agentOptions(),
    )
    await completed

    expect(result).toEqual({ turnId: 'turn-1', alreadyRunning: false })
    expect(messages.at(-1)).toEqual({ type: 'result', content: '作品完成' })
  })

  it('reports unavailable when no production providers are configured', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => null,
      capabilityResolver: async () => 'game',
      idFactory: () => 'turn-1',
    })

    await expect(runtime.isAvailable()).resolves.toBe(false)
    await expect(runtime.getSupportedModels()).resolves.toEqual([])
  })

  it('uses only an explicit approved capability and never guesses from prompt keywords', async () => {
    await expect(
      resolveProductionXiaobaoCapability('请帮我生成一张图片', {
        ...agentOptions(),
        xiaobaoCapability: 'writing',
      }),
    ).resolves.toBe('writing')
    await expect(resolveProductionXiaobaoCapability('请帮我写一篇文章', agentOptions())).rejects.toThrow(
      'Xiaobao capability must be selected',
    )
  })

  it.each([
    [undefined, undefined],
    ['writing', 'writing'],
    ['image', 'image'],
    ['not-a-capability', undefined],
  ])('validates the capability value passed by authenticated request handlers', (input, expected) => {
    expect(parseXiaobaoCapabilitySelection(input)).toBe(expected)
  })

  it('rejects unsupported production capabilities before creating dependencies', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => {
        throw new Error('dependencies must not be created')
      },
      capabilityResolver: resolveProductionXiaobaoCapability,
      idFactory: () => 'turn-unsupported',
    })
    let finish: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })
    const messages: AgentCallbackMessage[] = []

    const result = await runtime.chatStream(
      '生成一张图片',
      (message) => {
        messages.push(message)
        finish?.()
      },
      {
        ...agentOptions(),
        xiaobaoCapability: 'image',
      },
    )
    await completed

    expect(result).toEqual({ turnId: 'turn-unsupported', alreadyRunning: false })
    expect(messages).toEqual([
      { type: 'error', content: '小宝目前只支持写作和学习，其他创作工具尚未接入', is_error: true },
    ])
  })

  it('emits a static sandbox hint when game is selected but no game skill is assembled', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => ({
        ...dependencies(),
        // A production dependency build without a healthy sandbox never loads the game skill.
        skills: new InMemorySkillProvider(new Map()),
      }),
      capabilityResolver: resolveProductionXiaobaoCapability,
      idFactory: () => 'turn-game-unavailable',
    })
    const messages: AgentCallbackMessage[] = []
    let finish: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })

    const result = await runtime.chatStream(
      '做一个星星游戏',
      (message) => {
        messages.push(message)
        finish?.()
      },
      {
        ...agentOptions(),
        xiaobaoCapability: 'game',
      },
    )
    await completed

    expect(result).toEqual({ turnId: 'turn-game-unavailable', alreadyRunning: false })
    expect(messages).toEqual([
      { type: 'error', content: '游戏创作需要连接创作沙箱，当前暂未开放，请联系老师', is_error: true },
    ])
  })

  it('rejects a missing production capability before creating dependencies', async () => {
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => {
        throw new Error('dependencies must not be created')
      },
      capabilityResolver: resolveProductionXiaobaoCapability,
      idFactory: () => 'turn-missing-capability',
    })
    const messages: AgentCallbackMessage[] = []
    let finish: (() => void) | undefined
    const completed = new Promise<void>((resolve) => {
      finish = resolve
    })

    const result = await runtime.chatStream(
      '帮我学习',
      (message) => {
        messages.push(message)
        finish?.()
      },
      agentOptions(),
    )
    await completed

    expect(result).toEqual({ turnId: 'turn-missing-capability', alreadyRunning: false })
    expect(messages).toEqual([{ type: 'error', content: '请选择小宝的写作或学习能力后再开始', is_error: true }])
  })

  it('claims the task before awaiting capability resolution so concurrent starts share one run', async () => {
    let releaseCapability: (() => void) | undefined
    const capabilityReady = new Promise<void>((resolve) => {
      releaseCapability = resolve
    })
    let resolverCalls = 0
    let nextTurn = 0
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => null,
      capabilityResolver: async () => {
        resolverCalls += 1
        await capabilityReady
        return 'writing'
      },
      idFactory: () => `turn-${++nextTurn}`,
    })

    const firstPromise = runtime.chatStream('写作任务', null, agentOptions())
    const secondPromise = runtime.chatStream('重复请求', null, agentOptions())
    releaseCapability?.()
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toEqual({ turnId: 'turn-1', alreadyRunning: false })
    expect(second).toEqual({ turnId: 'turn-1', alreadyRunning: true })
    expect(resolverCalls).toBe(1)
  })

  it('keeps a delayed run registered until its terminal callback has been delivered', async () => {
    let releaseModel: (() => void) | undefined
    const modelReady = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    const delayedDependencies = dependencies()
    delayedDependencies.model = {
      name: 'delayed-model',
      async healthCheck() {
        return true
      },
      async listModels() {
        return []
      },
      async complete() {
        await modelReady
        return { kind: 'complete' as const, text: '延迟完成' }
      },
    }
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => delayedDependencies,
      capabilityResolver: async () => 'game',
      idFactory: () => 'xiaobao-delayed-turn',
    })
    const terminal = new Promise<void>((resolve) => {
      void runtime.chatStream(
        '开始延迟任务',
        (message) => {
          if (message.type === 'result') resolve()
        },
        {
          ...agentOptions(),
          conversationId: 'xiaobao-delayed-task',
        },
      )
    })

    await vi.waitFor(() => {
      expect(getAgentRun('xiaobao-delayed-task')).toMatchObject({
        turnId: 'xiaobao-delayed-turn',
        userId: 'student-1',
        status: 'running',
      })
    })
    releaseModel?.()
    await terminal
    await vi.waitFor(() => expect(getAgentRun('xiaobao-delayed-task')?.status).toBe('completed'))
  })

  it('uses the registered AbortController to cancel the model request and lifecycle', async () => {
    let modelSignal: AbortSignal | undefined
    let markModelStarted: (() => void) | undefined
    const modelStarted = new Promise<void>((resolve) => {
      markModelStarted = resolve
    })
    const cancellableDependencies = dependencies()
    cancellableDependencies.model = {
      name: 'cancellable-model',
      async healthCheck() {
        return true
      },
      async listModels() {
        return []
      },
      async complete(_input, signal) {
        modelSignal = signal
        markModelStarted?.()
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
    }
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => cancellableDependencies,
      capabilityResolver: async () => 'game',
      idFactory: () => 'xiaobao-cancel-turn',
    })
    const messages: AgentCallbackMessage[] = []

    await runtime.chatStream(
      '开始可取消任务',
      (message) => {
        messages.push(message)
      },
      { ...agentOptions(), conversationId: 'xiaobao-cancel-task' },
    )
    await modelStarted
    const run = getAgentRun('xiaobao-cancel-task')
    expect(modelSignal).toBe(run?.abortController.signal)

    run?.abortController.abort()

    await vi.waitFor(() => expect(getAgentRun('xiaobao-cancel-task')?.status).toBe('cancelled'))
    expect(messages.at(-1)).toEqual({ type: 'error', content: '任务已取消', is_error: true })
  })

  it('waits for a cancelled run to finish cleanup before starting the retry turn', async () => {
    let releaseCancelledModel: (() => void) | undefined
    let markCancelledModelStarted: (() => void) | undefined
    const cancelledModelStarted = new Promise<void>((resolve) => {
      markCancelledModelStarted = resolve
    })
    const cancelledModelCleanup = new Promise<void>((resolve) => {
      releaseCancelledModel = resolve
    })
    const firstDependencies = dependencies()
    firstDependencies.model = {
      name: 'slow-cancel-model',
      async healthCheck() {
        return true
      },
      async listModels() {
        return []
      },
      async complete(_input, signal) {
        markCancelledModelStarted?.()
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
        await cancelledModelCleanup
        throw new Error('cancelled model stopped')
      },
    }
    const retryDependencies = dependencies()
    const secondModel = new DeterministicModelProvider([{ kind: 'complete', text: '重试成功' }])
    retryDependencies.model = secondModel
    let dependencyCall = 0
    let nextTurn = 0
    const runtime = new XiaobaoRuntime({
      dependenciesFactory: async () => (dependencyCall++ === 0 ? firstDependencies : retryDependencies),
      capabilityResolver: async () => 'game',
      idFactory: () => `xiaobao-cancel-retry-turn-${++nextTurn}`,
    })
    const options = { ...agentOptions(), conversationId: 'xiaobao-cancel-retry-task' }

    await runtime.chatStream('第一轮', null, options)
    await cancelledModelStarted
    const firstRun = getAgentRun('xiaobao-cancel-retry-task')
    firstRun?.abortController.abort()
    if (firstRun) firstRun.status = 'cancelled'

    let retrySettled = false
    const retry = runtime.chatStream('取消后立即重试', null, options).then((result) => {
      retrySettled = true
      return result
    })
    await Promise.resolve()
    await Promise.resolve()

    const settledBeforeCleanup = retrySettled
    expect(secondModel.calls).toHaveLength(0)

    releaseCancelledModel?.()
    expect(settledBeforeCleanup).toBe(false)
    await expect(retry).resolves.toEqual({ turnId: 'xiaobao-cancel-retry-turn-2', alreadyRunning: false })
    await vi.waitFor(() => expect(secondModel.calls).toHaveLength(1))
  })

  it.each([
    ['coding mode', { mode: 'coding' as const }],
    ['image input', { imageBlocks: [{ type: 'image' as const, data: 'image-data', mimeType: 'image/png' }] }],
  ])('rejects %s even when an approved capability is selected', async (_description, restrictedInput) => {
    await expect(
      resolveProductionXiaobaoCapability('请开始', {
        ...agentOptions(),
        xiaobaoCapability: 'writing',
        ...restrictedInput,
      }),
    ).rejects.toThrow('Xiaobao input is not supported')
  })
})
