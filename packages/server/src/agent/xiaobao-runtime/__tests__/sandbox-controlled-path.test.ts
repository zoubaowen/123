import { describe, expect, it, vi } from 'vitest'
import { XiaobaoAgentLoop } from '../agent-loop.js'
import type { XiaobaoCapability, XiaobaoRuntimeEvent } from '../domain.js'
import { OrderedEventSink } from '../events.js'
import { ModelProviderError } from '../ports.js'
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SkillProvider,
  SkillSnapshot,
  ToolProvider,
  XiaobaoModelInfo,
  XiaobaoRuntimeDependencies,
} from '../ports.js'
import { SkillEngine } from '../skill-engine.js'
import { SandboxToolsProvider, type SandboxToolClient } from '../sandbox-tools.js'
import { InMemoryCheckpointStore, InMemorySkillProvider } from '../testing.js'

const gameSkill: SkillSnapshot = {
  name: 'scratch-game-coach',
  version: '1.0.0',
  instructions: '先完成最小可玩版本并实际试玩。',
  qualityGates: ['真实项目文件与可启动入口', '实际运行验证核心玩法', '交付可玩的预览或项目'],
}

class RecordingClient implements SandboxToolClient {
  readonly calls: Array<{ tool: string; input: unknown }> = []

  constructor(private readonly outcomes: Array<{ ok: true; result: unknown } | { ok: false; error: string }> = []) {}

  async execute(tool: string, input: unknown, _timeoutMs: number) {
    this.calls.push({ tool, input })
    const outcome = this.outcomes.shift() ?? { ok: true as const, result: { bytesWritten: 1 } }
    return outcome
  }

  async healthCheck() {
    return true
  }
}

