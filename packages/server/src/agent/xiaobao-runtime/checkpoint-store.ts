import type { CheckpointRecord, CheckpointRepository } from '../../db/types.js'
import { xiaobaoTaskSnapshotSchema, type XiaobaoTaskSnapshot } from './domain.js'
import type { CheckpointStore } from './ports.js'

export const XIAOBAO_CHECKPOINT_SCHEMA_VERSION = 1

export class CheckpointConflictError extends Error {
  constructor() {
    super('Xiaobao checkpoint write conflict')
    this.name = 'CheckpointConflictError'
  }
}

export class CheckpointCorruptError extends Error {
  constructor() {
    super('Xiaobao checkpoint is invalid')
    this.name = 'CheckpointCorruptError'
  }
}

export class DatabaseCheckpointStore implements CheckpointStore {
  constructor(
    private readonly repository: CheckpointRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async load(taskId: string): Promise<XiaobaoTaskSnapshot | null> {
    const record = await this.repository.findByTaskId(taskId)
    if (!record) return null
    return this.parseRecord(record, taskId)
  }

  async save(snapshot: XiaobaoTaskSnapshot): Promise<void> {
    const validated = xiaobaoTaskSnapshotSchema.parse(snapshot)
    const snapshotJson = JSON.stringify(validated)
    const current = await this.repository.findByTaskId(validated.taskId)

    if (!current) {
      if (validated.revision !== 0) throw new CheckpointConflictError()
      const timestamp = this.now()
      const created = await this.repository.create({
        taskId: validated.taskId,
        revision: 1,
        schemaVersion: XIAOBAO_CHECKPOINT_SCHEMA_VERSION,
        snapshotJson,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      if (created) return
      return this.acceptReplayOrThrow(validated.taskId, snapshotJson)
    }

    if (current.schemaVersion !== XIAOBAO_CHECKPOINT_SCHEMA_VERSION) {
      throw new CheckpointCorruptError()
    }
    if (current.snapshotJson === snapshotJson) return
    if (current.revision !== validated.revision) throw new CheckpointConflictError()

    const updated = await this.repository.compareAndSwap(validated.taskId, current.revision, {
      ...current,
      revision: current.revision + 1,
      snapshotJson,
      updatedAt: this.now(),
    })
    if (updated) return
    return this.acceptReplayOrThrow(validated.taskId, snapshotJson)
  }

  private async acceptReplayOrThrow(taskId: string, snapshotJson: string): Promise<void> {
    const winner = await this.repository.findByTaskId(taskId)
    if (winner?.schemaVersion === XIAOBAO_CHECKPOINT_SCHEMA_VERSION && winner.snapshotJson === snapshotJson) {
      return
    }
    throw new CheckpointConflictError()
  }

  private parseRecord(record: CheckpointRecord, requestedTaskId: string): XiaobaoTaskSnapshot {
    if (record.schemaVersion !== XIAOBAO_CHECKPOINT_SCHEMA_VERSION) {
      throw new CheckpointCorruptError()
    }

    try {
      const snapshot = xiaobaoTaskSnapshotSchema.parse(JSON.parse(record.snapshotJson))
      if (snapshot.taskId !== requestedTaskId || snapshot.taskId !== record.taskId) {
        throw new CheckpointCorruptError()
      }
      return snapshot
    } catch (error) {
      if (error instanceof CheckpointCorruptError) throw error
      throw new CheckpointCorruptError()
    }
  }
}
