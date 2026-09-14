# Xiaobao Runtime Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fully self-owned, provider-neutral Xiaobao Runtime foundation that can execute one deterministic Skill-driven tool loop, persist checkpoints through an interface, emit stable events, and register beside the existing runtimes without making it the default.

**Architecture:** Add a focused `packages/server/src/agent/xiaobao-runtime/` module whose domain types do not import CodeBuddy, OpenCode, CloudBase, or sandbox implementations. The foundation uses dependency-injected model, tool, Skill, checkpoint, usage, and safety ports; an `IAgentRuntime` adapter translates its stable internal events into the existing frontend callback contract.

**Tech Stack:** TypeScript 5.7, Zod 4, Vitest 3, existing `IAgentRuntime` and `AgentCallbackMessage` contracts.

**Spec:** `docs/superpowers/specs/2026-08-21-xiaobao-runtime-design.md`

## Global Constraints

- The Agent core must not import `@tencent-ai/agent-sdk`, OpenCode packages, OpenAgentKernel, CloudBase managers, COS SDKs, or concrete sandbox implementations.
- The initial student capability set is exactly `image`, `video`, `music`, `game`, `writing`, and `learning`.
- Capacity values are configuration, never hard-coded user limits.
- Dynamic values and secrets must not be written to logs; repository logging rules remain in force.
- Existing CodeBuddy and OpenCode runtimes remain available during migration.
- `xiaobao` is explicit opt-in in this foundation plan and must not become the production default yet.
- Every task uses tests first and ends with an isolated commit plus a progress-log update.

## File Map

- `packages/server/src/agent/xiaobao-runtime/domain.ts` — stable task, step, event, action, result, and state schemas.
- `packages/server/src/agent/xiaobao-runtime/state-machine.ts` — allowed idempotent task transitions.
- `packages/server/src/agent/xiaobao-runtime/ports.ts` — provider-neutral interfaces for models, tools, Skills, checkpoints, safety, and usage.
- `packages/server/src/agent/xiaobao-runtime/events.ts` — ordered event sink and existing callback bridge.
- `packages/server/src/agent/xiaobao-runtime/skill-engine.ts` — six-capability Skill resolution and versioned snapshots.
- `packages/server/src/agent/xiaobao-runtime/agent-loop.ts` — bounded plan/action/observation loop with local recovery.
- `packages/server/src/agent/xiaobao-runtime/runtime.ts` — `IAgentRuntime` adapter named `xiaobao`.
- `packages/server/src/agent/xiaobao-runtime/index.ts` — public exports for the new module.
- `packages/server/src/agent/xiaobao-runtime/__tests__/` — focused unit and integration tests.
- `packages/server/src/agent/runtime/registry.ts` — opt-in runtime registration.
- `docs/progress/2026-08-21-xiaobao-runtime.md` — per-task work log.

---

### Task 1: Domain Contracts and State Machine

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/domain.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/state-machine.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/state-machine.test.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Produces: `XiaobaoCapability`, `XiaobaoTaskStatus`, `XiaobaoTaskSnapshot`, `XiaobaoAction`, `XiaobaoObservation`, `XiaobaoRuntimeEvent`, `transitionTask(snapshot, nextStatus, now)`.
- Consumes: only Zod and standard TypeScript types.

- [ ] **Step 1: Write the failing state-machine tests**

```ts
import { describe, expect, it } from 'vitest'
import { createTaskSnapshot, transitionTask } from '../state-machine.js'

describe('xiaobao task state machine', () => {
  it('moves through the valid foundation lifecycle', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'game', now: 100 })
    const checked = transitionTask(created, 'safety_check', 110)
    const planned = transitionTask(transitionTask(checked, 'requirements', 120), 'planned', 130)
    expect(transitionTask(planned, 'running', 140).status).toBe('running')
  })

  it('rejects a transition that skips required gates', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'video', now: 100 })
    expect(() => transitionTask(created, 'completed', 110)).toThrow('Invalid Xiaobao task transition')
  })

  it('treats the same transition as idempotent', () => {
    const created = createTaskSnapshot({ taskId: 'task-1', capability: 'image', now: 100 })
    expect(transitionTask(created, 'created', 110)).toEqual(created)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/state-machine.test.ts`

Expected: FAIL because `state-machine.ts` does not exist.

- [ ] **Step 3: Implement schemas and explicit transitions**

