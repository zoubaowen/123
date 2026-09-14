import { describe, expect, it, vi } from 'vitest'
import {
  BudgetedUsageProvider,
  createCompositeBudgetPolicy,
  createUserBudgetCapReader,
  XIAOBAO_BUDGET_EXHAUSTED_REASON,
} from '../budget-policy.js'
import type { UsageProvider, UsageReservationResult } from '../ports.js'

const reservation = { taskId: 'task-1', userId: 'student-a', category: 'model' as const, units: 100 }

type CapRow = { xiaobaoCreditLimit?: number | null } | null

function sourceOf(row: CapRow, findById?: (id: string) => Promise<CapRow>) {
  return { findById: vi.fn(findById ?? (async () => row)) }
}

function innerProvider(result: UsageReservationResult = { allowed: true, reservationId: 'r-1' }) {
  return {
    reserve: vi.fn(async () => result),
    record: vi.fn(async () => undefined),
  } satisfies UsageProvider
}

function providerFor(capReader: ReturnType<typeof createUserBudgetCapReader>, settled: number | null) {
  const inner = innerProvider()
  const policy = createCompositeBudgetPolicy(capReader, null)
  const usage = { settledCreditsFor: vi.fn(async () => settled) }
  return { inner, provider: new BudgetedUsageProvider(inner, policy, usage) }
}

describe('createUserBudgetCapReader', () => {
  it('reads the per-student cap that is stored on the user row', async () => {
    const reader = createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: 80 }))

    await expect(reader.readCreditLimit('student-a')).resolves.toBe(80)
  })

  it('treats an explicitly null cap as no cap configured', async () => {
    const reader = createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: null }))

    await expect(reader.readCreditLimit('student-a')).resolves.toBeNull()
  })

  it('treats a row written before the column existed as no cap configured', async () => {
    // Documents created earlier simply lack the field.
    const reader = createUserBudgetCapReader(sourceOf({}))

    await expect(reader.readCreditLimit('student-a')).resolves.toBeNull()
  })

  it('fails closed when the student record cannot be found', async () => {
    const reader = createUserBudgetCapReader(sourceOf(null))

    await expect(reader.readCreditLimit('student-a')).rejects.toThrow()
  })

  it('fails closed on a stored cap that is not a positive whole number', async () => {
    for (const stored of [0, -5, 12.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const reader = createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: stored }))

      await expect(reader.readCreditLimit('student-a')).rejects.toThrow()
    }
  })

  it('propagates a repository failure instead of reporting "no cap"', async () => {
    const reader = createUserBudgetCapReader(
      sourceOf(null, async () => {
        throw new Error('users down')
      }),
    )

    await expect(reader.readCreditLimit('student-a')).rejects.toThrow('users down')
  })
})

describe('database cap composed with the environment fallback', () => {
  const environment = { defaultCredits: 50, perUserCredits: new Map([['student-a', 10]]) }

  it('lets the database cap win over both the per-student and the default environment cap', async () => {
    const policy = createCompositeBudgetPolicy(
      createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: 7 })),
      environment,
    )

    await expect(policy.limitFor('student-a')).resolves.toBe(7)
  })

  it('falls back to the environment when the student has no stored cap', async () => {
    const policy = createCompositeBudgetPolicy(
      createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: null })),
      environment,
    )

    await expect(policy.limitFor('student-a')).resolves.toBe(10)
    await expect(policy.limitFor('student-b')).resolves.toBe(50)
  })

  it('enforces a cap that only exists in the database when no environment cap is configured', async () => {
    const { inner, provider } = providerFor(createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: 30 })), 30)

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it('still allows the task while the student is below the stored cap', async () => {
    const { inner, provider } = providerFor(createUserBudgetCapReader(sourceOf({ xiaobaoCreditLimit: 30 })), 29)

    await expect(provider.reserve(reservation)).resolves.toEqual({ allowed: true, reservationId: 'r-1' })
    expect(inner.reserve).toHaveBeenCalledTimes(1)
  })

  it('denies the next task when the stored cap query fails', async () => {
    const failing = createUserBudgetCapReader(
      sourceOf(null, async () => {
        throw new Error('users down')
      }),
    )
    const { inner, provider } = providerFor(failing, 0)

    await expect(provider.reserve(reservation)).resolves.toEqual({
      allowed: false,
      reason: XIAOBAO_BUDGET_EXHAUSTED_REASON,
    })
    expect(inner.reserve).not.toHaveBeenCalled()
  })
})
