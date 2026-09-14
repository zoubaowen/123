import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckpointRecord } from '../../types.js'

const originalDatabasePath = process.env.DATABASE_PATH

function checkpoint(revision: number, snapshotJson = '{"status":"created"}'): CheckpointRecord {
  return {
    taskId: 'task-1',
    revision,
    schemaVersion: 1,
    snapshotJson,
    createdAt: 100,
    updatedAt: 100 + revision,
  }
}

describe('DrizzleXiaobaoCheckpointRepository', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'xiaobao-checkpoints-')), 'test.db')
  })

  afterEach(() => {
    if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = originalDatabasePath
  })

  it('creates one checkpoint per task and reloads it', async () => {
    const { DrizzleXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new DrizzleXiaobaoCheckpointRepository()

    await expect(repository.create(checkpoint(1))).resolves.toEqual(checkpoint(1))
    await expect(repository.create(checkpoint(1, '{"status":"changed"}'))).resolves.toBeNull()
    await expect(repository.findByTaskId('task-1')).resolves.toEqual(checkpoint(1))
  })

  it('reports database readability without writing a checkpoint', async () => {
    const { DrizzleXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new DrizzleXiaobaoCheckpointRepository()

    await expect(repository.healthCheck()).resolves.toBe(true)
    await expect(repository.findByTaskId('xiaobao-health-check')).resolves.toBeNull()
  })

  it('proves read and write readiness inside a rolled-back transaction with no checkpoint residue', async () => {
    const { DrizzleXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new DrizzleXiaobaoCheckpointRepository()

    await expect(repository.checkReadWriteReadiness()).resolves.toEqual({ readable: true, writable: true })
    await expect(repository.findByTaskId('__xiaobao_runtime_readiness__')).resolves.toBeNull()
  })

  it('updates only when the expected revision still owns the row', async () => {
    const { DrizzleXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new DrizzleXiaobaoCheckpointRepository()
    await repository.create(checkpoint(1))

    await expect(repository.compareAndSwap('task-1', 1, checkpoint(2, '{"status":"running"}'))).resolves.toEqual(
      checkpoint(2, '{"status":"running"}'),
    )
    await expect(repository.compareAndSwap('task-1', 1, checkpoint(3, '{"status":"stale"}'))).resolves.toBeNull()
    await expect(repository.findByTaskId('task-1')).resolves.toEqual(checkpoint(2, '{"status":"running"}'))
  })
})