```ts
export const XIAOBAO_CAPABILITIES = ['image', 'video', 'music', 'game', 'writing', 'learning'] as const
export type XiaobaoCapability = (typeof XIAOBAO_CAPABILITIES)[number]

export const XIAOBAO_TASK_STATUSES = [
  'created', 'safety_check', 'requirements', 'planned', 'running',
  'waiting_for_student', 'quality_check', 'revising', 'retrying',
  'paused_budget', 'failed_recoverable', 'failed_terminal', 'cancelled', 'completed',
] as const
export type XiaobaoTaskStatus = (typeof XIAOBAO_TASK_STATUSES)[number]

export interface XiaobaoTaskSnapshot {
  schemaVersion: 1
  taskId: string
  capability: XiaobaoCapability
  status: XiaobaoTaskStatus
  revision: number
  createdAt: number
  updatedAt: number
  currentStepId: string | null
}
```

Define an `ALLOWED_TRANSITIONS: Record<XiaobaoTaskStatus, readonly XiaobaoTaskStatus[]>`; `transitionTask` returns the same object for the same status, throws the static message `Invalid Xiaobao task transition` for disallowed transitions, and increments `revision` for accepted transitions.

- [ ] **Step 4: Run the focused test**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/state-machine.test.ts`

Expected: 3 tests PASS.

- [ ] **Step 5: Update the progress log and commit**

Add the Task 1 outcome and exact test result to `docs/progress/2026-08-21-xiaobao-runtime.md`.

```bash
git add packages/server/src/agent/xiaobao-runtime/domain.ts packages/server/src/agent/xiaobao-runtime/state-machine.ts packages/server/src/agent/xiaobao-runtime/__tests__/state-machine.test.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): add xiaobao runtime domain"
```

### Task 2: Provider-Neutral Ports and In-Memory Test Doubles

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/ports.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/testing.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/ports.test.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: Task 1 domain types.
- Produces: `ModelProvider`, `ToolProvider`, `SkillProvider`, `CheckpointStore`, `SafetyProvider`, `UsageProvider`, `XiaobaoRuntimeDependencies`, `InMemoryCheckpointStore`, and deterministic fake providers.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from 'vitest'
import { InMemoryCheckpointStore } from '../testing.js'
import { createTaskSnapshot } from '../state-machine.js'

describe('xiaobao provider ports', () => {
  it('round-trips checkpoints without exposing mutable storage', async () => {
    const store = new InMemoryCheckpointStore()
    const snapshot = createTaskSnapshot({ taskId: 'task-1', capability: 'learning', now: 100 })
    await store.save(snapshot)
    const loaded = await store.load('task-1')
    expect(loaded).toEqual(snapshot)
    expect(loaded).not.toBe(snapshot)
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/ports.test.ts`

Expected: FAIL because the provider port files do not exist.

- [ ] **Step 3: Define the exact provider interfaces**

```ts
export interface ModelProvider {
  readonly name: string
  complete(input: ModelRequest, signal: AbortSignal): Promise<ModelResponse>
}

export interface ToolProvider {
  readonly name: string
  execute(input: ToolExecutionRequest, signal: AbortSignal): Promise<XiaobaoObservation>
}

export interface SkillProvider {
  getByCapability(capability: XiaobaoCapability): Promise<SkillSnapshot | null>
}

export interface CheckpointStore {
  load(taskId: string): Promise<XiaobaoTaskSnapshot | null>
  save(snapshot: XiaobaoTaskSnapshot): Promise<void>
}

export interface SafetyProvider {
  check(input: SafetyCheckRequest): Promise<SafetyCheckResult>
}

export interface UsageProvider {
  reserve(input: UsageReservation): Promise<UsageReservationResult>
  record(input: UsageRecord): Promise<void>
}
```

`ModelResponse` is a discriminated union of `{ kind: 'text'; text: string }`, `{ kind: 'tool'; action: XiaobaoAction }`, and `{ kind: 'complete'; text: string }`. All interfaces accept domain values and must not import concrete vendors.

- [ ] **Step 4: Implement cloning in-memory stores and deterministic fakes**

Use `structuredClone` on save and load. Fake providers keep calls in arrays so later tests can assert ordering without dynamic logging.

- [ ] **Step 5: Run the focused tests**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/ports.test.ts`

Expected: PASS.

- [ ] **Step 6: Update the progress log and commit**

```bash
git add packages/server/src/agent/xiaobao-runtime/ports.ts packages/server/src/agent/xiaobao-runtime/testing.ts packages/server/src/agent/xiaobao-runtime/__tests__/ports.test.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): define xiaobao runtime ports"
```

### Task 3: Ordered Event Stream and Frontend Bridge

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/events.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/events.test.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: `XiaobaoRuntimeEvent` and existing `AgentCallback`.
- Produces: `OrderedEventSink.emit(event)` and `toAgentCallbackMessage(event)`.

- [ ] **Step 1: Write tests for ordering and translation**

```ts
it('serializes concurrent event emissions', async () => {
  const received: number[] = []
  const sink = new OrderedEventSink(async (event) => {
    await Promise.resolve()
    received.push(event.sequence)
  })
  await Promise.all([sink.emit(phaseEvent(1)), sink.emit(phaseEvent(2))])
  expect(received).toEqual([1, 2])
})

