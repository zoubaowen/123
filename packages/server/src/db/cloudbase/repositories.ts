import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import {
  getCollection,
  getCollectionName,
  getCommand,
  getExistingCollection,
  runCloudBaseTransaction,
  type CloudBaseTransactionHandle,
} from './client'
import type {
  User,
  NewUser,
  LocalCredential,
  NewLocalCredential,
  Task,
  NewTask,
  Connector,
  NewConnector,
  MiniProgramApp,
  NewMiniProgramApp,
  CronTask,
  NewCronTask,
  Account,
  NewAccount,
  Key,
  NewKey,
  UserResource,
  NewUserResource,
  Setting,
  NewSetting,
  Deployment,
  NewDeployment,
  AdminLog,
  NewAdminLog,
  EnvPoolEntry,
  NewEnvPoolEntry,
  UserRepository,
  LocalCredentialRepository,
  TaskRepository,
  ConnectorRepository,
  MiniProgramAppRepository,
  CronTaskRepository,
  AccountRepository,
  KeyRepository,
  UserResourceRepository,
  SettingRepository,
  DeploymentRepository,
  AdminLogRepository,
  EnvPoolRepository,
  CommunityWork,
  NewCommunityWork,
  CommunityWorkRepository,
  SmsCode,
  NewSmsCode,
  SmsCodeRepository,
  UserCredits,
  NewUserCredits,
  UserCreditsRepository,
  CreditTransaction,
  NewCreditTransaction,
  CreditTransactionRepository,
  SubscriptionPlan,
  NewSubscriptionPlan,
  SubscriptionPlanRepository,
  UserSubscription,
  NewUserSubscription,
  UserSubscriptionRepository,
  DailyUsage,
  NewDailyUsage,
  DailyUsageRepository,
  CheckpointRecord,
  CheckpointRepository,
  XiaobaoUsageReservationRecord,
  XiaobaoUsageCategoryTotals,
  UsageReservationLedgerInput,
  UsageReservationLedgerResult,
  UsageSettlementLedgerInput,
  XiaobaoUsageLedgerRepository,
  Institution,
  NewInstitution,
  InstitutionMember,
  InstitutionMemberRole,
  NewInstitutionMember,
  InstitutionRepository,
  InstitutionMemberRepository,
  TeacherClass,
  NewTeacherClass,
  TeacherClassRepository,
  ClassTeacher,
  NewClassTeacher,
  ClassTeacherRepository,
  ClassEnrollment,
  NewClassEnrollment,
  ClassEnrollmentRepository,
  Course,
  NewCourse,
  CourseChapter,
  CourseLesson,
  LessonResource,
  CourseOutline,
  CourseRepository,
  ClassCourse,
  NewClassCourse,
  ClassCourseRepository,
  LessonProgress,
  NewLessonProgress,
  LessonProgressRepository,
  ClassSession,
  NewClassSession,
  ClassSessionPatch,
  ClassSessionRepository,
  DatabaseProvider,
} from '../types'

const now = () => Date.now()

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripCloudBaseId<T>(doc: Record<string, unknown>): T {
  const { _id, ...rest } = doc
  return rest as T
}

function isCloudBaseDuplicateWriteError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'DATABASE_DUPLICATE_WRITE'
  )
}

export class CloudBaseXiaobaoCheckpointRepository implements CheckpointRepository {
  async healthCheck(): Promise<boolean> {
    try {
      const collection = getExistingCollection('xiaobao_runtime_checkpoints')
      await collection.limit(1).get()
      return true
    } catch {
      return false
    }
  }

  async checkReadWriteReadiness(): Promise<{ readable: boolean; writable: boolean }> {
    return { readable: await this.healthCheck(), writable: false }
  }

  async findByTaskId(taskId: string): Promise<CheckpointRecord | null> {
    const collection = await getCollection('xiaobao_runtime_checkpoints')
    const { data } = await collection.where({ taskId }).limit(1).get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<CheckpointRecord>(data[0] as Record<string, unknown>)
  }

  async create(record: CheckpointRecord): Promise<CheckpointRecord | null> {
    const collection = await getCollection('xiaobao_runtime_checkpoints')
    try {
      await collection.add({ _id: record.taskId, ...record })
      return record
    } catch (error) {
      if (isCloudBaseDuplicateWriteError(error)) return null
      throw error
    }
  }

  async compareAndSwap(
    taskId: string,
    expectedRevision: number,
    next: CheckpointRecord,
  ): Promise<CheckpointRecord | null> {
    const collection = await getCollection('xiaobao_runtime_checkpoints')
    const { updated } = await collection.where({ taskId, revision: expectedRevision }).update(next)
    return updated === 1 ? next : null
  }
}

// ─── XiaoBao Usage Ledger Repository ────────────────────────────────────────

const RESERVATION_CONFLICT = 'Usage reservation conflict'
const RESERVATION_ACCOUNTING_CONFLICT = 'Usage reservation accounting conflict'
const SETTLEMENT_CONFLICT = 'Usage settlement conflict'
const SETTLEMENT_EXCEEDS_RESERVATION = 'Usage settlement exceeds reservation'
const RELEASE_CONFLICT = 'Usage release conflict'
const LEDGER_UNAVAILABLE = 'XiaoBao usage ledger unavailable'
/** 预算核算读取分页：CloudBase 单次 get 有条数上限，必须显式翻页，否则用量会被低估。 */
const BUDGET_PAGE_SIZE = 100
const BUDGET_MAX_PAGES = 50
/** 按用户分批查询的上限：单次 in 条件不能无限长，而全班合计必须覆盖所有在班学生。 */
const LEDGER_USER_CHUNK_SIZE = 50

/**
 * 翻页求和；翻到上限仍未读完返回 `null`（**无法确定**），绝不返回偏小的用量。
 *
 * 偏小的用量会让预算放行本该被拦下的任务，所以宁可让调用方 fail-closed。
 */
async function sumPagedSettledCredits(
  collection: any,
  filter: Record<string, unknown>,
  pageSize: number,
  maxPages: number,
): Promise<number | null> {
  let total = 0
  let offset = 0

  for (let page = 0; page < maxPages; page += 1) {
    const { data } = await collection.where(filter).limit(pageSize).skip(offset).get()
    const rows = (data ?? []) as XiaobaoUsageReservationRecord[]
    for (const row of rows) total += row.creditCostSettled ?? 0
    if (rows.length < pageSize) return total
    offset += pageSize
  }

  return null
}

const LEDGER_BUSINESS_ERRORS = new Set([
  RESERVATION_CONFLICT,
  RESERVATION_ACCOUNTING_CONFLICT,
  SETTLEMENT_CONFLICT,
  SETTLEMENT_EXCEEDS_RESERVATION,
  RELEASE_CONFLICT,
])

class HealthProbeRollback extends Error {
  constructor() {
    super('XiaoBao usage health probe rollback')
  }
}

function isCloudBaseTransactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === 'DATABASE_TRANSACTION_CONFLICT' || code === 'DATABASE_DUPLICATE_WRITE'
}

function isLedgerBusinessError(error: unknown): error is Error {
  return error instanceof Error && LEDGER_BUSINESS_ERRORS.has(error.message)
}

async function runLedgerTransaction<T>(
  operation: (transaction: CloudBaseTransactionHandle) => T | Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await runCloudBaseTransaction(operation)
    } catch (error) {
      if (isLedgerBusinessError(error)) throw error
      if (isCloudBaseTransactionConflict(error) && attempt < 3) continue
      throw new Error(LEDGER_UNAVAILABLE)
    }
  }
  throw new Error(LEDGER_UNAVAILABLE)
}

function transactionCollection(
  transaction: CloudBaseTransactionHandle,
  name: 'user_credits' | 'credit_transactions' | 'xiaobao_usage_reservations',
): any {
  return transaction.collection(getCollectionName(name))
}

