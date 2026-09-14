import { describe, expect, it } from 'vitest'
import { ModelProviderError, type ModelProviderErrorCode, type ModelResponse } from '../ports.js'
import { createTaskSnapshot } from '../state-machine.js'
import { DeterministicModelProvider, InMemoryCheckpointStore, UnlimitedUsageProvider } from '../testing.js'

describe('xiaobao provider ports', () => {
  it('round-trips checkpoints without exposing mutable storage', async () => {
    const store = new InMemoryCheckpointStore()
    const snapshot = createTaskSnapshot({ taskId: 'task-1', capability: 'learning', now: 100 })

    await store.save(snapshot)
    const loaded = await store.load('task-1')

    expect(loaded).toEqual(snapshot)
    expect(loaded).not.toBe(snapshot)

    if (!loaded) throw new Error('Expected a checkpoint')
    loaded.status = 'completed'

    expect((await store.load('task-1'))?.status).toBe('created')
  })

  it('returns null for a task that has no checkpoint', async () => {
    const store = new InMemoryCheckpointStore()

    await expect(store.load('missing-task')).resolves.toBeNull()
  })

  it('records each usage reservation at most once', async () => {
    const usage = new UnlimitedUsageProvider()
    const record = {
      taskId: 'task-1',
      reservationId: 'reservation-1',
      category: 'model' as const,
      units: 42,
    }

    await usage.record(record)
    await usage.record(record)

    expect(usage.records).toEqual([record])
  })

  it('returns the same reservation for repeated task and category requests', async () => {
    const usage = new UnlimitedUsageProvider()
    const request = { taskId: 'task-1', userId: 'student-1', category: 'model' as const, units: 6 }

    const first = await usage.reserve(request)
    const second = await usage.reserve(request)

    expect(second).toEqual(first)
    expect(usage.reservations).toEqual([request])
  })

  it('rejects conflicting units for an existing task and category reservation', async () => {
    const usage = new UnlimitedUsageProvider()
    await usage.reserve({ taskId: 'task-1', userId: 'student-1', category: 'model', units: 6 })

    await expect(usage.reserve({ taskId: 'task-1', userId: 'student-1', category: 'model', units: 7 })).rejects.toThrow(
      'Usage reservation conflict',
    )
    expect(usage.reservations).toHaveLength(1)
  })

  it('rejects a different user for an existing task and category reservation', async () => {
    const usage = new UnlimitedUsageProvider()
    await usage.reserve({ taskId: 'task-1', userId: 'student-1', category: 'model', units: 6 })

    await expect(usage.reserve({ taskId: 'task-1', userId: 'student-2', category: 'model', units: 6 })).rejects.toThrow(
      'Usage reservation conflict',
    )
    expect(usage.reservations).toHaveLength(1)
  })

  it.each([
    { taskId: 'other-task', category: 'model' as const, units: 42 },
    { taskId: 'task-1', category: 'tool' as const, units: 42 },
    { taskId: 'task-1', category: 'model' as const, units: 43 },
  ])('rejects conflicting fields for an existing reservation record', async (conflict) => {
    const usage = new UnlimitedUsageProvider()
    await usage.record({ taskId: 'task-1', reservationId: 'reservation-1', category: 'model', units: 42 })

    await expect(usage.record({ reservationId: 'reservation-1', ...conflict })).rejects.toThrow('Usage record conflict')
    expect(usage.records).toHaveLength(1)
  })

  it('preserves optional normalized usage metadata from deterministic model responses', async () => {
    const response = {
      kind: 'text',
      text: '你好！',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
    } satisfies ModelResponse
    const provider = new DeterministicModelProvider([response])
    const snapshot = createTaskSnapshot({ taskId: 'task-1', capability: 'learning', now: 100 })

    await expect(
      provider.complete(
        {
          task: snapshot,
          prompt: '帮我学习',
          skill: { name: 'learning', version: '1', instructions: '帮助学习', qualityGates: [] },
          observations: [],
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual(response)
  })

  it.each<[ModelProviderErrorCode, string]>([
    ['authentication', '小宝暂时无法连接模型服务，请联系老师或管理员检查设置。'],
    ['rate_limit', '小宝正在稍作休息，请稍后再试。'],
    ['unavailable', '模型服务暂时不可用，请稍后再试。'],
    ['timeout', '等待模型回复超时，请稍后再试。'],
    ['invalid_response', '模型回复格式有问题，请稍后再试。'],
  ])('maps the %s provider failure to a safe child-friendly message', (code, message) => {
    const error = new ModelProviderError(code)

    expect(error).toMatchObject({ code, message })
    expect(error.message).not.toContain('Authorization')
    expect(error.message).not.toContain('Bearer')
  })
})
