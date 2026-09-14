import { eq, and, isNull, desc, sql, asc, gte, inArray, TransactionRollbackError } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { drizzleDb } from './client'
import {
  users,
  localCredentials,
  tasks,
  connectors,
  miniprogramApps,
  cronTasks,
  accounts,
  keys,
  userResources,
  settings,
  deployments,
  adminLogs,
  envPool,
  communityWorks,
  smsCodes,
  userCredits,
  creditTransactions,
  subscriptionPlans,
  userSubscriptions,
  dailyUsage,
  xiaobaoRuntimeCheckpoints,
  xiaobaoUsageReservations,
  institutions,
  institutionMembers,
  classes,
  classTeachers,
  classEnrollments,
  courses,
  courseChapters,
  courseLessons,
  lessonResources,
  classCourses,
  lessonProgress,
  classSessions,
} from '../schema'
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
  XiaobaoUsageLedgerRepository,
  XiaobaoUsageReservationRecord,
  XiaobaoUsageCategoryTotals,
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
  UsageReservationLedgerInput,
  UsageReservationLedgerResult,
  UsageSettlementLedgerInput,
  DatabaseProvider,
} from '../types'

const now = () => Date.now()

export class DrizzleXiaobaoCheckpointRepository implements CheckpointRepository {
  async healthCheck(): Promise<boolean> {
    try {
      await drizzleDb.select({ taskId: xiaobaoRuntimeCheckpoints.taskId }).from(xiaobaoRuntimeCheckpoints).limit(1)
      return true
    } catch {
      return false
    }
  }

  async checkReadWriteReadiness(): Promise<{ readable: boolean; writable: boolean }> {
    const taskId = '__xiaobao_runtime_readiness__'
    let rolledBack = false

    try {
      drizzleDb.transaction((transaction) => {
        transaction
          .insert(xiaobaoRuntimeCheckpoints)
          .values({
            taskId,
            revision: 0,
            schemaVersion: 1,
            snapshotJson: '{}',
            createdAt: 0,
            updatedAt: 0,
          })
          .run()
        transaction.rollback()
      })
    } catch (error) {
      if (!(error instanceof TransactionRollbackError)) return { readable: false, writable: false }
      rolledBack = true
    }

    try {
      const residue = await this.findByTaskId(taskId)
      return { readable: true, writable: rolledBack && residue === null }
    } catch {
      return { readable: false, writable: false }
    }
  }

  async findByTaskId(taskId: string): Promise<CheckpointRecord | null> {
    const [row] = await drizzleDb
      .select()
      .from(xiaobaoRuntimeCheckpoints)
      .where(eq(xiaobaoRuntimeCheckpoints.taskId, taskId))
      .limit(1)
    return row ?? null
  }

  async create(record: CheckpointRecord): Promise<CheckpointRecord | null> {
    const rows = await drizzleDb
      .insert(xiaobaoRuntimeCheckpoints)
      .values(record)
      .onConflictDoNothing({ target: xiaobaoRuntimeCheckpoints.taskId })
      .returning()
    return rows[0] ?? null
  }

  async compareAndSwap(
    taskId: string,
    expectedRevision: number,
    next: CheckpointRecord,
  ): Promise<CheckpointRecord | null> {
    const rows = await drizzleDb
      .update(xiaobaoRuntimeCheckpoints)
      .set(next)
      .where(
        and(eq(xiaobaoRuntimeCheckpoints.taskId, taskId), eq(xiaobaoRuntimeCheckpoints.revision, expectedRevision)),
      )
      .returning()
    return rows[0] ?? null
  }
}

// ─── XiaoBao Usage Ledger Repository ────────────────────────────────────────

const RESERVATION_CONFLICT = 'Usage reservation conflict'
const RESERVATION_ACCOUNTING_CONFLICT = 'Usage reservation accounting conflict'
const SETTLEMENT_CONFLICT = 'Usage settlement conflict'
const SETTLEMENT_EXCEEDS_RESERVATION = 'Usage settlement exceeds reservation'
const RELEASE_CONFLICT = 'Usage release conflict'

function mapUsageReservation(row: typeof xiaobaoUsageReservations.$inferSelect): XiaobaoUsageReservationRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    userId: row.userId,
    category: row.category,
    reservedUnits: row.reservedUnits,
    settledUnits: row.settledUnits,
    status: row.status,
    creditCostReserved: row.creditCostReserved,
    creditCostSettled: row.creditCostSettled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    settledAt: row.settledAt,
  }
}

function assertIdenticalReservation(
  row: typeof xiaobaoUsageReservations.$inferSelect,
  input: UsageReservationLedgerInput,
): void {
  if (
    row.userId !== input.userId ||
    row.category !== input.category ||
    row.reservedUnits !== input.reservedUnits ||
    row.creditCostReserved !== input.creditCostReserved
  ) {
    throw new Error(RESERVATION_CONFLICT)
  }
}

type DrizzleTransaction = Parameters<Parameters<typeof drizzleDb.transaction>[0]>[0]

function immediateTransaction<T>(operation: (transaction: DrizzleTransaction) => T): T {
  return drizzleDb.transaction(operation, { behavior: 'immediate' })
}

export class DrizzleXiaobaoUsageLedgerRepository implements XiaobaoUsageLedgerRepository {
  constructor(
    private readonly afterWrite: () => void = () => undefined,
    private readonly afterInitialRead: () => void = () => undefined,
  ) {}