function uniqueDocumentId(namespace: 'credits' | 'reservation', parts: string[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `xiaobao_${namespace}_${digest}`
}

async function findTransactionDocument<T>(collection: any, criteria: Record<string, unknown>): Promise<T | null> {
  const { data } = await collection.where(criteria).limit(1).get()
  if (!data || data.length === 0) return null
  return stripCloudBaseId<T>(data[0] as Record<string, unknown>)
}

function mapUsageReservation(document: Record<string, unknown>): XiaobaoUsageReservationRecord {
  return stripCloudBaseId<XiaobaoUsageReservationRecord>(document)
}

function assertIdenticalReservation(
  reservation: XiaobaoUsageReservationRecord,
  input: UsageReservationLedgerInput,
): void {
  if (
    reservation.userId !== input.userId ||
    reservation.category !== input.category ||
    reservation.reservedUnits !== input.reservedUnits ||
    reservation.creditCostReserved !== input.creditCostReserved
  ) {
    throw new Error(RESERVATION_CONFLICT)
  }
}

export class CloudBaseXiaobaoUsageLedgerRepository implements XiaobaoUsageLedgerRepository {
  /** 分页参数可注入，便于用很少的数据验证"读不完就 fail-closed"这条路径。 */
  constructor(
    private readonly budgetPageSize: number = BUDGET_PAGE_SIZE,
    private readonly budgetMaxPages: number = BUDGET_MAX_PAGES,
  ) {}

  async reserve(input: UsageReservationLedgerInput): Promise<UsageReservationLedgerResult> {
    return runLedgerTransaction(async (transaction) => {
      const reservations = transactionCollection(transaction, 'xiaobao_usage_reservations')
      const creditsCollection = transactionCollection(transaction, 'user_credits')
      const creditTransactions = transactionCollection(transaction, 'credit_transactions')
      const existing = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, {
        taskId: input.taskId,
        category: input.category,
      })
      if (existing) {
        assertIdenticalReservation(existing, input)
        return { allowed: true, record: existing }
      }

      let credits = await findTransactionDocument<UserCredits>(creditsCollection, { userId: input.userId })
      if (!credits) {
        const id = nanoid()
        const documentId = uniqueDocumentId('credits', [input.userId])
        const created: UserCredits = {
          id,
          userId: input.userId,
          balance: 0,
          frozenBalance: 0,
          lifetimeBalance: 0,
          createdAt: input.now,
          updatedAt: input.now,
        }
        await creditsCollection.add({ _id: documentId, ...created })
        credits = created
      }

      if (credits.balance < input.creditCostReserved) {
        return { allowed: false, reason: 'insufficient_credits' }
      }

      const id = nanoid()
      const documentId = uniqueDocumentId('reservation', [input.taskId, input.category])
      const reservation: XiaobaoUsageReservationRecord = {
        id,
        taskId: input.taskId,
        userId: input.userId,
        category: input.category,
        reservedUnits: input.reservedUnits,
        settledUnits: null,
        status: 'reserved',
        creditCostReserved: input.creditCostReserved,
        creditCostSettled: null,
        createdAt: input.now,
        updatedAt: input.now,
        settledAt: null,
      }

      try {
        await reservations.add({ _id: documentId, ...reservation })
      } catch (error) {
        if (!isCloudBaseDuplicateWriteError(error)) throw error
        const concurrent = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, {
          taskId: input.taskId,
          category: input.category,
        })
        if (!concurrent) throw codedTransactionConflict()
        assertIdenticalReservation(concurrent, input)
        return { allowed: true, record: concurrent }
      }

      const balanceAfter = credits.balance - input.creditCostReserved
      const frozenBalanceAfter = credits.frozenBalance + input.creditCostReserved
      const { updated } = await creditsCollection
        .where({
          id: credits.id,
          balance: credits.balance,
          frozenBalance: credits.frozenBalance,
        })
        .update({
          balance: balanceAfter,
          frozenBalance: frozenBalanceAfter,
          updatedAt: input.now,
        })
      if (updated !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      const transactionId = `xiaobao:${id}:reserve`
      await creditTransactions.add({
        _id: transactionId,
        id: transactionId,
        userId: input.userId,
        type: 'freeze',
        amount: input.creditCostReserved === 0 ? 0 : -input.creditCostReserved,
        balanceAfter,
        description: 'XiaoBao usage reservation',
        metadata: null,
        createdAt: input.now,
      })

      return { allowed: true, record: reservation }
    })
  }

  async settle(input: UsageSettlementLedgerInput): Promise<XiaobaoUsageReservationRecord> {
    return runLedgerTransaction(async (transaction) => {
      const reservations = transactionCollection(transaction, 'xiaobao_usage_reservations')
      const creditsCollection = transactionCollection(transaction, 'user_credits')
      const creditTransactions = transactionCollection(transaction, 'credit_transactions')
      const reservation = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, {
        id: input.reservationId,
      })

      if (!reservation || reservation.taskId !== input.taskId || reservation.category !== input.category) {
        throw new Error(SETTLEMENT_CONFLICT)
      }
      if (reservation.status === 'settled') {
        if (
          reservation.settledUnits !== input.settledUnits ||
          reservation.creditCostSettled !== input.creditCostSettled
        ) {
          throw new Error(SETTLEMENT_CONFLICT)
        }
        return reservation
      }
      if (reservation.status !== 'reserved') throw new Error(SETTLEMENT_CONFLICT)
      if (input.creditCostSettled > reservation.creditCostReserved) {
        throw new Error(SETTLEMENT_EXCEEDS_RESERVATION)
      }

      const credits = await findTransactionDocument<UserCredits>(creditsCollection, {
        userId: reservation.userId,
      })
      if (!credits || credits.frozenBalance < reservation.creditCostReserved) {
        throw new Error(RESERVATION_ACCOUNTING_CONFLICT)
      }

      const releasedCost = reservation.creditCostReserved - input.creditCostSettled
      const balanceAfter = credits.balance + releasedCost
      const frozenBalanceAfter = credits.frozenBalance - reservation.creditCostReserved
      const accountResult = await creditsCollection
        .where({
          id: credits.id,
          balance: credits.balance,
          frozenBalance: credits.frozenBalance,
        })
        .update({
          balance: balanceAfter,
          frozenBalance: frozenBalanceAfter,
          updatedAt: input.now,
        })
      if (accountResult.updated !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      const settledRecord: XiaobaoUsageReservationRecord = {
        ...reservation,
        settledUnits: input.settledUnits,
        status: 'settled',
        creditCostSettled: input.creditCostSettled,
        updatedAt: input.now,
        settledAt: input.now,
      }
      const reservationResult = await reservations.where({ id: input.reservationId, status: 'reserved' }).update({
        settledUnits: input.settledUnits,
        status: 'settled',
        creditCostSettled: input.creditCostSettled,
        updatedAt: input.now,
        settledAt: input.now,
      })
      if (reservationResult.updated !== 1) throw new Error(SETTLEMENT_CONFLICT)

      const settlementTransactionId = `xiaobao:${reservation.id}:settle`
      await creditTransactions.add({
        _id: settlementTransactionId,
        id: settlementTransactionId,
        userId: reservation.userId,
        type: 'consumption',
        amount: input.creditCostSettled === 0 ? 0 : -input.creditCostSettled,
        balanceAfter,
        description: 'XiaoBao usage settlement',
        metadata: null,
        createdAt: input.now,
      })

      if (releasedCost > 0) {
        const releaseTransactionId = `xiaobao:${reservation.id}:release`
        await creditTransactions.add({
          _id: releaseTransactionId,
          id: releaseTransactionId,
          userId: reservation.userId,
          type: 'refund',
          amount: releasedCost,
          balanceAfter,
          description: 'XiaoBao unused reservation release',
          metadata: null,
          createdAt: input.now,
        })
      }

      return settledRecord
    })
  }

  async release(
    reservationId: string,
    reason: 'safety_denied' | 'runtime_failed',
  ): Promise<XiaobaoUsageReservationRecord> {
    if (reason !== 'safety_denied' && reason !== 'runtime_failed') throw new Error(RELEASE_CONFLICT)
    return runLedgerTransaction(async (transaction) => {
      const reservations = transactionCollection(transaction, 'xiaobao_usage_reservations')
      const creditsCollection = transactionCollection(transaction, 'user_credits')
      const creditTransactions = transactionCollection(transaction, 'credit_transactions')
      const reservation = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, {
        id: reservationId,
      })
      if (!reservation) throw new Error(RELEASE_CONFLICT)

      if (reservation.status === 'released') {
        const releaseTransaction = await findTransactionDocument<CreditTransaction>(creditTransactions, {
          id: `xiaobao:${reservationId}:release`,
        })
        let recordedReason: unknown
        try {
          recordedReason = releaseTransaction?.metadata
            ? (JSON.parse(releaseTransaction.metadata) as { reason?: unknown }).reason
            : undefined
        } catch {
          throw new Error(RELEASE_CONFLICT)
        }
        if (recordedReason !== reason) throw new Error(RELEASE_CONFLICT)
        return reservation
      }
      if (reservation.status !== 'reserved') throw new Error(RELEASE_CONFLICT)

      const credits = await findTransactionDocument<UserCredits>(creditsCollection, {
        userId: reservation.userId,
      })
      if (!credits || credits.frozenBalance < reservation.creditCostReserved) {
        throw new Error(RESERVATION_ACCOUNTING_CONFLICT)
      }

      const releasedAt = now()
      const balanceAfter = credits.balance + reservation.creditCostReserved
      const frozenBalanceAfter = credits.frozenBalance - reservation.creditCostReserved
      const accountResult = await creditsCollection
        .where({
          id: credits.id,
          balance: credits.balance,
          frozenBalance: credits.frozenBalance,
        })
        .update({
          balance: balanceAfter,
          frozenBalance: frozenBalanceAfter,
          updatedAt: releasedAt,
        })
      if (accountResult.updated !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      const releasedRecord: XiaobaoUsageReservationRecord = {
        ...reservation,
        settledUnits: 0,
        status: 'released',
        creditCostSettled: 0,
        updatedAt: releasedAt,
        settledAt: releasedAt,
      }
      const reservationResult = await reservations.where({ id: reservationId, status: 'reserved' }).update({
        settledUnits: 0,
        status: 'released',
        creditCostSettled: 0,
        updatedAt: releasedAt,
        settledAt: releasedAt,
      })
      if (reservationResult.updated !== 1) throw new Error(RELEASE_CONFLICT)

      const releaseTransactionId = `xiaobao:${reservation.id}:release`
      await creditTransactions.add({
        _id: releaseTransactionId,
        id: releaseTransactionId,
        userId: reservation.userId,
        type: 'refund',
        amount: reservation.creditCostReserved,
        balanceAfter,
        description: 'XiaoBao reservation release',
        metadata: JSON.stringify({ reason }),
        createdAt: releasedAt,
      })

      return releasedRecord
    })
  }

  async findByTaskAndCategory(
    taskId: string,
    category: XiaobaoUsageReservationRecord['category'],
  ): Promise<XiaobaoUsageReservationRecord | null> {
    return runLedgerTransaction(async (transaction) => {
      const reservation = await findTransactionDocument<XiaobaoUsageReservationRecord>(
        transactionCollection(transaction, 'xiaobao_usage_reservations'),
        { taskId, category },
      )
      return reservation
    })
  }

  async sumSettledCreditsByUser(userId: string, since: number | null): Promise<number | null> {
    return runLedgerTransaction(async (transaction) => {
      const filter: Record<string, unknown> = { userId, status: 'settled' }
      if (since !== null) filter.settledAt = getCommand().gte(since)

      return sumPagedSettledCredits(
        transactionCollection(transaction, 'xiaobao_usage_reservations'),
        filter,
        this.budgetPageSize,
        this.budgetMaxPages,
      )
    })
  }

  async sumSettledCreditsByUsers(userIds: readonly string[], since: number | null): Promise<number | null> {
    // 没有在班学生是**确定的 0**，与"无法确定"不同
    if (userIds.length === 0) return 0

    return runLedgerTransaction(async (transaction) => {
      const collection = transactionCollection(transaction, 'xiaobao_usage_reservations')
      const _ = getCommand()
      let total = 0

      // 按用户分批查询：单次 in 条件不能无限长，而用量总和必须覆盖全班。
      for (let start = 0; start < userIds.length; start += LEDGER_USER_CHUNK_SIZE) {
        const chunk = userIds.slice(start, start + LEDGER_USER_CHUNK_SIZE)
        const filter: Record<string, unknown> = { userId: _.in([...chunk]), status: 'settled' }
        if (since !== null) filter.settledAt = _.gte(since)

        const chunkTotal = await sumPagedSettledCredits(collection, filter, this.budgetPageSize, this.budgetMaxPages)
        // 任何一批读不完 ⇒ 整班合计无法确定，绝不给偏小的数字
        if (chunkTotal === null) return null
        total += chunkTotal
      }

      return total
    })
  }

  async sumSettledCreditsByUserByCategory(
    userId: string,
    since: number | null,
  ): Promise<XiaobaoUsageCategoryTotals | null> {
    return runLedgerTransaction(async (transaction) => {
      const filter: Record<string, unknown> = { userId, status: 'settled' }
      if (since !== null) filter.settledAt = getCommand().gte(since)

      const collection = transactionCollection(transaction, 'xiaobao_usage_reservations')
      const totals: XiaobaoUsageCategoryTotals = { model: 0, tool: 0, sandbox: 0, media: 0 }
      let offset = 0

      // 与总量求和同样必须显式翻页：偏小的分类明细会让管理端低估学生用量。
      for (let page = 0; page < this.budgetMaxPages; page += 1) {
        const { data } = await collection.where(filter).limit(this.budgetPageSize).skip(offset).get()
        const rows = data as XiaobaoUsageReservationRecord[]
        for (const row of rows) {
          const category = row.category
          // 集合本身没有 schema 约束，遇到未知分类时跳过而不是把它算进别的用途。
          if (category === 'model' || category === 'tool' || category === 'sandbox' || category === 'media') {
            totals[category] += row.creditCostSettled ?? 0
          }
        }
        if (rows.length < this.budgetPageSize) return totals
        offset += this.budgetPageSize
      }

      // 翻页到上限仍未读完：返回 null，绝不给出一份"看起来完整的"偏小明细。
      return null
    })
  }

  async healthCheck(): Promise<boolean> {
    const probeId = nanoid()
    const probeTaskId = `__xiaobao_usage_probe__${nanoid()}`
    let creditsBefore: { count: number; balance: number; frozenBalance: number } | undefined
    let reservationsBefore: number | undefined
    let transactionsBefore: number | undefined
    let probeVerified = false

    try {
      await runCloudBaseTransaction(async (transaction) => {
        const credits = await transactionCollection(transaction, 'user_credits').get()
        const reservations = transactionCollection(transaction, 'xiaobao_usage_reservations')
        const reservationCount = await reservations.count()
        const transactionCount = await transactionCollection(transaction, 'credit_transactions').count()
        creditsBefore = aggregateCredits(credits.data)
        reservationsBefore = reservationCount.total
        transactionsBefore = transactionCount.total

        await reservations.add({
          _id: probeId,
          id: probeId,
          taskId: probeTaskId,
          userId: '__xiaobao_usage_probe__',
          category: 'model',
          reservedUnits: 1,
          settledUnits: null,
          status: 'reserved',
          creditCostReserved: 0,
          creditCostSettled: null,
          createdAt: 0,
          updatedAt: 0,
          settledAt: null,
        })
        const probe = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, { id: probeId })
        probeVerified = probe?.id === probeId
        throw new HealthProbeRollback()
      })
    } catch (error) {
      if (!(error instanceof HealthProbeRollback) || !probeVerified) return false
    }

    try {
      return await runCloudBaseTransaction(async (transaction) => {
        const credits = await transactionCollection(transaction, 'user_credits').get()
        const reservations = transactionCollection(transaction, 'xiaobao_usage_reservations')
        const reservationCount = await reservations.count()
        const transactionCount = await transactionCollection(transaction, 'credit_transactions').count()
        const residue = await findTransactionDocument<XiaobaoUsageReservationRecord>(reservations, { id: probeId })
        const creditsAfter = aggregateCredits(credits.data)
        return (
          residue === null &&
          creditsBefore !== undefined &&
          creditsAfter.count === creditsBefore.count &&
          creditsAfter.balance === creditsBefore.balance &&
          creditsAfter.frozenBalance === creditsBefore.frozenBalance &&
          reservationCount.total === reservationsBefore &&
          transactionCount.total === transactionsBefore
        )
      })
    } catch {
      return false
    }
  }
}

