// ─── Data Types ─────────────────────────────────────────────────────────────

export interface User {
  id: string
  provider: string
  externalId: string
  accessToken: string
  refreshToken: string | null
  scope: string | null
  username: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  role: string // 'user' | 'admin'
  status: string // 'active' | 'disabled'
  disabledReason: string | null
  disabledAt: number | null
  disabledBy: string | null
  apiKey: string | null // Encrypted server API key
  phone: string | null
  phoneVerified: boolean | null
  /** Per-student XiaoBao credit cap; null means no cap is configured for this student. */
  xiaobaoCreditLimit: number | null
  createdAt: number
  updatedAt: number
  lastLoginAt: number
}

export interface LocalCredential {
  userId: string
  passwordHash: string
  createdAt: number
  updatedAt: number
}

export interface Task {
  id: string
  userId: string
  prompt: string
  title: string | null
  repoUrl: string | null
  envId: string | null // CloudBase env ID resolved at creation from provision mode
  selectedAgent: string | null
  selectedModel: string | null
  selectedRuntime: string | null
  xiaobaoCapability: string | null
  mode: string
  installDependencies: boolean | null
  maxDuration: number | null
  keepAlive: boolean | null
  enableBrowser: boolean | null
  status: string
  progress: number | null
  logs: string | null
  error: string | null
  branchName: string | null
  sandboxId: string | null
  sandboxSessionId: string | null
  sandboxCwd: string | null
  sandboxMode: string | null
  agentSessionId: string | null
  sandboxUrl: string | null
  previewUrl: string | null
  prUrl: string | null
  prNumber: number | null
  prStatus: string | null
  prMergeCommitSha: string | null
  mcpServerList: string | null
  skillSettings: string | null // JSON string of { initialized: boolean; skillList: string[] }
  createdAt: number
  updatedAt: number
  completedAt: number | null
  deletedAt: number | null
  personalGitInfo: string | null
}

export interface Connector {
  id: string
  userId: string
  name: string
  description: string | null
  type: string
  baseUrl: string | null
  oauthClientId: string | null
  oauthClientSecret: string | null
  command: string | null
  args: string | null
  env: string | null
  headers: string | null
  status: string
  createdAt: number
  updatedAt: number
}

export interface MiniProgramApp {
  id: string
  userId: string
  name: string
  appId: string
  privateKey: string
  description: string | null
  createdAt: number
  updatedAt: number
}