  async reserve(input: UsageReservationLedgerInput): Promise<UsageReservationLedgerResult> {
    return immediateTransaction((transaction) => {
      const existing = transaction
        .select()
        .from(xiaobaoUsageReservations)
        .where(
          and(eq(xiaobaoUsageReservations.taskId, input.taskId), eq(xiaobaoUsageReservations.category, input.category)),
        )
        .get()
      if (existing) {
        assertIdenticalReservation(existing, input)
        return { allowed: true, record: mapUsageReservation(existing) }
      }

      let credits = transaction.select().from(userCredits).where(eq(userCredits.userId, input.userId)).get()
      this.afterInitialRead()
      if (!credits) {
        transaction
          .insert(userCredits)
          .values({
            id: nanoid(),
            userId: input.userId,
            balance: 0,
            frozenBalance: 0,
            lifetimeBalance: 0,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: userCredits.userId })
          .run()
        this.afterWrite()
        credits = transaction.select().from(userCredits).where(eq(userCredits.userId, input.userId)).get()
      }

      if (!credits || credits.balance < input.creditCostReserved) {
        return { allowed: false, reason: 'insufficient_credits' }
      }

      const id = nanoid()
      const insertResult = transaction
        .insert(xiaobaoUsageReservations)
        .values({
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
        })
        .onConflictDoNothing({
          target: [xiaobaoUsageReservations.taskId, xiaobaoUsageReservations.category],
        })
        .run()
      this.afterWrite()

      if (insertResult.changes === 0) {
        const concurrent = transaction
          .select()
          .from(xiaobaoUsageReservations)
          .where(
            and(
              eq(xiaobaoUsageReservations.taskId, input.taskId),
              eq(xiaobaoUsageReservations.category, input.category),
            ),
          )
          .get()
        if (!concurrent) throw new Error(RESERVATION_CONFLICT)
        assertIdenticalReservation(concurrent, input)
        return { allowed: true, record: mapUsageReservation(concurrent) }
      }

      const balanceAfter = credits.balance - input.creditCostReserved
      const freezeResult = transaction
        .update(userCredits)
        .set({
          balance: sql`${userCredits.balance} - ${input.creditCostReserved}`,
          frozenBalance: sql`${userCredits.frozenBalance} + ${input.creditCostReserved}`,
          updatedAt: input.now,
        })
        .where(and(eq(userCredits.userId, input.userId), sql`${userCredits.balance} >= ${input.creditCostReserved}`))
        .run()
      this.afterWrite()
      if (freezeResult.changes !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      transaction
        .insert(creditTransactions)
        .values({
          id: `xiaobao:${id}:reserve`,
          userId: input.userId,
          type: 'freeze',
          amount: -input.creditCostReserved,
          balanceAfter,
          description: 'XiaoBao usage reservation',
          metadata: null,
          createdAt: input.now,
        })
        .run()
      this.afterWrite()

      return {
        allowed: true,
        record: {
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
        },
      }
    })
  }

  async settle(input: UsageSettlementLedgerInput): Promise<XiaobaoUsageReservationRecord> {
    return immediateTransaction((transaction) => {
      const reservation = transaction
        .select()
        .from(xiaobaoUsageReservations)
        .where(eq(xiaobaoUsageReservations.id, input.reservationId))
        .get()
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
        return mapUsageReservation(reservation)
      }
      if (reservation.status !== 'reserved') throw new Error(SETTLEMENT_CONFLICT)
      if (input.creditCostSettled > reservation.creditCostReserved) {
        throw new Error(SETTLEMENT_EXCEEDS_RESERVATION)
      }

      const releasedCost = reservation.creditCostReserved - input.creditCostSettled
      const credits = transaction.select().from(userCredits).where(eq(userCredits.userId, reservation.userId)).get()
      this.afterInitialRead()
      if (!credits || credits.frozenBalance < reservation.creditCostReserved) {
        throw new Error(RESERVATION_ACCOUNTING_CONFLICT)
      }
      const balanceAfter = credits.balance + releasedCost

      const accountResult = transaction
        .update(userCredits)
        .set({
          balance: sql`${userCredits.balance} + ${releasedCost}`,
          frozenBalance: sql`${userCredits.frozenBalance} - ${reservation.creditCostReserved}`,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(userCredits.userId, reservation.userId),
            sql`${userCredits.frozenBalance} >= ${reservation.creditCostReserved}`,
          ),
        )
        .run()
      this.afterWrite()
      if (accountResult.changes !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      const updateResult = transaction
        .update(xiaobaoUsageReservations)
        .set({
          settledUnits: input.settledUnits,
          status: 'settled',
          creditCostSettled: input.creditCostSettled,
          updatedAt: input.now,
          settledAt: input.now,
        })
        .where(
          and(eq(xiaobaoUsageReservations.id, input.reservationId), eq(xiaobaoUsageReservations.status, 'reserved')),
        )
        .run()
      this.afterWrite()
      if (updateResult.changes !== 1) throw new Error(SETTLEMENT_CONFLICT)

      transaction
        .insert(creditTransactions)
        .values({
          id: `xiaobao:${reservation.id}:settle`,
          userId: reservation.userId,
          type: 'consumption',
          amount: -input.creditCostSettled,
          balanceAfter,
          description: 'XiaoBao usage settlement',
          metadata: null,
          createdAt: input.now,
        })
        .run()
      this.afterWrite()

      if (releasedCost > 0) {
        transaction
          .insert(creditTransactions)
          .values({
            id: `xiaobao:${reservation.id}:release`,
            userId: reservation.userId,
            type: 'refund',
            amount: releasedCost,
            balanceAfter,
            description: 'XiaoBao unused reservation release',
            metadata: null,
            createdAt: input.now,
          })
          .run()
        this.afterWrite()
      }

      return mapUsageReservation({
        ...reservation,
        settledUnits: input.settledUnits,
        status: 'settled',
        creditCostSettled: input.creditCostSettled,
        updatedAt: input.now,
        settledAt: input.now,
      })
    })
  }

  async release(
    reservationId: string,
    reason: 'safety_denied' | 'runtime_failed',
  ): Promise<XiaobaoUsageReservationRecord> {
    if (reason !== 'safety_denied' && reason !== 'runtime_failed') throw new Error(RELEASE_CONFLICT)
    return immediateTransaction((transaction) => {
      const reservation = transaction
        .select()
        .from(xiaobaoUsageReservations)
        .where(eq(xiaobaoUsageReservations.id, reservationId))
        .get()
      if (!reservation) throw new Error(RELEASE_CONFLICT)

      if (reservation.status === 'released') {
        const releaseTransaction = transaction
          .select({ metadata: creditTransactions.metadata })
          .from(creditTransactions)
          .where(eq(creditTransactions.id, `xiaobao:${reservationId}:release`))
          .get()
        let recordedReason: unknown
        try {
          recordedReason = releaseTransaction?.metadata
            ? (JSON.parse(releaseTransaction.metadata) as { reason?: unknown }).reason
            : undefined
        } catch {
          throw new Error(RELEASE_CONFLICT)
        }
        if (recordedReason !== reason) throw new Error(RELEASE_CONFLICT)
        return mapUsageReservation(reservation)
      }
      if (reservation.status !== 'reserved') throw new Error(RELEASE_CONFLICT)

      const credits = transaction.select().from(userCredits).where(eq(userCredits.userId, reservation.userId)).get()
      this.afterInitialRead()
      if (!credits || credits.frozenBalance < reservation.creditCostReserved) {
        throw new Error(RESERVATION_ACCOUNTING_CONFLICT)
      }
      const releasedAt = now()
      const balanceAfter = credits.balance + reservation.creditCostReserved

      const accountResult = transaction
        .update(userCredits)
        .set({
          balance: sql`${userCredits.balance} + ${reservation.creditCostReserved}`,
          frozenBalance: sql`${userCredits.frozenBalance} - ${reservation.creditCostReserved}`,
          updatedAt: releasedAt,
        })
        .where(
          and(
            eq(userCredits.userId, reservation.userId),
            sql`${userCredits.frozenBalance} >= ${reservation.creditCostReserved}`,
          ),
        )
        .run()
      this.afterWrite()
      if (accountResult.changes !== 1) throw new Error(RESERVATION_ACCOUNTING_CONFLICT)

      const updateResult = transaction
        .update(xiaobaoUsageReservations)
        .set({
          settledUnits: 0,
          status: 'released',
          creditCostSettled: 0,
          updatedAt: releasedAt,
          settledAt: releasedAt,
        })
        .where(and(eq(xiaobaoUsageReservations.id, reservationId), eq(xiaobaoUsageReservations.status, 'reserved')))
        .run()
      this.afterWrite()
      if (updateResult.changes !== 1) throw new Error(RELEASE_CONFLICT)

      transaction
        .insert(creditTransactions)
        .values({
          id: `xiaobao:${reservation.id}:release`,
          userId: reservation.userId,
          type: 'refund',
          amount: reservation.creditCostReserved,
          balanceAfter,
          description: 'XiaoBao reservation release',
          metadata: JSON.stringify({ reason }),
          createdAt: releasedAt,
        })
        .run()
      this.afterWrite()

      return mapUsageReservation({
        ...reservation,
        settledUnits: 0,
        status: 'released',
        creditCostSettled: 0,
        updatedAt: releasedAt,
        settledAt: releasedAt,
      })
    })
  }

  async findByTaskAndCategory(
    taskId: string,
    category: XiaobaoUsageReservationRecord['category'],
  ): Promise<XiaobaoUsageReservationRecord | null> {
    const row = drizzleDb
      .select()
      .from(xiaobaoUsageReservations)
      .where(and(eq(xiaobaoUsageReservations.taskId, taskId), eq(xiaobaoUsageReservations.category, category)))
      .get()
    return row ? mapUsageReservation(row) : null
  }

  async sumSettledCreditsByUser(userId: string, since: number | null): Promise<number | null> {
    const conditions = [eq(xiaobaoUsageReservations.userId, userId), eq(xiaobaoUsageReservations.status, 'settled')]
    if (since !== null) conditions.push(gte(xiaobaoUsageReservations.settledAt, since))

    const row = drizzleDb
      .select({ total: sql<number>`coalesce(sum(${xiaobaoUsageReservations.creditCostSettled}), 0)` })
      .from(xiaobaoUsageReservations)
      .where(and(...conditions))
      .get()

    return Number(row?.total ?? 0)
  }

  async sumSettledCreditsByUsers(userIds: readonly string[], since: number | null): Promise<number | null> {
    // 没有在班学生是**确定的 0**，与"无法确定"不同
    if (userIds.length === 0) return 0

    const conditions = [
      inArray(xiaobaoUsageReservations.userId, [...userIds]),
      eq(xiaobaoUsageReservations.status, 'settled'),
    ]
    if (since !== null) conditions.push(gte(xiaobaoUsageReservations.settledAt, since))

    const row = drizzleDb
      .select({ total: sql<number>`coalesce(sum(${xiaobaoUsageReservations.creditCostSettled}), 0)` })
      .from(xiaobaoUsageReservations)
      .where(and(...conditions))
      .get()

    return Number(row?.total ?? 0)
  }

  async sumSettledCreditsByUserByCategory(
    userId: string,
    since: number | null,
  ): Promise<XiaobaoUsageCategoryTotals | null> {
    const conditions = [eq(xiaobaoUsageReservations.userId, userId), eq(xiaobaoUsageReservations.status, 'settled')]
    if (since !== null) conditions.push(gte(xiaobaoUsageReservations.settledAt, since))

    const rows = drizzleDb
      .select({
        category: xiaobaoUsageReservations.category,
        total: sql<number>`coalesce(sum(${xiaobaoUsageReservations.creditCostSettled}), 0)`,
      })
      .from(xiaobaoUsageReservations)
      .where(and(...conditions))
      .groupBy(xiaobaoUsageReservations.category)
      .all()

    // 没有记录的分类保持 0：SQLite 的聚合是完整的，"没有用量"就是确切的 0。
    const totals: XiaobaoUsageCategoryTotals = { model: 0, tool: 0, sandbox: 0, media: 0 }
    for (const row of rows) totals[row.category] = Number(row.total ?? 0)
    return totals
  }

  async healthCheck(): Promise<boolean> {
    const probeId = nanoid()
    const probeTaskId = `__xiaobao_usage_probe__${nanoid()}`
    let creditsBefore: { count: number; balance: number; frozenBalance: number } | undefined
    let reservationsBefore: number | undefined
    let probeVerified = false

    try {
      drizzleDb.transaction((transaction) => {
        creditsBefore = transaction
          .select({
            count: sql<number>`count(*)`,
            balance: sql<number>`coalesce(sum(${userCredits.balance}), 0)`,
            frozenBalance: sql<number>`coalesce(sum(${userCredits.frozenBalance}), 0)`,
          })
          .from(userCredits)
          .get()
        reservationsBefore = transaction
          .select({ count: sql<number>`count(*)` })
          .from(xiaobaoUsageReservations)
          .get()?.count

        transaction
          .insert(xiaobaoUsageReservations)
          .values({
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
          .run()
        this.afterWrite()

        const probe = transaction
          .select({ id: xiaobaoUsageReservations.id })
          .from(xiaobaoUsageReservations)
          .where(eq(xiaobaoUsageReservations.id, probeId))
          .get()
        probeVerified = probe?.id === probeId
        transaction.rollback()
      })
    } catch (error) {
      if (!(error instanceof TransactionRollbackError) || !probeVerified) return false
    }

    try {
      const creditsAfter = drizzleDb
        .select({
          count: sql<number>`count(*)`,
          balance: sql<number>`coalesce(sum(${userCredits.balance}), 0)`,
          frozenBalance: sql<number>`coalesce(sum(${userCredits.frozenBalance}), 0)`,
        })
        .from(userCredits)
        .get()
      const reservationsAfter = drizzleDb
        .select({ count: sql<number>`count(*)` })
        .from(xiaobaoUsageReservations)
        .get()?.count
      const residue = drizzleDb
        .select({ id: xiaobaoUsageReservations.id })
        .from(xiaobaoUsageReservations)
        .where(eq(xiaobaoUsageReservations.id, probeId))
        .get()

      return (
        residue === undefined &&
        creditsBefore !== undefined &&
        creditsAfter !== undefined &&
        creditsAfter.count === creditsBefore.count &&
        creditsAfter.balance === creditsBefore.balance &&
        creditsAfter.frozenBalance === creditsBefore.frozenBalance &&
        reservationsAfter === reservationsBefore
      )
    } catch {
      return false
    }
  }
}

// ─── User Repository ────────────────────────────────────────────────────────

class DrizzleUserRepository implements UserRepository {
  async findById(id: string): Promise<User | null> {
    const [row] = await drizzleDb.select().from(users).where(eq(users.id, id)).limit(1)
    return (row as User) ?? null
  }

  async findByProviderAndExternalId(provider: string, externalId: string): Promise<User | null> {
    const [row] = await drizzleDb
      .select()
      .from(users)
      .where(and(eq(users.provider, provider), eq(users.externalId, externalId)))
      .limit(1)
    return (row as User) ?? null
  }

  async findByApiKey(encryptedApiKey: string): Promise<User | null> {
    const [row] = await drizzleDb.select().from(users).where(eq(users.apiKey, encryptedApiKey)).limit(1)
    return (row as User) ?? null
  }

  async findByPhone(phone: string): Promise<User | null> {
    const [row] = await drizzleDb.select().from(users).where(eq(users.phone, phone)).limit(1)
    return (row as User) ?? null
  }

  async create(user: NewUser): Promise<User> {
    const ts = now()
    const values = {
      ...user,
      createdAt: user.createdAt ?? ts,
      updatedAt: user.updatedAt ?? ts,
      lastLoginAt: user.lastLoginAt ?? ts,
    }
    await drizzleDb.insert(users).values(values)
    return values as User
  }

  async update(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null> {
    await drizzleDb
      .update(users)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(users.id, id))
    return this.findById(id)
  }

  async deleteById(id: string): Promise<void> {
    await drizzleDb.delete(users).where(eq(users.id, id))
  }

  // Admin methods
  async findAll(limit = 20, offset = 0): Promise<User[]> {
    const rows = await drizzleDb.select().from(users).limit(limit).offset(offset).orderBy(desc(users.createdAt))
    return rows as User[]
  }

  async count(): Promise<number> {
    const [result] = await drizzleDb.select({ count: sql<number>`count(*)` }).from(users)
    return Number(result?.count ?? 0)
  }

  async updateRole(id: string, role: 'user' | 'admin'): Promise<User | null> {
    await drizzleDb.update(users).set({ role, updatedAt: now() }).where(eq(users.id, id))
    return this.findById(id)
  }

  async disable(id: string, reason: string, adminUserId: string): Promise<User | null> {
    await drizzleDb
      .update(users)
      .set({
        status: 'disabled',
        disabledReason: reason,
        disabledAt: now(),
        disabledBy: adminUserId,
        updatedAt: now(),
      })
      .where(eq(users.id, id))
    return this.findById(id)
  }

  async enable(id: string): Promise<User | null> {
    await drizzleDb
      .update(users)
      .set({
        status: 'active',
        disabledReason: null,
        disabledAt: null,
        disabledBy: null,
        updatedAt: now(),
      })
      .where(eq(users.id, id))
    return this.findById(id)
  }
}

// ─── LocalCredential Repository ─────────────────────────────────────────────

class DrizzleLocalCredentialRepository implements LocalCredentialRepository {
  async findByUserId(userId: string): Promise<LocalCredential | null> {
    const [row] = await drizzleDb.select().from(localCredentials).where(eq(localCredentials.userId, userId)).limit(1)
    return (row as LocalCredential) ?? null
  }

  async create(credential: NewLocalCredential): Promise<LocalCredential> {
    const ts = now()
    const values = {
      ...credential,
      createdAt: credential.createdAt ?? ts,
      updatedAt: credential.updatedAt ?? ts,
    }
    await drizzleDb.insert(localCredentials).values(values)
    return values as LocalCredential
  }

  async update(userId: string, data: Partial<Omit<LocalCredential, 'userId'>>): Promise<LocalCredential | null> {
    await drizzleDb
      .update(localCredentials)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(localCredentials.userId, userId))
    return this.findByUserId(userId)
  }
}

// ─── Task Repository ────────────────────────────────────────────────────────

class DrizzleTaskRepository implements TaskRepository {
  async findById(id: string): Promise<Task | null> {
    const [row] = await drizzleDb.select().from(tasks).where(eq(tasks.id, id)).limit(1)
    return (row as unknown as Task) ?? null
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Task | null> {
    const [row] = await drizzleDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .limit(1)
    return (row as unknown as Task) ?? null
  }

  async findByUserId(userId: string, limit = 20): Promise<Task[]> {
    const rows = await drizzleDb
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
    return rows as unknown as Task[]
  }

  async findByRepoAndPr(userId: string, prNumber: number, repoUrl: string): Promise<Task[]> {
    const rows = await drizzleDb
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.prNumber, prNumber),
          eq(tasks.repoUrl, repoUrl),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1)
    return rows as unknown as Task[]
  }

  async findAll(limit: number, offset: number, filters?: { userId?: string; status?: string }): Promise<Task[]> {
    const conditions = [isNull(tasks.deletedAt)]
    if (filters?.userId) conditions.push(eq(tasks.userId, filters.userId))
    if (filters?.status) conditions.push(eq(tasks.status, filters.status))
    const rows = await drizzleDb
      .select()
      .from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
      .offset(offset)
    return rows as unknown as Task[]
  }

  async count(filters?: { userId?: string; status?: string }): Promise<number> {
    const conditions = [isNull(tasks.deletedAt)]
    if (filters?.userId) conditions.push(eq(tasks.userId, filters.userId))
    if (filters?.status) conditions.push(eq(tasks.status, filters.status))
    const rows = await drizzleDb
      .select({ count: sql<number>`count(*)` })
      .from(tasks)
      .where(and(...conditions))
    return Number(rows[0]?.count ?? 0)
  }

  async create(task: NewTask): Promise<Task> {
    const ts = now()
    const values = {
      ...task,
      createdAt: task.createdAt ?? ts,
      updatedAt: task.updatedAt ?? ts,
    }
    await drizzleDb.insert(tasks).values(values)
    const [row] = await drizzleDb.select().from(tasks).where(eq(tasks.id, task.id)).limit(1)
    return row as unknown as Task
  }

  async update(id: string, data: Partial<Omit<Task, 'id'>>): Promise<Task | null> {
    await drizzleDb
      .update(tasks)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(tasks.id, id))
    return this.findById(id)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(tasks).set({ userId: toUserId }).where(eq(tasks.userId, fromUserId))
  }

