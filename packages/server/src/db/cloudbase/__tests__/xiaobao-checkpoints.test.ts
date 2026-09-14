import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CheckpointRecord } from '../../types.js'

const cloudbase = vi.hoisted(() => ({
  add: vi.fn(),
  get: vi.fn(),
  getCollection: vi.fn(),
  getExistingCollection: vi.fn(),
  getCommand: vi.fn(),
  limit: vi.fn(),
  update: vi.fn(),
  where: vi.fn(),
}))

vi.mock('../client.js', () => ({
  getCollection: cloudbase.getCollection,
  getExistingCollection: cloudbase.getExistingCollection,
  getCommand: cloudbase.getCommand,
}))

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

describe('CloudBaseXiaobaoCheckpointRepository', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    cloudbase.getCommand.mockReturnValue({})
    cloudbase.getCollection.mockResolvedValue({
      add: cloudbase.add,
      where: cloudbase.where,
    })
    cloudbase.getExistingCollection.mockReturnValue({ limit: cloudbase.limit })
  })

  it('reads the checkpoint collection and omits CloudBase document metadata', async () => {
    cloudbase.where.mockReturnValue({ limit: cloudbase.limit })
    cloudbase.limit.mockReturnValue({ get: cloudbase.get })
    cloudbase.get.mockResolvedValue({ data: [{ _id: 'cloudbase-id', ...checkpoint(1) }] })

    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.findByTaskId('task-1')).resolves.toEqual(checkpoint(1))
    expect(cloudbase.getCollection).toHaveBeenCalledWith('xiaobao_runtime_checkpoints')
  })

  it('reports collection readability without writing a checkpoint', async () => {
    cloudbase.limit.mockReturnValue({ get: cloudbase.get })
    cloudbase.get.mockResolvedValue({ data: [] })
    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.healthCheck()).resolves.toBe(true)
    expect(cloudbase.add).not.toHaveBeenCalled()
    expect(cloudbase.getCollection).not.toHaveBeenCalled()
    expect(cloudbase.getExistingCollection).toHaveBeenCalledWith('xiaobao_runtime_checkpoints')
  })

  it('does not claim safe write readiness when CloudBase cannot provide a rollback probe', async () => {
    cloudbase.limit.mockReturnValue({ get: cloudbase.get })
    cloudbase.get.mockResolvedValue({ data: [] })
    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.checkReadWriteReadiness()).resolves.toEqual({ readable: true, writable: false })
    expect(cloudbase.add).not.toHaveBeenCalled()
    expect(cloudbase.getCollection).not.toHaveBeenCalled()
  })

  it('reports an unreadable checkpoint collection as unhealthy', async () => {
    cloudbase.getExistingCollection.mockImplementation(() => {
      throw new Error('service unavailable')
    })
    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.healthCheck()).resolves.toBe(false)
  })

  it('returns null when the task document already exists', async () => {
    cloudbase.add.mockRejectedValue(Object.assign(new Error('insert failed'), { code: 'DATABASE_DUPLICATE_WRITE' }))

    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.create(checkpoint(1))).resolves.toBeNull()
    expect(cloudbase.add).toHaveBeenCalledWith({ _id: 'task-1', ...checkpoint(1) })
  })

  it('propagates service errors when creating a checkpoint', async () => {
    const serviceError = new Error('service unavailable')
    cloudbase.add.mockRejectedValue(serviceError)

    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.create(checkpoint(1))).rejects.toBe(serviceError)
  })

  it('propagates permission errors when creating a checkpoint', async () => {
    const permissionError = Object.assign(new Error('permission denied'), { code: 'AUTH_PERMISSION_DENIED' })
    cloudbase.add.mockRejectedValue(permissionError)

    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.create(checkpoint(1))).rejects.toBe(permissionError)
  })

  it('updates only the checkpoint with the expected revision', async () => {
    cloudbase.where.mockReturnValue({ update: cloudbase.update })
    cloudbase.update.mockResolvedValue({ updated: 1 })

    const { CloudBaseXiaobaoCheckpointRepository } = await import('../repositories.js')
    const repository = new CloudBaseXiaobaoCheckpointRepository()

    await expect(repository.compareAndSwap('task-1', 1, checkpoint(2, '{"status":"running"}'))).resolves.toEqual(
      checkpoint(2, '{"status":"running"}'),
    )
    expect(cloudbase.where).toHaveBeenCalledWith({ taskId: 'task-1', revision: 1 })

    cloudbase.update.mockResolvedValue({ updated: 0 })
    await expect(repository.compareAndSwap('task-1', 1, checkpoint(2, '{"status":"running"}'))).resolves.toBeNull()
  })
})
