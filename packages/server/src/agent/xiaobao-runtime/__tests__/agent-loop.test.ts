import { describe, expect, it } from 'vitest'
import type { XiaobaoRuntimeEvent } from '../domain.js'
import { OrderedEventSink } from '../events.js'
import { XiaobaoAgentLoop } from '../agent-loop.js'
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SafetyCheckRequest,
  SafetyCheckResult,
  SafetyProvider,
  SkillProvider,
  ToolExecutionRequest,
  ToolProvider,
  UsageProvider,
  UsageRecord,
  UsageReservation,
  UsageReservationResult,
  XiaobaoModelInfo,
  XiaobaoRuntimeDependencies,
} from '../ports.js'
import { ModelProviderError } from '../ports.js'
import { SkillEngine } from '../skill-engine.js'
import { createTaskSnapshot, transitionTask } from '../state-machine.js'
import { SafetyProviderUnavailableError } from '../tencent-tms-safety-provider.js'
import {
  DeterministicModelProvider,
  FixedSafetyProvider,
  InMemoryCheckpointStore,
  InMemorySkillProvider,
  UnlimitedUsageProvider,
} from '../testing.js'

const gameSkill = {
  name: 'scratch-game-coach',
  version: '1.0.0',
  instructions: '先完成最小可玩版本，再真实试玩。',
  qualityGates: ['真实启动', '完整试玩'],
}

class ScriptedToolProvider implements ToolProvider {
  readonly name = 'make_game'
  readonly calls: ToolExecutionRequest[] = []

  constructor(private readonly outcomes: Array<Error | { actionId: string; ok: boolean; output: unknown }>) {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async execute(input: ToolExecutionRequest): Promise<{ actionId: string; ok: boolean; output: unknown }> {
    this.calls.push(structuredClone(input))
    const outcome = this.outcomes.shift()
    if (!outcome) throw new Error('Scripted tool outcome exhausted')
    if (outcome instanceof Error) throw outcome
    return structuredClone(outcome)
  }
}

class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted-model'
  readonly calls: ModelRequest[] = []

  constructor(private readonly outcomes: Array<ModelResponse | Error>) {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async listModels(): Promise<XiaobaoModelInfo[]> {
    return [{ id: 'scripted-model', name: 'Scripted Model' }]
  }

  async complete(input: ModelRequest, _signal: AbortSignal): Promise<ModelResponse> {
    this.calls.push(structuredClone(input))
    const outcome = this.outcomes.shift()
    if (!outcome) throw new Error('Scripted model outcome exhausted')
    if (outcome instanceof Error) throw outcome
    return structuredClone(outcome)
  }
}

class DeniedUsageProvider implements UsageProvider {
  readonly reservations: UsageReservation[] = []

  async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    this.reservations.push(structuredClone(input))
    return { allowed: false, reason: '课堂额度不足' }
  }

  async record(_input: UsageRecord): Promise<void> {}
}

class FailOnceUsageProvider extends UnlimitedUsageProvider {
  recordAttempts = 0

  override async record(input: UsageRecord): Promise<void> {
    this.recordAttempts += 1
    if (this.recordAttempts === 1) throw new Error('usage storage unavailable')
    await super.record(input)
  }
}

class CrashAfterFirstReservationProvider extends UnlimitedUsageProvider {
  reserveAttempts = 0

  override async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    const result = await super.reserve(input)
    this.reserveAttempts += 1
    if (this.reserveAttempts === 1) throw new Error('crash after reservation')
    return result
  }
}

class UnavailableSafetyProvider extends FixedSafetyProvider {
  override async check(): Promise<never> {
    throw new SafetyProviderUnavailableError()
  }
}

class FailOnceSafetyProvider extends FixedSafetyProvider {
  attempts = 0

  override async check(input: SafetyCheckRequest, signal: AbortSignal): Promise<SafetyCheckResult> {
    this.attempts += 1
    if (this.attempts === 1) throw new SafetyProviderUnavailableError()
    return super.check(input, signal)
  }
}

class PendingUntilAbortedSafetyProvider implements SafetyProvider {
  private resolveStarted!: () => void
  readonly started = new Promise<void>((resolve) => {
    this.resolveStarted = resolve
  })