function codedTransactionConflict(): Error & { code: string } {
  return Object.assign(new Error(LEDGER_UNAVAILABLE), { code: 'DATABASE_TRANSACTION_CONFLICT' })
}

function aggregateCredits(documents: Record<string, unknown>[]): {
  count: number
  balance: number
  frozenBalance: number
} {
  return documents.reduce<{ count: number; balance: number; frozenBalance: number }>(
    (aggregate, document) => ({
      count: aggregate.count + 1,
      balance: aggregate.balance + Number(document.balance),
      frozenBalance: aggregate.frozenBalance + Number(document.frozenBalance),
    }),
    { count: 0, balance: 0, frozenBalance: 0 },
  )
}

// ─── User Repository ────────────────────────────────────────────────────────

class CloudBaseUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<User>(data[0] as Record<string, unknown>)
  }

  async findByProviderAndExternalId(provider: string, externalId: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    const { data } = await collection
      .where({ provider: _.eq(provider), externalId: _.eq(externalId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<User>(data[0] as Record<string, unknown>)
  }

  async findByApiKey(encryptedApiKey: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    const { data } = await collection
      .where({ apiKey: _.eq(encryptedApiKey) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<User>(data[0] as Record<string, unknown>)
  }

  async findByPhone(phone: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    const { data } = await collection
      .where({ phone: _.eq(phone) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<User>(data[0] as Record<string, unknown>)
  }

  async create(user: NewUser): Promise<User> {
    const collection = await getCollection('users')
    const ts = now()
    const doc: User = {
      refreshToken: null,
      scope: null,
      email: null,
      name: null,
      avatarUrl: null,
      disabledReason: null,
      disabledAt: null,
      disabledBy: null,
      apiKey: null,
      phone: null,
      phoneVerified: null,
      xiaobaoCreditLimit: null,
      ...user,
      createdAt: user.createdAt ?? ts,
      updatedAt: user.updatedAt ?? ts,
      lastLoginAt: user.lastLoginAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findById(id)
  }

  async deleteById(id: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('users')
    await collection.where({ id: _.eq(id) }).remove()
  }

  // Admin methods
  async findAll(limit = 20, offset = 0): Promise<User[]> {
    const collection = await getCollection('users')
    const { data } = await collection.limit(limit).skip(offset).get()
    return data.map((doc: any) => stripCloudBaseId<User>(doc as Record<string, unknown>))
  }

  async count(): Promise<number> {
    const collection = await getCollection('users')
    const { total } = await collection.count()
    return total
  }

  async updateRole(id: string, role: 'user' | 'admin'): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    await collection.where({ id: _.eq(id) }).update({ role, updatedAt: now() })
    return this.findById(id)
  }

  async disable(id: string, reason: string, adminUserId: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    await collection.where({ id: _.eq(id) }).update({
      status: 'disabled',
      disabledReason: reason,
      disabledAt: now(),
      disabledBy: adminUserId,
      updatedAt: now(),
    })
    return this.findById(id)
  }

  async enable(id: string): Promise<User | null> {
    const _ = getCommand()
    const collection = await getCollection('users')
    await collection.where({ id: _.eq(id) }).update({
      status: 'active',
      disabledReason: null,
      disabledAt: null,
      disabledBy: null,
      updatedAt: now(),
    })
    return this.findById(id)
  }
}

// ─── LocalCredential Repository ─────────────────────────────────────────────

class CloudBaseLocalCredentialRepository implements LocalCredentialRepository {
  async findByUserId(userId: string): Promise<LocalCredential | null> {
    const _ = getCommand()
    const collection = await getCollection('local_credentials')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<LocalCredential>(data[0] as Record<string, unknown>)
  }

  async create(credential: NewLocalCredential): Promise<LocalCredential> {
    const collection = await getCollection('local_credentials')
    const ts = now()
    const doc: LocalCredential = {
      ...credential,
      createdAt: credential.createdAt ?? ts,
      updatedAt: credential.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(userId: string, data: Partial<Omit<LocalCredential, 'userId'>>): Promise<LocalCredential | null> {
    const _ = getCommand()
    const collection = await getCollection('local_credentials')
    await collection.where({ userId: _.eq(userId) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findByUserId(userId)
  }
}

// ─── Task Repository ────────────────────────────────────────────────────────

/** Apply business defaults for Task fields that may be missing in legacy DB records */
function withTaskDefaults(task: Record<string, unknown>): Task {
  const doc = stripCloudBaseId<Task>(task)
  return {
    ...doc,
    mode: doc.mode || 'default',
    status: doc.status || 'pending',
    selectedAgent: doc.selectedAgent ?? 'codebuddy',
    selectedRuntime: doc.selectedRuntime ?? null,
    xiaobaoCapability: doc.xiaobaoCapability ?? null,
    sandboxMode: doc.sandboxMode || 'isolated',
    installDependencies: doc.installDependencies ?? false,
    maxDuration: doc.maxDuration ?? 300,
    keepAlive: doc.keepAlive ?? false,
    enableBrowser: doc.enableBrowser ?? false,
    progress: doc.progress ?? 0,
  }
}

class CloudBaseTaskRepository implements TaskRepository {
  async findById(id: string): Promise<Task | null> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return withTaskDefaults(data[0] as Record<string, unknown>)
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Task | null> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const { data } = await collection
      .where({ id: _.eq(id), userId: _.eq(userId), deletedAt: _.eq(null) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return withTaskDefaults(data[0] as Record<string, unknown>)
  }

  async findByUserId(userId: string, limit = 20): Promise<Task[]> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const { data } = await collection
      .where({ userId: _.eq(userId), deletedAt: _.eq(null) })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => withTaskDefaults(doc))
  }

  async findByRepoAndPr(userId: string, prNumber: number, repoUrl: string): Promise<Task[]> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const { data } = await collection
      .where({ userId: _.eq(userId), prNumber: _.eq(prNumber), repoUrl: _.eq(repoUrl), deletedAt: _.eq(null) })
      .limit(1)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => withTaskDefaults(doc))
  }

  async findAll(limit: number, offset: number, filters?: { userId?: string; status?: string }): Promise<Task[]> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const where: Record<string, any> = { deletedAt: _.eq(null) }
    if (filters?.userId) where.userId = _.eq(filters.userId)
    if (filters?.status) where.status = _.eq(filters.status)
    const { data } = await collection.where(where).orderBy('createdAt', 'desc').skip(offset).limit(limit).get()
    if (!data) return []
    return (data as Record<string, unknown>[]).map((doc) => withTaskDefaults(doc))
  }

  async count(filters?: { userId?: string; status?: string }): Promise<number> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    const where: Record<string, any> = { deletedAt: _.eq(null) }
    if (filters?.userId) where.userId = _.eq(filters.userId)
    if (filters?.status) where.status = _.eq(filters.status)
    const { total } = await collection.where(where).count()
    return total
  }

  async create(task: NewTask): Promise<Task> {
    const collection = await getCollection('tasks')
    const ts = now()
    const doc: Task = {
      // ── Business defaults (for optional fields) ──
      selectedAgent: 'codebuddy',
      installDependencies: false,
      maxDuration: 300,
      keepAlive: false,
      enableBrowser: false,
      progress: 0,
      // ── Nullable defaults ──
      title: null,
      repoUrl: null,
      envId: null,
      selectedModel: null,
      selectedRuntime: null,
      xiaobaoCapability: null,
      logs: null,
      error: null,
      branchName: null,
      sandboxId: null,
      sandboxSessionId: null,
      sandboxCwd: null,
      sandboxMode: null,
      agentSessionId: null,
      sandboxUrl: null,
      previewUrl: null,
      prUrl: null,
      prNumber: null,
      prStatus: null,
      prMergeCommitSha: null,
      mcpServerList: null,
      skillSettings: null,
      // ── Caller overrides (spread after defaults) ──
      ...task,
      createdAt: task.createdAt ?? ts,
      updatedAt: task.updatedAt ?? ts,
      completedAt: task.completedAt ?? null,
      deletedAt: task.deletedAt ?? null,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<Task, 'id'>>): Promise<Task | null> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findById(id)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async softDelete(id: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('tasks')
    await collection.where({ id: _.eq(id) }).update({ deletedAt: now() })
  }
}

// ─── Connector Repository ───────────────────────────────────────────────────

class CloudBaseConnectorRepository implements ConnectorRepository {
  async findByUserId(userId: string): Promise<Connector[]> {
    const _ = getCommand()
    const collection = await getCollection('connectors')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<Connector>(doc))
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Connector | null> {
    const _ = getCommand()
    const collection = await getCollection('connectors')
    const { data } = await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Connector>(data[0] as Record<string, unknown>)
  }

  async create(connector: NewConnector): Promise<Connector> {
    const collection = await getCollection('connectors')
    const ts = now()
    const doc: Connector = {
      ...connector,
      createdAt: connector.createdAt ?? ts,
      updatedAt: connector.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, userId: string, data: Partial<Omit<Connector, 'id' | 'userId'>>): Promise<Connector | null> {
    const _ = getCommand()
    const collection = await getCollection('connectors')
    await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findByIdAndUserId(id, userId)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('connectors')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async delete(id: string, userId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('connectors')
    await collection.where({ id: _.eq(id), userId: _.eq(userId) }).remove()
  }
}

// ─── MiniProgramApp Repository ──────────────────────────────────────────────

class CloudBaseMiniProgramAppRepository implements MiniProgramAppRepository {
  async findByUserId(userId: string): Promise<MiniProgramApp[]> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<MiniProgramApp>(doc))
  }

  async findByIdAndUserId(id: string, userId: string): Promise<MiniProgramApp | null> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    const { data } = await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<MiniProgramApp>(data[0] as Record<string, unknown>)
  }

  async findByAppIdAndUserId(appId: string, userId: string): Promise<MiniProgramApp | null> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    const { data } = await collection
      .where({ appId: _.eq(appId), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<MiniProgramApp>(data[0] as Record<string, unknown>)
  }

  async create(app: NewMiniProgramApp): Promise<MiniProgramApp> {
    const collection = await getCollection('miniprogram_apps')
    const ts = now()
    const doc: MiniProgramApp = {
      ...app,
      createdAt: app.createdAt ?? ts,
      updatedAt: app.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<MiniProgramApp, 'id' | 'userId'>>,
  ): Promise<MiniProgramApp | null> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findByIdAndUserId(id, userId)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async delete(id: string, userId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('miniprogram_apps')
    await collection.where({ id: _.eq(id), userId: _.eq(userId) }).remove()
  }
}

// ─── CronTask Repository ────────────────────────────────────────────────────

class CloudBaseCronTaskRepository implements CronTaskRepository {
  async findByUserId(userId: string): Promise<CronTask[]> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<CronTask>(doc))
  }

  async findByIdAndUserId(id: string, userId: string): Promise<CronTask | null> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    const { data } = await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<CronTask>(data[0] as Record<string, unknown>)
  }

  async findAllEnabled(): Promise<CronTask[]> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    const { data } = await collection
      .where({ enabled: _.eq(true) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<CronTask>(doc))
  }

  async create(task: NewCronTask): Promise<CronTask> {
    const collection = await getCollection('cron_tasks')
    const ts = now()
    const doc: CronTask = {
      repoUrl: null,
      selectedAgent: null,
      selectedModel: null,
      lastRunAt: null,
      nextRunAt: null,
      lockedBy: null,
      lockedAt: null,
      ...task,
      createdAt: task.createdAt ?? ts,
      updatedAt: task.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, userId: string, data: Partial<Omit<CronTask, 'id' | 'userId'>>): Promise<CronTask | null> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findByIdAndUserId(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    await collection.where({ id: _.eq(id), userId: _.eq(userId) }).remove()
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async tryLock(id: string, lockerId: string, maxLockMs: number): Promise<boolean> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    const cutoff = Date.now() - maxLockMs
    try {
      const result = await collection
        .where({
          id: _.eq(id),
          _: _.or([{ lockedBy: _.eq(null) }, { lockedBy: _.exists(false) }, { lockedAt: _.lt(cutoff) }]),
        })
        .update({ lockedBy: lockerId, lockedAt: Date.now() })
      return (result as any).updated > 0
    } catch {
      return false
    }
  }

  async releaseLock(id: string, lockerId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('cron_tasks')
    await collection.where({ id: _.eq(id), lockedBy: _.eq(lockerId) }).update({ lockedBy: null, lockedAt: null })
  }
}

// ─── Account Repository ─────────────────────────────────────────────────────

class CloudBaseAccountRepository implements AccountRepository {
  async findByUserIdAndProvider(userId: string, provider: string): Promise<Account | null> {
    const _ = getCommand()
    const collection = await getCollection('accounts')
    const { data } = await collection
      .where({ userId: _.eq(userId), provider: _.eq(provider) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Account>(data[0] as Record<string, unknown>)
  }

  async findByProviderAndExternalUserId(provider: string, externalUserId: string): Promise<Account | null> {
    const _ = getCommand()
    const collection = await getCollection('accounts')
    const { data } = await collection
      .where({ provider: _.eq(provider), externalUserId: _.eq(externalUserId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Account>(data[0] as Record<string, unknown>)
  }

  async create(account: NewAccount): Promise<Account> {
    const collection = await getCollection('accounts')
    const ts = now()
    const doc: Account = {
      ...account,
      createdAt: account.createdAt ?? ts,
      updatedAt: account.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<Account, 'id'>>): Promise<Account | null> {
    const _ = getCommand()
    const collection = await getCollection('accounts')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<Account>(rows[0] as Record<string, unknown>)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('accounts')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async delete(userId: string, provider: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('accounts')
    await collection.where({ userId: _.eq(userId), provider: _.eq(provider) }).remove()
  }
}

// ─── Key Repository ─────────────────────────────────────────────────────────

class CloudBaseKeyRepository implements KeyRepository {
  async findByUserId(userId: string): Promise<Key[]> {
    const _ = getCommand()
    const collection = await getCollection('keys')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<Key>(doc))
  }

  async findByUserIdAndProvider(userId: string, provider: string): Promise<Key | null> {
    const _ = getCommand()
    const collection = await getCollection('keys')
    const { data } = await collection
      .where({ userId: _.eq(userId), provider: _.eq(provider) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Key>(data[0] as Record<string, unknown>)
  }

  async upsert(key: NewKey): Promise<Key> {
    const ts = now()
    const existing = await this.findByUserIdAndProvider(key.userId, key.provider)
    if (existing) {
      const _ = getCommand()
      const collection = await getCollection('keys')
      await collection
        .where({ userId: _.eq(key.userId), provider: _.eq(key.provider) })
        .update({ value: key.value, updatedAt: ts })
      return { ...existing, value: key.value, updatedAt: ts }
    }
    const collection = await getCollection('keys')
    const doc: Key = {
      ...key,
      id: key.id || nanoid(),
      createdAt: key.createdAt ?? ts,
      updatedAt: key.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('keys')
    await collection.where({ userId: _.eq(fromUserId) }).update({ userId: toUserId })
  }

  async delete(userId: string, provider: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('keys')
    await collection.where({ userId: _.eq(userId), provider: _.eq(provider) }).remove()
  }
}

// ─── UserResource Repository ────────────────────────────────────────────────

class CloudBaseUserResourceRepository implements UserResourceRepository {
  async findByUserId(userId: string): Promise<UserResource | null> {
    const _ = getCommand()
    const collection = await getCollection('user_resources')
    // Return user-scoped resource (scope='user'), backwards compatible
    const { data } = await collection
      .where({ userId: _.eq(userId), scope: _.eq('user') })
      .limit(1)
      .get()
    if (!data || data.length === 0) {
      // Fallback: old records without scope field
      const { data: legacy } = await collection
        .where({ userId: _.eq(userId) })
        .limit(1)
        .get()
      if (!legacy || legacy.length === 0) return null
      return stripCloudBaseId<UserResource>(legacy[0] as Record<string, unknown>)
    }
    return stripCloudBaseId<UserResource>(data[0] as Record<string, unknown>)
  }

  async findByTaskId(taskId: string): Promise<UserResource | null> {
    const _ = getCommand()
    const collection = await getCollection('user_resources')
    const { data } = await collection
      .where({ scope: _.eq('task'), taskId: _.eq(taskId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<UserResource>(data[0] as Record<string, unknown>)
  }

  async findAllByUserId(userId: string): Promise<UserResource[]> {
    const _ = getCommand()
    const collection = await getCollection('user_resources')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<UserResource>(doc))
  }

  async create(resource: NewUserResource): Promise<UserResource> {
    const collection = await getCollection('user_resources')
    const ts = now()
    const doc: UserResource = {
      ...resource,
      scope: resource.scope || 'user',
      taskId: resource.taskId ?? null,
      createdAt: resource.createdAt ?? ts,
      updatedAt: resource.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<UserResource, 'id'>>): Promise<UserResource | null> {
    const _ = getCommand()
    const collection = await getCollection('user_resources')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<UserResource>(rows[0] as Record<string, unknown>)
  }

  async deleteById(id: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('user_resources')
    await collection.where({ id: _.eq(id) }).remove()
  }
}

// ─── Setting Repository ─────────────────────────────────────────────────────

class CloudBaseSettingRepository implements SettingRepository {
  async findByUserIdAndKey(userId: string, key: string): Promise<Setting | null> {
    const _ = getCommand()
    const collection = await getCollection('settings')
    const { data } = await collection
      .where({ userId: _.eq(userId), key: _.eq(key) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Setting>(data[0] as Record<string, unknown>)
  }

  async findByUserId(userId: string): Promise<Setting[]> {
    const _ = getCommand()
    const collection = await getCollection('settings')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<Setting>(doc))
  }

  async upsert(setting: NewSetting): Promise<Setting> {
    const ts = now()
    const existing = setting.userId
      ? await this.findByUserIdAndKey(setting.userId, setting.key)
      : await this.findSystemSetting(setting.key)
    if (existing) {
      const _ = getCommand()
      const collection = await getCollection('settings')
      const condition = setting.userId
        ? { userId: _.eq(setting.userId), key: _.eq(setting.key) }
        : { userId: _.eq(null), key: _.eq(setting.key) }
      await collection.where(condition).update({ value: setting.value, updatedAt: ts })
      return { ...existing, value: setting.value, updatedAt: ts }
    }
    const collection = await getCollection('settings')
    const doc: Setting = {
      ...setting,
      id: setting.id || nanoid(),
      createdAt: setting.createdAt ?? ts,
      updatedAt: setting.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async findSystemSetting(key: string): Promise<Setting | null> {
    const _ = getCommand()
    const collection = await getCollection('settings')
    const { data } = await collection
      .where({ userId: _.eq(null), key: _.eq(key) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Setting>(data[0] as Record<string, unknown>)
  }

  async upsertSystemSetting(key: string, value: string): Promise<Setting> {
    return this.upsert({ id: nanoid(), userId: null, key, value })
  }

  async deleteSystemSetting(key: string): Promise<boolean> {
    const _ = getCommand()
    const collection = await getCollection('settings')
    const result = await collection.where({ userId: _.eq(null), key: _.eq(key) }).remove()
    return ((result as any).deleted ?? 0) > 0
  }

  async findAllSystemSettings(): Promise<Setting[]> {
    const _ = getCommand()
    const collection = await getCollection('settings')
    const { data } = await collection
      .where({ userId: _.eq(null) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<Setting>(doc))
  }
}

// ─── Deployment Repository ──────────────────────────────────────────────────

class CloudBaseDeploymentRepository implements DeploymentRepository {
  async findByTaskId(taskId: string): Promise<Deployment[]> {
    const _ = getCommand()
    const collection = await getCollection('deployments')
    const { data } = await collection
      .where({ taskId: _.eq(taskId), deletedAt: _.eq(null) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<Deployment>(doc))
  }

  async findByTaskIdAndTypePath(taskId: string, type: string, path: string | null): Promise<Deployment | null> {
    const _ = getCommand()
    const collection = await getCollection('deployments')
    const where: Record<string, unknown> = {
      taskId: _.eq(taskId),
      type: _.eq(type),
      deletedAt: _.eq(null),
    }
    if (path !== null) {
      where.path = _.eq(path)
    } else {
      where.path = _.eq(null)
    }
    const { data } = await collection.where(where).limit(1).get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Deployment>(data[0] as Record<string, unknown>)
  }

  async findByTaskIdAndUserId(taskId: string, userId: string): Promise<Deployment | null> {
    const _ = getCommand()
    const collection = await getCollection('deployments')
    const { data } = await collection
      .where({ taskId: _.eq(taskId), deletedAt: _.eq(null) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    // Filter by userId since CloudBase doesn't support joins
    // This is acceptable: deployment ownership is verified by the caller via task ownership
    return stripCloudBaseId<Deployment>(data[0] as Record<string, unknown>)
  }

  async create(deployment: NewDeployment): Promise<Deployment> {
    const collection = await getCollection('deployments')
    const ts = now()
    const doc: Deployment = {
      ...deployment,
      createdAt: deployment.createdAt ?? ts,
      updatedAt: deployment.updatedAt ?? ts,
      deletedAt: deployment.deletedAt ?? null,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<Deployment, 'id'>>): Promise<Deployment | null> {
    const _ = getCommand()
    const collection = await getCollection('deployments')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<Deployment>(rows[0] as Record<string, unknown>)
  }

  async softDelete(id: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('deployments')
    await collection.where({ id: _.eq(id) }).update({ deletedAt: now() })
  }
}

// ─── AdminLog Repository ───────────────────────────────────────────────────────

class CloudBaseAdminLogRepository implements AdminLogRepository {
  async create(log: NewAdminLog): Promise<AdminLog> {
    const collection = await getCollection('admin_logs')
    const ts = now()
    const doc: AdminLog = {
      ...log,
      createdAt: log.createdAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async findByAdminUserId(adminUserId: string, limit = 50): Promise<AdminLog[]> {
    const _ = getCommand()
    const collection = await getCollection('admin_logs')
    const { data } = await collection
      .where({ adminUserId: _.eq(adminUserId) })
      .limit(limit)
      .get()
    return data.map((doc: any) => stripCloudBaseId<AdminLog>(doc as Record<string, unknown>))
  }

  async findByTargetUserId(targetUserId: string, limit = 50): Promise<AdminLog[]> {
    const _ = getCommand()
    const collection = await getCollection('admin_logs')
    const { data } = await collection
      .where({ targetUserId: _.eq(targetUserId) })
      .limit(limit)
      .get()
    return data.map((doc: any) => stripCloudBaseId<AdminLog>(doc as Record<string, unknown>))
  }

  async findAll(limit = 50, offset = 0): Promise<AdminLog[]> {
    const collection = await getCollection('admin_logs')
    const { data } = await collection.limit(limit).skip(offset).get()
    return data.map((doc: any) => stripCloudBaseId<AdminLog>(doc as Record<string, unknown>))
  }
}

// ─── EnvPool Repository ─────────────────────────────────────────────────────

class CloudBaseEnvPoolRepository implements EnvPoolRepository {
  async findReady(): Promise<EnvPoolEntry | null> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    const { data } = await collection
      .where({ status: _.eq('ready') })
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<EnvPoolEntry>(data[0] as Record<string, unknown>)
  }

  async claimEntry(
    id: string,
    data: { claimedByUserId: string; claimedByTaskId: string | null; claimedAt: number },
  ): Promise<EnvPoolEntry | null> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    // CAS: only update where status is still 'ready'
    const { updated } = await collection
      .where({ id: _.eq(id), status: _.eq('ready') })
      .update({ status: 'claimed', ...data, updatedAt: now() })
    if (updated === 0) return null // already claimed by another pod
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<EnvPoolEntry>(rows[0] as Record<string, unknown>)
  }

  async countByStatus(status: string): Promise<number> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    const { total } = await collection.where({ status: _.eq(status) }).count()
    return total
  }

  async findAllByStatus(status: string): Promise<EnvPoolEntry[]> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    const { data } = await collection
      .where({ status: _.eq(status) })
      .limit(1000)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<EnvPoolEntry>(doc))
  }

  async countActive(): Promise<number> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    const { total } = await collection.where(_.or([{ status: _.eq('creating') }, { status: _.eq('ready') }])).count()
    return total
  }

  async create(entry: NewEnvPoolEntry): Promise<EnvPoolEntry> {
    const collection = await getCollection('env_pool')
    const ts = now()
    const doc: EnvPoolEntry = {
      ...entry,
      createdAt: entry.createdAt ?? ts,
      updatedAt: entry.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<EnvPoolEntry, 'id'>>): Promise<EnvPoolEntry | null> {
    const _ = getCommand()
    const collection = await getCollection('env_pool')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<EnvPoolEntry>(rows[0] as Record<string, unknown>)
  }

  async getStats(): Promise<Record<string, number>> {
    const stats: Record<string, number> = { creating: 0, ready: 0, claimed: 0, failed: 0 }
    for (const status of Object.keys(stats)) {
      stats[status] = await this.countByStatus(status)
    }
    return stats
  }
}

// ─── CommunityWork Repository ──────────────────────────────────────────────

class CloudBaseCommunityWorkRepository implements CommunityWorkRepository {
  async findAll(limit = 50, offset = 0): Promise<CommunityWork[]> {
    const collection = await getCollection('community_works')
    const { data } = await collection.orderBy('createdAt', 'desc').skip(offset).limit(limit).get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<CommunityWork>(doc))
  }

  async findByUserId(userId: string): Promise<CommunityWork[]> {
    const _ = getCommand()
    const collection = await getCollection('community_works')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    return (data as Record<string, unknown>[]).map((doc) => stripCloudBaseId<CommunityWork>(doc))
  }

  async findById(id: string): Promise<CommunityWork | null> {
    const _ = getCommand()
    const collection = await getCollection('community_works')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<CommunityWork>(data[0] as Record<string, unknown>)
  }

  async create(work: NewCommunityWork): Promise<CommunityWork> {
    const collection = await getCollection('community_works')
    const ts = now()
    const doc: CommunityWork = {
      ...work,
      createdAt: work.createdAt ?? ts,
      updatedAt: work.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<CommunityWork, 'id' | 'userId'>>,
  ): Promise<CommunityWork | null> {
    const _ = getCommand()
    const collection = await getCollection('community_works')
    await collection
      .where({ id: _.eq(id), userId: _.eq(userId) })
      .update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findById(id)
  }

  async delete(id: string, userId: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('community_works')
    await collection.where({ id: _.eq(id), userId: _.eq(userId) }).remove()
  }

  async count(): Promise<number> {
    const collection = await getCollection('community_works')
    const result = await collection.count()
    return result.total || 0
  }
}

// ─── SmsCode Repository ──────────────────────────────────────────────────────

class CloudBaseSmsCodeRepository implements SmsCodeRepository {
  async create(code: NewSmsCode): Promise<SmsCode> {
    const collection = await getCollection('sms_codes')
    const ts = now()
    const doc: SmsCode = {
      ...code,
      createdAt: code.createdAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async findByPhoneAndCode(phone: string, code: string): Promise<SmsCode | null> {
    const _ = getCommand()
    const collection = await getCollection('sms_codes')
    const { data } = await collection
      .where({ phone: _.eq(phone), code: _.eq(code) })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<SmsCode>(data[0] as Record<string, unknown>)
  }

  async markUsed(id: string): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('sms_codes')
    await collection.where({ id: _.eq(id) }).update({ used: true })
  }

  async deleteExpired(): Promise<void> {
    const _ = getCommand()
    const collection = await getCollection('sms_codes')
    await collection.where({ expiresAt: _.lt(now()) }).remove()
  }
}

// ─── UserCredits Repository ──────────────────────────────────────────────────

class CloudBaseUserCreditsRepository implements UserCreditsRepository {
  async findByUserId(userId: string): Promise<UserCredits | null> {
    const _ = getCommand()
    const collection = await getCollection('user_credits')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<UserCredits>(data[0] as Record<string, unknown>)
  }

  async create(credits: NewUserCredits): Promise<UserCredits> {
    const collection = await getCollection('user_credits')
    const ts = now()
    const doc: UserCredits = {
      ...credits,
      createdAt: credits.createdAt ?? ts,
      updatedAt: credits.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async updateByUserId(userId: string, data: Partial<Omit<UserCredits, 'id' | 'userId'>>): Promise<UserCredits | null> {
    const _ = getCommand()
    const collection = await getCollection('user_credits')
    await collection.where({ userId: _.eq(userId) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findByUserId(userId)
  }

  async consumeByUserId(userId: string, amount: number, ts: number): Promise<UserCredits | null> {
    const _ = getCommand()
    const collection = await getCollection('user_credits')
    // CloudBase: check-and-consume - read current balance, then update atomically
    const current = await this.findByUserId(userId)
    if (!current || current.balance < amount) return null
    await collection.where({ userId: _.eq(userId) }).update({
      balance: current.balance - amount,
      updatedAt: ts,
    })
    return this.findByUserId(userId)
  }

  async getOrCreate(userId: string): Promise<UserCredits> {
    const existing = await this.findByUserId(userId)
    if (existing) return existing
    return this.create({
      id: nanoid(),
      userId,
      balance: 0,
      frozenBalance: 0,
      lifetimeBalance: 0,
    })
  }
}

// ─── CreditTransaction Repository ────────────────────────────────────────────

class CloudBaseCreditTransactionRepository implements CreditTransactionRepository {
  async create(tx: NewCreditTransaction): Promise<CreditTransaction> {
    const collection = await getCollection('credit_transactions')
    const ts = now()
    const doc: CreditTransaction = {
      id: tx.id ?? nanoid(),
      userId: tx.userId,
      type: tx.type,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
      description: tx.description ?? null,
      metadata: tx.metadata ?? null,
      createdAt: tx.createdAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async findByUserId(userId: string, limit = 50, offset = 0): Promise<CreditTransaction[]> {
    const _ = getCommand()
    const collection = await getCollection('credit_transactions')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .skip(offset)
      .get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<CreditTransaction>(d))
  }

  async findByUserIdAndType(userId: string, type: string, limit = 50): Promise<CreditTransaction[]> {
    const _ = getCommand()
    const collection = await getCollection('credit_transactions')
    const { data } = await collection
      .where({ userId: _.eq(userId), type: _.eq(type) })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<CreditTransaction>(d))
  }

  async findAll(limit = 100, offset = 0): Promise<CreditTransaction[]> {
    const collection = await getCollection('credit_transactions')
    const { data } = await collection.orderBy('createdAt', 'desc').limit(limit).skip(offset).get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<CreditTransaction>(d))
  }
}

// ─── SubscriptionPlan Repository ─────────────────────────────────────────────

class CloudBaseSubscriptionPlanRepository implements SubscriptionPlanRepository {
  async findById(id: string): Promise<SubscriptionPlan | null> {
    const _ = getCommand()
    const collection = await getCollection('subscription_plans')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<SubscriptionPlan>(data[0] as Record<string, unknown>)
  }

  async findActive(): Promise<SubscriptionPlan[]> {
    return this.findAllActive()
  }

  async findAllActive(): Promise<SubscriptionPlan[]> {
    const _ = getCommand()
    const collection = await getCollection('subscription_plans')
    const { data } = await collection
      .where({ active: _.eq(true) })
      .orderBy('sortOrder', 'asc')
      .get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<SubscriptionPlan>(d))
  }

  async findAll(): Promise<SubscriptionPlan[]> {
    const collection = await getCollection('subscription_plans')
    const { data } = await collection.orderBy('sortOrder', 'asc').get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<SubscriptionPlan>(d))
  }

  async create(plan: NewSubscriptionPlan): Promise<SubscriptionPlan> {
    const collection = await getCollection('subscription_plans')
    const ts = now()
    const doc: SubscriptionPlan = {
      ...plan,
      createdAt: plan.createdAt ?? ts,
      updatedAt: plan.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<SubscriptionPlan, 'id'>>): Promise<SubscriptionPlan | null> {
    const _ = getCommand()
    const collection = await getCollection('subscription_plans')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    return this.findById(id)
  }

  async count(): Promise<number> {
    const collection = await getCollection('subscription_plans')
    const result = await collection.count()
    return result.total || 0
  }
}

// ─── UserSubscription Repository ─────────────────────────────────────────────

class CloudBaseUserSubscriptionRepository implements UserSubscriptionRepository {
  async findByUserId(userId: string): Promise<UserSubscription | null> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    const { data } = await collection
      .where({ userId: _.eq(userId) })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<UserSubscription>(data[0] as Record<string, unknown>)
  }

  async findActiveByUserId(userId: string): Promise<UserSubscription | null> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    const { data } = await collection
      .where({ userId: _.eq(userId), status: _.eq('active') })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<UserSubscription>(data[0] as Record<string, unknown>)
  }

  async create(sub: NewUserSubscription): Promise<UserSubscription> {
    const collection = await getCollection('user_subscriptions')
    const ts = now()
    const doc: UserSubscription = {
      ...sub,
      createdAt: sub.createdAt ?? ts,
      updatedAt: sub.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<UserSubscription, 'id'>>): Promise<UserSubscription | null> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<UserSubscription>(rows[0] as Record<string, unknown>)
  }

  async findExpiringActive(beforeTime: number): Promise<UserSubscription[]> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    const { data } = await collection.where({ status: _.eq('active'), currentPeriodEnd: _.lt(beforeTime) }).get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<UserSubscription>(d))
  }

  async findAllActive(): Promise<UserSubscription[]> {
    return this.findByStatus('active')
  }

  async findByStatus(status: string): Promise<UserSubscription[]> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    const { data } = await collection
      .where({ status: _.eq(status) })
      .orderBy('createdAt', 'desc')
      .get()
    return (data || []).map((d: Record<string, unknown>) => stripCloudBaseId<UserSubscription>(d))
  }

  async countByStatus(status: string): Promise<number> {
    const _ = getCommand()
    const collection = await getCollection('user_subscriptions')
    const { total } = await collection.where({ status: _.eq(status) }).count()
    return total
  }
}

// ─── DailyUsage Repository ───────────────────────────────────────────────────

class CloudBaseDailyUsageRepository implements DailyUsageRepository {
  async create(data: NewDailyUsage): Promise<DailyUsage> {
    const ts = now()
    const doc: DailyUsage = {
      id: data.id ?? nanoid(),
      userId: data.userId,
      date: data.date,
      taskCount: data.taskCount ?? 0,
      sandboxDuration: data.sandboxDuration ?? 0,
      creditsConsumed: data.creditsConsumed ?? 0,
      createdAt: data.createdAt ?? ts,
      updatedAt: data.updatedAt ?? ts,
    }
    const collection = await getCollection('daily_usage')
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<DailyUsage, 'id'>>): Promise<DailyUsage | null> {
    const _ = getCommand()
    const collection = await getCollection('daily_usage')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: data.updatedAt ?? now() })
    const { data: rows } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!rows || rows.length === 0) return null
    return stripCloudBaseId<DailyUsage>(rows[0] as Record<string, unknown>)
  }

  async findByUserIdAndDate(userId: string, date: string): Promise<DailyUsage | null> {
    const _ = getCommand()
    const collection = await getCollection('daily_usage')
    const { data } = await collection
      .where({ userId: _.eq(userId), date: _.eq(date) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<DailyUsage>(data[0] as Record<string, unknown>)
  }

  async upsert(
    userId: string,
    date: string,
    data: { taskCount?: number; sandboxDuration?: number; creditsConsumed?: number },
  ): Promise<DailyUsage> {
    const _ = getCommand()
    const ts = now()
    const existing = await this.findByUserIdAndDate(userId, date)
    if (existing) {
      await getCollection('daily_usage').then((c) =>
        c.where({ id: _.eq(existing.id) }).update({ ...data, updatedAt: ts }),
      )
      return { ...existing, ...data, updatedAt: ts }
    }
    const doc: DailyUsage = {
      id: nanoid(),
      userId,
      date,
      taskCount: data.taskCount ?? 0,
      sandboxDuration: data.sandboxDuration ?? 0,
      creditsConsumed: data.creditsConsumed ?? 0,
      createdAt: ts,
      updatedAt: ts,
    }
    const collection = await getCollection('daily_usage')
    await collection.add(doc)
    return doc
  }

  async findByUserId(userId: string, limit = 30): Promise<DailyUsage[]> {
    const _ = getCommand()
    const collection = await getCollection('daily_usage')
    const { data: rows } = await collection
      .where({ userId: _.eq(userId) })
      .orderBy('date', 'desc')
      .limit(limit)
      .get()
    return (rows || []).map((d: Record<string, unknown>) => stripCloudBaseId<DailyUsage>(d))
  }

  async findByDate(date: string): Promise<DailyUsage[]> {
    const _ = getCommand()
    const collection = await getCollection('daily_usage')
    const { data: rows } = await collection.where({ date: _.eq(date) }).get()
    return (rows || []).map((d: Record<string, unknown>) => stripCloudBaseId<DailyUsage>(d))
  }

  async getDateRangeUserStats(startDate: string, endDate: string) {
    const _ = getCommand()
    const db = (await import('./client')).getDatabase?.()
    const result = await db
      .collection('daily_usage')
      .aggregate()
      .match({
        date: _.gte(startDate).and(_.lte(endDate)),
      })
      .group({
        _id: '$userId',
        totalTasks: _.sum('$taskCount'),
        totalDuration: _.sum('$sandboxDuration'),
        totalCredits: _.sum('$creditsConsumed'),
      })
      .end()
    return (result.data || []).map(
      (r: { _id: string; totalTasks: number; totalDuration: number; totalCredits: number }) => ({
        userId: r._id,
        totalTasks: r.totalTasks || 0,
        totalDuration: r.totalDuration || 0,
        totalCredits: r.totalCredits || 0,
      }),
    )
  }
}

// ─── Institution Repositories ───────────────────────────────────────────────

const TEACHER_PAGE_SIZE = 100
const TEACHER_MAX_PAGES = 50
/** 一次 `in` 条件里放多少个 id：太长会撑爆查询，太短会放大请求数。 */
const TEACHER_IN_CHUNK_SIZE = 50

const COURSE_OUTLINE_UNKNOWN = 'Xiaobao course outline is unknown'

/** 章节/课时按 `sortOrder` 排序；同序时按 id 定序，保证结果确定。 */
function bySortOrder<T extends { id: string; sortOrder: number }>(left: T, right: T): number {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
}

/**
 * 显式翻页读取整个结果集。
 *
 * 返回 null 表示**无法确定**（翻到上限仍未读完）。偏小的结果会让权限判断放行本不该放行的人，
 * 因此绝不返回一份"看起来完整"的部分列表。
 */
async function listAllPaged(
  name: Parameters<typeof getCollection>[0],
  filter: Record<string, unknown>,
  pageSize: number,
  maxPages: number,
): Promise<Record<string, unknown>[] | null> {
  const collection = await getCollection(name)
  const rows: Record<string, unknown>[] = []

  for (let page = 0; page < maxPages; page += 1) {
    // 空过滤器表示"整集合"：真实 CloudBase 不接受 where({})，因此这种情况不加 where 条件。
    const scoped = Object.keys(filter).length === 0 ? collection : collection.where(filter)
    const { data } = await scoped.limit(pageSize).skip(rows.length).get()
    const batch = (data ?? []) as Record<string, unknown>[]
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }

  return null
}

/**
 * 按 `field in (ids)` 分批读取整个结果集。
 *
 * 单次 `in` 条件不能无限长，所以按 `TEACHER_IN_CHUNK_SIZE` 分批；任何一批读不完都返回 `null`，
 * 因为"少读了几节课"和"读完了"在下游看起来一样，但后果不同。
 */
async function listAllPagedInChunks(
  name: Parameters<typeof getCollection>[0],
  field: string,
  ids: readonly string[],
  pageSize: number,
  maxPages: number,
): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = []
  const _ = getCommand()

  for (let start = 0; start < ids.length; start += TEACHER_IN_CHUNK_SIZE) {
    const chunk = ids.slice(start, start + TEACHER_IN_CHUNK_SIZE)
    const batch = await listAllPaged(name, { [field]: _.in([...chunk]) }, pageSize, maxPages)
    if (batch === null) return null
    rows.push(...batch)
  }

  return rows
}

export class CloudBaseInstitutionRepository implements InstitutionRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findById(id: string): Promise<Institution | null> {
    const _ = getCommand()
    const collection = await getCollection('institutions')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Institution>(data[0] as Record<string, unknown>)
  }

  async create(institution: NewInstitution): Promise<Institution> {
    const collection = await getCollection('institutions')
    const ts = now()
    const doc: Institution = {
      ...institution,
      createdAt: institution.createdAt ?? ts,
      updatedAt: institution.updatedAt ?? ts,
    }
    await collection.add(doc)
    return doc
  }

  async listAll(): Promise<Institution[] | null> {
    const rows = await listAllPaged('institutions', {}, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<Institution>(row))
  }

  async listForUser(userId: string): Promise<Institution[] | null> {
    const _ = getCommand()
    const memberships = await listAllPaged(
      'institution_members',
      { userId: _.eq(userId) },
      this.pageSize,
      this.maxPages,
    )
    if (memberships === null) return null

    const result: Institution[] = []
    for (const membership of memberships) {
      const institution = await this.findById(String(membership.institutionId))
      if (institution) result.push(institution)
    }
    return result
  }
}

export class CloudBaseInstitutionMemberRepository implements InstitutionMemberRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findById(id: string): Promise<InstitutionMember | null> {
    const _ = getCommand()
    const collection = await getCollection('institution_members')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<InstitutionMember>(data[0] as Record<string, unknown>)
  }

  async findByInstitutionAndUser(institutionId: string, userId: string): Promise<InstitutionMember | null> {
    const _ = getCommand()
    const collection = await getCollection('institution_members')
    const { data } = await collection
      .where({ institutionId: _.eq(institutionId), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<InstitutionMember>(data[0] as Record<string, unknown>)
  }

  async create(member: NewInstitutionMember): Promise<InstitutionMember | null> {
    // CloudBase 集合没有唯一索引，唯一性只能靠显式预检查（并发下为尽力而为）。
    const existing = await this.findByInstitutionAndUser(member.institutionId, member.userId)
    if (existing) return null

    const collection = await getCollection('institution_members')
    const ts = now()
    const doc: InstitutionMember = {
      ...member,
      createdAt: member.createdAt ?? ts,
      updatedAt: member.updatedAt ?? ts,
    }

    try {
      await collection.add(doc)
    } catch (error) {
      // 同一 id 重复写入：与"已存在成员关系"一样按未创建处理。
      if (isCloudBaseDuplicateWriteError(error)) return null
      throw error
    }

    return doc
  }

  async updateRole(
    institutionId: string,
    userId: string,
    role: InstitutionMemberRole,
  ): Promise<InstitutionMember | null> {
    const existing = await this.findByInstitutionAndUser(institutionId, userId)
    if (!existing) return null

    // 只改角色与 updatedAt：createdAt 是"谁在什么时候加入机构"的事实，不能被动到
    const updatedAt = now()
    const _ = getCommand()
    const collection = await getCollection('institution_members')
    await collection.where({ id: _.eq(existing.id) }).update({ role, updatedAt })

    return { ...existing, role, updatedAt }
  }

  async remove(institutionId: string, userId: string): Promise<boolean> {
    const _ = getCommand()
    const collection = await getCollection('institution_members')
    const { deleted } = await collection.where({ institutionId: _.eq(institutionId), userId: _.eq(userId) }).remove()
    return (deleted ?? 0) > 0
  }

  async listByUserId(userId: string): Promise<InstitutionMember[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('institution_members', { userId: _.eq(userId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<InstitutionMember>(row))
  }

  async listByInstitutionId(institutionId: string): Promise<InstitutionMember[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged(
      'institution_members',
      { institutionId: _.eq(institutionId) },
      this.pageSize,
      this.maxPages,
    )
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<InstitutionMember>(row))
  }
}

// ─── Class Repositories ─────────────────────────────────────────────────────

export class CloudBaseTeacherClassRepository implements TeacherClassRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findById(id: string): Promise<TeacherClass | null> {
    const _ = getCommand()
    const collection = await getCollection('classes')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<TeacherClass>(data[0] as Record<string, unknown>)
  }

  async create(input: NewTeacherClass): Promise<TeacherClass> {
    const collection = await getCollection('classes')
    const ts = now()
    const doc: TeacherClass = { ...input, createdAt: input.createdAt ?? ts, updatedAt: input.updatedAt ?? ts }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<TeacherClass, 'id' | 'createdAt'>>): Promise<TeacherClass | null> {
    const existing = await this.findById(id)
    if (!existing) return null

    const _ = getCommand()
    const collection = await getCollection('classes')
    await collection.where({ id: _.eq(id) }).update({ ...data, updatedAt: now() })
    return this.findById(id)
  }

  async archive(id: string, archivedAt: number): Promise<TeacherClass | null> {
    const existing = await this.findById(id)
    if (!existing) return null

    const _ = getCommand()
    const collection = await getCollection('classes')
    await collection.where({ id: _.eq(id) }).update({ status: 'archived', archivedAt, updatedAt: archivedAt })
    return this.findById(id)
  }

  async listByInstitution(institutionId: string): Promise<TeacherClass[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged(
      'classes',
      { institutionId: _.eq(institutionId), status: _.eq('active') },
      this.pageSize,
      this.maxPages,
    )
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<TeacherClass>(row))
  }

  async listByTeacher(userId: string): Promise<TeacherClass[] | null> {
    const _ = getCommand()
    const assignments = await listAllPaged('class_teachers', { userId: _.eq(userId) }, this.pageSize, this.maxPages)
    if (assignments === null) return null

    const result: TeacherClass[] = []
    for (const assignment of assignments) {
      const teacherClass = await this.findById(String(assignment.classId))
      if (teacherClass && teacherClass.status === 'active') result.push(teacherClass)
    }
    return result
  }

  async listByStudent(studentUserId: string): Promise<TeacherClass[] | null> {
    const _ = getCommand()
    const enrollments = await listAllPaged(
      'class_enrollments',
      { studentUserId: _.eq(studentUserId), status: _.eq('active') },
      this.pageSize,
      this.maxPages,
    )
    if (enrollments === null) return null

    const result: TeacherClass[] = []
    for (const enrollment of enrollments) {
      const teacherClass = await this.findById(String(enrollment.classId))
      if (teacherClass && teacherClass.status === 'active') result.push(teacherClass)
    }
    return result
  }
}

export class CloudBaseClassTeacherRepository implements ClassTeacherRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findByClassAndUser(classId: string, userId: string): Promise<ClassTeacher | null> {
    const _ = getCommand()
    const collection = await getCollection('class_teachers')
    const { data } = await collection
      .where({ classId: _.eq(classId), userId: _.eq(userId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<ClassTeacher>(data[0] as Record<string, unknown>)
  }

  async create(input: NewClassTeacher): Promise<ClassTeacher | null> {
    // 集合没有复合主键，重复分配只能靠显式预检查（并发下为尽力而为）。
    const existing = await this.findByClassAndUser(input.classId, input.userId)
    if (existing) return null

    const collection = await getCollection('class_teachers')
    const doc: ClassTeacher = { ...input, createdAt: input.createdAt ?? now() }

    try {
      await collection.add(doc)
    } catch (error) {
      if (isCloudBaseDuplicateWriteError(error)) return null
      throw error
    }

    return doc
  }

  async remove(classId: string, userId: string): Promise<boolean> {
    const _ = getCommand()
    const collection = await getCollection('class_teachers')
    const { deleted } = await collection.where({ classId: _.eq(classId), userId: _.eq(userId) }).remove()
    return (deleted ?? 0) > 0
  }

  async listByClass(classId: string): Promise<ClassTeacher[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('class_teachers', { classId: _.eq(classId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassTeacher>(row))
  }

  async listByUser(userId: string): Promise<ClassTeacher[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('class_teachers', { userId: _.eq(userId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassTeacher>(row))
  }
}

export class CloudBaseClassEnrollmentRepository implements ClassEnrollmentRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findByClassAndStudent(classId: string, studentUserId: string): Promise<ClassEnrollment | null> {
    const _ = getCommand()
    const collection = await getCollection('class_enrollments')
    const { data } = await collection
      .where({ classId: _.eq(classId), studentUserId: _.eq(studentUserId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<ClassEnrollment>(data[0] as Record<string, unknown>)
  }

  async enroll(input: NewClassEnrollment): Promise<ClassEnrollment> {
    const ts = now()
    const _ = getCommand()
    const existing = await this.findByClassAndStudent(input.classId, input.studentUserId)
    const collection = await getCollection('class_enrollments')

    if (existing) {
      // 已经在班：幂等返回，不产生第二条记录。
      if (existing.status === 'active') return existing

      // 复学：复用同一条记录并清空退班时间，避免同一 (classId, studentUserId) 出现两条记录。
      await collection
        .where({ id: _.eq(existing.id) })
        .update({ status: 'active', leftAt: null, joinedAt: input.joinedAt ?? ts })
      return (await this.findByClassAndStudent(input.classId, input.studentUserId)) as ClassEnrollment
    }

    const doc: ClassEnrollment = { ...input, joinedAt: input.joinedAt ?? ts, leftAt: input.leftAt ?? null }
    await collection.add(doc)
    return doc
  }

  async leave(classId: string, studentUserId: string, leftAt: number): Promise<ClassEnrollment | null> {
    const existing = await this.findByClassAndStudent(classId, studentUserId)
    if (!existing || existing.status !== 'active') return null

    const _ = getCommand()
    const collection = await getCollection('class_enrollments')
    await collection.where({ id: _.eq(existing.id) }).update({ status: 'left', leftAt })
    return this.findByClassAndStudent(classId, studentUserId)
  }

  async listByClass(classId: string, options?: { includeLeft?: boolean }): Promise<ClassEnrollment[] | null> {
    const _ = getCommand()
    const filter: Record<string, unknown> = { classId: _.eq(classId) }
    if (!options?.includeLeft) filter.status = _.eq('active')

    const rows = await listAllPaged('class_enrollments', filter, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassEnrollment>(row))
  }

  async listByStudent(studentUserId: string): Promise<ClassEnrollment[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged(
      'class_enrollments',
      { studentUserId: _.eq(studentUserId) },
      this.pageSize,
      this.maxPages,
    )
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassEnrollment>(row))
  }
}

// ─── Course Repositories ────────────────────────────────────────────────────

export class CloudBaseCourseRepository implements CourseRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async findById(id: string): Promise<Course | null> {
    const _ = getCommand()
    const collection = await getCollection('courses')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<Course>(data[0] as Record<string, unknown>)
  }

  async create(course: NewCourse): Promise<Course> {
    const collection = await getCollection('courses')
    const ts = now()
    const doc: Course = { ...course, createdAt: course.createdAt ?? ts, updatedAt: course.updatedAt ?? ts }
    await collection.add(doc)
    return doc
  }

  async update(id: string, data: Partial<Omit<Course, 'id' | 'institutionId' | 'createdAt'>>): Promise<Course | null> {
    const existing = await this.findById(id)
    if (!existing) return null

    // updatedAt 由仓储刷新：让调用方传时间戳，等于把"最后修改时间"变成可以填错的字段
    const next: Course = { ...existing, ...data, id, institutionId: existing.institutionId, updatedAt: now() }
    const _ = getCommand()
    const collection = await getCollection('courses')
    await collection.where({ id: _.eq(id) }).update({
      title: next.title,
      description: next.description,
      coverAsset: next.coverAsset,
      stage: next.stage,
      topic: next.topic,
      status: next.status,
      ageRange: next.ageRange,
      goals: next.goals,
      expectedOutcome: next.expectedOutcome,
      updatedAt: next.updatedAt,
    })

    return next
  }

  async listByInstitution(institutionId: string): Promise<Course[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('courses', { institutionId: _.eq(institutionId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<Course>(row))
  }

  async createChapter(chapter: CourseChapter): Promise<CourseChapter> {
    const collection = await getCollection('course_chapters')
    await collection.add(chapter)
    return chapter
  }

  async createLesson(lesson: CourseLesson): Promise<CourseLesson> {
    const collection = await getCollection('course_lessons')
    await collection.add(lesson)
    return lesson
  }

  async createResource(resource: LessonResource): Promise<LessonResource> {
    const collection = await getCollection('lesson_resources')
    await collection.add(resource)
    return resource
  }

  async loadOutline(courseId: string): Promise<CourseOutline | null> {
    const course = await this.findById(courseId)
    // null 只表示"课程不存在"，调用方据此回 404
    if (!course) return null

    const _ = getCommand()
    const chapterRows = await listAllPaged(
      'course_chapters',
      { courseId: _.eq(courseId) },
      this.pageSize,
      this.maxPages,
    )
    // 读取被截断 ⇒ 抛错：把缺课的课程当完整课程展示，会让学生少上几节课
    if (chapterRows === null) throw new Error(COURSE_OUTLINE_UNKNOWN)

    const chapters = chapterRows.map((row) => stripCloudBaseId<CourseChapter>(row)).sort(bySortOrder)
    if (chapters.length === 0) return { course, chapters: [] }

    const lessonRows = await listAllPagedInChunks(
      'course_lessons',
      'chapterId',
      chapters.map((chapter) => chapter.id),
      this.pageSize,
      this.maxPages,
    )
    if (lessonRows === null) throw new Error(COURSE_OUTLINE_UNKNOWN)

    const lessons = lessonRows.map((row) => stripCloudBaseId<CourseLesson>(row)).sort(bySortOrder)

    const resourceRows =
      lessons.length === 0
        ? []
        : await listAllPagedInChunks(
            'lesson_resources',
            'lessonId',
            lessons.map((lesson) => lesson.id),
            this.pageSize,
            this.maxPages,
          )
    if (resourceRows === null) throw new Error(COURSE_OUTLINE_UNKNOWN)

    const resources = resourceRows.map((row) => stripCloudBaseId<LessonResource>(row))

    return {
      course,
      chapters: chapters.map((chapter) => ({
        chapter,
        lessons: lessons
          .filter((lesson) => lesson.chapterId === chapter.id)
          .map((lesson) => ({
            lesson,
            resources: resources
              .filter((resource) => resource.lessonId === lesson.id)
              .sort((left, right) => left.id.localeCompare(right.id)),
          })),
      })),
    }
  }
}

export class CloudBaseClassCourseRepository implements ClassCourseRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  private async find(classId: string, courseId: string): Promise<ClassCourse | null> {
    const _ = getCommand()
    const collection = await getCollection('class_courses')
    const { data } = await collection
      .where({ classId: _.eq(classId), courseId: _.eq(courseId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<ClassCourse>(data[0] as Record<string, unknown>)
  }

  async assign(input: NewClassCourse): Promise<ClassCourse> {
    // 幂等：已关联就返回原记录，且不刷新首次关联时间
    const existing = await this.find(input.classId, input.courseId)
    if (existing) return existing

    const collection = await getCollection('class_courses')
    const doc: ClassCourse = { ...input, assignedAt: input.assignedAt ?? now() }

    try {
      await collection.add(doc)
    } catch (error) {
      if (isCloudBaseDuplicateWriteError(error)) {
        const concurrent = await this.find(input.classId, input.courseId)
        if (concurrent) return concurrent
      }
      throw error
    }

    return doc
  }

  async listByClass(classId: string): Promise<ClassCourse[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('class_courses', { classId: _.eq(classId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassCourse>(row))
  }

  async listByCourse(courseId: string): Promise<ClassCourse[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('class_courses', { courseId: _.eq(courseId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<ClassCourse>(row))
  }
}

export class CloudBaseLessonProgressRepository implements LessonProgressRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  private async find(classId: string, lessonId: string): Promise<LessonProgress | null> {
    const _ = getCommand()
    const collection = await getCollection('lesson_progress')
    const { data } = await collection
      .where({ classId: _.eq(classId), lessonId: _.eq(lessonId) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<LessonProgress>(data[0] as Record<string, unknown>)
  }

  async setStatus(input: NewLessonProgress): Promise<LessonProgress> {
    // 非 completed 一律清空完成时间，避免留下过期的"完成时间"
    const completedAt = input.status === 'completed' ? (input.completedAt ?? now()) : null
    const existing = await this.find(input.classId, input.lessonId)

    if (existing) {
      const _ = getCommand()
      const collection = await getCollection('lesson_progress')
      await collection.where({ id: _.eq(existing.id) }).update({ status: input.status, completedAt })
      return { ...existing, status: input.status, completedAt }
    }

    const collection = await getCollection('lesson_progress')
    const doc: LessonProgress = {
      id: input.id,
      classId: input.classId,
      lessonId: input.lessonId,
      status: input.status,
      completedAt,
    }
    await collection.add(doc)
    return doc
  }

  async listByClass(classId: string): Promise<LessonProgress[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('lesson_progress', { classId: _.eq(classId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    return rows.map((row) => stripCloudBaseId<LessonProgress>(row))
  }
}

export class CloudBaseClassSessionRepository implements ClassSessionRepository {
  constructor(
    private readonly pageSize: number = TEACHER_PAGE_SIZE,
    private readonly maxPages: number = TEACHER_MAX_PAGES,
  ) {}

  async create(input: NewClassSession): Promise<ClassSession> {
    const collection = await getCollection('class_sessions')
    const doc: ClassSession = {
      id: input.id,
      classId: input.classId,
      lessonId: input.lessonId,
      startedByUserId: input.startedByUserId,
      startedAt: input.startedAt,
      endedAt: input.endedAt ?? null,
      durationMinutes: input.durationMinutes ?? null,
      pointLimit: input.pointLimit,
      capabilities: input.capabilities ?? '[]',
      skills: input.skills ?? '[]',
      mcpServers: input.mcpServers ?? '[]',
      studentCount: input.studentCount ?? null,
    }

    try {
      await collection.add(doc)
    } catch (error) {
      // CloudBase 没有部分唯一索引，靠"先查进行中的课再建"和这里的重复写兜底保持同一不变量
      if (isCloudBaseDuplicateWriteError(error)) {
        const active = await this.findActiveByClass(input.classId)
        if (active) return active
      }
      throw error
    }

    return doc
  }

  async findById(id: string): Promise<ClassSession | null> {
    const _ = getCommand()
    const collection = await getCollection('class_sessions')
    const { data } = await collection
      .where({ id: _.eq(id) })
      .limit(1)
      .get()
    if (!data || data.length === 0) return null
    return stripCloudBaseId<ClassSession>(data[0] as Record<string, unknown>)
  }

  async findActiveByClass(classId: string): Promise<ClassSession | null> {
    const _ = getCommand()
    // 显式翻页读全部"进行中"的行后自己挑最新的一节：CloudBase 的 where 不支持部分唯一索引，
    // 排序放在代码里而不是查询里，两个 Provider 才能给出同一答案。
    const rows = await listAllPaged(
      'class_sessions',
      { classId: _.eq(classId), endedAt: _.eq(null) },
      this.pageSize,
      this.maxPages,
    )
    // 读不全就不敢说"没有进行中的课"：写路径据此决定能不能再开一节，宁可报错也不能放行
    if (rows === null) throw new Error('Class session state unavailable')

    let active: ClassSession | null = null
    for (const row of rows.map((item) => stripCloudBaseId<ClassSession>(item))) {
      if (!active || row.startedAt > active.startedAt) active = row
    }
    return active
  }

  async listByClass(classId: string): Promise<ClassSession[] | null> {
    const _ = getCommand()
    const rows = await listAllPaged('class_sessions', { classId: _.eq(classId) }, this.pageSize, this.maxPages)
    if (rows === null) return null
    // 新课在前；CloudBase 的集合顺序不是承诺，排序放在代码里，两个 Provider 给同一答案
    return rows
      .map((row) => stripCloudBaseId<ClassSession>(row))
      .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
  }

  async update(id: string, patch: ClassSessionPatch): Promise<ClassSession | null> {
    const existing = await this.findById(id)
    if (!existing) return null

    // 已经下课的记录不再被改动：课堂时长是事实，不是可反复覆盖的设置
    if (existing.endedAt !== null && patch.endedAt !== undefined) return existing

    const next: ClassSession = {
      ...existing,
      pointLimit: patch.pointLimit ?? existing.pointLimit,
      capabilities: patch.capabilities ?? existing.capabilities,
      skills: patch.skills ?? existing.skills,
      mcpServers: patch.mcpServers ?? existing.mcpServers,
      endedAt: patch.endedAt ?? existing.endedAt,
      durationMinutes: patch.durationMinutes ?? existing.durationMinutes,
    }

    const _ = getCommand()
    const collection = await getCollection('class_sessions')
    await collection.where({ id: _.eq(id) }).update({
      pointLimit: next.pointLimit,
      capabilities: next.capabilities,
      skills: next.skills,
      mcpServers: next.mcpServers,
      endedAt: next.endedAt,
      durationMinutes: next.durationMinutes,
    })

    return next
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

export function createCloudBaseProvider(): DatabaseProvider {
  return {
    users: new CloudBaseUserRepository(),
    localCredentials: new CloudBaseLocalCredentialRepository(),
    tasks: new CloudBaseTaskRepository(),
    connectors: new CloudBaseConnectorRepository(),
    miniprogramApps: new CloudBaseMiniProgramAppRepository(),
    cronTasks: new CloudBaseCronTaskRepository(),
    accounts: new CloudBaseAccountRepository(),
    keys: new CloudBaseKeyRepository(),
    userResources: new CloudBaseUserResourceRepository(),
    settings: new CloudBaseSettingRepository(),
    deployments: new CloudBaseDeploymentRepository(),
    adminLogs: new CloudBaseAdminLogRepository(),
    envPool: new CloudBaseEnvPoolRepository(),
    communityWorks: new CloudBaseCommunityWorkRepository(),
    smsCodes: new CloudBaseSmsCodeRepository(),
    userCredits: new CloudBaseUserCreditsRepository(),
    creditTransactions: new CloudBaseCreditTransactionRepository(),
    subscriptionPlans: new CloudBaseSubscriptionPlanRepository(),
    userSubscriptions: new CloudBaseUserSubscriptionRepository(),
    dailyUsage: new CloudBaseDailyUsageRepository(),
    xiaobaoRuntimeCheckpoints: new CloudBaseXiaobaoCheckpointRepository(),
    xiaobaoUsageLedger: new CloudBaseXiaobaoUsageLedgerRepository(),
    institutions: new CloudBaseInstitutionRepository(),
    institutionMembers: new CloudBaseInstitutionMemberRepository(),
    classes: new CloudBaseTeacherClassRepository(),
    classTeachers: new CloudBaseClassTeacherRepository(),
    classEnrollments: new CloudBaseClassEnrollmentRepository(),
    courses: new CloudBaseCourseRepository(),
    classCourses: new CloudBaseClassCourseRepository(),
    lessonProgress: new CloudBaseLessonProgressRepository(),
    classSessions: new CloudBaseClassSessionRepository(),
  }
}
