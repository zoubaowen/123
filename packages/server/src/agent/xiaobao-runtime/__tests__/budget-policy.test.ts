import { describe, expect, it, vi } from 'vitest'
import {
  BudgetedUsageProvider,
  budgetConfigurationIsInvalid,
  createCompositeBudgetPolicy,
  createEnvironmentBudgetPolicy,
  createLayeredBudgetPolicy,
  loadBudgetEnvironment,
  XIAOBAO_BUDGET_EXHAUSTED_REASON,
  type XiaobaoBudgetPolicy,
  type XiaobaoBudgetUsage,
} from '../budget-policy.js'
import type { UsageProvider, UsageReservationResult } from '../ports.js'

const reservation = { taskId: 'task-1', userId: 'user-1', category: 'model' as const, units: 100 }

function innerProvider(result: UsageReservationResult = { allowed: true, reservationId: 'r-1' }) {
  return {
    reserve: vi.fn(async () => result),
    record: vi.fn(async () => undefined),
  } satisfies UsageProvider
}

function harness(options: { limit: number | null | Error; settled: number | null | Error }) {
  const inner = innerProvider()
  const policy: XiaobaoBudgetPolicy = {
    limitFor: vi.fn(async () => {
      if (options.limit instanceof Error) throw options.limit
      return options.limit
    }),
  }
  const usage: XiaobaoBudgetUsage = {
    settledCreditsFor: vi.fn(async () => {
      if (options.settled instanceof Error) throw options.settled
      return options.settled
    }),
  }
  return { inner, provider: new BudgetedUsageProvider(inner, policy, usage) }
}

describe('loadBudgetEnvironment', () => {
  it('returns null and reports nothing invalid when budgeting is not configured', () => {
    expect(loadBudgetEnvironment({})).toBeNull()
    expect(budgetConfigurationIsInvalid({})).toBe(false)
    expect(loadBudgetEnvironment({ XIAOBAO_BUDGET_DEFAULT_CREDITS: '', XIAOBAO_BUDGET_USER_CREDITS: '  ' })).toBeNull()
    expect(
      budgetConfigurationIsInvalid({ XIAOBAO_BUDGET_DEFAULT_CREDITS: '', XIAOBAO_BUDGET_USER_CREDITS: '  ' }),
    ).toBe(false)
  })

  it('reads a default cap only, a per-user cap only, or both', () => {
    expect(loadBudgetEnvironment({ XIAOBAO_BUDGET_DEFAULT_CREDITS: '50' })).toEqual({
      defaultCredits: 50,
      perUserCredits: new Map(),
    })

    const perUser = loadBudgetEnvironment({ XIAOBAO_BUDGET_USER_CREDITS: 'user-a=10,user-b=20' })
    expect(perUser?.defaultCredits).toBeNull()
    expect([...(perUser?.perUserCredits ?? [])]).toEqual([
      ['user-a', 10],
      ['user-b', 20],
    ])

    expect(
      loadBudgetEnvironment({ XIAOBAO_BUDGET_DEFAULT_CREDITS: '50', XIAOBAO_BUDGET_USER_CREDITS: 'user-a=10' }),
    ).toMatchObject({ defaultCredits: 50 })
  })

  it.each([
    ['missing separator', { XIAOBAO_BUDGET_USER_CREDITS: 'user-a' }],
    ['empty user id', { XIAOBAO_BUDGET_USER_CREDITS: '=10' }],
    ['non-numeric credits', { XIAOBAO_BUDGET_USER_CREDITS: 'user-a=ten' }],
    ['zero credits', { XIAOBAO_BUDGET_USER_CREDITS: 'user-a=0' }],
    ['negative credits', { XIAOBAO_BUDGET_USER_CREDITS: 'user-a=-5' }],
    ['fractional default', { XIAOBAO_BUDGET_DEFAULT_CREDITS: '1.5' }],
    ['non-numeric default', { XIAOBAO_BUDGET_DEFAULT_CREDITS: 'abc' }],
  ])('treats %s as invalid configuration', (_case, environment) => {
    expect(loadBudgetEnvironment(environment)).toBeNull()
    expect(budgetConfigurationIsInvalid(environment)).toBe(true)
  })

  it('tolerates whitespace around entries', () => {
    const parsed = loadBudgetEnvironment({ XIAOBAO_BUDGET_USER_CREDITS: ' user-a = 10 , user-b=20 ,' })

    expect([...(parsed?.perUserCredits ?? [])]).toEqual([
      ['user-a', 10],
      ['user-b', 20],
    ])
  })
})