  async check(_input: SafetyCheckRequest, signal?: AbortSignal): Promise<SafetyCheckResult> {
    this.resolveStarted()
    if (!signal) throw new Error('Safety signal missing')
    if (signal.aborted) throw signal.reason
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  }
}

function createHarness(options?: {
  responses?: ConstructorParameters<typeof DeterministicModelProvider>[0]
  model?: ScriptedModelProvider
  skills?: SkillProvider
  safety?: SafetyProvider
  usage?: UsageProvider
  tool?: ToolProvider
  maxTurns?: number
}) {
  const model =
    options?.model ?? new DeterministicModelProvider(options?.responses ?? [{ kind: 'complete', text: '作品完成' }])
  const safety = options?.safety ?? new FixedSafetyProvider()
  const usage = options?.usage ?? new UnlimitedUsageProvider()
  const checkpoints = new InMemoryCheckpointStore()
  const tool = options?.tool ?? new ScriptedToolProvider([{ actionId: 'action-1', ok: true, output: { url: '/game' } }])
  const dependencies: XiaobaoRuntimeDependencies = {
    model,
    tools: new Map([[tool.name, tool]]),
    skills: options?.skills ?? new InMemorySkillProvider(new Map([['game', gameSkill]])),
    checkpoints,
    safety,
    usage,
    clock: { now: () => 1000 },
  }
  const events: XiaobaoRuntimeEvent[] = []
  const sink = new OrderedEventSink((event) => events.push(event))
  const loop = new XiaobaoAgentLoop(dependencies, new SkillEngine(dependencies.skills), {
    maxTurns: options?.maxTurns ?? 6,
  })
  return { loop, model, safety, usage, checkpoints, tool, events, sink }
}

const request = {
  taskId: 'task-1',
  userId: 'student-1',
  capability: 'game' as const,
  prompt: '做一个收集星星的小兔子游戏',
}