  async softDelete(id: string): Promise<void> {
    await drizzleDb.update(tasks).set({ deletedAt: now() }).where(eq(tasks.id, id))
  }
}

// ─── Connector Repository ───────────────────────────────────────────────────

class DrizzleConnectorRepository implements ConnectorRepository {
  async findByUserId(userId: string): Promise<Connector[]> {
    const rows = await drizzleDb.select().from(connectors).where(eq(connectors.userId, userId))
    return rows as Connector[]
  }

  async findByIdAndUserId(id: string, userId: string): Promise<Connector | null> {
    const [row] = await drizzleDb
      .select()
      .from(connectors)
      .where(and(eq(connectors.id, id), eq(connectors.userId, userId)))
      .limit(1)
    return (row as Connector) ?? null
  }

  async create(connector: NewConnector): Promise<Connector> {
    const ts = now()
    const values = {
      ...connector,
      createdAt: connector.createdAt ?? ts,
      updatedAt: connector.updatedAt ?? ts,
    }
    await drizzleDb.insert(connectors).values(values)
    return values as Connector
  }

  async update(id: string, userId: string, data: Partial<Omit<Connector, 'id' | 'userId'>>): Promise<Connector | null> {
    await drizzleDb
      .update(connectors)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(and(eq(connectors.id, id), eq(connectors.userId, userId)))
    return this.findByIdAndUserId(id, userId)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(connectors).set({ userId: toUserId }).where(eq(connectors.userId, fromUserId))
  }

  async delete(id: string, userId: string): Promise<void> {
    await drizzleDb.delete(connectors).where(and(eq(connectors.id, id), eq(connectors.userId, userId)))
  }
}

// ─── MiniProgramApp Repository ──────────────────────────────────────────────

class DrizzleMiniProgramAppRepository implements MiniProgramAppRepository {
  async findByUserId(userId: string): Promise<MiniProgramApp[]> {
    const rows = await drizzleDb.select().from(miniprogramApps).where(eq(miniprogramApps.userId, userId))
    return rows as MiniProgramApp[]
  }

  async findByIdAndUserId(id: string, userId: string): Promise<MiniProgramApp | null> {
    const [row] = await drizzleDb
      .select()
      .from(miniprogramApps)
      .where(and(eq(miniprogramApps.id, id), eq(miniprogramApps.userId, userId)))
      .limit(1)
    return (row as MiniProgramApp) ?? null
  }

  async findByAppIdAndUserId(appId: string, userId: string): Promise<MiniProgramApp | null> {
    const [row] = await drizzleDb
      .select()
      .from(miniprogramApps)
      .where(and(eq(miniprogramApps.appId, appId), eq(miniprogramApps.userId, userId)))
      .limit(1)
    return (row as MiniProgramApp) ?? null
  }

  async create(app: NewMiniProgramApp): Promise<MiniProgramApp> {
    const ts = now()
    const values = {
      ...app,
      createdAt: app.createdAt ?? ts,
      updatedAt: app.updatedAt ?? ts,
    }
    await drizzleDb.insert(miniprogramApps).values(values)
    return values as MiniProgramApp
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<MiniProgramApp, 'id' | 'userId'>>,
  ): Promise<MiniProgramApp | null> {
    await drizzleDb
      .update(miniprogramApps)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(and(eq(miniprogramApps.id, id), eq(miniprogramApps.userId, userId)))
    return this.findByIdAndUserId(id, userId)
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(miniprogramApps).set({ userId: toUserId }).where(eq(miniprogramApps.userId, fromUserId))
  }

  async delete(id: string, userId: string): Promise<void> {
    await drizzleDb.delete(miniprogramApps).where(and(eq(miniprogramApps.id, id), eq(miniprogramApps.userId, userId)))
  }
}

// ─── Account Repository ─────────────────────────────────────────────────────

// ─── CronTask Repository ────────────────────────────────────────────────────

class DrizzleCronTaskRepository implements CronTaskRepository {
  async findByUserId(userId: string): Promise<CronTask[]> {
    const rows = await drizzleDb.select().from(cronTasks).where(eq(cronTasks.userId, userId))
    return rows as CronTask[]
  }

