import { describe, expect, it, vi } from 'vitest'
import { createDatabaseClassBudgetReader } from '../class-budget-reader.js'
import { BudgetedUsageProvider, createLayeredBudgetPolicy, XIAOBAO_BUDGET_EXHAUSTED_REASON } from '../budget-policy.js'

interface ClassRow {
  id: string
  xiaobaoCreditLimit?: number | null
}

interface SourceOptions {
  classes?: ClassRow[] | null | Error
  students?: string[] | null | Error
  settled?: number | null | Error
}

function sourceOf(options: SourceOptions) {
  return {
    listActiveClassesForStudent: vi.fn(async () => {
      if (options.classes instanceof Error) throw options.classes
      return options.classes === undefined ? [] : options.classes
    }),
    listActiveStudentIds: vi.fn(async () => {
      if (options.students instanceof Error) throw options.students
      return options.students === undefined ? [] : options.students
    }),
    sumSettledCreditsByUsers: vi.fn(async () => {
      if (options.settled instanceof Error) throw options.settled
      return options.settled === undefined ? 0 : options.settled
    }),
  }
}

describe('createDatabaseClassBudgetReader', () => {
  it('returns null when the student is in no capped class', async () => {
    const withoutCap = createDatabaseClassBudgetReader(sourceOf({ classes: [{ id: 'c1', xiaobaoCreditLimit: null }] }))
    await expect(withoutCap.readClassBudget('student-1')).resolves.toBeNull()

    const noClass = createDatabaseClassBudgetReader(sourceOf({ classes: [] }))
    await expect(noClass.readClassBudget('student-1')).resolves.toBeNull()
  })

  it('reads the class cap together with the whole-class settled total', async () => {
    const source = sourceOf({
      classes: [{ id: 'c1', xiaobaoCreditLimit: 300 }],
      students: ['student-1', 'student-2'],
      settled: 120,
    })
    const reader = createDatabaseClassBudgetReader(source)

    await expect(reader.readClassBudget('student-1')).resolves.toEqual({ limit: 300, settledCredits: 120 })
    expect(source.listActiveStudentIds).toHaveBeenCalledWith('c1')
    expect(source.sumSettledCreditsByUsers).toHaveBeenCalledWith(['student-1', 'student-2'], null)
  })

  it('picks the most restrictive cap when the student is in several capped classes', async () => {
    const source = sourceOf({
      classes: [
        { id: 'c-big', xiaobaoCreditLimit: 500 },
        { id: 'c-small', xiaobaoCreditLimit: 100 },
        { id: 'c-none', xiaobaoCreditLimit: null },
      ],
      students: ['student-1'],
      settled: 10,
    })
    const reader = createDatabaseClassBudgetReader(source)

    await expect(reader.readClassBudget('student-1')).resolves.toMatchObject({ limit: 100 })
    // 必须用被选中那个班的全班合计，否则上限与用量口径不一致
    expect(source.listActiveStudentIds).toHaveBeenCalledWith('c-small')
  })

  it('breaks equal-cap ties deterministically by class id', async () => {
    const source = sourceOf({
      classes: [
        { id: 'c-b', xiaobaoCreditLimit: 100 },
        { id: 'c-a', xiaobaoCreditLimit: 100 },
      ],
      students: ['student-1'],
      settled: 1,
    })

    await createDatabaseClassBudgetReader(source).readClassBudget('student-1')

    expect(source.listActiveStudentIds).toHaveBeenCalledWith('c-a')
  })

  it('fails closed when the class list or the roster cannot be determined', async () => {
    await expect(createDatabaseClassBudgetReader(sourceOf({ classes: null })).readClassBudget('s')).rejects.toThrow()

    await expect(
      createDatabaseClassBudgetReader(
        sourceOf({ classes: [{ id: 'c1', xiaobaoCreditLimit: 100 }], students: null }),
      ).readClassBudget('s'),
    ).rejects.toThrow()
  })

  it('fails closed on a stored cap that is not a positive whole number', async () => {
    for (const stored of [0, -5, 12.5]) {
      const reader = createDatabaseClassBudgetReader(sourceOf({ classes: [{ id: 'c1', xiaobaoCreditLimit: stored }] }))
      await expect(reader.readClassBudget('student-1')).rejects.toThrow()
    }
  })

  it('passes an undetermined class total through, and the decorator then denies the task', async () => {
    const source = sourceOf({
      classes: [{ id: 'c1', xiaobaoCreditLimit: 100 }],
      students: ['student-1'],
      settled: null,
    })
    const reader = createDatabaseClassBudgetReader(source)

    await expect(reader.readClassBudget('student-1')).resolves.toEqual({ limit: 100, settledCredits: null })

    // 与生产装配相同的组合：不确定的全班合计必须导致拒绝，绝不能放行
    const policy = createLayeredBudgetPolicy({
      personalCapReader: { readCreditLimit: async () => null },
      personalUsage: { settledCreditsFor: async () => 0 },
      classBudgetReader: reader,
      environment: null,
    })
    const inner = {
      reserve: vi.fn(async () => ({ allowed: true as const, reservationId: 'r-1' })),
      record: vi.fn(async () => undefined),
    }
    const provider = new BudgetedUsageProvider(inner, policy, { settledCreditsFor: async () => 0 })

    await expect(
      provider.reserve({ taskId: 't1', userId: 'student-1', category: 'model', units: 10 }),
    ).resolves.toEqual({ allowed: false, reason: XIAOBAO_BUDGET_EXHAUSTED_REASON })
    expect(inner.reserve).not.toHaveBeenCalled()
  })

  it('denies once the whole-class total reaches the class cap even though this student barely used it', async () => {
    // 这个学生自己只用了 1 点，但全班已用 100/100：班级共享额度必须拦住他
    const source = sourceOf({
      classes: [{ id: 'c1', xiaobaoCreditLimit: 100 }],
      students: ['student-1', 'student-2'],
      settled: 100,
    })
    const policy = createLayeredBudgetPolicy({
      personalCapReader: { readCreditLimit: async () => null },
      personalUsage: { settledCreditsFor: async () => 1 },
      classBudgetReader: createDatabaseClassBudgetReader(source),
      environment: null,
    })
    const inner = {
      reserve: vi.fn(async () => ({ allowed: true as const, reservationId: 'r-1' })),
      record: vi.fn(async () => undefined),
    }
    const provider = new BudgetedUsageProvider(inner, policy, { settledCreditsFor: async () => 1 })

    await expect(
      provider.reserve({ taskId: 't1', userId: 'student-1', category: 'model', units: 10 }),
    ).resolves.toEqual({ allowed: false, reason: XIAOBAO_BUDGET_EXHAUSTED_REASON })
    expect(inner.reserve).not.toHaveBeenCalled()
  })
})