it('maps completion to the existing result callback', () => {
  expect(toAgentCallbackMessage(completedEvent('完成啦'))).toMatchObject({
    type: 'result',
    content: '完成啦',
  })
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/events.test.ts`

Expected: FAIL because `events.ts` does not exist.

- [ ] **Step 3: Implement a promise-chain sink and exhaustive bridge**

Map internal events as follows: `phase → agent_phase`, `text → text`, `tool_started → tool_use`, `tool_finished → tool_result`, `artifact → artifact`, `waiting_for_student → ask_user`, `failed → error`, `completed → result`. Use an exhaustive `never` check so new event types cannot silently disappear.

- [ ] **Step 4: Run the focused test**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/events.test.ts`

Expected: PASS.

- [ ] **Step 5: Update the progress log and commit**

```bash
git add packages/server/src/agent/xiaobao-runtime/events.ts packages/server/src/agent/xiaobao-runtime/__tests__/events.test.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): bridge xiaobao runtime events"
```

### Task 4: Six-Capability Skill Engine

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/skill-engine.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/skill-engine.test.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: `SkillProvider`, `XiaobaoCapability`, and existing Skill names.
- Produces: `SkillEngine.resolve(capability)` returning an immutable `SkillSnapshot`.

- [ ] **Step 1: Write the six-capability mapping test**

```ts
expect(SKILL_NAMES_BY_CAPABILITY).toEqual({
  image: 'student-image-master',
  video: 'student-video-master',
  music: 'student-music-master',
  game: 'scratch-game-coach',
  writing: 'student-writing-coach',
  learning: 'student-learning-master',
})
```

Also test that a missing Skill throws `Xiaobao skill unavailable` and that returned snapshots are cloned and frozen.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/skill-engine.test.ts`

Expected: FAIL because `skill-engine.ts` does not exist.

- [ ] **Step 3: Implement exact mapping and immutable resolution**

`SkillEngine` receives a `SkillProvider`; it validates that the provider result name matches the expected name, returns a frozen clone, and never reads CodeBuddy/OpenCode configuration locations directly.

- [ ] **Step 4: Run the focused test**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/skill-engine.test.ts`

Expected: PASS for all six capabilities and error cases.

- [ ] **Step 5: Update the progress log and commit**

```bash
git add packages/server/src/agent/xiaobao-runtime/skill-engine.ts packages/server/src/agent/xiaobao-runtime/__tests__/skill-engine.test.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): add xiaobao skill engine"
```

### Task 5: Bounded Agent Loop with Checkpoints and Local Recovery

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/agent-loop.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: all Task 2 ports, `SkillEngine`, `OrderedEventSink`, and Task 1 state functions.
- Produces: `XiaobaoAgentLoop.run(request, sink, signal): Promise<XiaobaoRunResult>`.

- [ ] **Step 1: Write the successful tool-loop test**

```ts
it('checks safety, reserves usage, executes one tool, checkpoints, and completes', async () => {
  const harness = createAgentLoopHarness([
    { kind: 'tool', action: { id: 'action-1', toolName: 'make_image', input: { prompt: '星空兔子' } } },
    { kind: 'complete', text: '作品完成' },
  ])
  const result = await harness.loop.run(gameRequest(), harness.sink, new AbortController().signal)
  expect(result.status).toBe('completed')
  expect(harness.calls).toEqual(['safety', 'usage.reserve', 'skill', 'model', 'tool', 'checkpoint', 'model', 'checkpoint'])
})
```

Add tests for safety denial, budget pause, abort, tool failure followed by one retry, maximum-turn failure, and resuming a stored `running` checkpoint without repeating the safety reservation.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts`

Expected: FAIL because `agent-loop.ts` does not exist.

- [ ] **Step 3: Implement the minimal deterministic loop**

```ts
for (let turn = snapshot.turnCount; turn < limits.maxTurns; turn += 1) {
  throwIfAborted(signal)
  const response = await dependencies.model.complete(buildModelRequest(snapshot, skill), signal)
  if (response.kind === 'tool') {
    const observation = await executeWithSingleRetry(response.action, signal)
    snapshot = appendObservation(snapshot, response.action, observation)
    await dependencies.checkpoints.save(snapshot)
    continue
  }
  if (response.kind === 'complete') {
    snapshot = completeSnapshot(snapshot, response.text, dependencies.clock.now())
    await dependencies.checkpoints.save(snapshot)
    await sink.emit(completedEvent(snapshot, response.text))
    return { status: 'completed', snapshot }
  }
  await sink.emit(textEvent(snapshot, response.text))
}
```

The implementation must execute safety before model access, reserve budget before expensive work, save after every accepted observation, retry a failed tool at most once, and emit a terminal event on every exit path.

- [ ] **Step 4: Run the focused test**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts`

Expected: all success, denial, budget, abort, retry, turn-limit, and resume tests PASS.

- [ ] **Step 5: Update the progress log and commit**

```bash
git add packages/server/src/agent/xiaobao-runtime/agent-loop.ts packages/server/src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): add xiaobao agent loop"
```

### Task 6: Existing Runtime Adapter and Explicit Registration

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/runtime.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/index.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/runtime.test.ts`
- Modify: `packages/server/src/agent/runtime/registry.ts`
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: `XiaobaoAgentLoop`, callback bridge, `IAgentRuntime`, and `AgentOptions`.
- Produces: `XiaobaoRuntime`, `xiaobaoRuntime`, registry key `xiaobao`.

- [ ] **Step 1: Write adapter and registry tests**

```ts
it('exposes the explicit xiaobao runtime without changing the default', () => {
  expect(agentRuntimeRegistry.get('xiaobao')?.name).toBe('xiaobao')
  expect(agentRuntimeRegistry.resolve().name).not.toBe('xiaobao')
})

it('returns a turn id immediately and emits a terminal result', async () => {
  const messages: AgentCallbackMessage[] = []
  const result = await runtime.chatStream('画一只兔子', (message) => messages.push(message), imageOptions())
  expect(result.alreadyRunning).toBe(false)
  await runtime.waitForIdle(result.turnId)
  expect(messages.at(-1)?.type).toBe('result')
})
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/runtime.test.ts`

Expected: FAIL because `XiaobaoRuntime` is not implemented or registered.

- [ ] **Step 3: Implement the adapter with injected dependencies**

`XiaobaoRuntime` has `readonly name = 'xiaobao'`, accepts a dependency factory in its constructor, derives capability only from validated task metadata, creates a stable turn ID with `nanoid(12)`, runs the loop in a guarded background promise, and translates internal events through `OrderedEventSink`. `isAvailable()` returns true only when required providers pass their own health checks. `getSupportedModels()` returns provider model metadata without vendor-specific imports in the core.

- [ ] **Step 4: Register without changing defaults**

Add `this.register(xiaobaoRuntime)` to `AgentRuntimeRegistry`. Keep `DEFAULT_RUNTIME`, `codebuddy`, `opencode-acp`, and `tencent-sdk` alias behavior unchanged.

- [ ] **Step 5: Run focused and existing runtime tests**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime src/agent/runtime/__tests__/baseline.test.ts`

Expected: new adapter tests and existing runtime baseline PASS.

- [ ] **Step 6: Update the progress log and commit**

```bash
git add packages/server/src/agent/xiaobao-runtime packages/server/src/agent/runtime/registry.ts docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "feat(agent): register xiaobao runtime foundation"
```

### Task 7: Foundation Verification and Browser-Safe Exposure Check

**Files:**
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: verified foundation baseline and exact handoff for the next provider-integration plan.

- [ ] **Step 1: Run all new Runtime tests**

Run: `pnpm.cmd --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime`

Expected: all Xiaobao Runtime tests PASS with no skipped tests.

- [ ] **Step 2: Run repository-required verification**

Run: `pnpm.cmd format`

Expected: command succeeds; inspect the exact diff and do not stage unrelated formatting changes.

Run: `pnpm.cmd type-check`

Expected: exit code 0.

Run: `pnpm.cmd lint --ignore-pattern ".worktrees/**" --ignore-pattern "**/dist/**"`

Expected: exit code 0.

Run: `pnpm.cmd --filter @ai-xiaobao/server build`

Expected: exit code 0.

- [ ] **Step 3: Inspect runtime discovery through the existing HTTP surface**

Use the existing built server test or local preview already supplied by the user environment; do not start a new long-running development server. Confirm the runtime catalogue can expose `xiaobao` when available and that the student UI still defaults to its pre-foundation runtime because rollout is not part of this plan.

- [ ] **Step 4: Update the final foundation log entry**

Record every command, pass/fail count, browser/API observation, known limitations, and the next plan: production checkpoint storage plus the first real model provider.

- [ ] **Step 5: Commit verification records**

```bash
git add docs/progress/2026-08-21-xiaobao-runtime.md
git commit -m "docs(agent): verify xiaobao runtime foundation"
```

## Deferred to Follow-Up Plans

The following are intentionally separate, independently reviewable subprojects:

1. PostgreSQL/CloudBase checkpoint and usage repositories.
2. First production model provider and structured tool-call protocol.
3. Local Docker and remote sandbox providers with snapshot recovery.
4. S3/MinIO/COS storage providers.
5. Real image, Volcano video, and selected music providers.
6. Student six-entry rollout, teacher budgets, and browser workflows.
7. Redis queue, multi-node workers, load tests, observability, and disaster recovery.