  async findByIdAndUserId(id: string, userId: string): Promise<CronTask | null> {
    const [row] = await drizzleDb
      .select()
      .from(cronTasks)
      .where(and(eq(cronTasks.id, id), eq(cronTasks.userId, userId)))
      .limit(1)
    return (row as CronTask) ?? null
  }

  async findAllEnabled(): Promise<CronTask[]> {
    const rows = await drizzleDb.select().from(cronTasks).where(eq(cronTasks.enabled, true))
    return rows as CronTask[]
  }

  async create(task: NewCronTask): Promise<CronTask> {
    const ts = now()
    const values = {
      ...task,
      createdAt: task.createdAt ?? ts,
      updatedAt: task.updatedAt ?? ts,
    }
    await drizzleDb.insert(cronTasks).values(values)
    return values as CronTask
  }

  async update(id: string, userId: string, data: Partial<Omit<CronTask, 'id' | 'userId'>>): Promise<CronTask | null> {
    await drizzleDb
      .update(cronTasks)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(and(eq(cronTasks.id, id), eq(cronTasks.userId, userId)))
    return this.findByIdAndUserId(id, userId)
  }

  async delete(id: string, userId: string): Promise<void> {
    await drizzleDb.delete(cronTasks).where(and(eq(cronTasks.id, id), eq(cronTasks.userId, userId)))
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(cronTasks).set({ userId: toUserId }).where(eq(cronTasks.userId, fromUserId))
  }

  async tryLock(id: string, lockerId: string, maxLockMs: number): Promise<boolean> {
    const cutoff = Date.now() - maxLockMs
    // Atomic CAS: only acquire if unlocked or lock expired
    const result = await drizzleDb
      .update(cronTasks)
      .set({ lockedBy: lockerId, lockedAt: Date.now() })
      .where(and(eq(cronTasks.id, id), sql`(${cronTasks.lockedBy} IS NULL OR ${cronTasks.lockedAt} < ${cutoff})`))
    return (result as any).changes > 0
  }

  async releaseLock(id: string, lockerId: string): Promise<void> {
    await drizzleDb
      .update(cronTasks)
      .set({ lockedBy: null, lockedAt: null })
      .where(and(eq(cronTasks.id, id), eq(cronTasks.lockedBy, lockerId)))
  }
}

// ─── Account Repository ─────────────────────────────────────────────────────

class DrizzleAccountRepository implements AccountRepository {
  async findByUserIdAndProvider(userId: string, provider: string): Promise<Account | null> {
    const [row] = await drizzleDb
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)))
      .limit(1)
    return (row as Account) ?? null
  }

  async findByProviderAndExternalUserId(provider: string, externalUserId: string): Promise<Account | null> {
    const [row] = await drizzleDb
      .select()
      .from(accounts)
      .where(and(eq(accounts.provider, provider), eq(accounts.externalUserId, externalUserId)))
      .limit(1)
    return (row as Account) ?? null
  }

  async create(account: NewAccount): Promise<Account> {
    const ts = now()
    const values = {
      ...account,
      createdAt: account.createdAt ?? ts,
      updatedAt: account.updatedAt ?? ts,
    }
    await drizzleDb.insert(accounts).values(values)
    return values as Account
  }

  async update(id: string, data: Partial<Omit<Account, 'id'>>): Promise<Account | null> {
    await drizzleDb
      .update(accounts)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(accounts.id, id))
    const [row] = await drizzleDb.select().from(accounts).where(eq(accounts.id, id)).limit(1)
    return (row as Account) ?? null
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(accounts).set({ userId: toUserId }).where(eq(accounts.userId, fromUserId))
  }

  async delete(userId: string, provider: string): Promise<void> {
    await drizzleDb.delete(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)))
  }
}

// ─── Key Repository ─────────────────────────────────────────────────────────

class DrizzleKeyRepository implements KeyRepository {
  async findByUserId(userId: string): Promise<Key[]> {
    const rows = await drizzleDb.select().from(keys).where(eq(keys.userId, userId))
    return rows as Key[]
  }

  async findByUserIdAndProvider(userId: string, provider: string): Promise<Key | null> {
    const [row] = await drizzleDb
      .select()
      .from(keys)
      .where(and(eq(keys.userId, userId), eq(keys.provider, provider)))
      .limit(1)
    return (row as Key) ?? null
  }

  async upsert(key: NewKey): Promise<Key> {
    const ts = now()
    const existing = await this.findByUserIdAndProvider(key.userId, key.provider)
    if (existing) {
      await drizzleDb
        .update(keys)
        .set({ value: key.value, updatedAt: ts })
        .where(and(eq(keys.userId, key.userId), eq(keys.provider, key.provider)))
      return { ...existing, value: key.value, updatedAt: ts }
    }
    const values = {
      ...key,
      id: key.id || nanoid(),
      createdAt: key.createdAt ?? ts,
      updatedAt: key.updatedAt ?? ts,
    }
    await drizzleDb.insert(keys).values(values)
    return values as Key
  }

  async updateUserId(fromUserId: string, toUserId: string): Promise<void> {
    await drizzleDb.update(keys).set({ userId: toUserId }).where(eq(keys.userId, fromUserId))
  }

  async delete(userId: string, provider: string): Promise<void> {
    await drizzleDb.delete(keys).where(and(eq(keys.userId, userId), eq(keys.provider, provider)))
  }
}

// ─── UserResource Repository ────────────────────────────────────────────────

class DrizzleUserResourceRepository implements UserResourceRepository {
  async findByUserId(userId: string): Promise<UserResource | null> {
    // Return user-scoped resource (scope='user'), backwards compatible
    const [row] = await drizzleDb
      .select()
      .from(userResources)
      .where(and(eq(userResources.userId, userId), eq(userResources.scope, 'user')))
      .limit(1)
    return (row as UserResource) ?? null
  }

  async findByTaskId(taskId: string): Promise<UserResource | null> {
    const [row] = await drizzleDb
      .select()
      .from(userResources)
      .where(and(eq(userResources.scope, 'task'), eq(userResources.taskId, taskId)))
      .limit(1)
    return (row as UserResource) ?? null
  }

  async findAllByUserId(userId: string): Promise<UserResource[]> {
    const rows = await drizzleDb.select().from(userResources).where(eq(userResources.userId, userId))
    return rows as UserResource[]
  }

  async create(resource: NewUserResource): Promise<UserResource> {
    const ts = now()
    const values = {
      ...resource,
      scope: resource.scope || 'user',
      taskId: resource.taskId ?? null,
      createdAt: resource.createdAt ?? ts,
      updatedAt: resource.updatedAt ?? ts,
    }
    await drizzleDb.insert(userResources).values(values)
    return values as UserResource
  }

  async update(id: string, data: Partial<Omit<UserResource, 'id'>>): Promise<UserResource | null> {
    await drizzleDb
      .update(userResources)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(userResources.id, id))
    const [row] = await drizzleDb.select().from(userResources).where(eq(userResources.id, id)).limit(1)
    return (row as UserResource) ?? null
  }

  async deleteById(id: string): Promise<void> {
    await drizzleDb.delete(userResources).where(eq(userResources.id, id))
  }
}

// ─── Setting Repository ─────────────────────────────────────────────────────

class DrizzleSettingRepository implements SettingRepository {
  async findByUserIdAndKey(userId: string, key: string): Promise<Setting | null> {
    const [row] = await drizzleDb
      .select()
      .from(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, key)))
      .limit(1)
    return (row as Setting) ?? null
  }

  async findByUserId(userId: string): Promise<Setting[]> {
    const rows = await drizzleDb.select().from(settings).where(eq(settings.userId, userId))
    return rows as Setting[]
  }

  async upsert(setting: NewSetting): Promise<Setting> {
    const ts = now()
    const existing = setting.userId
      ? await this.findByUserIdAndKey(setting.userId, setting.key)
      : await this.findSystemSetting(setting.key)
    if (existing) {
      const condition = setting.userId
        ? and(eq(settings.userId, setting.userId), eq(settings.key, setting.key))
        : and(isNull(settings.userId), eq(settings.key, setting.key))
      await drizzleDb.update(settings).set({ value: setting.value, updatedAt: ts }).where(condition)
      return { ...existing, value: setting.value, updatedAt: ts }
    }
    const values = {
      ...setting,
      id: setting.id || nanoid(),
      createdAt: setting.createdAt ?? ts,
      updatedAt: setting.updatedAt ?? ts,
    }
    await drizzleDb.insert(settings).values(values)
    return values as Setting
  }

  async findSystemSetting(key: string): Promise<Setting | null> {
    const [row] = await drizzleDb
      .select()
      .from(settings)
      .where(and(isNull(settings.userId), eq(settings.key, key)))
      .limit(1)
    return (row as Setting) ?? null
  }

  async upsertSystemSetting(key: string, value: string): Promise<Setting> {
    return this.upsert({ id: nanoid(), userId: null, key, value })
  }

  async deleteSystemSetting(key: string): Promise<boolean> {
    const result = await drizzleDb.delete(settings).where(and(isNull(settings.userId), eq(settings.key, key)))
    // drizzle 不同 driver 返回结构不一，统一通过 changes/affectedRows 判断
    const affected = (result as any).changes ?? (result as any).rowCount ?? (result as any).affectedRows ?? 0
    return affected > 0
  }

  async findAllSystemSettings(): Promise<Setting[]> {
    const rows = await drizzleDb.select().from(settings).where(isNull(settings.userId))
    return rows as Setting[]
  }
}

// ─── Deployment Repository ──────────────────────────────────────────────────

class DrizzleDeploymentRepository implements DeploymentRepository {
  async findByTaskId(taskId: string): Promise<Deployment[]> {
    const rows = await drizzleDb
      .select()
      .from(deployments)
      .where(and(eq(deployments.taskId, taskId), isNull(deployments.deletedAt)))
    return rows as Deployment[]
  }