export interface CronTask {
  id: string
  userId: string
  name: string
  prompt: string
  cronExpression: string
  enabled: boolean
  repoUrl: string | null
  selectedAgent: string | null
  selectedModel: string | null
  lastRunAt: number | null
  nextRunAt: number | null
  lockedBy: string | null
  lockedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface Account {
  id: string
  userId: string
  provider: string
  externalUserId: string
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scope: string | null
  username: string
  createdAt: number
  updatedAt: number
}

export interface Key {
  id: string
  userId: string
  provider: string
  value: string
  createdAt: number
  updatedAt: number
}

export interface UserResource {
  id: string
  userId: string
  scope: string // 'user' | 'task'
  taskId: string | null // set when scope='task'
  status: string
  envId: string | null
  envAlias: string | null
  envRegion: string | null
  cosTagValue: string | null
  policyHash: string | null
  camUsername: string | null
  camSecretId: string | null
  camSecretKey: string | null
  policyId: number | null
  failStep: string | null
  failReason: string | null
  createdAt: number
  updatedAt: number
}

export interface Setting {
  id: string
  userId: string | null // null = system-level setting
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

export interface Deployment {
  id: string
  taskId: string
  type: string
  url: string | null
  path: string | null
  qrCodeUrl: string | null
  pagePath: string | null
  appId: string | null
  label: string | null
  metadata: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export interface AdminLog {
  id: string
  adminUserId: string
  action: string
  targetUserId: string | null
  details: string | null
  ipAddress: string | null
  userAgent: string | null
  createdAt: number
}

export interface UserCredits {
  id: string
  userId: string
  balance: number
  frozenBalance: number
  lifetimeBalance: number
  createdAt: number
  updatedAt: number
}

export interface CreditTransaction {
  id: string
  userId: string
  type: string
  amount: number
  balanceAfter: number
  description: string | null
  metadata: string | null
  createdAt: number
}

export interface SubscriptionPlan {
  id: string
  name: string
  description: string | null
  type: string
  creditsPerPeriod: number
  periodDays: number
  priceCents: number
  maxTasksPerDay: number | null
  maxSandboxDuration: number | null
  features: string | null
  active: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface UserSubscription {
  id: string
  userId: string
  planId: string
  status: string
  currentPeriodStart: number
  currentPeriodEnd: number
  autoRenew: boolean
  cancelledAt: number | null
  createdAt: number
  updatedAt: number
}

export interface DailyUsage {
  id: string
  userId: string
  date: string
  taskCount: number
  sandboxDuration: number
  creditsConsumed: number
  createdAt: number
  updatedAt: number
}

// ─── Creation Types (omit auto-generated timestamps) ────────────────────────

/** Fields that default to null when creating a User */
type UserNullableFields =
  | 'refreshToken'
  | 'scope'
  | 'email'
  | 'name'
  | 'avatarUrl'
  | 'disabledReason'
  | 'disabledAt'
  | 'disabledBy'
  | 'apiKey'
  | 'phone'
  | 'phoneVerified'
  | 'xiaobaoCreditLimit'

export type NewUser = Omit<User, 'createdAt' | 'updatedAt' | 'lastLoginAt' | UserNullableFields> &
  Partial<Pick<User, UserNullableFields>> & {
    createdAt?: number
    updatedAt?: number
    lastLoginAt?: number
  }

export type NewLocalCredential = Omit<LocalCredential, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

/** Fields that default to null when creating a Task */
type TaskNullableFields =
  | 'title'
  | 'repoUrl'
  | 'envId'
  | 'selectedAgent'
  | 'selectedModel'
  | 'selectedRuntime'
  | 'xiaobaoCapability'
  | 'installDependencies'
  | 'maxDuration'
  | 'keepAlive'
  | 'enableBrowser'
  | 'progress'
  | 'logs'
  | 'error'
  | 'branchName'
  | 'sandboxId'
  | 'sandboxSessionId'
  | 'sandboxCwd'
  | 'sandboxMode'
  | 'agentSessionId'
  | 'sandboxUrl'
  | 'previewUrl'
  | 'prUrl'
  | 'prNumber'
  | 'prStatus'
  | 'prMergeCommitSha'
  | 'mcpServerList'
  | 'skillSettings'

export type NewTask = Omit<Task, 'createdAt' | 'updatedAt' | 'completedAt' | 'deletedAt' | TaskNullableFields> &
  Partial<Pick<Task, TaskNullableFields>> & {
    createdAt?: number
    updatedAt?: number
    completedAt?: number | null
    deletedAt?: number | null
  }

export type NewConnector = Omit<Connector, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewMiniProgramApp = Omit<MiniProgramApp, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

/** Fields that default to null when creating a CronTask */
type CronTaskNullableFields =
  | 'repoUrl'
  | 'selectedAgent'
  | 'selectedModel'
  | 'lastRunAt'
  | 'nextRunAt'
  | 'lockedBy'
  | 'lockedAt'

export type NewCronTask = Omit<CronTask, 'createdAt' | 'updatedAt' | CronTaskNullableFields> &
  Partial<Pick<CronTask, CronTaskNullableFields>> & {
    createdAt?: number
    updatedAt?: number
  }

export type NewAccount = Omit<Account, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewKey = Omit<Key, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewUserResource = Omit<UserResource, 'createdAt' | 'updatedAt' | 'scope' | 'taskId'> & {
  scope?: string // defaults to 'user'
  taskId?: string | null
  createdAt?: number
  updatedAt?: number
}

export type NewSetting = Omit<Setting, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewDeployment = Omit<Deployment, 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  createdAt?: number
  updatedAt?: number
  deletedAt?: number | null
}

export type NewAdminLog = Omit<AdminLog, 'createdAt'> & {
  createdAt?: number
}

export interface SmsCode {
  id: string
  phone: string
  code: string
  expiresAt: number
  used: boolean
  createdAt: number
}

export type NewSmsCode = Omit<SmsCode, 'createdAt'> & { createdAt?: number }

export interface UserCredits {
  id: string
  userId: string
  balance: number
  frozenBalance: number
  lifetimeBalance: number
  createdAt: number
  updatedAt: number
}

export type NewUserCredits = Omit<UserCredits, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface CreditTransaction {
  id: string
  userId: string
  type: string
  amount: number
  balanceAfter: number
  description: string | null
  metadata: string | null
  createdAt: number
}

export interface NewCreditTransaction {
  id?: string
  userId: string
  type: string
  amount: number
  balanceAfter: number
  description?: string | null
  metadata?: string | null
  createdAt?: number
}

export interface SubscriptionPlan {
  id: string
  name: string
  description: string | null
  type: string
  creditsPerPeriod: number
  periodDays: number
  priceCents: number
  maxTasksPerDay: number | null
  maxSandboxDuration: number | null
  features: string | null
  active: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type NewSubscriptionPlan = Omit<SubscriptionPlan, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface UserSubscription {
  id: string
  userId: string
  planId: string
  status: string
  currentPeriodStart: number
  currentPeriodEnd: number
  autoRenew: boolean
  cancelledAt: number | null
  createdAt: number
  updatedAt: number
}

export type NewUserSubscription = Omit<UserSubscription, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface DailyUsage {
  id: string
  userId: string
  date: string
  taskCount: number
  sandboxDuration: number
  creditsConsumed: number
  createdAt: number
  updatedAt: number
}

export type NewDailyUsage = Omit<DailyUsage, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface CheckpointRecord {
  taskId: string
  revision: number
  schemaVersion: number
  snapshotJson: string
  createdAt: number
  updatedAt: number
}

export interface XiaobaoUsageReservationRecord {
  id: string
  taskId: string
  userId: string
  category: 'model' | 'tool' | 'sandbox' | 'media'
  reservedUnits: number
  settledUnits: number | null
  status: 'reserved' | 'settled' | 'released'
  creditCostReserved: number
  creditCostSettled: number | null
  createdAt: number
  updatedAt: number
  settledAt: number | null
}

/**
 * 已结算学分按用途分类的汇总。
 *
 * 四个键都必然存在：**没有用量是 0**，而"整体无法确定"用 `null` 表示（见仓储方法），
 * 两者含义不同，调用方必须区分。
 */
export type XiaobaoUsageCategoryTotals = Record<XiaobaoUsageReservationRecord['category'], number>

export interface UsageReservationLedgerInput {
  taskId: string
  userId: string
  category: XiaobaoUsageReservationRecord['category']
  reservedUnits: number
  creditCostReserved: number
  now: number
}

export interface UsageSettlementLedgerInput {
  reservationId: string
  taskId: string
  category: XiaobaoUsageReservationRecord['category']
  settledUnits: number
  creditCostSettled: number
  now: number
}

export type UsageReservationLedgerResult =
  | { allowed: true; record: XiaobaoUsageReservationRecord }
  | { allowed: false; reason: 'insufficient_credits' }

// ─── Repository Interfaces ──────────────────────────────────────────────────

export interface UserRepository {
  findById(id: string): Promise<User | null>
  findByProviderAndExternalId(provider: string, externalId: string): Promise<User | null>
  findByApiKey(encryptedApiKey: string): Promise<User | null>
  findByPhone(phone: string): Promise<User | null>
  create(user: NewUser): Promise<User>
  update(id: string, data: Partial<Omit<User, 'id'>>): Promise<User | null>
  deleteById(id: string): Promise<void>
  // Admin methods
  findAll(limit?: number, offset?: number): Promise<User[]>
  count(): Promise<number>
  updateRole(id: string, role: 'user' | 'admin'): Promise<User | null>
  disable(id: string, reason: string, adminUserId: string): Promise<User | null>
  enable(id: string): Promise<User | null>
}

export interface LocalCredentialRepository {
  findByUserId(userId: string): Promise<LocalCredential | null>
  create(credential: NewLocalCredential): Promise<LocalCredential>
  update(userId: string, data: Partial<Omit<LocalCredential, 'userId'>>): Promise<LocalCredential | null>
}

export interface TaskRepository {
  findById(id: string): Promise<Task | null>
  findByIdAndUserId(id: string, userId: string): Promise<Task | null>
  findByUserId(userId: string, limit?: number): Promise<Task[]>
  findByRepoAndPr(userId: string, prNumber: number, repoUrl: string): Promise<Task[]>
  findAll(limit: number, offset: number, filters?: { userId?: string; status?: string }): Promise<Task[]>
  count(filters?: { userId?: string; status?: string }): Promise<number>
  create(task: NewTask): Promise<Task>
  update(id: string, data: Partial<Omit<Task, 'id'>>): Promise<Task | null>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
  softDelete(id: string): Promise<void>
}

export interface ConnectorRepository {
  findByUserId(userId: string): Promise<Connector[]>
  findByIdAndUserId(id: string, userId: string): Promise<Connector | null>
  create(connector: NewConnector): Promise<Connector>
  update(id: string, userId: string, data: Partial<Omit<Connector, 'id' | 'userId'>>): Promise<Connector | null>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
  delete(id: string, userId: string): Promise<void>
}

export interface MiniProgramAppRepository {
  findByUserId(userId: string): Promise<MiniProgramApp[]>
  findByIdAndUserId(id: string, userId: string): Promise<MiniProgramApp | null>
  findByAppIdAndUserId(appId: string, userId: string): Promise<MiniProgramApp | null>
  create(app: NewMiniProgramApp): Promise<MiniProgramApp>
  update(
    id: string,
    userId: string,
    data: Partial<Omit<MiniProgramApp, 'id' | 'userId'>>,
  ): Promise<MiniProgramApp | null>
  delete(id: string, userId: string): Promise<void>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
}

export interface CronTaskRepository {
  findByUserId(userId: string): Promise<CronTask[]>
  findByIdAndUserId(id: string, userId: string): Promise<CronTask | null>
  findAllEnabled(): Promise<CronTask[]>
  create(task: NewCronTask): Promise<CronTask>
  update(id: string, userId: string, data: Partial<Omit<CronTask, 'id' | 'userId'>>): Promise<CronTask | null>
  delete(id: string, userId: string): Promise<void>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
  tryLock(id: string, lockerId: string, maxLockMs: number): Promise<boolean>
  releaseLock(id: string, lockerId: string): Promise<void>
}

export interface AccountRepository {
  findByUserIdAndProvider(userId: string, provider: string): Promise<Account | null>
  findByProviderAndExternalUserId(provider: string, externalUserId: string): Promise<Account | null>
  create(account: NewAccount): Promise<Account>
  update(id: string, data: Partial<Omit<Account, 'id'>>): Promise<Account | null>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
  delete(userId: string, provider: string): Promise<void>
}

export interface KeyRepository {
  findByUserId(userId: string): Promise<Key[]>
  findByUserIdAndProvider(userId: string, provider: string): Promise<Key | null>
  upsert(key: NewKey): Promise<Key>
  updateUserId(fromUserId: string, toUserId: string): Promise<void>
  delete(userId: string, provider: string): Promise<void>
}

export interface UserResourceRepository {
  findByUserId(userId: string): Promise<UserResource | null>
  findByTaskId(taskId: string): Promise<UserResource | null>
  findAllByUserId(userId: string): Promise<UserResource[]>
  create(resource: NewUserResource): Promise<UserResource>
  update(id: string, data: Partial<Omit<UserResource, 'id'>>): Promise<UserResource | null>
  deleteById(id: string): Promise<void>
}

export interface SettingRepository {
  findByUserIdAndKey(userId: string, key: string): Promise<Setting | null>
  findByUserId(userId: string): Promise<Setting[]>
  upsert(setting: NewSetting): Promise<Setting>
  /** Find a system-level setting (userId IS NULL) */
  findSystemSetting(key: string): Promise<Setting | null>
  /** Upsert a system-level setting (userId IS NULL) */
  upsertSystemSetting(key: string, value: string): Promise<Setting>
  /** Delete a system-level setting (returns true if existed) */
  deleteSystemSetting(key: string): Promise<boolean>
  /** List all system-level settings */
  findAllSystemSettings(): Promise<Setting[]>
}

export interface DeploymentRepository {
  findByTaskId(taskId: string): Promise<Deployment[]>
  findByTaskIdAndTypePath(taskId: string, type: string, path: string | null): Promise<Deployment | null>
  findByTaskIdAndUserId(taskId: string, userId: string): Promise<Deployment | null>
  create(deployment: NewDeployment): Promise<Deployment>
  update(id: string, data: Partial<Omit<Deployment, 'id'>>): Promise<Deployment | null>
  softDelete(id: string): Promise<void>
}

export interface AdminLogRepository {
  create(log: NewAdminLog): Promise<AdminLog>
  findByAdminUserId(adminUserId: string, limit?: number): Promise<AdminLog[]>
  findByTargetUserId(targetUserId: string, limit?: number): Promise<AdminLog[]>
  findAll(limit?: number, offset?: number): Promise<AdminLog[]>
}

export interface SmsCodeRepository {
  create(code: NewSmsCode): Promise<SmsCode>
  findByPhoneAndCode(phone: string, code: string): Promise<SmsCode | null>
  markUsed(id: string): Promise<void>
  deleteExpired(): Promise<void>
}

export interface UserCreditsRepository {
  findByUserId(userId: string): Promise<UserCredits | null>
  create(credits: NewUserCredits): Promise<UserCredits>
  updateByUserId(userId: string, data: Partial<Omit<UserCredits, 'id' | 'userId'>>): Promise<UserCredits | null>
  getOrCreate(userId: string): Promise<UserCredits>
  consumeByUserId(userId: string, amount: number, ts: number): Promise<UserCredits | null>
}

export interface CreditTransactionRepository {
  create(tx: NewCreditTransaction): Promise<CreditTransaction>
  findByUserId(userId: string, limit?: number, offset?: number): Promise<CreditTransaction[]>
  findByUserIdAndType(userId: string, type: string, limit?: number): Promise<CreditTransaction[]>
  findAll(limit: number, offset: number): Promise<CreditTransaction[]>
}

export interface SubscriptionPlanRepository {
  findById(id: string): Promise<SubscriptionPlan | null>
  findActive(): Promise<SubscriptionPlan[]>
  findAllActive(): Promise<SubscriptionPlan[]>
  findAll(): Promise<SubscriptionPlan[]>
  create(plan: NewSubscriptionPlan): Promise<SubscriptionPlan>
  update(id: string, data: Partial<Omit<SubscriptionPlan, 'id'>>): Promise<SubscriptionPlan | null>
  count(): Promise<number>
}

export interface UserSubscriptionRepository {
  findByUserId(userId: string): Promise<UserSubscription | null>
  findActiveByUserId(userId: string): Promise<UserSubscription | null>
  create(sub: NewUserSubscription): Promise<UserSubscription>
  update(id: string, data: Partial<Omit<UserSubscription, 'id'>>): Promise<UserSubscription | null>
  findAllActive(): Promise<UserSubscription[]>
  findExpiringActive(beforeTime: number): Promise<UserSubscription[]>
  findByStatus(status: string): Promise<UserSubscription[]>
}

export interface DailyUsageRepository {
  findByUserIdAndDate(userId: string, date: string): Promise<DailyUsage | null>
  create(data: NewDailyUsage): Promise<DailyUsage>
  update(id: string, data: Partial<Omit<DailyUsage, 'id'>>): Promise<DailyUsage | null>
  upsert(
    userId: string,
    date: string,
    data: { taskCount?: number; sandboxDuration?: number; creditsConsumed?: number },
  ): Promise<DailyUsage>
  findByUserId(userId: string, limit?: number): Promise<DailyUsage[]>
  findByDate(date: string): Promise<DailyUsage[]>
  getDateRangeUserStats(
    startDate: string,
    endDate: string,
  ): Promise<Array<{ userId: string; totalTasks: number; totalDuration: number; totalCredits: number }>>
}

export interface CheckpointRepository {
  /** Read-only production readiness probe; must not create or modify checkpoint records. */
  healthCheck(): Promise<boolean>
  /**
   * Explicit production capability probe. Missing support fails closed.
   * Implementations may only report writable=true after a no-residue rollback probe.
   */
  checkReadWriteReadiness?(): Promise<{ readable: boolean; writable: boolean }>
  findByTaskId(taskId: string): Promise<CheckpointRecord | null>
  create(record: CheckpointRecord): Promise<CheckpointRecord | null>
  compareAndSwap(taskId: string, expectedRevision: number, next: CheckpointRecord): Promise<CheckpointRecord | null>
}

export interface XiaobaoUsageLedgerRepository {
  reserve(input: UsageReservationLedgerInput): Promise<UsageReservationLedgerResult>
  settle(input: UsageSettlementLedgerInput): Promise<XiaobaoUsageReservationRecord>
  release(reservationId: string, reason: 'safety_denied' | 'runtime_failed'): Promise<XiaobaoUsageReservationRecord>
  findByTaskAndCategory(
    taskId: string,
    category: XiaobaoUsageReservationRecord['category'],
  ): Promise<XiaobaoUsageReservationRecord | null>
  /**
   * 该用户已结算的小宝学分总额（`since` 为 null 表示不限起始时间），用于教师/运营侧预算核算。
   *
   * 返回 null 表示**无法确定**（例如读取被截断）：调用方必须按 fail-closed 处理，
   * 不能把不确定当成 0，否则会放行本该被预算挡下的任务。
   */
  sumSettledCreditsByUser(userId: string, since: number | null): Promise<number | null>
  /**
   * 一组用户已结算的学分合计（`since` 为 null 表示不限起始时间）。
   *
   * 班级共享额度是**整班共用**的，必须按全班合计比较，所以需要一次多用户聚合而不是逐个学生求和。
   * 名单为空返回确定的 `0`；返回 `null` 表示**无法确定**（读取被截断），调用方必须按 fail-closed 处理。
   */
  sumSettledCreditsByUsers(userIds: readonly string[], since: number | null): Promise<number | null>
  /**
   * 该用户已结算学分**按用途分类**的汇总（`since` 为 null 表示不限起始时间），
   * 用于管理端回答"额度花在哪"。
   *
   * 返回 null 表示**无法确定**（读取被截断）：调用方必须与"四个分类都是 0"区分开，
   * 不能把不确定当成没有用量。
   */
  sumSettledCreditsByUserByCategory(userId: string, since: number | null): Promise<XiaobaoUsageCategoryTotals | null>
  healthCheck(): Promise<boolean>
}

export interface CommunityWork {
  id: string
  userId: string
  userName: string
  title: string
  description: string
  previewUrl: string | null
  tags: string // JSON array of tags
  fileUrls: string // JSON array of file URLs
  likeCount: number
  likedBy: string // JSON array of userIds who liked
  createdAt: number
  updatedAt: number
}

export type NewCommunityWork = Omit<CommunityWork, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

// ─── Environment Pool ───────────────────────────────────────────────────────

export interface EnvPoolEntry {
  id: string
  status: string // 'creating' | 'ready' | 'claimed' | 'failed'
  envId: string | null
  envAlias: string | null
  envRegion: string | null
  cosTagValue: string | null
  policyHash: string | null
  camUsername: string | null
  camSecretId: string | null
  camSecretKey: string | null
  policyId: number | null
  claimedByUserId: string | null
  claimedByTaskId: string | null
  claimedAt: number | null
  failReason: string | null
  createdAt: number
  updatedAt: number
}

export type NewEnvPoolEntry = Omit<EnvPoolEntry, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface EnvPoolRepository {
  /** Find one ready entry (status='ready'), FIFO order */
  findReady(): Promise<EnvPoolEntry | null>
  /** CAS: claim a ready entry (status='ready' → 'claimed'). Returns null if already claimed by another pod. */
  claimEntry(
    id: string,
    data: { claimedByUserId: string; claimedByTaskId: string | null; claimedAt: number },
  ): Promise<EnvPoolEntry | null>
  /** Find all entries by status */
  findAllByStatus(status: string): Promise<EnvPoolEntry[]>
  /** Count entries by status */
  countByStatus(status: string): Promise<number>
  /** Count all non-claimed/non-failed entries (creating + ready) */
  countActive(): Promise<number>
  create(entry: NewEnvPoolEntry): Promise<EnvPoolEntry>
  update(id: string, data: Partial<Omit<EnvPoolEntry, 'id'>>): Promise<EnvPoolEntry | null>
  /** Get pool stats: { creating, ready, claimed, failed } */
  getStats(): Promise<Record<string, number>>
}

export interface CommunityWorkRepository {
  findAll(limit?: number, offset?: number): Promise<CommunityWork[]>
  findByUserId(userId: string): Promise<CommunityWork[]>
  findById(id: string): Promise<CommunityWork | null>
  create(work: NewCommunityWork): Promise<CommunityWork>
  update(id: string, userId: string, data: Partial<Omit<CommunityWork, 'id' | 'userId'>>): Promise<CommunityWork | null>
  delete(id: string, userId: string): Promise<void>
  count(): Promise<number>
}

// ─── Institutions & Teaching Classes ────────────────────────────────────────

/** 机构内的角色。刻意与 `users.role`（平台运维管理员）分开：机构角色是多对多的。 */
export type InstitutionMemberRole = 'owner' | 'admin' | 'teacher'
export type InstitutionMemberStatus = 'active' | 'left'
export type ClassAiUsageMode = 'class_only' | 'anytime'
export type ClassTeacherRole = 'lead' | 'assistant'
export type ClassEnrollmentStatus = 'active' | 'left'
export type LifecycleStatus = 'active' | 'archived'

export interface Institution {
  id: string
  name: string
  status: LifecycleStatus
  createdAt: number
  updatedAt: number
}

export interface InstitutionMember {
  id: string
  institutionId: string
  userId: string
  role: InstitutionMemberRole
  status: InstitutionMemberStatus
  createdAt: number
  updatedAt: number
}

export interface TeacherClass {
  id: string
  institutionId: string
  name: string
  aiUsageMode: ClassAiUsageMode
  /** 班级共享额度；null 表示未设置（不限制）。 */
  xiaobaoCreditLimit: number | null
  status: LifecycleStatus
  archivedAt: number | null
  createdAt: number
  updatedAt: number
}

export interface ClassTeacher {
  classId: string
  userId: string
  role: ClassTeacherRole
  createdAt: number
}

export interface ClassEnrollment {
  id: string
  classId: string
  studentUserId: string
  status: ClassEnrollmentStatus
  joinedAt: number
  /** 退班时间；保留记录以便历史课堂与作品仍能定位归属。 */
  leftAt: number | null
}

export type NewInstitution = Omit<Institution, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewInstitutionMember = Omit<InstitutionMember, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface InstitutionRepository {
  findById(id: string): Promise<Institution | null>
  create(institution: NewInstitution): Promise<Institution>
  /** 全部机构（平台管理端用）；null 表示无法确定（读取被截断）。 */
  listAll(): Promise<Institution[] | null>
  /**
   * 该用户所属的全部机构。
   *
   * 返回 null 表示**无法确定**（读取被截断）：调用方必须与"空数组"区分，不能把不确定当成"没有机构"。
   */
  listForUser(userId: string): Promise<Institution[] | null>
}

export interface InstitutionMemberRepository {
  findById(id: string): Promise<InstitutionMember | null>
  findByInstitutionAndUser(institutionId: string, userId: string): Promise<InstitutionMember | null>
  /**
   * 同一机构内同一用户重复添加时返回 null，而不是抛出底层数据库错误。
   *
   * 注意实现差异：Drizzle 侧由唯一索引硬保证；CloudBase 的集合没有唯一索引，
   * 只能靠显式预检查（并发下为尽力而为）。调用方不得把 null 当作"已存在即可放行"以外的语义。
   */
  create(member: NewInstitutionMember): Promise<InstitutionMember | null>
  /**
   * 修改成员角色；成员不存在时返回 `null`。
   *
   * 单独一个方法而不是"先删再加"：删除会把 `createdAt`（谁在什么时候加入机构）冲掉，
   * 而这是有审计意义的事实。
   */
  updateRole(institutionId: string, userId: string, role: InstitutionMemberRole): Promise<InstitutionMember | null>
  /** 解除机构成员关系；真的删掉了返回 true，本来没有这条关系返回 false。 */
  remove(institutionId: string, userId: string): Promise<boolean>
  /** 该用户的全部机构成员关系；null 表示无法确定。 */
  listByUserId(userId: string): Promise<InstitutionMember[] | null>
  /** 某机构的全部成员；null 表示无法确定。 */
  listByInstitutionId(institutionId: string): Promise<InstitutionMember[] | null>
}

export type NewClassTeacher = Omit<ClassTeacher, 'createdAt'> & { createdAt?: number }

export type NewClassEnrollment = Omit<ClassEnrollment, 'joinedAt' | 'leftAt'> & {
  joinedAt?: number
  leftAt?: number | null
}

export type NewTeacherClass = Omit<TeacherClass, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export interface TeacherClassRepository {
  /** 按 id 读取班级，包含已归档的班（历史记录需要能读回来）。 */
  findById(id: string): Promise<TeacherClass | null>
  create(input: NewTeacherClass): Promise<TeacherClass>
  /** 局部更新班级（例如设置班级共享额度）。班级不存在时返回 null。 */
  update(id: string, data: Partial<Omit<TeacherClass, 'id' | 'createdAt'>>): Promise<TeacherClass | null>
  /** 归档班级：写 status='archived' 与 archivedAt，**不删除记录**。班级不存在时返回 null。 */
  archive(id: string, archivedAt: number): Promise<TeacherClass | null>
  /** 某机构的在办班级；null 表示无法确定（读取被截断）。 */
  listByInstitution(institutionId: string): Promise<TeacherClass[] | null>
  /** 某老师担任（lead 或 assistant）的在办班级；null 表示无法确定。 */
  listByTeacher(userId: string): Promise<TeacherClass[] | null>
  /** 某学生当前在班（仅 active 选课）的在办班级；null 表示无法确定。 */
  listByStudent(studentUserId: string): Promise<TeacherClass[] | null>
}

export interface ClassTeacherRepository {
  findByClassAndUser(classId: string, userId: string): Promise<ClassTeacher | null>
  /**
   * 重复分配同一老师时返回 null。
   *
   * 实现差异：Drizzle 侧由复合主键保证；CloudBase 集合没有主键约束，只能靠显式预检查。
   */
  create(input: NewClassTeacher): Promise<ClassTeacher | null>
  /** 解除任课关系；真的删掉了返回 true，本来就没有这条关系返回 false。 */
  remove(classId: string, userId: string): Promise<boolean>
  listByClass(classId: string): Promise<ClassTeacher[] | null>
  listByUser(userId: string): Promise<ClassTeacher[] | null>
}

export interface ClassEnrollmentRepository {
  findByClassAndStudent(classId: string, studentUserId: string): Promise<ClassEnrollment | null>
  /**
   * 加入班级：
   * - 没有记录 ⇒ 新建在班记录；
   * - 只有退班记录 ⇒ **复用同一条记录**、清空 `leftAt` 并恢复在班（唯一约束不允许插入第二条）；
   * - 已经在班 ⇒ 幂等返回现有记录。
   */
  enroll(input: NewClassEnrollment): Promise<ClassEnrollment>
  /** 退班：写 status='left' 与 leftAt 并保留记录；记录不存在或已经退班时返回 null。 */
  leave(classId: string, studentUserId: string, leftAt: number): Promise<ClassEnrollment | null>
  /** 某班的选课记录；默认只返回在班学生（`includeLeft` 可包含退班历史）。null 表示无法确定。 */
  listByClass(classId: string, options?: { includeLeft?: boolean }): Promise<ClassEnrollment[] | null>
  /** 某学生的全部选课记录（含已退班）；null 表示无法确定。 */
  listByStudent(studentUserId: string): Promise<ClassEnrollment[] | null>
}

// ─── Courses & Lessons ──────────────────────────────────────────────────────

export type CourseStage = 'lower_primary' | 'upper_primary' | 'middle_school'
export type CourseStatus = 'ready' | 'draft'
export type LessonResourceType = 'slides' | 'demo' | 'worksheet' | 'assignment'
export type LessonResourceStatus = 'ready' | 'planned'
export type LessonProgressStatus = 'completed' | 'next' | 'locked'

export interface Course {
  id: string
  institutionId: string
  title: string
  description: string
  /** 空字符串表示用品牌默认图。 */
  coverAsset: string
  stage: CourseStage
  topic: string
  status: CourseStatus
  ageRange: string
  /** JSON 字符串，内容为 string[]。 */
  goals: string
  expectedOutcome: string
  createdAt: number
  updatedAt: number
}

export interface CourseChapter {
  id: string
  courseId: string
  title: string
  sortOrder: number
}

export interface CourseLesson {
  id: string
  chapterId: string
  title: string
  sortOrder: number
  durationMinutes: number
  /** 以下数组字段均为 JSON 字符串。 */
  objectives: string
  steps: string
  teacherTips: string
  assignment: string
  capabilities: string
  skills: string
  mcpServers: string
}

export interface LessonResource {
  id: string
  lessonId: string
  title: string
  type: LessonResourceType
  status: LessonResourceStatus
}

export interface ClassCourse {
  classId: string
  courseId: string
  assignedAt: number
}

export interface LessonProgress {
  id: string
  classId: string
  lessonId: string
  status: LessonProgressStatus
  /** 未完成的课时为 null，而不是用 0 冒充时间戳。 */
  completedAt: number | null
}

// ─── Class Sessions ─────────────────────────────────────────────────────────

/**
 * 一次开课的记录。
 *
 * 这是**既成事实的快照**：开课当时的能力、额度与人数就存这些值，后续改班级配置不回填历史。
 * `endedAt` 为 null 表示仍在进行中；"一个班同时只有一节进行中的课"由数据库部分唯一索引保证。
 */
export interface ClassSession {
  id: string
  classId: string
  lessonId: string
  startedByUserId: string
  startedAt: number
  /** 进行中为 null。 */
  endedAt: number | null
  /** 下课才写入；进行中的课没有时长，不用 0 冒充。 */
  durationMinutes: number | null
  pointLimit: number
  /** 以下数组字段均为 JSON 字符串。 */
  capabilities: string
  skills: string
  mcpServers: string
  /** 开课时的人数快照；名单无法确定时为 null。 */
  studentCount: number | null
}

export type NewClassSession = Omit<
  ClassSession,
  'endedAt' | 'durationMinutes' | 'capabilities' | 'skills' | 'mcpServers' | 'studentCount'
> & {
  endedAt?: number | null
  durationMinutes?: number | null
  capabilities?: string
  skills?: string
  mcpServers?: string
  studentCount?: number | null
}

/** 课中调整与下课共用同一份补丁；未给出的字段保持原值。 */
export interface ClassSessionPatch {
  pointLimit?: number
  capabilities?: string
  skills?: string
  mcpServers?: string
  endedAt?: number
  durationMinutes?: number
}

export interface ClassSessionRepository {
  create(input: NewClassSession): Promise<ClassSession>
  findById(id: string): Promise<ClassSession | null>
  /**
   * 班级当前进行中的课；确实没有则 `null`。
   *
   * 读取被截断时**抛错**而不是返回 `null`：写路径靠它判断"能不能再开一节"，把"读不到"当成
   * "没有进行中的课"会开出两节同时进行的课。
   */
  findActiveByClass(classId: string): Promise<ClassSession | null>
  /** 某班的全部课堂记录；null 表示无法确定（读取被截断）。 */
  listByClass(classId: string): Promise<ClassSession[] | null>
  /**
   * 更新记录；记录不存在时返回 `null`。
   *
   * **下课是幂等的**：已经下课的记录不会被第二次下课改动结束时间与时长——否则"这节课上了多久"
   * 会被重复点击改写成另一段时长，课堂记录就不再是事实。
   */
  update(id: string, patch: ClassSessionPatch): Promise<ClassSession | null>
}

export type NewCourse = Omit<Course, 'createdAt' | 'updatedAt'> & {
  createdAt?: number
  updatedAt?: number
}

export type NewClassCourse = Omit<ClassCourse, 'assignedAt'> & { assignedAt?: number }

export type NewLessonProgress = Omit<LessonProgress, 'completedAt'> & { completedAt?: number | null }

export interface CourseOutlineLesson {
  lesson: CourseLesson
  resources: LessonResource[]
}

export interface CourseOutlineChapter {
  chapter: CourseChapter
  lessons: CourseOutlineLesson[]
}

/** 课程大纲：章节与课时按 `sortOrder` 排列，资源归到各自课时下。 */
export interface CourseOutline {
  course: Course
  chapters: CourseOutlineChapter[]
}

/**
 * 课程聚合仓储。
 *
 * 章节 / 课时 / 资源**没有独立生命周期**：它们只作为课程大纲的一部分被写入与读取，
 * 也不存在跨课程的查询需求。因此这里按聚合边界收在一个仓储里，而不是为四张表各起一个——
 * 后者会让双 Provider 的实现与装配面积翻倍，却换不到任何额外能力。
 */
export interface CourseRepository {
  findById(id: string): Promise<Course | null>
  create(course: NewCourse): Promise<Course>
  /**
   * 局部更新课程；课程不存在时返回 `null`。
   *
   * `updatedAt` 由仓储刷新：让调用方传时间戳，等于把"最后修改时间"变成可以填错甚至伪造的字段。
   * `institutionId` 不在可改范围内——课包换机构会让已有的班级关联凭空跨机构。
   */
  update(id: string, data: Partial<Omit<Course, 'id' | 'institutionId' | 'createdAt'>>): Promise<Course | null>
  /** 某机构的全部课程；null 表示无法确定（读取被截断）。 */
  listByInstitution(institutionId: string): Promise<Course[] | null>
  createChapter(chapter: CourseChapter): Promise<CourseChapter>
  createLesson(lesson: CourseLesson): Promise<CourseLesson>
  createResource(resource: LessonResource): Promise<LessonResource>
  /**
   * 读取课程大纲。
   *
   * 课程不存在返回 `null`；存在但大纲读取被截断时**抛错**——不完整的课程大纲会让学生少上几节课，
   * 调用方必须按 fail-closed 处理，而不是把缺课的课程当完整课程展示。
   */
  loadOutline(courseId: string): Promise<CourseOutline | null>
}

export interface ClassCourseRepository {
  /** 关联课包到班级；**幂等**：已关联时返回原记录，且不刷新首次关联时间。 */
  assign(input: NewClassCourse): Promise<ClassCourse>
  listByClass(classId: string): Promise<ClassCourse[] | null>
  listByCourse(courseId: string): Promise<ClassCourse[] | null>
}

export interface LessonProgressRepository {
  /**
   * 按 `(classId, lessonId)` upsert 课时进度。
   *
   * 状态不是 `completed` 时必须把 `completedAt` 清空，避免留下过期的"完成时间"。
   */
  setStatus(input: NewLessonProgress): Promise<LessonProgress>
  listByClass(classId: string): Promise<LessonProgress[] | null>
}

// ─── Database Provider ──────────────────────────────────────────────────────

export interface DatabaseProvider {
  users: UserRepository
  localCredentials: LocalCredentialRepository
  tasks: TaskRepository
  connectors: ConnectorRepository
  miniprogramApps: MiniProgramAppRepository
  cronTasks: CronTaskRepository
  accounts: AccountRepository
  keys: KeyRepository
  userResources: UserResourceRepository
  settings: SettingRepository
  deployments: DeploymentRepository
  adminLogs: AdminLogRepository
  envPool: EnvPoolRepository
  communityWorks: CommunityWorkRepository
  smsCodes: SmsCodeRepository
  userCredits: UserCreditsRepository
  creditTransactions: CreditTransactionRepository
  subscriptionPlans: SubscriptionPlanRepository
  userSubscriptions: UserSubscriptionRepository
  dailyUsage: DailyUsageRepository
  xiaobaoRuntimeCheckpoints: CheckpointRepository
  xiaobaoUsageLedger: XiaobaoUsageLedgerRepository
  institutions: InstitutionRepository
  institutionMembers: InstitutionMemberRepository
  classes: TeacherClassRepository
  classTeachers: ClassTeacherRepository
  classEnrollments: ClassEnrollmentRepository
  courses: CourseRepository
  classCourses: ClassCourseRepository
  lessonProgress: LessonProgressRepository
  classSessions: ClassSessionRepository
}
