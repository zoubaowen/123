import { afterEach, describe, expect, it, vi } from 'vitest'
import { canAccessXiaobaoRollout, isXiaobaoRolloutUser, type XiaobaoRolloutDatabase } from '../rollout.js'

interface DatabaseOptions {
  readonly role?: string
  /** null 表示用户不存在 */
  readonly status?: string | null
  readonly userThrows?: boolean
  readonly taskOwned?: boolean
  readonly taskThrows?: boolean
}

function createDatabase(options: DatabaseOptions = {}) {
  const findById = vi.fn(async () => {
    if (options.userThrows) throw new Error('unavailable')
    if (options.status === null) return null
    return { role: options.role ?? 'user', status: options.status ?? 'active' }
  })
  const findByIdAndUserId = vi.fn(async (taskId: string, userId: string) => {
    if (options.taskThrows) throw new Error('unavailable')
    return options.taskOwned === false ? null : { id: taskId, userId }
  })
  return {
    database: { users: { findById }, tasks: { findByIdAndUserId } } as unknown as XiaobaoRolloutDatabase,
    findById,
    findByIdAndUserId,
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isXiaobaoRolloutUser', () => {
  it('allows an active user whose id is in the user allowlist', async () => {
    const { database } = createDatabase()

    await expect(
      isXiaobaoRolloutUser({
        userId: 'student-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1,student-2' },
      }),
    ).resolves.toBe(true)
  })

  it('denies an active user outside the allowlist', async () => {
    const { database } = createDatabase()

    await expect(
      isXiaobaoRolloutUser({
        userId: 'student-3',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1,student-2' },
      }),
    ).resolves.toBe(false)
  })

  it('allows an admin without any allowlist entry', async () => {
    const { database } = createDatabase({ role: 'admin' })

    await expect(isXiaobaoRolloutUser({ userId: 'admin-1', database, environment: {} })).resolves.toBe(true)
  })

  it('denies a disabled user even when allowlisted or admin', async () => {
    const allowlisted = createDatabase({ status: 'disabled', userThrows: false })
    await expect(
      isXiaobaoRolloutUser({
        userId: 'student-1',
        database: allowlisted.database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(false)

    const disabledAdmin = createDatabase({ role: 'admin', status: 'disabled' })
    await expect(
      isXiaobaoRolloutUser({ userId: 'admin-1', database: disabledAdmin.database, environment: {} }),
    ).resolves.toBe(false)
  })

  it('denies a missing user', async () => {
    const { database } = createDatabase({ status: null })

    await expect(
      isXiaobaoRolloutUser({
        userId: 'student-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(false)
  })

  it.each([undefined, '', ',', ' , ', '   '])('denies when the allowlist is %j', async (allowlist) => {
    const { database } = createDatabase()

    await expect(
      isXiaobaoRolloutUser({ userId: 'student-1', database, environment: { XIAOBAO_TEST_USER_IDS: allowlist } }),
    ).resolves.toBe(false)
  })

  it('prefers the passed environment over process.env', async () => {
    vi.stubEnv('XIAOBAO_TEST_USER_IDS', 'other-user')
    const { database } = createDatabase()

    await expect(
      isXiaobaoRolloutUser({ userId: 'student-1', database, environment: { XIAOBAO_TEST_USER_IDS: 'student-1' } }),
    ).resolves.toBe(true)
    await expect(isXiaobaoRolloutUser({ userId: 'student-1', database, environment: {} })).resolves.toBe(false)
  })

  it('denies when the user lookup throws', async () => {
    const { database } = createDatabase({ userThrows: true })

    await expect(
      isXiaobaoRolloutUser({
        userId: 'student-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(false)
  })
})

describe('canAccessXiaobaoRollout', () => {
  it('always allows a runtime other than xiaobao without reading the user', async () => {
    const { database, findById } = createDatabase({ status: null })

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'codebuddy',
        userId: 'student-1',
        taskId: 'task-1',
        database,
        environment: {},
      }),
    ).resolves.toBe(true)
    expect(findById).not.toHaveBeenCalled()
  })

  it('allows an admin', async () => {
    const { database } = createDatabase({ role: 'admin' })

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'admin-1',
        taskId: 'task-1',
        database,
        environment: {},
      }),
    ).resolves.toBe(true)
  })

  it('allows a user-level allowlist entry once task ownership is proven', async () => {
    const { database, findByIdAndUserId } = createDatabase()

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'student-1',
        taskId: 'task-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(true)
    expect(findByIdAndUserId).toHaveBeenCalledWith('task-1', 'student-1')
  })

  it('denies a user-level allowlist entry when the task belongs to someone else', async () => {
    const { database } = createDatabase({ taskOwned: false })

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'student-1',
        taskId: 'task-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(false)
  })

  it('keeps the existing task-level allowlist semantics', async () => {
    const { database } = createDatabase()

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'student-1',
        taskId: 'task-9',
        database,
        environment: { XIAOBAO_TEST_TASK_IDS: 'task-9' },
      }),
    ).resolves.toBe(true)
  })

  it('denies when neither allowlist matches', async () => {
    const { database } = createDatabase()

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'student-1',
        taskId: 'task-1',
        database,
        environment: { XIAOBAO_TEST_TASK_IDS: 'task-9', XIAOBAO_TEST_USER_IDS: 'student-2' },
      }),
    ).resolves.toBe(false)
  })

  it('denies when the task ownership check throws', async () => {
    const { database } = createDatabase({ taskThrows: true })

    await expect(
      canAccessXiaobaoRollout({
        runtimeName: 'xiaobao',
        userId: 'student-1',
        taskId: 'task-1',
        database,
        environment: { XIAOBAO_TEST_USER_IDS: 'student-1' },
      }),
    ).resolves.toBe(false)
  })
})