  async findByTaskIdAndTypePath(taskId: string, type: string, path: string | null): Promise<Deployment | null> {
    const conditions = [eq(deployments.taskId, taskId), eq(deployments.type, type), isNull(deployments.deletedAt)]
    if (path !== null) {
      conditions.push(eq(deployments.path, path))
    } else {
      conditions.push(isNull(deployments.path))
    }
    const [row] = await drizzleDb
      .select()
      .from(deployments)
      .where(and(...conditions))
      .limit(1)
    return (row as Deployment) ?? null
  }

  async findByTaskIdAndUserId(taskId: string, userId: string): Promise<Deployment | null> {
    const [row] = await drizzleDb
      .select()
      .from(deployments)
      .innerJoin(tasks, eq(deployments.taskId, tasks.id))
      .where(and(eq(deployments.taskId, taskId), eq(tasks.userId, userId), isNull(deployments.deletedAt)))
      .limit(1)
    return row ? (row.deployments as Deployment) : null
  }

  async create(deployment: NewDeployment): Promise<Deployment> {
    const ts = now()
    const values = {
      ...deployment,
      createdAt: deployment.createdAt ?? ts,
      updatedAt: deployment.updatedAt ?? ts,
    }
    await drizzleDb.insert(deployments).values(values)
    return values as Deployment
  }

  async update(id: string, data: Partial<Omit<Deployment, 'id'>>): Promise<Deployment | null> {
    await drizzleDb
      .update(deployments)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(deployments.id, id))
    const [row] = await drizzleDb.select().from(deployments).where(eq(deployments.id, id)).limit(1)
    return (row as Deployment) ?? null
  }

  async softDelete(id: string): Promise<void> {
    await drizzleDb.update(deployments).set({ deletedAt: now() }).where(eq(deployments.id, id))
  }
}

// ─── AdminLog Repository ───────────────────────────────────────────────────────

class DrizzleAdminLogRepository implements AdminLogRepository {
  async create(log: NewAdminLog): Promise<AdminLog> {
    const ts = now()
    const values = {
      ...log,
      createdAt: log.createdAt ?? ts,
    }
    await drizzleDb.insert(adminLogs).values(values)
    return values as AdminLog
  }

  async findByAdminUserId(adminUserId: string, limit = 50): Promise<AdminLog[]> {
    const rows = await drizzleDb
      .select()
      .from(adminLogs)
      .where(eq(adminLogs.adminUserId, adminUserId))
      .limit(limit)
      .orderBy(desc(adminLogs.createdAt))
    return rows as AdminLog[]
  }

  async findByTargetUserId(targetUserId: string, limit = 50): Promise<AdminLog[]> {
    const rows = await drizzleDb
      .select()
      .from(adminLogs)
      .where(eq(adminLogs.targetUserId, targetUserId))
      .limit(limit)
      .orderBy(desc(adminLogs.createdAt))
    return rows as AdminLog[]
  }

  async findAll(limit = 50, offset = 0): Promise<AdminLog[]> {
    const rows = await drizzleDb.select().from(adminLogs).limit(limit).offset(offset).orderBy(desc(adminLogs.createdAt))
    return rows as AdminLog[]
  }
}

// ─── EnvPool Repository ────────────────────────────────────────────────────

class DrizzleEnvPoolRepository implements EnvPoolRepository {
  async findReady(): Promise<EnvPoolEntry | null> {
    const [row] = await drizzleDb
      .select()
      .from(envPool)
      .where(eq(envPool.status, 'ready'))
      .orderBy(asc(envPool.createdAt))
      .limit(1)
    return (row as EnvPoolEntry) ?? null
  }

  async claimEntry(
    id: string,
    data: { claimedByUserId: string; claimedByTaskId: string | null; claimedAt: number },
  ): Promise<EnvPoolEntry | null> {
    // CAS: only update if status is still 'ready'
    const result = await drizzleDb
      .update(envPool)
      .set({ status: 'claimed', ...data, updatedAt: now() })
      .where(and(eq(envPool.id, id), eq(envPool.status, 'ready')))
    // SQLite: changes === 0 means row was already claimed by another pod
    if ((result as any).changes === 0 && (result as any).rowsAffected === undefined) {
      // Drizzle returns different shapes depending on driver; check by re-reading
      const [row] = await drizzleDb.select().from(envPool).where(eq(envPool.id, id)).limit(1)
      if (!row || row.status !== 'claimed' || row.claimedByUserId !== data.claimedByUserId) return null
      return row as EnvPoolEntry
    }
    const [row] = await drizzleDb.select().from(envPool).where(eq(envPool.id, id)).limit(1)
    if (!row || row.status !== 'claimed') return null
    return row as EnvPoolEntry
  }

  async countByStatus(status: string): Promise<number> {
    const [row] = await drizzleDb
      .select({ count: sql<number>`count(*)` })
      .from(envPool)
      .where(eq(envPool.status, status))
    return row?.count ?? 0
  }

  async findAllByStatus(status: string): Promise<EnvPoolEntry[]> {
    const rows = await drizzleDb.select().from(envPool).where(eq(envPool.status, status))
    return rows as EnvPoolEntry[]
  }

  async countActive(): Promise<number> {
    const [row] = await drizzleDb
      .select({ count: sql<number>`count(*)` })
      .from(envPool)
      .where(sql`${envPool.status} IN ('creating', 'ready')`)
    return row?.count ?? 0
  }

  async create(entry: NewEnvPoolEntry): Promise<EnvPoolEntry> {
    const ts = now()
    const values = {
      ...entry,
      createdAt: entry.createdAt ?? ts,
      updatedAt: entry.updatedAt ?? ts,
    }
    await drizzleDb.insert(envPool).values(values)
    return values as EnvPoolEntry
  }

  async update(id: string, data: Partial<Omit<EnvPoolEntry, 'id'>>): Promise<EnvPoolEntry | null> {
    await drizzleDb
      .update(envPool)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(envPool.id, id))
    const [row] = await drizzleDb.select().from(envPool).where(eq(envPool.id, id)).limit(1)
    return (row as EnvPoolEntry) ?? null
  }

  async getStats(): Promise<Record<string, number>> {
    const rows = await drizzleDb
      .select({ status: envPool.status, count: sql<number>`count(*)` })
      .from(envPool)
      .groupBy(envPool.status)
    const stats: Record<string, number> = { creating: 0, ready: 0, claimed: 0, failed: 0 }
    for (const row of rows) {
      stats[row.status] = row.count
    }
    return stats
  }
}

// ─── CommunityWork Repository ──────────────────────────────────────────────

class DrizzleCommunityWorkRepository implements CommunityWorkRepository {
  async findAll(limit = 50, offset = 0): Promise<CommunityWork[]> {
    const rows = await drizzleDb
      .select()
      .from(communityWorks)
      .orderBy(desc(communityWorks.createdAt))
      .limit(limit)
      .offset(offset)
    return rows as CommunityWork[]
  }

  async findByUserId(userId: string): Promise<CommunityWork[]> {
    const rows = await drizzleDb
      .select()
      .from(communityWorks)
      .where(eq(communityWorks.userId, userId))
      .orderBy(desc(communityWorks.createdAt))
    return rows as CommunityWork[]
  }

  async findById(id: string): Promise<CommunityWork | null> {
    const [row] = await drizzleDb.select().from(communityWorks).where(eq(communityWorks.id, id)).limit(1)
    return (row as CommunityWork) ?? null
  }

  async create(work: NewCommunityWork): Promise<CommunityWork> {
    const ts = now()
    const values = {
      ...work,
      createdAt: work.createdAt ?? ts,
      updatedAt: work.updatedAt ?? ts,
    }
    await drizzleDb.insert(communityWorks).values(values)
    return values as CommunityWork
  }

  async update(
    id: string,
    userId: string,
    data: Partial<Omit<CommunityWork, 'id' | 'userId'>>,
  ): Promise<CommunityWork | null> {
    await drizzleDb
      .update(communityWorks)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(and(eq(communityWorks.id, id), eq(communityWorks.userId, userId)))
    return this.findById(id)
  }

  async delete(id: string, userId: string): Promise<void> {
    await drizzleDb.delete(communityWorks).where(and(eq(communityWorks.id, id), eq(communityWorks.userId, userId)))
  }

  async count(): Promise<number> {
    const [row] = await drizzleDb.select({ count: sql<number>`count(*)` }).from(communityWorks)
    return row?.count ?? 0
  }
}

// ─── SmsCode Repository ──────────────────────────────────────────────────────

class DrizzleSmsCodeRepository implements SmsCodeRepository {
  async create(code: NewSmsCode): Promise<SmsCode> {
    const ts = now()
    const values = {
      ...code,
      createdAt: code.createdAt ?? ts,
    }
    await drizzleDb.insert(smsCodes).values(values)
    return values as SmsCode
  }

  async findByPhoneAndCode(phone: string, code: string): Promise<SmsCode | null> {
    const [row] = await drizzleDb
      .select()
      .from(smsCodes)
      .where(and(eq(smsCodes.phone, phone), eq(smsCodes.code, code)))
      .orderBy(desc(smsCodes.createdAt))
      .limit(1)
    return (row as SmsCode) ?? null
  }

  async markUsed(id: string): Promise<void> {
    await drizzleDb.update(smsCodes).set({ used: true }).where(eq(smsCodes.id, id))
  }

  async deleteExpired(): Promise<void> {
    await drizzleDb.delete(smsCodes).where(sql`${smsCodes.expiresAt} < ${now()}`)
  }
}

// ─── UserCredits Repository ──────────────────────────────────────────────────

class DrizzleUserCreditsRepository implements UserCreditsRepository {
  async findByUserId(userId: string): Promise<UserCredits | null> {
    const [row] = await drizzleDb.select().from(userCredits).where(eq(userCredits.userId, userId)).limit(1)
    return (row as UserCredits) ?? null
  }

  async create(credits: NewUserCredits): Promise<UserCredits> {
    const ts = now()
    const values = {
      ...credits,
      createdAt: credits.createdAt ?? ts,
      updatedAt: credits.updatedAt ?? ts,
    }
    await drizzleDb.insert(userCredits).values(values)
    return values as UserCredits
  }

