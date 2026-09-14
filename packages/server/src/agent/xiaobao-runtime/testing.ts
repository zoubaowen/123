import type { XiaobaoCapability, XiaobaoObservation, XiaobaoTaskSnapshot } from './domain.js'
import type {
  CheckpointStore,
  ModelProvider,
  ModelRequest,
  ModelResponse,
  SafetyCheckRequest,
  SafetyCheckResult,
  SafetyProvider,
  SkillProvider,
  SkillSnapshot,
  ToolExecutionRequest,
  ToolProvider,
  UsageProvider,
  UsageRecord,
  UsageReservation,
  UsageReservationResult,
  XiaobaoModelInfo,
} from './ports.js'

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly snapshots = new Map<string, XiaobaoTaskSnapshot>()

  async load(taskId: string): Promise<XiaobaoTaskSnapshot | null> {
    const snapshot = this.snapshots.get(taskId)
    return snapshot ? structuredClone(snapshot) : null
  }

  async save(snapshot: XiaobaoTaskSnapshot): Promise<void> {
    this.snapshots.set(snapshot.taskId, structuredClone(snapshot))
  }
}

export class DeterministicModelProvider implements ModelProvider {
  readonly name = 'deterministic-model'
  readonly calls: ModelRequest[] = []

  constructor(private readonly responses: ModelResponse[]) {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async listModels(): Promise<XiaobaoModelInfo[]> {
    return [{ id: 'deterministic-model', name: 'Deterministic Model' }]
  }

  async complete(input: ModelRequest, _signal: AbortSignal): Promise<ModelResponse> {
    this.calls.push(structuredClone(input))
    const response = this.responses.shift()
    if (!response) throw new Error('Deterministic model response exhausted')
    return structuredClone(response)
  }
}

export class DeterministicToolProvider implements ToolProvider {
  readonly calls: ToolExecutionRequest[] = []

  constructor(
    readonly name: string,
    private readonly observations: XiaobaoObservation[],
  ) {}

  async healthCheck(): Promise<boolean> {
    return true
  }

  async execute(input: ToolExecutionRequest, _signal: AbortSignal): Promise<XiaobaoObservation> {
    this.calls.push(structuredClone(input))
    const observation = this.observations.shift()
    if (!observation) throw new Error('Deterministic tool observation exhausted')
    return structuredClone(observation)
  }
}

export class InMemorySkillProvider implements SkillProvider {
  constructor(private readonly skills: ReadonlyMap<XiaobaoCapability, SkillSnapshot>) {}

  async getByCapability(capability: XiaobaoCapability): Promise<SkillSnapshot | null> {
    const skill = this.skills.get(capability)
    return skill ? structuredClone(skill) : null
  }
}

export class FixedSafetyProvider implements SafetyProvider {
  readonly calls: SafetyCheckRequest[] = []

  constructor(private readonly result: SafetyCheckResult = { allowed: true }) {}

  async check(input: SafetyCheckRequest, _signal: AbortSignal): Promise<SafetyCheckResult> {
    this.calls.push(structuredClone(input))
    return structuredClone(this.result)
  }
}

export class UnlimitedUsageProvider implements UsageProvider {
  readonly reservations: UsageReservation[] = []
  readonly records: UsageRecord[] = []
  private readonly reservationsByKey = new Map<
    string,
    { input: UsageReservation; result: UsageReservationResult & { allowed: true } }
  >()
  private readonly recordsByReservationId = new Map<string, UsageRecord>()

  async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    const key = `${input.taskId}\u0000${input.category}`
    const existing = this.reservationsByKey.get(key)
    if (existing) {
      if (existing.input.userId !== input.userId || existing.input.units !== input.units) {
        throw new Error('Usage reservation conflict')
      }
      return structuredClone(existing.result)
    }

    this.reservations.push(structuredClone(input))
    const result = { allowed: true as const, reservationId: `reservation-${this.reservations.length}` }
    this.reservationsByKey.set(key, { input: structuredClone(input), result })
    return structuredClone(result)
  }

  async record(input: UsageRecord): Promise<void> {
    const existing = this.recordsByReservationId.get(input.reservationId)
    if (existing) {
      if (existing.taskId !== input.taskId || existing.category !== input.category || existing.units !== input.units) {
        throw new Error('Usage record conflict')
      }
      return
    }
    this.recordsByReservationId.set(input.reservationId, structuredClone(input))
    this.records.push(structuredClone(input))
  }
}