describe('createEnvironmentBudgetPolicy', () => {
  const policy = createEnvironmentBudgetPolicy({
    defaultCredits: 50,
    perUserCredits: new Map([['user-a', 5]]),
  })

  it('prefers the per-user cap and falls back to the default', async () => {
    await expect(policy.limitFor('user-a')).resolves.toBe(5)
    await expect(policy.limitFor('user-b')).resolves.toBe(50)
  })

  it('returns null when no cap applies', async () => {
    const withoutDefault = createEnvironmentBudgetPolicy({ defaultCredits: null, perUserCredits: new Map() })

    await expect(withoutDefault.limitFor('user-a')).resolves.toBeNull()
  })
})

describe('createCompositeBudgetPolicy', () => {
  const reader = (limit: number | null | Error) => ({
    readCreditLimit: vi.fn(async () => {
      if (limit instanceof Error) throw limit
      return limit
    }),
  })

  it('prefers the per-student database cap over the environment', async () => {
    const policy = createCompositeBudgetPolicy(reader(7), {
      defaultCredits: 100,
      perUserCredits: new Map([['user-a', 5]]),
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(7)
  })

  it('falls back to the environment when the database has no per-student cap', async () => {
    const policy = createCompositeBudgetPolicy(reader(null), {
      defaultCredits: 100,
      perUserCredits: new Map([['user-a', 5]]),
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(5)
    await expect(policy.limitFor('user-b')).resolves.toBe(100)
  })

  it('applies a database-only cap even when no environment budget is configured', async () => {
    const policy = createCompositeBudgetPolicy(reader(9), null)

    await expect(policy.limitFor('user-a')).resolves.toBe(9)
  })

  it('does not limit when neither source provides a cap', async () => {
    const policy = createCompositeBudgetPolicy(reader(null), null)

    await expect(policy.limitFor('user-a')).resolves.toBeNull()
  })

  it('propagates a lookup failure so the decorator can fail closed', async () => {
    const policy = createCompositeBudgetPolicy(reader(new Error('users down')), null)

    await expect(policy.limitFor('user-a')).rejects.toThrow('users down')
    const { provider } = harness({ limit: null, settled: 0 })
    expect(provider).toBeDefined()
  })
})

describe('BudgetedUsageProvider', () => {
  it('delegates untouched when the student has no cap', async () => {
    const { inner, provider } = harness({ limit: null, settled: 999 })

    await expect(provider.reserve(reservation)).resolves.toEqual({ allowed: true, reservationId: 'r-1' })
    expect(inner.reserve).toHaveBeenCalledOnce()
  })

  it('delegates while the student is still under the cap', async () => {
    const { inner, provider } = harness({ limit: 50, settled: 49 })

    await expect(provider.reserve(reservation)).resolves.toMatchObject({ allowed: true })
    expect(inner.reserve).toHaveBeenCalledOnce()
  })

  it.each([
    ['exactly at the cap', 50],
    ['above the cap', 51],
  ])('denies a new task when settled credits are %s', async (_case, settled) => {
    const { inner, provider } = harness({ limit: 50, settled })

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it('denies instead of assuming zero when usage cannot be determined', async () => {
    const { inner, provider } = harness({ limit: 50, settled: null })

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it.each([
    ['the usage lookup throws', { limit: 50, settled: new Error('ledger down') }],
    ['the policy lookup throws', { limit: new Error('policy down'), settled: 0 }],
  ])('fails closed when %s', async (_case, options) => {
    const { inner, provider } = harness(options)

    const outcome = await provider.reserve(reservation)

    expect(outcome).toEqual({ allowed: false, reason: XIAOBAO_BUDGET_EXHAUSTED_REASON })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it('never leaks dynamic values in the denial reason', async () => {
    const { provider } = harness({ limit: 50, settled: 50 })

    const outcome = await provider.reserve({ ...reservation, userId: 'student-secret-id' })

    expect(outcome.allowed).toBe(false)
    if (!outcome.allowed) {
      expect(outcome.reason).toBe(XIAOBAO_BUDGET_EXHAUSTED_REASON)
      expect(outcome.reason).not.toContain('student-secret-id')
      expect(outcome.reason).not.toContain('50')
    }
  })

  it('always forwards usage records to the inner provider', async () => {
    const { inner, provider } = harness({ limit: 50, settled: 500 })

    await provider.record({ taskId: 'task-1', reservationId: 'r-1', category: 'model', units: 10 })

    expect(inner.record).toHaveBeenCalledWith({
      taskId: 'task-1',
      reservationId: 'r-1',
      category: 'model',
      units: 10,
    })
  })
})

describe('createLayeredBudgetPolicy', () => {
  const personalCap = (limit: number | null | Error) => ({
    readCreditLimit: vi.fn(async () => {
      if (limit instanceof Error) throw limit
      return limit
    }),
  })

  const personalUsage = (settled: number | null | Error) => ({
    settledCreditsFor: vi.fn(async () => {
      if (settled instanceof Error) throw settled
      return settled
    }),
  })

  const classBudget = (value: { limit: number; settledCredits: number | null } | null | Error) => ({
    readClassBudget: vi.fn(async () => {
      if (value instanceof Error) throw value
      return value
    }),
  })

  it('prefers the per-student cap and its personal usage over the class budget', async () => {
    const usage = personalUsage(10)
    const reader = classBudget({ limit: 500, settledCredits: 400 })
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(20),
      personalUsage: usage,
      classBudgetReader: reader,
      environment: { defaultCredits: 999, perUserCredits: new Map() },
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(20)
    await expect(policy.settledCreditsFor!('user-a')).resolves.toBe(10)
    // 学生个人上限已经生效，就不该再去查班级额度
    expect(reader.readClassBudget).not.toHaveBeenCalled()
  })

  it('uses the class total — not the single student usage — when the class cap governs', async () => {
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: personalUsage(3),
      classBudgetReader: classBudget({ limit: 100, settledCredits: 40 }),
      environment: { defaultCredits: 999, perUserCredits: new Map() },
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(100)
    // 关键：班级共享额度必须拿全班合计比较，用学生自己的 3 点会把班级上限错当成个人上限
    await expect(policy.settledCreditsFor!('user-a')).resolves.toBe(40)
  })

  it('passes an undetermined class total through as null so the decorator fails closed', async () => {
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: personalUsage(3),
      classBudgetReader: classBudget({ limit: 100, settledCredits: null }),
      environment: null,
    })

    await expect(policy.settledCreditsFor!('user-a')).resolves.toBeNull()
  })

  it('falls back to the environment when neither the student nor the class has a cap', async () => {
    const usage = personalUsage(7)
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: usage,
      classBudgetReader: classBudget(null),
      environment: { defaultCredits: 50, perUserCredits: new Map([['user-a', 11]]) },
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(11)
    await expect(policy.limitFor('user-b')).resolves.toBe(50)
    // 环境上限是学生口径，已用额度用学生个人用量
    await expect(policy.settledCreditsFor!('user-a')).resolves.toBe(7)
  })

  it('reports no limit and reads no usage when nothing is configured', async () => {
    const usage = personalUsage(7)
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: usage,
      environment: null,
    })

    await expect(policy.limitFor('user-a')).resolves.toBeNull()
    await expect(policy.settledCreditsFor!('user-a')).resolves.toBeNull()
    expect(usage.settledCreditsFor).not.toHaveBeenCalled()
  })

  it('skips the class layer entirely when no class reader is configured', async () => {
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: personalUsage(1),
      environment: { defaultCredits: 50, perUserCredits: new Map() },
    })

    await expect(policy.limitFor('user-a')).resolves.toBe(50)
  })

  it('propagates a class budget failure so the decorator can fail closed', async () => {
    const policy = createLayeredBudgetPolicy({
      personalCapReader: personalCap(null),
      personalUsage: personalUsage(1),
      classBudgetReader: classBudget(new Error('classes down')),
      environment: { defaultCredits: 50, perUserCredits: new Map() },
    })

    await expect(policy.limitFor('user-a')).rejects.toThrow('classes down')
  })
})

describe('BudgetedUsageProvider with a scope-aware policy', () => {
  it('denies a new task when the whole-class total has reached the class cap', async () => {
    const inner = innerProvider()
    const policy = createLayeredBudgetPolicy({
      personalCapReader: { readCreditLimit: vi.fn(async () => null) },
      personalUsage: { settledCreditsFor: vi.fn(async () => 5) },
      classBudgetReader: { readClassBudget: vi.fn(async () => ({ limit: 100, settledCredits: 100 })) },
      environment: null,
    })
    const provider = new BudgetedUsageProvider(inner, policy, { settledCreditsFor: vi.fn(async () => 5) })

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it('keeps using the injected usage source when the policy has no scope-aware lookup', async () => {
    // 回归保护：第 63/64 轮的组合策略不提供 settledCreditsFor，行为必须与今天一致
    const { inner, provider } = harness({ limit: 50, settled: 50 })

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })
})