  async updateByUserId(userId: string, data: Partial<Omit<UserCredits, 'id' | 'userId'>>): Promise<UserCredits | null> {
    await drizzleDb
      .update(userCredits)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(userCredits.userId, userId))
    return this.findByUserId(userId)
  }

  async consumeByUserId(userId: string, amount: number, ts: number): Promise<UserCredits | null> {
    // Atomic consume: only update if balance >= amount
    const result = await drizzleDb
      .update(userCredits)
      .set({ balance: sql`${userCredits.balance} - ${amount}`, updatedAt: ts })
      .where(and(eq(userCredits.userId, userId), sql`${userCredits.balance} >= ${amount}`))
    if ((result as any).changes === 0) return null
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

class DrizzleCreditTransactionRepository implements CreditTransactionRepository {
  async create(tx: NewCreditTransaction): Promise<CreditTransaction> {
    const ts = now()
    const values = {
      ...tx,
      id: tx.id ?? nanoid(),
      createdAt: tx.createdAt ?? ts,
    }
    await drizzleDb.insert(creditTransactions).values(values)
    return values as CreditTransaction
  }

  async findByUserId(userId: string, limit = 50, offset = 0): Promise<CreditTransaction[]> {
    const rows = await drizzleDb
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
      .offset(offset)
    return rows as CreditTransaction[]
  }

  async findByUserIdAndType(userId: string, type: string, limit = 50): Promise<CreditTransaction[]> {
    const rows = await drizzleDb
      .select()
      .from(creditTransactions)
      .where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, type)))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
    return rows as CreditTransaction[]
  }

  async findAll(limit = 100, offset = 0): Promise<CreditTransaction[]> {
    const rows = await drizzleDb
      .select()
      .from(creditTransactions)
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit)
      .offset(offset)
    return rows as CreditTransaction[]
  }
}

// ─── SubscriptionPlan Repository ─────────────────────────────────────────────

class DrizzleSubscriptionPlanRepository implements SubscriptionPlanRepository {
  async findById(id: string): Promise<SubscriptionPlan | null> {
    const [row] = await drizzleDb.select().from(subscriptionPlans).where(eq(subscriptionPlans.id, id)).limit(1)
    return (row as SubscriptionPlan) ?? null
  }

  async findActive(): Promise<SubscriptionPlan[]> {
    return this.findAllActive()
  }

  async findAllActive(): Promise<SubscriptionPlan[]> {
    const rows = await drizzleDb
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.active, true))
      .orderBy(asc(subscriptionPlans.sortOrder))
    return rows as SubscriptionPlan[]
  }

  async findAll(): Promise<SubscriptionPlan[]> {
    const rows = await drizzleDb.select().from(subscriptionPlans).orderBy(asc(subscriptionPlans.sortOrder))
    return rows as SubscriptionPlan[]
  }

  async create(plan: NewSubscriptionPlan): Promise<SubscriptionPlan> {
    const ts = now()
    const values = {
      ...plan,
      createdAt: plan.createdAt ?? ts,
      updatedAt: plan.updatedAt ?? ts,
    }
    await drizzleDb.insert(subscriptionPlans).values(values)
    return values as SubscriptionPlan
  }

  async update(id: string, data: Partial<Omit<SubscriptionPlan, 'id'>>): Promise<SubscriptionPlan | null> {
    await drizzleDb
      .update(subscriptionPlans)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(subscriptionPlans.id, id))
    return this.findById(id)
  }

  async count(): Promise<number> {
    const [row] = await drizzleDb.select({ count: sql<number>`count(*)` }).from(subscriptionPlans)
    return row?.count ?? 0
  }
}

// ─── UserSubscription Repository ─────────────────────────────────────────────

class DrizzleUserSubscriptionRepository implements UserSubscriptionRepository {
  async findByUserId(userId: string): Promise<UserSubscription | null> {
    const [row] = await drizzleDb
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1)
    return (row as UserSubscription) ?? null
  }

  async findActiveByUserId(userId: string): Promise<UserSubscription | null> {
    const [row] = await drizzleDb
      .select()
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.userId, userId), eq(userSubscriptions.status, 'active')))
      .limit(1)
    return (row as UserSubscription) ?? null
  }

  async create(sub: NewUserSubscription): Promise<UserSubscription> {
    const ts = now()
    const values = {
      ...sub,
      createdAt: sub.createdAt ?? ts,
      updatedAt: sub.updatedAt ?? ts,
    }
    await drizzleDb.insert(userSubscriptions).values(values)
    return values as UserSubscription
  }

  async update(id: string, data: Partial<Omit<UserSubscription, 'id'>>): Promise<UserSubscription | null> {
    await drizzleDb
      .update(userSubscriptions)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(userSubscriptions.id, id))
    const [row] = await drizzleDb.select().from(userSubscriptions).where(eq(userSubscriptions.id, id)).limit(1)
    return (row as UserSubscription) ?? null
  }

  async findExpiringActive(beforeTime: number): Promise<UserSubscription[]> {
    const rows = await drizzleDb
      .select()
      .from(userSubscriptions)
      .where(and(eq(userSubscriptions.status, 'active'), sql`${userSubscriptions.currentPeriodEnd} < ${beforeTime}`))
    return rows as UserSubscription[]
  }

  async findAllActive(): Promise<UserSubscription[]> {
    return this.findByStatus('active')
  }

  async findByStatus(status: string): Promise<UserSubscription[]> {
    const rows = await drizzleDb
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.status, status))
      .orderBy(desc(userSubscriptions.createdAt))
    return rows as UserSubscription[]
  }

  async countByStatus(status: string): Promise<number> {
    const [row] = await drizzleDb
      .select({ count: sql<number>`count(*)` })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.status, status))
    return row?.count ?? 0
  }
}

// ─── DailyUsage Repository ───────────────────────────────────────────────────

class DrizzleDailyUsageRepository implements DailyUsageRepository {
  async create(data: NewDailyUsage): Promise<DailyUsage> {
    const ts = now()
    const values = {
      ...data,
      id: data.id ?? nanoid(),
      taskCount: data.taskCount ?? 0,
      sandboxDuration: data.sandboxDuration ?? 0,
      creditsConsumed: data.creditsConsumed ?? 0,
      createdAt: data.createdAt ?? ts,
      updatedAt: data.updatedAt ?? ts,
    }
    await drizzleDb.insert(dailyUsage).values(values)
    return values as DailyUsage
  }

  async update(id: string, data: Partial<Omit<DailyUsage, 'id'>>): Promise<DailyUsage | null> {
    await drizzleDb
      .update(dailyUsage)
      .set({ ...data, updatedAt: data.updatedAt ?? now() })
      .where(eq(dailyUsage.id, id))
    const [row] = await drizzleDb.select().from(dailyUsage).where(eq(dailyUsage.id, id)).limit(1)
    return (row as DailyUsage) ?? null
  }

  async findByUserIdAndDate(userId: string, date: string): Promise<DailyUsage | null> {
    const [row] = await drizzleDb
      .select()
      .from(dailyUsage)
      .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.date, date)))
      .limit(1)
    return (row as DailyUsage) ?? null
  }

  async upsert(
    userId: string,
    date: string,
    data: { taskCount?: number; sandboxDuration?: number; creditsConsumed?: number },
  ): Promise<DailyUsage> {
    const ts = now()
    const existing = await this.findByUserIdAndDate(userId, date)
    if (existing) {
      await drizzleDb
        .update(dailyUsage)
        .set({
          taskCount: data.taskCount ?? existing.taskCount,
          sandboxDuration: data.sandboxDuration ?? existing.sandboxDuration,
          creditsConsumed: data.creditsConsumed ?? existing.creditsConsumed,
          updatedAt: ts,
        })
        .where(eq(dailyUsage.id, existing.id))
      return { ...existing, ...data, updatedAt: ts }
    }
    const values = {
      id: nanoid(),
      userId,
      date,
      taskCount: data.taskCount ?? 0,
      sandboxDuration: data.sandboxDuration ?? 0,
      creditsConsumed: data.creditsConsumed ?? 0,
      createdAt: ts,
      updatedAt: ts,
    }
    await drizzleDb.insert(dailyUsage).values(values)
    return values as DailyUsage
  }

  async findByUserId(userId: string, limit = 30): Promise<DailyUsage[]> {
    const rows = await drizzleDb
      .select()
      .from(dailyUsage)
      .where(eq(dailyUsage.userId, userId))
      .orderBy(desc(dailyUsage.date))
      .limit(limit)
    return rows as DailyUsage[]
  }

  async findByDate(date: string): Promise<DailyUsage[]> {
    const rows = await drizzleDb.select().from(dailyUsage).where(eq(dailyUsage.date, date))
    return rows as DailyUsage[]
  }

  async getDateRangeUserStats(startDate: string, endDate: string) {
    const rows = drizzleDb
      .select({
        userId: dailyUsage.userId,
        totalTasks: sql<number>`SUM(CASE WHEN ${dailyUsage.taskCount} > 0 THEN ${dailyUsage.taskCount} ELSE 0 END)`,
        totalDuration: sql<number>`SUM(CASE WHEN ${dailyUsage.sandboxDuration} > 0 THEN ${dailyUsage.sandboxDuration} ELSE 0 END)`,
        totalCredits: sql<number>`SUM(CASE WHEN ${dailyUsage.creditsConsumed} > 0 THEN ${dailyUsage.creditsConsumed} ELSE 0 END)`,
      })
      .from(dailyUsage)
      .where(sql`${dailyUsage.date} >= ${startDate} AND ${dailyUsage.date} <= ${endDate}`)
      .groupBy(dailyUsage.userId)
      .all()
    return rows.map((r) => ({
      userId: r.userId,
      totalTasks: Number(r.totalTasks),
      totalDuration: Number(r.totalDuration),
      totalCredits: Number(r.totalCredits),
    }))
  }
}

// ─── Institution Repositories ───────────────────────────────────────────────

/** better-sqlite3 对唯一索引与复合主键冲突使用这两个扩展结果码。 */
function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') return true
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' && message.includes('UNIQUE constraint failed')
}