describe('xiaobao agent loop', () => {
  it('checks safety and budget, executes a tool, checkpoints, and completes', async () => {
    const harness = createHarness({
      responses: [
        {
          kind: 'tool',
          action: { id: 'action-1', toolName: 'make_game', input: { theme: '星空兔子' } },
        },
        { kind: 'complete', text: '作品完成' },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.status).toBe('completed')
    expect(harness.safety.calls).toHaveLength(1)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
    expect(harness.tool.calls).toHaveLength(1)
    expect(saved).toMatchObject({ status: 'completed', turnCount: 2, resultText: '作品完成' })
    expect(saved?.observations).toEqual([
      { actionId: 'action-1', ok: true, output: { url: '/game' }, toolName: 'make_game' },
    ])
    expect(harness.events.map((event) => event.type)).toContain('completed')
  })

  it('records the sum of supplied token usage across text, tool, and completion turns', async () => {
    const harness = createHarness({
      responses: [
        { kind: 'text', text: '先想一想', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
        { kind: 'text', text: '这一轮没有用量' },
        {
          kind: 'tool',
          action: { id: 'action-1', toolName: 'make_game', input: {} },
          usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
        },
        { kind: 'complete', text: '作品完成', usage: { inputTokens: 7, outputTokens: 8, totalTokens: 15 } },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect((harness.usage as UnlimitedUsageProvider).records).toEqual([
      {
        taskId: 'task-1',
        reservationId: 'reservation-1',
        category: 'model',
        units: 30,
      },
    ])
  })

  it('falls back to completed turn count when the model never supplies usage', async () => {
    const harness = createHarness({
      responses: [
        { kind: 'text', text: '先想一想' },
        { kind: 'tool', action: { id: 'action-1', toolName: 'make_game', input: {} } },
        { kind: 'complete', text: '作品完成' },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect((harness.usage as UnlimitedUsageProvider).records).toEqual([
      {
        taskId: 'task-1',
        reservationId: 'reservation-1',
        category: 'model',
        units: 3,
      },
    ])
  })

  it('retries usage recording from quality check before marking the task completed', async () => {
    const usage = new FailOnceUsageProvider()
    let skillCalls = 0
    const skills: SkillProvider = {
      async getByCapability() {
        skillCalls += 1
        return skillCalls === 1 ? gameSkill : null
      },
    }
    const model = new ScriptedModelProvider([
      { kind: 'complete', text: '作品完成', usage: { inputTokens: 8, outputTokens: 5, totalTokens: 13 } },
    ])
    const harness = createHarness({ model, skills, usage })

    await expect(harness.loop.run(request, harness.sink, new AbortController().signal)).rejects.toThrow(
      'usage storage unavailable',
    )
    await expect(harness.checkpoints.load('task-1')).resolves.toMatchObject({
      status: 'quality_check',
      revision: 5,
      resultText: '作品完成',
      usageReservationId: 'reservation-1',
      modelUsageTokens: 13,
      hasExactModelUsage: true,
    })
    expect(model.calls).toHaveLength(1)
    expect(skillCalls).toBe(1)
    expect(usage.records).toHaveLength(0)

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.snapshot).toMatchObject({ status: 'completed', revision: 6, resultText: '作品完成' })
    expect(model.calls).toHaveLength(1)
    expect(skillCalls).toBe(1)
    expect(usage.recordAttempts).toBe(2)
    expect(usage.records).toEqual([
      {
        taskId: 'task-1',
        reservationId: 'reservation-1',
        category: 'model',
        units: 13,
      },
    ])
    expect(harness.events.filter((event) => event.type === 'completed')).toHaveLength(1)
  })

  it('stops before model access when child safety denies the request', async () => {
    const safety = new FixedSafetyProvider({ allowed: false, reason: '内容不适龄' })
    const harness = createHarness({ safety })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('failed_terminal')
    expect(harness.model.calls).toHaveLength(0)
    expect(harness.events.at(-1)).toMatchObject({ type: 'failed', message: '内容不适龄' })
  })

  it('stores a recoverable failure without model or usage calls when safety is unavailable', async () => {
    const harness = createHarness({ safety: new UnavailableSafetyProvider() })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.snapshot).toMatchObject({ status: 'failed_recoverable', revision: 2, turnCount: 0 })
    expect(saved).toEqual(result.snapshot)
    expect(harness.events.at(-1)).toEqual({
      type: 'failed',
      taskId: 'task-1',
      sequence: 2,
      timestamp: 1000,
      message: '安全检查暂时不可用，请稍后再试',
      recoverable: true,
    })
    expect(harness.model.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
  })

  it('rechecks safety before model and usage calls when an unavailable check is retried', async () => {
    const safety = new FailOnceSafetyProvider()
    const harness = createHarness({ safety })

    const first = await harness.loop.run(request, harness.sink, new AbortController().signal)
    expect(first.status).toBe('failed_recoverable')
    expect(harness.model.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(0)

    const resumed = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(resumed.status).toBe('completed')
    expect(safety.attempts).toBe(2)
    expect(harness.model.calls).toHaveLength(1)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
  })

  it('passes cancellation to an in-flight safety check without model or usage calls', async () => {
    const safety = new PendingUntilAbortedSafetyProvider()
    const harness = createHarness({ safety })
    const controller = new AbortController()
    const reason = new DOMException('task cancelled during safety', 'AbortError')

    const run = harness.loop.run(request, harness.sink, controller.signal)
    await safety.started
    controller.abort(reason)

    await expect(run).rejects.toBe(reason)
    expect(harness.model.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
  })

  it('pauses before model access when usage cannot be reserved', async () => {
    const harness = createHarness({ usage: new DeniedUsageProvider() })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('paused_budget')
    expect(harness.model.calls).toHaveLength(0)
    expect(harness.events.at(-1)).toMatchObject({ type: 'failed', message: '课堂额度不足', recoverable: true })
  })

  it('resumes a planned checkpoint with the same idempotent reservation after a crash', async () => {
    const usage = new CrashAfterFirstReservationProvider()
    const harness = createHarness({ usage })

    await expect(harness.loop.run(request, harness.sink, new AbortController().signal)).rejects.toThrow(
      'crash after reservation',
    )
    await expect(harness.checkpoints.load('task-1')).resolves.toMatchObject({
      status: 'planned',
      revision: 3,
      usageReservationId: null,
    })
    expect(usage.reservations).toHaveLength(1)

    const resumed = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(resumed.snapshot).toMatchObject({
      status: 'completed',
      usageReservationId: 'reservation-1',
    })
    expect(usage.reserveAttempts).toBe(2)
    expect(usage.reservations).toHaveLength(1)
    expect(usage.records).toHaveLength(1)
  })

  it('cancels without calling providers when already aborted', async () => {
    const harness = createHarness()
    const controller = new AbortController()
    controller.abort()

    const result = await harness.loop.run(request, harness.sink, controller.signal)

    expect(result.status).toBe('cancelled')
    expect(harness.safety.calls).toHaveLength(0)
    expect(harness.model.calls).toHaveLength(0)
  })

  it('retries a thrown tool failure once and preserves one observation', async () => {
    const tool = new ScriptedToolProvider([
      new Error('temporary tool failure'),
      { actionId: 'action-1', ok: true, output: 'ok' },
    ])
    const harness = createHarness({
      tool,
      responses: [
        { kind: 'tool', action: { id: 'action-1', toolName: 'make_game', input: {} } },
        { kind: 'complete', text: '已恢复' },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(tool.calls).toHaveLength(2)
    expect(result.snapshot.observations).toHaveLength(1)
  })

  it('does not checkpoint a tool turn or usage when tool execution never produces an observation', async () => {
    const tool = new ScriptedToolProvider([new Error('temporary tool failure'), new Error('permanent tool failure')])
    const harness = createHarness({
      tool,
      responses: [
        {
          kind: 'tool',
          action: { id: 'action-1', toolName: 'make_game', input: {} },
          usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
        },
      ],
    })

    await expect(harness.loop.run(request, harness.sink, new AbortController().signal)).rejects.toThrow(
      'permanent tool failure',
    )

    await expect(harness.checkpoints.load('task-1')).resolves.toMatchObject({
      status: 'running',
      revision: 4,
      turnCount: 0,
      modelUsageTokens: 0,
      hasExactModelUsage: false,
      observations: [],
    })
    expect(tool.calls).toHaveLength(2)
  })

  it('fails recoverably when the maximum model turns are exhausted', async () => {
    const harness = createHarness({
      maxTurns: 2,
      responses: [
        { kind: 'text', text: '第一步' },
        { kind: 'text', text: '第二步' },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('failed_recoverable')
    expect(result.snapshot.turnCount).toBe(2)
    expect(harness.events.at(-1)).toMatchObject({ type: 'failed', recoverable: true })
  })

  it.each([
    { code: 'rate_limit' as const, message: '小宝正在稍作休息，请稍后再试。' },
    { code: 'timeout' as const, message: '等待模型回复超时，请稍后再试。' },
    { code: 'unavailable' as const, message: '模型服务暂时不可用，请稍后再试。' },
  ])('checkpoints $code model failures as recoverable without side effects', async ({ code, message }) => {
    const error = new ModelProviderError(code)
    error.message = 'Authorization: Bearer provider-key raw provider body'
    const model = new ScriptedModelProvider([error])
    const tool = new ScriptedToolProvider([{ actionId: 'action-1', ok: true, output: 'should-not-run' }])
    const harness = createHarness({ model, tool })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.snapshot).toMatchObject({ status: 'failed_recoverable', revision: 5, turnCount: 0 })
    expect(saved).toEqual(result.snapshot)
    expect(harness.events.at(-1)).toEqual({
      type: 'failed',
      taskId: 'task-1',
      sequence: 2,
      timestamp: 1000,
      message,
      recoverable: true,
    })
    expect(tool.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
  })

  it('persists the reservation and exact usage before a later recoverable model failure', async () => {
    const model = new ScriptedModelProvider([
      { kind: 'text', text: '先完成第一步', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } },
      new ModelProviderError('timeout'),
      { kind: 'complete', text: '恢复后完成', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } },
    ])
    const harness = createHarness({ model })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.snapshot).toMatchObject({
      status: 'failed_recoverable',
      turnCount: 1,
      usageReservationId: 'reservation-1',
      modelUsageTokens: 5,
      hasExactModelUsage: true,
    })
    expect(saved).toEqual(result.snapshot)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)

    const resumed = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(resumed.snapshot).toMatchObject({
      status: 'completed',
      revision: 10,
      turnCount: 2,
      usageReservationId: 'reservation-1',
      modelUsageTokens: 12,
      hasExactModelUsage: true,
      resultText: '恢复后完成',
    })
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
    expect((harness.usage as UnlimitedUsageProvider).records).toEqual([
      {
        taskId: 'task-1',
        reservationId: 'reservation-1',
        category: 'model',
        units: 12,
      },
    ])
  })

  it.each([
    {
      code: 'authentication' as const,
      message: '小宝暂时无法连接模型服务，请联系老师或管理员检查设置。',
    },
    { code: 'invalid_response' as const, message: '模型回复格式有问题，请稍后再试。' },
  ])('checkpoints $code model failures as terminal without leaking provider details', async ({ code, message }) => {
    const error = Object.assign(new ModelProviderError(code), {
      message: 'Authorization: Bearer provider-key raw provider body',
      cause: new Error('raw provider body'),
      rawBody: 'raw provider body',
      apiKey: 'provider-key',
    })
    const model = new ScriptedModelProvider([error])
    const tool = new ScriptedToolProvider([{ actionId: 'action-1', ok: true, output: 'should-not-run' }])
    const harness = createHarness({ model, tool })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.snapshot).toMatchObject({ status: 'failed_terminal', revision: 5, turnCount: 0 })
    expect(saved).toEqual(result.snapshot)
    expect(harness.events.at(-1)).toEqual({
      type: 'failed',
      taskId: 'task-1',
      sequence: 2,
      timestamp: 1000,
      message,
      recoverable: false,
    })
    expect(JSON.stringify(harness.events)).not.toContain('raw provider body')
    expect(JSON.stringify(harness.events)).not.toContain('provider-key')
    expect(tool.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
  })

  it('leaves non-provider model errors for the runtime boundary', async () => {
    const error = new Error('unexpected runtime failure')
    const model = new ScriptedModelProvider([error])
    const tool = new ScriptedToolProvider([{ actionId: 'action-1', ok: true, output: 'should-not-run' }])
    const harness = createHarness({ model, tool })

    await expect(harness.loop.run(request, harness.sink, new AbortController().signal)).rejects.toBe(error)

    await expect(harness.checkpoints.load('task-1')).resolves.toMatchObject({
      status: 'running',
      revision: 4,
      turnCount: 0,
      usageReservationId: 'reservation-1',
    })
    expect(harness.events.map((event) => event.type)).toEqual(['phase'])
    expect(tool.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
  })

  it('reserves usage before resuming a legacy running checkpoint without a reservation', async () => {
    const usage = new UnlimitedUsageProvider()
    await usage.reserve({ taskId: 'task-1', userId: 'student-1', category: 'model', units: 6 })
    const harness = createHarness({ usage, responses: [{ kind: 'complete', text: '继续完成' }] })
    let snapshot = createTaskSnapshot({ ...request, now: 100 })
    snapshot = transitionTask(snapshot, 'safety_check', 110)
    snapshot = transitionTask(snapshot, 'requirements', 120)
    snapshot = transitionTask(snapshot, 'planned', 130)
    snapshot = transitionTask(snapshot, 'running', 140)
    await harness.checkpoints.save(snapshot)

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(harness.safety.calls).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
    expect((harness.usage as UnlimitedUsageProvider).records).toEqual([
      {
        taskId: 'task-1',
        reservationId: 'reservation-1',
        category: 'model',
        units: 1,
      },
    ])
    expect(result.snapshot).toMatchObject({
      revision: 7,
      turnCount: 1,
      usageReservationId: 'reservation-1',
    })
  })

  it('pauses a legacy running checkpoint when a replacement reservation is denied', async () => {
    const usage = new DeniedUsageProvider()
    const harness = createHarness({ usage })
    let snapshot = createTaskSnapshot({ ...request, now: 100 })
    snapshot = transitionTask(snapshot, 'safety_check', 110)
    snapshot = transitionTask(snapshot, 'requirements', 120)
    snapshot = transitionTask(snapshot, 'planned', 130)
    snapshot = transitionTask(snapshot, 'running', 140)
    await harness.checkpoints.save(snapshot)

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)

    expect(result.snapshot).toMatchObject({
      status: 'paused_budget',
      revision: 5,
      usageReservationId: null,
    })
    expect(usage.reservations).toHaveLength(1)
    expect(harness.model.calls).toHaveLength(0)
    expect(harness.events.at(-1)).toMatchObject({ type: 'failed', message: '课堂额度不足', recoverable: true })
  })

  it('pauses for a student question without settling usage and persists the waiting checkpoint', async () => {
    const harness = createHarness({
      responses: [
        {
          kind: 'ask',
          toolCallId: 'ask-1',
          header: '写作主题',
          questions: ['你想写什么故事？', '给谁看？'],
        },
      ],
    })

    const result = await harness.loop.run(request, harness.sink, new AbortController().signal)
    const saved = await harness.checkpoints.load('task-1')

    expect(result.status).toBe('waiting_for_student')
    expect(saved).toMatchObject({
      status: 'waiting_for_student',
      currentStepId: 'ask-1',
    })
    const waitingEvent = harness.events.find((event) => event.type === 'waiting_for_student')
    expect(waitingEvent).toBeDefined()
    const structured = waitingEvent as {
      toolCallId?: string
      header?: string
      questions?: readonly string[]
    }
    expect(structured.toolCallId).toBe('ask-1')
    expect(structured.header).toBe('写作主题')
    expect(structured.questions).toEqual(['你想写什么故事？', '给谁看？'])
    // A question pause must not settle model usage.
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
  })

  it('resumes from a waiting checkpoint with student answers and completes', async () => {
    const harness = createHarness({
      responses: [
        {
          kind: 'ask',
          toolCallId: 'ask-1',
          header: '写作主题',
          questions: ['你想写什么故事？', '给谁看？'],
        },
        { kind: 'complete', text: '作品完成', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
      ],
    })

    const first = await harness.loop.run(request, harness.sink, new AbortController().signal)
    expect(first.status).toBe('waiting_for_student')

    const resumed = await harness.loop.run(
      { ...request, studentAnswers: { 'turn-any': { toolCallId: 'ask-1', answers: { 写作主题: '太空冒险' } } } },
      harness.sink,
      new AbortController().signal,
    )

    expect(resumed.status).toBe('completed')
    const saved = await harness.checkpoints.load('task-1')
    expect(saved).toMatchObject({ status: 'completed', currentStepId: null })
    // The student answer observation was injected for the model's next turn.
    const answerObservation = saved?.observations.find(
      (observation) =>
        observation.toolName === 'xiaobao_ask' &&
        observation.output !== null &&
        typeof observation.output === 'object' &&
        Object.hasOwn(observation.output as Record<string, unknown>, '写作主题'),
    )
    expect(answerObservation).toMatchObject({ actionId: 'ask-1', ok: true })
    expect(answerObservation?.output).toEqual({ 写作主题: '太空冒险' })
    // Model usage is settled exactly once for the final completion turn.
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(1)
    expect((harness.usage as UnlimitedUsageProvider).reservations).toHaveLength(1)
  })

  it('stays waiting when a resume request has no matching student answer', async () => {
    const harness = createHarness({
      responses: [
        {
          kind: 'ask',
          toolCallId: 'ask-1',
          header: '写作主题',
          questions: ['你想写什么故事？'],
        },
        { kind: 'complete', text: '不应触发', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ],
    })

    const first = await harness.loop.run(request, harness.sink, new AbortController().signal)
    expect(first.status).toBe('waiting_for_student')

    const resumed = await harness.loop.run(
      { ...request, studentAnswers: { 'turn-any': { toolCallId: 'other-ask', answers: { 写作主题: 'x' } } } },
      harness.sink,
      new AbortController().signal,
    )

    expect(resumed.status).toBe('waiting_for_student')
    // No completion turn happened, so nothing was settled.
    expect((harness.usage as UnlimitedUsageProvider).records).toHaveLength(0)
    expect(harness.model.calls).toHaveLength(1)
  })
})
