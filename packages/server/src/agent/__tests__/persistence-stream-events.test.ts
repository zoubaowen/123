import { describe, expect, it, vi } from 'vitest'
import { PersistenceService } from '../persistence.service.js'

describe('PersistenceService stream event isolation', () => {
  it('binds replay and cleanup queries to conversation, turn, environment, and user', async () => {
    const replayWhere = vi.fn()
    const cleanupWhere = vi.fn()
    const replayQuery = {
      orderBy: vi.fn(() => ({
        limit: vi.fn(() => ({
          get: vi.fn(async () => ({ data: [] })),
        })),
      })),
    }
    const cleanupQuery = { remove: vi.fn(async () => undefined) }
    const collection = {
      where: vi.fn((query: Record<string, unknown>) => {
        if ('seq' in query) {
          replayWhere(query)
          return replayQuery
        }
        cleanupWhere(query)
        return cleanupQuery
      }),
    }
    const command = {
      eq: (value: unknown) => ({ operation: 'eq', value }),
      gt: (value: unknown) => ({ operation: 'gt', value }),
    }
    const service = new PersistenceService() as unknown as {
      getStreamEventsCollection: () => Promise<typeof collection>
      getCloudBaseApp: () => Promise<{ database: () => { command: typeof command } }>
      getStreamEvents: PersistenceService['getStreamEvents']
      cleanupStreamEvents: PersistenceService['cleanupStreamEvents']
    }
    service.getStreamEventsCollection = async () => collection
    service.getCloudBaseApp = async () => ({ database: () => ({ command }) })

    await service.getStreamEvents('task-1', 'turn-1', 'school-env', 'student-1', 3)
    await service.cleanupStreamEvents('task-1', 'turn-1', 'school-env', 'student-1')

    const identity = {
      conversationId: { operation: 'eq', value: 'task-1' },
      turnId: { operation: 'eq', value: 'turn-1' },
      envId: { operation: 'eq', value: 'school-env' },
      userId: { operation: 'eq', value: 'student-1' },
    }
    expect(replayWhere).toHaveBeenCalledWith({
      ...identity,
      seq: { operation: 'gt', value: 3 },
    })
    expect(cleanupWhere).toHaveBeenCalledWith(identity)
  })
})
