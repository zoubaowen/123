import { describe, expect, it } from 'vitest'
import type { XiaobaoTaskSnapshot } from '../domain.js'
import { CheckpointConflictError, CheckpointCorruptError, DatabaseCheckpointStore } from '../checkpoint-store.js'
import type { CheckpointRecord, CheckpointRepository } from '../../../db/types.js'
import { createTaskSnapshot, transitionTask } from '../state-machine.js'

class MemoryCheckpointRepository implements CheckpointRepository {
  record: CheckpointRecord | null = null

  async healthCheck(): Promise<boolean> {
    return true
  }

  async findByTaskId(taskId: string): Promise<CheckpointRecord | null> {
    return this.record?.taskId === taskId ? structuredClone(this.record) : null
  }

  async create(record: CheckpointRecord): Promise<CheckpointRecord | null> {
    if (this.record) return null
    this.record = structuredClone(record)
    return structuredClone(record)
  }

  async compareAndSwap(
    taskId: string,
    expectedRevision: number,
    next: CheckpointRecord,
  ): Promise<CheckpointRecord | null> {
    if (this.record?.taskId !== taskId || this.record.revision !== expectedRevision) return null
    this.record = structuredClone(next)
    return structuredClone(next)
  }
}

function createSnapshot(): XiaobaoTaskSnapshot {
  return createTaskSnapshot({
    taskId: 'task-1',
    userId: 'student-1',
    capability: 'learning',
    prompt: '解释彩虹为什么有七种颜色',
    now: 100,
  })
}

describe('DatabaseCheckpointStore', () => {
  it('persists and reloads a validated snapshot', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const snapshot = createSnapshot()

    await store.save(snapshot)

    await expect(store.load('task-1')).resolves.toEqual(snapshot)
    expect(repository.record).toMatchObject({ taskId: 'task-1', revision: 1, schemaVersion: 1 })
  })

  it('increments the storage revision when the snapshot changes', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const snapshot = createSnapshot()
    await store.save(snapshot)

    await store.save(transitionTask(snapshot, 'safety_check', 300))

    expect(repository.record?.revision).toBe(2)
  })

  it('accepts an identical replay without writing another revision', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const snapshot = createSnapshot()
    await store.save(snapshot)

    await store.save(structuredClone(snapshot))

    expect(repository.record?.revision).toBe(1)
  })

  it('rejects a stale divergent snapshot instead of rebasing it onto the latest revision', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const initial = createSnapshot()
    await store.save(initial)
    await store.save(transitionTask(initial, 'safety_check', 300))

    const staleDivergent = {
      ...initial,
      prompt: '陈旧工作者的不同结果',
      updatedAt: 400,
    }

    await expect(store.save(staleDivergent)).rejects.toBeInstanceOf(CheckpointConflictError)
    await expect(store.load('task-1')).resolves.toMatchObject({ status: 'safety_check', revision: 1 })
    expect(repository.record?.revision).toBe(2)
  })

  it('rejects a first write that skips the initial snapshot revision', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const skippedInitial = transitionTask(createSnapshot(), 'safety_check', 300)

    await expect(store.save(skippedInitial)).rejects.toBeInstanceOf(CheckpointConflictError)
    expect(repository.record).toBeNull()
  })

  it('rejects a divergent write after losing a compare-and-swap race', async () => {
    const repository = new MemoryCheckpointRepository()
    const store = new DatabaseCheckpointStore(repository, () => 200)
    const snapshot = createSnapshot()
    await store.save(snapshot)
    const next = transitionTask(snapshot, 'safety_check', 300)
    repository.compareAndSwap = async () => null

    await expect(store.save(next)).rejects.toBeInstanceOf(CheckpointConflictError)
  })

  it('rejects malformed stored JSON', async () => {
    const repository = new MemoryCheckpointRepository()
    repository.record = {
      taskId: 'task-1',
      revision: 1,
      schemaVersion: 1,
      snapshotJson: '{bad-json',
      createdAt: 100,
      updatedAt: 100,
    }
    const store = new DatabaseCheckpointStore(repository, () => 200)

    await expect(store.load('task-1')).rejects.toBeInstanceOf(CheckpointCorruptError)
  })

  it('rejects unsupported checkpoint schema versions', async () => {
    const repository = new MemoryCheckpointRepository()
    repository.record = {
      taskId: 'task-1',
      revision: 1,
      schemaVersion: 2,
      snapshotJson: JSON.stringify(createSnapshot()),
      createdAt: 100,
      updatedAt: 100,
    }
    const store = new DatabaseCheckpointStore(repository, () => 200)

    await expect(store.load('task-1')).rejects.toBeInstanceOf(CheckpointCorruptError)
  })
})