class DrizzleInstitutionRepository implements InstitutionRepository {
  async findById(id: string): Promise<Institution | null> {
    const [row] = await drizzleDb.select().from(institutions).where(eq(institutions.id, id)).limit(1)
    return (row as Institution) ?? null
  }

  async create(institution: NewInstitution): Promise<Institution> {
    const ts = now()
    const values = {
      ...institution,
      createdAt: institution.createdAt ?? ts,
      updatedAt: institution.updatedAt ?? ts,
    }
    await drizzleDb.insert(institutions).values(values)
    return values as Institution
  }

  async listAll(): Promise<Institution[] | null> {
    const rows = await drizzleDb.select().from(institutions)
    return rows as Institution[]
  }

  async listForUser(userId: string): Promise<Institution[] | null> {
    const rows = await drizzleDb
      .select({
        id: institutions.id,
        name: institutions.name,
        status: institutions.status,
        createdAt: institutions.createdAt,
        updatedAt: institutions.updatedAt,
      })
      .from(institutions)
      .innerJoin(institutionMembers, eq(institutionMembers.institutionId, institutions.id))
      .where(eq(institutionMembers.userId, userId))
    return rows as Institution[]
  }
}

class DrizzleInstitutionMemberRepository implements InstitutionMemberRepository {
  async findById(id: string): Promise<InstitutionMember | null> {
    const [row] = await drizzleDb.select().from(institutionMembers).where(eq(institutionMembers.id, id)).limit(1)
    return (row as InstitutionMember) ?? null
  }

  async findByInstitutionAndUser(institutionId: string, userId: string): Promise<InstitutionMember | null> {
    const [row] = await drizzleDb
      .select()
      .from(institutionMembers)
      .where(and(eq(institutionMembers.institutionId, institutionId), eq(institutionMembers.userId, userId)))
      .limit(1)
    return (row as InstitutionMember) ?? null
  }

  async create(member: NewInstitutionMember): Promise<InstitutionMember | null> {
    const ts = now()
    const values = {
      ...member,
      createdAt: member.createdAt ?? ts,
      updatedAt: member.updatedAt ?? ts,
    }
    try {
      await drizzleDb.insert(institutionMembers).values(values)
    } catch (error) {
      // 唯一索引冲突 = 该用户在机构内已有成员关系。返回 null 让调用方决定是幂等还是冲突，
      // 同时保留第一条记录不被覆盖。
      if (isUniqueConstraintError(error)) return null
      throw error
    }
    return values as InstitutionMember
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
    await drizzleDb.update(institutionMembers).set({ role, updatedAt }).where(eq(institutionMembers.id, existing.id))

    return { ...existing, role, updatedAt }
  }

  async remove(institutionId: string, userId: string): Promise<boolean> {
    const result = await drizzleDb
      .delete(institutionMembers)
      .where(and(eq(institutionMembers.institutionId, institutionId), eq(institutionMembers.userId, userId)))
    return ((result as { changes?: number }).changes ?? 0) > 0
  }

  async listByUserId(userId: string): Promise<InstitutionMember[] | null> {
    const rows = await drizzleDb.select().from(institutionMembers).where(eq(institutionMembers.userId, userId))
    return rows as InstitutionMember[]
  }

  async listByInstitutionId(institutionId: string): Promise<InstitutionMember[] | null> {
    const rows = await drizzleDb
      .select()
      .from(institutionMembers)
      .where(eq(institutionMembers.institutionId, institutionId))
    return rows as InstitutionMember[]
  }
}

// ─── Class Repositories ─────────────────────────────────────────────────────

/** 班级列集合：三处列表查询共用，避免列清单在多个查询里漂移。 */
const teacherClassColumns = {
  id: classes.id,
  institutionId: classes.institutionId,
  name: classes.name,
  aiUsageMode: classes.aiUsageMode,
  xiaobaoCreditLimit: classes.xiaobaoCreditLimit,
  status: classes.status,
  archivedAt: classes.archivedAt,
  createdAt: classes.createdAt,
  updatedAt: classes.updatedAt,
}

class DrizzleTeacherClassRepository implements TeacherClassRepository {
  async findById(id: string): Promise<TeacherClass | null> {
    const [row] = await drizzleDb.select().from(classes).where(eq(classes.id, id)).limit(1)
    return (row as TeacherClass) ?? null
  }

  async create(input: NewTeacherClass): Promise<TeacherClass> {
    const ts = now()
    const values = { ...input, createdAt: input.createdAt ?? ts, updatedAt: input.updatedAt ?? ts }
    await drizzleDb.insert(classes).values(values)
    return values as TeacherClass
  }

  async update(id: string, data: Partial<Omit<TeacherClass, 'id' | 'createdAt'>>): Promise<TeacherClass | null> {
    await drizzleDb
      .update(classes)
      .set({ ...data, updatedAt: now() })
      .where(eq(classes.id, id))
    return this.findById(id)
  }

  async archive(id: string, archivedAt: number): Promise<TeacherClass | null> {
    await drizzleDb
      .update(classes)
      .set({ status: 'archived', archivedAt, updatedAt: archivedAt })
      .where(eq(classes.id, id))
    return this.findById(id)
  }

  async listByInstitution(institutionId: string): Promise<TeacherClass[] | null> {
    const rows = await drizzleDb
      .select(teacherClassColumns)
      .from(classes)
      .where(and(eq(classes.institutionId, institutionId), eq(classes.status, 'active')))
    return rows as TeacherClass[]
  }

  async listByTeacher(userId: string): Promise<TeacherClass[] | null> {
    const rows = await drizzleDb
      .select(teacherClassColumns)
      .from(classes)
      .innerJoin(classTeachers, eq(classTeachers.classId, classes.id))
      .where(and(eq(classTeachers.userId, userId), eq(classes.status, 'active')))
    return rows as TeacherClass[]
  }

  async listByStudent(studentUserId: string): Promise<TeacherClass[] | null> {
    const rows = await drizzleDb
      .select(teacherClassColumns)
      .from(classes)
      .innerJoin(classEnrollments, eq(classEnrollments.classId, classes.id))
      .where(
        and(
          eq(classEnrollments.studentUserId, studentUserId),
          eq(classEnrollments.status, 'active'),
          eq(classes.status, 'active'),
        ),
      )
    return rows as TeacherClass[]
  }
}

class DrizzleClassTeacherRepository implements ClassTeacherRepository {
  async findByClassAndUser(classId: string, userId: string): Promise<ClassTeacher | null> {
    const [row] = await drizzleDb
      .select()
      .from(classTeachers)
      .where(and(eq(classTeachers.classId, classId), eq(classTeachers.userId, userId)))
      .limit(1)
    return (row as ClassTeacher) ?? null
  }

  async create(input: NewClassTeacher): Promise<ClassTeacher | null> {
    const values = { ...input, createdAt: input.createdAt ?? now() }
    try {
      await drizzleDb.insert(classTeachers).values(values)
    } catch (error) {
      // 复合主键冲突 = 该老师已经在这个班任课。返回 null 让调用方决定是幂等还是冲突。
      if (isUniqueConstraintError(error)) return null
      throw error
    }
    return values as ClassTeacher
  }

  async remove(classId: string, userId: string): Promise<boolean> {
    const result = await drizzleDb
      .delete(classTeachers)
      .where(and(eq(classTeachers.classId, classId), eq(classTeachers.userId, userId)))
    return ((result as { changes?: number }).changes ?? 0) > 0
  }

  async listByClass(classId: string): Promise<ClassTeacher[] | null> {
    const rows = await drizzleDb.select().from(classTeachers).where(eq(classTeachers.classId, classId))
    return rows as ClassTeacher[]
  }

  async listByUser(userId: string): Promise<ClassTeacher[] | null> {
    const rows = await drizzleDb.select().from(classTeachers).where(eq(classTeachers.userId, userId))
    return rows as ClassTeacher[]
  }
}

class DrizzleClassEnrollmentRepository implements ClassEnrollmentRepository {
  async findByClassAndStudent(classId: string, studentUserId: string): Promise<ClassEnrollment | null> {
    const [row] = await drizzleDb
      .select()
      .from(classEnrollments)
      .where(and(eq(classEnrollments.classId, classId), eq(classEnrollments.studentUserId, studentUserId)))
      .limit(1)
    return (row as ClassEnrollment) ?? null
  }

  async enroll(input: NewClassEnrollment): Promise<ClassEnrollment> {
    const ts = now()
    const existing = await this.findByClassAndStudent(input.classId, input.studentUserId)

    if (existing) {
      // 已经在班：幂等返回，不产生第二条记录。
      if (existing.status === 'active') return existing

      // 复学：复用同一条记录并清空退班时间。唯一约束是 (classId, studentUserId)，插第二条会冲突。
      await drizzleDb
        .update(classEnrollments)
        .set({ status: 'active', leftAt: null, joinedAt: input.joinedAt ?? ts })
        .where(eq(classEnrollments.id, existing.id))
      return (await this.findByClassAndStudent(input.classId, input.studentUserId)) as ClassEnrollment
    }

    const values = { ...input, joinedAt: input.joinedAt ?? ts, leftAt: input.leftAt ?? null }
    await drizzleDb.insert(classEnrollments).values(values)
    return values as ClassEnrollment
  }

  async leave(classId: string, studentUserId: string, leftAt: number): Promise<ClassEnrollment | null> {
    const existing = await this.findByClassAndStudent(classId, studentUserId)
    if (!existing || existing.status !== 'active') return null

    await drizzleDb.update(classEnrollments).set({ status: 'left', leftAt }).where(eq(classEnrollments.id, existing.id))
    return this.findByClassAndStudent(classId, studentUserId)
  }

  async listByClass(classId: string, options?: { includeLeft?: boolean }): Promise<ClassEnrollment[] | null> {
    const conditions = [eq(classEnrollments.classId, classId)]
    if (!options?.includeLeft) conditions.push(eq(classEnrollments.status, 'active'))

    const rows = await drizzleDb
      .select()
      .from(classEnrollments)
      .where(and(...conditions))
    return rows as ClassEnrollment[]
  }

