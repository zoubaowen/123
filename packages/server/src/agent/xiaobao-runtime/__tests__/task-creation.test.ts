import { describe, expect, it, vi } from 'vitest'
import type { XiaobaoClassCapabilityState } from '../class-session-gate.js'
import type { XiaobaoRolloutDatabase } from '../rollout.js'
import { resolveXiaobaoTaskCreation } from '../task-creation.js'

function createDatabase(options: { role?: string; status?: string | null; userThrows?: boolean } = {}) {
  const findById = vi.fn(async () => {
    if (options.userThrows) throw new Error('unavailable')
    if (options.status === null) return null
    return { role: options.role ?? 'user', status: options.status ?? 'active' }
  })
  return {
    database: {
      users: { findById },
      tasks: { findByIdAndUserId: vi.fn(async () => null) },
    } as unknown as XiaobaoRolloutDatabase,
    findById,
  }
}

const environment = { XIAOBAO_TEST_USER_IDS: 'student-1' }

describe('resolveXiaobaoTaskCreation', () => {
  it('accepts an allowlisted user creating a xiaobao task with a capability', async () => {
    const { database } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: true, capability: 'learning' })
  })

  it.each(['writing', 'learning', 'game'] as const)('accepts the supported capability %s', async (capability) => {
    const { database } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: capability,
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: true, capability })
  })

  it('rejects a xiaobao task for a user outside the rollout', async () => {
    const { database } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'xiaobao',
        userId: 'student-9',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: false, status: 403, error: 'Xiaobao runtime is restricted' })
  })

  it('rejects a xiaobao task when the user is missing, disabled, or the lookup fails', async () => {
    const missing = createDatabase({ status: null })
    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database: missing.database,
        environment,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })

    const disabled = createDatabase({ status: 'disabled' })
    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database: disabled.database,
        environment,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })

    const failing = createDatabase({ userThrows: true })
    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database: failing.database,
        environment,
      }),
    ).resolves.toMatchObject({ ok: false, status: 403 })
  })

  it.each(['study', 'image', 'video', 'music', 'random-string', 42, {}])(
    'rejects the invalid capability %j with a 400',
    async (rawCapability) => {
      const { database, findById } = createDatabase()

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability,
          selectedRuntime: 'xiaobao',
          userId: 'student-1',
          database,
          environment,
        }),
      ).resolves.toEqual({ ok: false, status: 400, error: 'Invalid XiaoBao capability' })
      // 非法能力必须在读用户之前就被拒绝。
      expect(findById).not.toHaveBeenCalled()
    },
  )

  it('rejects a capability that is valid but not paired with the xiaobao runtime', async () => {
    const { database, findById } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: 'learning',
        selectedRuntime: 'codebuddy',
        userId: 'student-1',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: false, status: 400, error: 'Invalid XiaoBao capability' })
    expect(findById).not.toHaveBeenCalled()
  })

  it('passes through a request without runtime or capability unchanged', async () => {
    const { database, findById } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: undefined,
        selectedRuntime: undefined,
        userId: 'student-9',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: true, capability: null })
    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: null,
        selectedRuntime: 'opencode-acp',
        userId: 'student-9',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: true, capability: null })
    // 非小宝路径不得触发灰度查询。
    expect(findById).not.toHaveBeenCalled()
  })

  it('allows an eligible user to request the xiaobao runtime without a capability yet', async () => {
    const { database } = createDatabase()

    await expect(
      resolveXiaobaoTaskCreation({
        rawCapability: undefined,
        selectedRuntime: 'xiaobao',
        userId: 'student-1',
        database,
        environment,
      }),
    ).resolves.toEqual({ ok: true, capability: null })
  })

  describe('class session gate', () => {
    function createGate(state: XiaobaoClassCapabilityState) {
      const resolveForStudent = vi.fn(async () => state)
      return { gate: { resolveForStudent }, resolveForStudent }
    }

    it('allows a capability the running class opened', async () => {
      const { database } = createDatabase()
      const { gate } = createGate({ mode: 'class_only', inSession: true, capabilities: ['writing'] })

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability: 'writing',
          selectedRuntime: 'xiaobao',
          userId: 'student-1',
          database,
          environment,
          classSessionGate: gate,
        }),
      ).resolves.toEqual({ ok: true, capability: 'writing' })
    })

    it('rejects a capability this lesson did not open', async () => {
      const { database } = createDatabase()
      const { gate } = createGate({ mode: 'class_only', inSession: true, capabilities: ['writing'] })

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability: 'learning',
          selectedRuntime: 'xiaobao',
          userId: 'student-1',
          database,
          environment,
          classSessionGate: gate,
        }),
      ).resolves.toEqual({ ok: false, status: 403, error: '本节课没有开放这个能力' })
    })

    it('rejects any xiaobao use outside class time for a class_only student', async () => {
      const { database } = createDatabase()
      const { gate } = createGate({ mode: 'class_only', inSession: false, capabilities: [] })

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability: 'writing',
          selectedRuntime: 'xiaobao',
          userId: 'student-1',
          database,
          environment,
          classSessionGate: gate,
        }),
      ).resolves.toEqual({ ok: false, status: 403, error: '本节课还没有开始，暂时不能使用小宝' })
    })

    it('keeps an anytime student unrestricted even without a running class', async () => {
      const { database } = createDatabase()
      const { gate, resolveForStudent } = createGate({ mode: 'unrestricted' })

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability: 'game',
          selectedRuntime: 'xiaobao',
          userId: 'student-1',
          database,
          environment,
          classSessionGate: gate,
        }),
      ).resolves.toEqual({ ok: true, capability: 'game' })
      expect(resolveForStudent).toHaveBeenCalledWith('student-1')
    })

    it('never consults the gate for a non-xiaobao runtime', async () => {
      const { database } = createDatabase()
      const { gate, resolveForStudent } = createGate({ mode: 'class_only', inSession: false, capabilities: [] })

      await expect(
        resolveXiaobaoTaskCreation({
          rawCapability: undefined,
          selectedRuntime: 'opencode-acp',
          userId: 'student-1',
          database,
          environment,
          classSessionGate: gate,
        }),
      ).resolves.toEqual({ ok: true, capability: null })
      expect(resolveForStudent).not.toHaveBeenCalled()
    })
  })
})