/** 顺序消费脚本化模型响应；Error 原样抛出用于触发可恢复中断。 */
class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted-model'
  readonly calls: ModelRequest[] = []

  constructor(private readonly outcomes: Array<ModelResponse | Error>) {}

  async healthCheck() {
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

function buildDependencies(options: { client: RecordingClient; model: ModelProvider }): {
  dependencies: XiaobaoRuntimeDependencies
  loop: XiaobaoAgentLoop
  checkpoints: InMemoryCheckpointStore
  events: XiaobaoRuntimeEvent[]
  sink: OrderedEventSink
  usage: { reserve: ReturnType<typeof vi.fn>; record: ReturnType<typeof vi.fn> }
} {
  const sandbox = new SandboxToolsProvider(options.client)
  const tools = new Map<string, ToolProvider>()
  for (const name of ['write_file', 'read_file', 'edit_file', 'run_command']) tools.set(name, sandbox)

  const skills: SkillProvider = new InMemorySkillProvider(new Map([['game', gameSkill]]))
  const checkpoints = new InMemoryCheckpointStore()
  const usage = {
    reserve: vi.fn(async (input: { taskId: string }) => ({
      allowed: true as const,
      reservationId: `${input.taskId}-r`,
    })),
    record: vi.fn(async () => {}),
  }
  const dependencies: XiaobaoRuntimeDependencies = {
    model: options.model,
    tools,
    skills,
    checkpoints,
    safety: { check: async () => ({ allowed: true }) },
    usage,
    clock: { now: () => 100 },
  }
  const events: XiaobaoRuntimeEvent[] = []
  const sink = new OrderedEventSink((event) => events.push(event))
  const loop = new XiaobaoAgentLoop(dependencies, new SkillEngine(skills), { maxTurns: 6 })
  return { dependencies, loop, checkpoints, events, sink, usage }
}

function harness(client: RecordingClient, responses: ModelResponse[]) {
  const model = new ScriptedModelProvider(responses)
  const built = buildDependencies({ client, model })
  return { client, model, ...built }
}

const request = {
  taskId: 'sandbox-game-1',
  userId: 'student-1',
  capability: 'game' as XiaobaoCapability,
  prompt: '做一个小游戏',
}

describe('sandbox tool controlled path', () => {
  it('writes a project file through the sandbox client and completes the game task', async () => {
    const client = new RecordingClient()
    const h = harness(client, [
      {
        kind: 'tool',
        action: { id: 'write-1', toolName: 'write_file', input: { path: 'project/main.py', content: 'print(1)' } },
      },
      { kind: 'complete', text: '游戏完成', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } },
    ])

    const result = await h.loop.run(request, h.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(client.calls).toHaveLength(1)
    expect(client.calls[0]).toEqual({ tool: 'write', input: { path: 'project/main.py', content: 'print(1)' } })
    const saved = await h.checkpoints.load('sandbox-game-1')
    expect(saved?.observations).toHaveLength(1)
    expect(saved?.observations[0]).toMatchObject({ actionId: 'write-1', ok: true, toolName: 'write_file' })
    expect(h.events.some((event) => event.type === 'tool_finished')).toBe(true)
    expect(h.events.some((event) => event.type === 'completed')).toBe(true)
  })

  it('records a client failure as a failed observation without leaking upstream text or retrying', async () => {
    const client = new RecordingClient([{ ok: false, error: 'sandbox write denied' }])
    const h = harness(client, [
      {
        kind: 'tool',
        action: { id: 'write-1', toolName: 'write_file', input: { path: 'project/main.py', content: 'print(1)' } },
      },
      { kind: 'complete', text: '游戏完成' },
    ])

    const result = await h.loop.run(request, h.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    // A normalized tool failure is one observation (no client retry) and the model still completes.
    expect(client.calls).toHaveLength(1)
    const saved = await h.checkpoints.load('sandbox-game-1')
    expect(saved?.observations).toHaveLength(1)
    expect(saved?.observations[0]).toMatchObject({ actionId: 'write-1', ok: false, toolName: 'write_file' })
    expect(JSON.stringify(h.events)).not.toContain('sandbox write denied')
    expect(JSON.stringify(saved?.observations)).not.toContain('sandbox write denied')
  })

  it('carries the original tool name into the next model turn observations', async () => {
    const client = new RecordingClient()
    const h = harness(client, [
      {
        kind: 'tool',
        action: { id: 'write-1', toolName: 'write_file', input: { path: 'project/main.py', content: 'print(1)' } },
      },
      {
        kind: 'tool',
        action: {
          id: 'run-1',
          toolName: 'run_command',
          input: { command: 'python project/main.py', timeout: 10000 },
        },
      },
      { kind: 'complete', text: '游戏完成' },
    ])

    const result = await h.loop.run(request, h.sink, new AbortController().signal)

    expect(result.status).toBe('completed')
    expect(client.calls.map((call) => call.tool)).toEqual(['write', 'bash'])
    // The second model turn must have seen the write observation under its real name.
    const secondTurnObservations = h.model.calls[1]?.observations ?? []
    expect(secondTurnObservations).toHaveLength(1)
    expect(secondTurnObservations[0]).toMatchObject({ actionId: 'write-1', ok: true, toolName: 'write_file' })
    // The final complete turn sees both observations with original tool names.
    const finalTurnObservations = h.model.calls[2]?.observations ?? []
    expect(finalTurnObservations).toHaveLength(2)
    expect(finalTurnObservations[0]).toMatchObject({ toolName: 'write_file' })
    expect(finalTurnObservations[1]).toMatchObject({ actionId: 'run-1', ok: true, toolName: 'run_command' })
  })

  it('resumes sandbox tool work from a recoverable failure without losing tool observations', async () => {
    const client = new RecordingClient()
    // Turn 1: write a file, then the model hits a recoverable outage.
    // Resume: run the written project, then complete.
    const model = new ScriptedModelProvider([
      {
        kind: 'tool',
        action: { id: 'write-1', toolName: 'write_file', input: { path: 'project/main.py', content: 'print(1)' } },
      },
      new ModelProviderError('unavailable'),
      {
        kind: 'tool',
        action: {
          id: 'run-1',
          toolName: 'run_command',
          input: { command: 'python project/main.py', timeout: 10000 },
        },
      },
      { kind: 'complete', text: '游戏完成' },
    ])
    const built = buildDependencies({ client, model })

    const first = await built.loop.run(request, built.sink, new AbortController().signal)
    expect(first.status).toBe('failed_recoverable')

    const resumed = await built.loop.run(request, built.sink, new AbortController().signal)

    expect(resumed.status).toBe('completed')
    expect(client.calls.map((call) => call.tool)).toEqual(['write', 'bash'])
    // Resume must not reserve the model budget twice (idempotent reservation on the checkpoint).
    expect(built.usage.reserve).toHaveBeenCalledTimes(1)
    // After resume the model sees the original write observation before running the project.
    const resumedWriteTurn = model.calls.find((call) => call.observations.some((o) => o.actionId === 'write-1'))
    expect(resumedWriteTurn?.observations).toHaveLength(1)
    expect(resumedWriteTurn?.observations[0]).toMatchObject({ ok: true, toolName: 'write_file' })
    const finalTurn = model.calls.at(-1)
    expect(finalTurn?.observations).toHaveLength(2)
    expect(finalTurn?.observations[1]).toMatchObject({ actionId: 'run-1', ok: true, toolName: 'run_command' })
  })
})