  async listByStudent(studentUserId: string): Promise<ClassEnrollment[] | null> {
    const rows = await drizzleDb
      .select()
      .from(classEnrollments)
      .where(eq(classEnrollments.studentUserId, studentUserId))
    return rows as ClassEnrollment[]
  }
}

// ─── Course Repositories ────────────────────────────────────────────────────

class DrizzleCourseRepository implements CourseRepository {
  async findById(id: string): Promise<Course | null> {
    const [row] = await drizzleDb.select().from(courses).where(eq(courses.id, id)).limit(1)
    return (row as Course) ?? null
  }

  async create(course: NewCourse): Promise<Course> {
    const ts = now()
    const values = { ...course, createdAt: course.createdAt ?? ts, updatedAt: course.updatedAt ?? ts }
    await drizzleDb.insert(courses).values(values)
    return values as Course
  }

  async update(id: string, data: Partial<Omit<Course, 'id' | 'institutionId' | 'createdAt'>>): Promise<Course | null> {
    const existing = await this.findById(id)
    if (!existing) return null

    // updatedAt 由仓储刷新：让调用方传时间戳，等于把"最后修改时间"变成可以填错的字段
    const next: Course = { ...existing, ...data, id, institutionId: existing.institutionId, updatedAt: now() }
    await drizzleDb
      .update(courses)
      .set({
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
      .where(eq(courses.id, id))

    return next
  }

  async listByInstitution(institutionId: string): Promise<Course[] | null> {
    const rows = await drizzleDb.select().from(courses).where(eq(courses.institutionId, institutionId))
    return rows as Course[]
  }

  async createChapter(chapter: CourseChapter): Promise<CourseChapter> {
    await drizzleDb.insert(courseChapters).values(chapter)
    return chapter
  }

  async createLesson(lesson: CourseLesson): Promise<CourseLesson> {
    await drizzleDb.insert(courseLessons).values(lesson)
    return lesson
  }

  async createResource(resource: LessonResource): Promise<LessonResource> {
    await drizzleDb.insert(lessonResources).values(resource)
    return resource
  }

  async loadOutline(courseId: string): Promise<CourseOutline | null> {
    const course = await this.findById(courseId)
    if (!course) return null

    const chapterRows = await drizzleDb
      .select()
      .from(courseChapters)
      .where(eq(courseChapters.courseId, courseId))
      .orderBy(asc(courseChapters.sortOrder))
    const chapterList = chapterRows as CourseChapter[]
    if (chapterList.length === 0) return { course, chapters: [] }

    const lessonRows = await drizzleDb
      .select()
      .from(courseLessons)
      .where(
        inArray(
          courseLessons.chapterId,
          chapterList.map((chapter) => chapter.id),
        ),
      )
      .orderBy(asc(courseLessons.sortOrder))
    const lessonList = lessonRows as CourseLesson[]

    const resourceList =
      lessonList.length === 0
        ? []
        : ((await drizzleDb
            .select()
            .from(lessonResources)
            .where(
              inArray(
                lessonResources.lessonId,
                lessonList.map((lesson) => lesson.id),
              ),
            )) as LessonResource[])

    return {
      course,
      chapters: chapterList.map((chapter) => ({
        chapter,
        lessons: lessonList
          .filter((lesson) => lesson.chapterId === chapter.id)
          .map((lesson) => ({
            lesson,
            resources: resourceList.filter((resource) => resource.lessonId === lesson.id),
          })),
      })),
    }
  }
}

class DrizzleClassCourseRepository implements ClassCourseRepository {
  private async find(classId: string, courseId: string): Promise<ClassCourse | null> {
    const [row] = await drizzleDb
      .select()
      .from(classCourses)
      .where(and(eq(classCourses.classId, classId), eq(classCourses.courseId, courseId)))
      .limit(1)
    return (row as ClassCourse) ?? null
  }

  async assign(input: NewClassCourse): Promise<ClassCourse> {
    const existing = await this.find(input.classId, input.courseId)
    if (existing) return existing

    const values = { ...input, assignedAt: input.assignedAt ?? now() }
    try {
      await drizzleDb.insert(classCourses).values(values)
    } catch (error) {
      // 并发下可能刚好被别人插入：返回既有记录，保持幂等语义
      if (isUniqueConstraintError(error)) {
        const concurrent = await this.find(input.classId, input.courseId)
        if (concurrent) return concurrent
      }
      throw error
    }
    return values as ClassCourse
  }

  async listByClass(classId: string): Promise<ClassCourse[] | null> {
    const rows = await drizzleDb.select().from(classCourses).where(eq(classCourses.classId, classId))
    return rows as ClassCourse[]
  }

  async listByCourse(courseId: string): Promise<ClassCourse[] | null> {
    const rows = await drizzleDb.select().from(classCourses).where(eq(classCourses.courseId, courseId))
    return rows as ClassCourse[]
  }
}

class DrizzleLessonProgressRepository implements LessonProgressRepository {
  private async find(classId: string, lessonId: string): Promise<LessonProgress | null> {
    const [row] = await drizzleDb
      .select()
      .from(lessonProgress)
      .where(and(eq(lessonProgress.classId, classId), eq(lessonProgress.lessonId, lessonId)))
      .limit(1)
    return (row as LessonProgress) ?? null
  }

  async setStatus(input: NewLessonProgress): Promise<LessonProgress> {
    // 非 completed 一律清空完成时间，避免留下过期的"完成时间"
    const completedAt = input.status === 'completed' ? (input.completedAt ?? now()) : null
    const existing = await this.find(input.classId, input.lessonId)

    if (existing) {
      await drizzleDb
        .update(lessonProgress)
        .set({ status: input.status, completedAt })
        .where(eq(lessonProgress.id, existing.id))
      return { ...existing, status: input.status, completedAt }
    }

    const values: LessonProgress = {
      id: input.id,
      classId: input.classId,
      lessonId: input.lessonId,
      status: input.status,
      completedAt,
    }
    await drizzleDb.insert(lessonProgress).values(values)
    return values
  }

  async listByClass(classId: string): Promise<LessonProgress[] | null> {
    const rows = await drizzleDb.select().from(lessonProgress).where(eq(lessonProgress.classId, classId))
    return rows as LessonProgress[]
  }
}

class DrizzleClassSessionRepository implements ClassSessionRepository {
  async create(input: NewClassSession): Promise<ClassSession> {
    const values: ClassSession = {
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
      await drizzleDb.insert(classSessions).values(values)
    } catch (error) {
      // 部分唯一索引保证"一个班同时只有一节进行中的课"：并发开课时返回已经在上的那一节，
      // 而不是把老师的第二次点击变成两节课。
      if (isUniqueConstraintError(error)) {
        const active = await this.findActiveByClass(input.classId)
        if (active) return active
      }
      throw error
    }

    return values
  }

  async findById(id: string): Promise<ClassSession | null> {
    const [row] = await drizzleDb.select().from(classSessions).where(eq(classSessions.id, id)).limit(1)
    return (row as ClassSession) ?? null
  }

  async findActiveByClass(classId: string): Promise<ClassSession | null> {
    const [row] = await drizzleDb
      .select()
      .from(classSessions)
      .where(and(eq(classSessions.classId, classId), isNull(classSessions.endedAt)))
      .limit(1)
    return (row as ClassSession) ?? null
  }

  async listByClass(classId: string): Promise<ClassSession[] | null> {
    const rows = await drizzleDb
      .select()
      .from(classSessions)
      .where(eq(classSessions.classId, classId))
      // 新课在前；同一毫秒开的两节课用 id 兜底排序，保证同一个库状态下顺序确定
      .orderBy(desc(classSessions.startedAt), desc(classSessions.id))
    return rows as ClassSession[]
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

    await drizzleDb
      .update(classSessions)
      .set({
        pointLimit: next.pointLimit,
        capabilities: next.capabilities,
        skills: next.skills,
        mcpServers: next.mcpServers,
        endedAt: next.endedAt,
        durationMinutes: next.durationMinutes,
      })
      .where(eq(classSessions.id, id))

    return next
  }
}

// ─── Provider Factory ───────────────────────────────────────────────────────

export function createDrizzleProvider(): DatabaseProvider {
  return {
    users: new DrizzleUserRepository(),
    localCredentials: new DrizzleLocalCredentialRepository(),
    tasks: new DrizzleTaskRepository(),
    connectors: new DrizzleConnectorRepository(),
    miniprogramApps: new DrizzleMiniProgramAppRepository(),
    cronTasks: new DrizzleCronTaskRepository(),
    accounts: new DrizzleAccountRepository(),
    keys: new DrizzleKeyRepository(),
    userResources: new DrizzleUserResourceRepository(),
    settings: new DrizzleSettingRepository(),
    deployments: new DrizzleDeploymentRepository(),
    adminLogs: new DrizzleAdminLogRepository(),
    envPool: new DrizzleEnvPoolRepository(),
    communityWorks: new DrizzleCommunityWorkRepository(),
    smsCodes: new DrizzleSmsCodeRepository(),
    userCredits: new DrizzleUserCreditsRepository(),
    creditTransactions: new DrizzleCreditTransactionRepository(),
    subscriptionPlans: new DrizzleSubscriptionPlanRepository(),
    userSubscriptions: new DrizzleUserSubscriptionRepository(),
    dailyUsage: new DrizzleDailyUsageRepository(),
    xiaobaoRuntimeCheckpoints: new DrizzleXiaobaoCheckpointRepository(),
    xiaobaoUsageLedger: new DrizzleXiaobaoUsageLedgerRepository(),
    institutions: new DrizzleInstitutionRepository(),
    institutionMembers: new DrizzleInstitutionMemberRepository(),
    classes: new DrizzleTeacherClassRepository(),
    classTeachers: new DrizzleClassTeacherRepository(),
    classEnrollments: new DrizzleClassEnrollmentRepository(),
    courses: new DrizzleCourseRepository(),
    classCourses: new DrizzleClassCourseRepository(),
    lessonProgress: new DrizzleLessonProgressRepository(),
    classSessions: new DrizzleClassSessionRepository(),
  }
}
