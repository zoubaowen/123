import { sql } from 'drizzle-orm'
import { check, sqliteTable, text, integer, uniqueIndex, index, primaryKey } from 'drizzle-orm/sqlite-core'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = () => Date.now()
const xiaobaoUsageCategories = ['model', 'tool', 'sandbox', 'media'] as const
const xiaobaoUsageReservationStatuses = ['reserved', 'settled', 'released'] as const

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    provider: text('provider').notNull(), // 'github' | 'local'
    externalId: text('external_id').notNull(),
    accessToken: text('access_token').notNull().default(''),
    refreshToken: text('refresh_token'),
    scope: text('scope'),
    username: text('username').notNull(),
    email: text('email'),
    name: text('name'),
    avatarUrl: text('avatar_url'),

    // Role and status fields for admin system
    role: text('role').notNull().default('user'), // 'user' | 'admin'
    status: text('status').notNull().default('active'), // 'active' | 'disabled'
    disabledReason: text('disabled_reason'),
    disabledAt: integer('disabled_at'),
    disabledBy: text('disabled_by'), // Admin user ID who disabled this user

    // Server API Key for programmatic access
    apiKey: text('api_key'), // Encrypted, plaintext has prefix sak_

    // Phone for SMS verification
    phone: text('phone'),
    phoneVerified: integer('phone_verified', { mode: 'boolean' }).default(false),

    // Per-student XiaoBao credit cap; null means no cap is configured for this student.
    xiaobaoCreditLimit: integer('xiaobao_credit_limit'),

    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
    lastLoginAt: integer('last_login_at').notNull().$defaultFn(now),
  },
  (table) => ({
    providerExternalIdUnique: uniqueIndex('users_provider_external_id_idx').on(table.provider, table.externalId),
    phoneUnique: uniqueIndex('users_phone_unique_idx').on(table.phone),
  }),
)

// ─── Local Credentials ────────────────────────────────────────────────────────

export const localCredentials = sqliteTable('local_credentials', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

// ─── Tasks ───────────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    title: text('title'),
    repoUrl: text('repo_url'),
    // CloudBase environment ID used for this task (resolved at creation from provision mode)
    envId: text('env_id'),
    selectedAgent: text('selected_agent').default('claude'),
    selectedModel: text('selected_model'),
    selectedRuntime: text('selected_runtime'), // 'tencent-sdk' | 'opencode-acp' | null (null = registry default)
    xiaobaoCapability: text('xiaobao_capability'), // 'writing' | 'learning' | 'game' | null (XiaoBao runtime only)
    mode: text('mode').notNull().default('default'), // 'default' | 'coding'
    installDependencies: integer('install_dependencies', { mode: 'boolean' }).default(false),
    maxDuration: integer('max_duration').default(parseInt(process.env.MAX_SANDBOX_DURATION || '300', 10)),
    keepAlive: integer('keep_alive', { mode: 'boolean' }).default(false),
    enableBrowser: integer('enable_browser', { mode: 'boolean' }).default(false),
    status: text('status').notNull().default('pending'),
    progress: integer('progress').default(0),
    logs: text('logs'), // JSON string of LogEntry[]
    error: text('error'),
    branchName: text('branch_name'),
    sandboxId: text('sandbox_id'),
    sandboxSessionId: text('sandbox_session_id'),
    sandboxCwd: text('sandbox_cwd'),
    sandboxMode: text('sandbox_mode'),
    agentSessionId: text('agent_session_id'),
    sandboxUrl: text('sandbox_url'),
    previewUrl: text('preview_url'),
    prUrl: text('pr_url'),
    prNumber: integer('pr_number'),
    prStatus: text('pr_status'),
    prMergeCommitSha: text('pr_merge_commit_sha'),
    mcpServerList: text('mcp_server_list'), // JSON string of Connector[]
    skillSettings: text('skill_settings'), // JSON string of { initialized: boolean; skillList: string[] }
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
    completedAt: integer('completed_at'),
    deletedAt: integer('deleted_at'),
  },
  (table) => ({
    userDeletedCreatedIdx: index('tasks_user_deleted_created_idx').on(table.userId, table.deletedAt, table.createdAt),
    deletedStatusCreatedIdx: index('tasks_deleted_status_created_idx').on(
      table.deletedAt,
      table.status,
      table.createdAt,
    ),
    userPrRepoIdx: index('tasks_user_pr_repo_idx').on(table.userId, table.prNumber, table.repoUrl),
  }),
)

// ─── XiaoBao Runtime Checkpoints ─────────────────────────────────────────────

export const xiaobaoRuntimeCheckpoints = sqliteTable('xiaobao_runtime_checkpoints', {
  taskId: text('task_id').primaryKey(),
  revision: integer('revision').notNull(),
  schemaVersion: integer('schema_version').notNull(),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// ─── XiaoBao Usage Reservations ─────────────────────────────────────────────

export const xiaobaoUsageReservations = sqliteTable(
  'xiaobao_usage_reservations',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull(),
    userId: text('user_id').notNull(),
    category: text('category', { enum: xiaobaoUsageCategories }).notNull(),
    reservedUnits: integer('reserved_units').notNull(),
    settledUnits: integer('settled_units'),
    status: text('status', { enum: xiaobaoUsageReservationStatuses }).notNull(),
    creditCostReserved: integer('credit_cost_reserved').notNull(),
    creditCostSettled: integer('credit_cost_settled'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    settledAt: integer('settled_at'),
  },
  (table) => ({
    taskCategoryUnique: uniqueIndex('xiaobao_usage_reservations_task_category_unique').on(table.taskId, table.category),
    userIdIdx: index('xiaobao_usage_reservations_user_id_idx').on(table.userId),
    statusIdx: index('xiaobao_usage_reservations_status_idx').on(table.status),
    categoryCheck: check(
      'xiaobao_usage_reservations_category_check',
      sql`${table.category} IN ('model', 'tool', 'sandbox', 'media')`,
    ),
    statusCheck: check(
      'xiaobao_usage_reservations_status_check',
      sql`${table.status} IN ('reserved', 'settled', 'released')`,
    ),
    reservedUnitsCheck: check(
      'xiaobao_usage_reservations_reserved_units_check',
      sql`typeof(${table.reservedUnits}) = 'integer' AND ${table.reservedUnits} > 0`,
    ),
    settledUnitsCheck: check(
      'xiaobao_usage_reservations_settled_units_check',
      sql`${table.settledUnits} IS NULL OR (typeof(${table.settledUnits}) = 'integer' AND ${table.settledUnits} >= 0)`,
    ),
    creditCostReservedCheck: check(
      'xiaobao_usage_reservations_credit_cost_reserved_check',
      sql`typeof(${table.creditCostReserved}) = 'integer' AND ${table.creditCostReserved} >= 0`,
    ),
    creditCostSettledCheck: check(
      'xiaobao_usage_reservations_credit_cost_settled_check',
      sql`${table.creditCostSettled} IS NULL OR (typeof(${table.creditCostSettled}) = 'integer' AND ${table.creditCostSettled} >= 0)`,
    ),
  }),
)

// ─── Connectors ───────────────────────────────────────────────────────────────

export const connectors = sqliteTable('connectors', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull().default('remote'), // 'local' | 'remote'
  baseUrl: text('base_url'),
  oauthClientId: text('oauth_client_id'),
  oauthClientSecret: text('oauth_client_secret'),
  command: text('command'),
  args: text('args'),
  env: text('env'),
  headers: text('headers'),
  status: text('status').notNull().default('disconnected'), // 'connected' | 'disconnected'
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

// ─── MiniProgram Apps ─────────────────────────────────────────────────────────

export const miniprogramApps = sqliteTable('miniprogram_apps', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  appId: text('app_id').notNull(),
  privateKey: text('private_key').notNull(), // stored encrypted via lib/crypto
  description: text('description'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

// ─── Cron Tasks ──────────────────────────────────────────────────────────────

export const cronTasks = sqliteTable('cron_tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  cronExpression: text('cron_expression').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  repoUrl: text('repo_url'),
  selectedAgent: text('selected_agent').default('codebuddy'),
  selectedModel: text('selected_model'),
  lastRunAt: integer('last_run_at'),
  nextRunAt: integer('next_run_at'),
  lockedBy: text('locked_by'),
  lockedAt: integer('locked_at'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

// ─── Accounts ─────────────────────────────────────────────────────────────────

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('github'), // 'github'
    externalUserId: text('external_user_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: integer('expires_at'),
    scope: text('scope'),
    username: text('username').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdProviderUnique: uniqueIndex('accounts_user_id_provider_idx').on(table.userId, table.provider),
  }),
)

// ─── Keys ────────────────────────────────────────────────────────────────────

export const keys = sqliteTable(
  'keys',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'anthropic' | 'openai' | 'cursor' | 'gemini' | 'aigateway'
    value: text('value').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdProviderUnique: uniqueIndex('keys_user_id_provider_idx').on(table.userId, table.provider),
  }),
)

// ─── CloudBase User Resources ───────────────────────────────────────────────

export const userResources = sqliteTable('user_resources', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // scope: 'user' = user-level env (shared/isolated), 'task' = task-level env
  scope: text('scope').notNull().default('user'),
  // taskId: only set when scope='task', links this env resource to a specific task
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'),
  envId: text('env_id'),
  envAlias: text('env_alias'),
  envRegion: text('env_region'),
  cosTagValue: text('cos_tag_value'),
  policyHash: text('policy_hash'),
  camUsername: text('cam_username'),
  camSecretId: text('cam_secret_id'),
  camSecretKey: text('cam_secret_key'),
  policyId: integer('policy_id'),
  failStep: text('fail_step'),
  failReason: text('fail_reason'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

// ─── Settings ────────────────────────────────────────────────────────────────

export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    // userId = null  →  system-level setting (not tied to any user)
    // userId = <id>  →  per-user setting
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdKeyUnique: uniqueIndex('settings_user_id_key_idx').on(table.userId, table.key),
  }),
)

// ─── Deployments ─────────────────────────────────────────────────────────────

export const deployments = sqliteTable(
  'deployments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'web' | 'miniprogram'

    // For web deployments
    url: text('url'),
    path: text('path'), // Extracted URL path for deduplication

    // For miniprogram deployments
    qrCodeUrl: text('qr_code_url'),
    pagePath: text('page_path'),
    appId: text('app_id'),

    // Metadata
    label: text('label'), // Optional display name
    metadata: text('metadata'), // JSON string for additional fields

    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
    deletedAt: integer('deleted_at'),
  },
  (table) => ({
    // Indexes for faster queries (deduplication handled in application logic)
    taskIdIdx: index('deployments_task_id_idx').on(table.taskId),
    taskTypePathIdx: index('deployments_task_type_path_idx').on(table.taskId, table.type, table.path),
  }),
)

// ─── Admin Logs ───────────────────────────────────────────────────────────────

export const adminLogs = sqliteTable(
  'admin_logs',
  {
    id: text('id').primaryKey(),
    adminUserId: text('admin_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(), // 'user_disable' | 'user_enable' | 'user_role_change' | 'password_reset' | ...
    targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    details: text('details'), // JSON string
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (table) => ({
    adminUserIdIdx: index('admin_logs_admin_user_id_idx').on(table.adminUserId),
    targetUserIdIdx: index('admin_logs_target_user_id_idx').on(table.targetUserId),
    actionIdx: index('admin_logs_action_idx').on(table.action),
    createdAtIdx: index('admin_logs_created_at_idx').on(table.createdAt),
  }),
)

// ─── Environment Pool ───────────────────────────────────────────────────────

export const envPool = sqliteTable(
  'env_pool',
  {
    id: text('id').primaryKey(),
    // 'creating' → 'ready' → 'claimed' | 'failed'
    status: text('status').notNull().default('creating'),
    envId: text('env_id'),
    envAlias: text('env_alias'),
    envRegion: text('env_region'),
    cosTagValue: text('cos_tag_value'),
    policyHash: text('policy_hash'),
    camUsername: text('cam_username'),
    camSecretId: text('cam_secret_id'),
    camSecretKey: text('cam_secret_key'),
    policyId: integer('policy_id'),
    // 认领信息
    claimedByUserId: text('claimed_by_user_id'),
    claimedByTaskId: text('claimed_by_task_id'),
    claimedAt: integer('claimed_at'),
    failReason: text('fail_reason'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    statusIdx: index('env_pool_status_idx').on(table.status),
  }),
)

// ─── Community Works ─────────────────────────────────────────────────────────

export const communityWorks = sqliteTable(
  'community_works',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userName: text('user_name').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    previewUrl: text('preview_url'),
    tags: text('tags').notNull().default('[]'),
    fileUrls: text('file_urls').notNull().default('[]'),
    likeCount: integer('like_count').notNull().default(0),
    likedBy: text('liked_by').notNull().default('[]'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdIdx: index('cw_user_id_idx').on(table.userId),
    createdAtIdx: index('cw_created_at_idx').on(table.createdAt),
  }),
)

// ─── SMS Verification Codes ───────────────────────────────────────────────────

export const smsCodes = sqliteTable(
  'sms_codes',
  {
    id: text('id').primaryKey(),
    phone: text('phone').notNull(),
    code: text('code').notNull(),
    expiresAt: integer('expires_at').notNull(),
    used: integer('used', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (table) => ({
    phoneIdx: index('sms_codes_phone_idx').on(table.phone),
    expiresIdx: index('sms_codes_expires_idx').on(table.expiresAt),
  }),
)

// ─── User Credits ────────────────────────────────────────────────────────────

export const userCredits = sqliteTable(
  'user_credits',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' })
      .unique(),
    balance: integer('balance').notNull().default(0), // Available credits
    frozenBalance: integer('frozen_balance').notNull().default(0), // Credits frozen for in-progress tasks
    lifetimeBalance: integer('lifetime_balance').notNull().default(0), // Total credits ever purchased
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdIdx: index('user_credits_user_id_idx').on(table.userId),
  }),
)

// ─── Credit Transactions ─────────────────────────────────────────────────────

export const creditTransactions = sqliteTable(
  'credit_transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // 'purchase' | 'consumption' | 'refund' | 'admin_grant' | 'subscription' | 'free_daily'
    amount: integer('amount').notNull(), // Positive = credit, negative = debit
    balanceAfter: integer('balance_after').notNull(),
    description: text('description'), // Human-readable memo
    metadata: text('metadata'), // JSON: { taskId?, planId?, paymentId? }
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdIdx: index('ct_user_id_idx').on(table.userId),
    typeIdx: index('ct_type_idx').on(table.type),
    createdAtIdx: index('ct_created_at_idx').on(table.createdAt),
  }),
)

// ─── Subscription Plans ──────────────────────────────────────────────────────

export const subscriptionPlans = sqliteTable(
  'subscription_plans',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull(), // 'free' | 'basic' | 'pro' | 'enterprise'
    creditsPerPeriod: integer('credits_per_period').notNull().default(0), // Credits granted each period
    periodDays: integer('period_days').notNull().default(30), // Billing period in days
    priceCents: integer('price_cents').notNull().default(0), // Price in cents (0 = free)
    maxTasksPerDay: integer('max_tasks_per_day'), // null = unlimited
    maxSandboxDuration: integer('max_sandbox_duration'), // max seconds per sandbox
    features: text('features'), // JSON array of feature flags
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    activeIdx: index('sp_active_idx').on(table.active),
  }),
)

// ─── User Subscriptions ──────────────────────────────────────────────────────

export const userSubscriptions = sqliteTable(
  'user_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: text('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: 'restrict' }),
    status: text('status').notNull().default('active'), // 'active' | 'expired' | 'cancelled' | 'pending'
    currentPeriodStart: integer('current_period_start').notNull(),
    currentPeriodEnd: integer('current_period_end').notNull(),
    autoRenew: integer('auto_renew', { mode: 'boolean' }).notNull().default(true),
    cancelledAt: integer('cancelled_at'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userIdIdx: index('us_user_id_idx').on(table.userId),
    statusIdx: index('us_status_idx').on(table.status),
  }),
)

// ─── Daily Usage ──────────────────────────────────────────────────────────────

export const dailyUsage = sqliteTable(
  'daily_usage',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // 'YYYY-MM-DD'
    taskCount: integer('task_count').notNull().default(0),
    sandboxDuration: integer('sandbox_duration').notNull().default(0), // Total seconds
    creditsConsumed: integer('credits_consumed').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    userDateUnique: uniqueIndex('du_user_date_unique').on(table.userId, table.date),
    dateIdx: index('du_date_idx').on(table.date),
  }),
)

// ─── Institutions & Teaching Classes ─────────────────────────────────────────
// 教师端的机构、班级、任课老师与学生选课。机构角色刻意不写进 users.role：
// 那一列是平台运维后台的管理员标志（requireAdmin 依赖它），而机构角色天然是多对多的。

const institutionMemberRoles = ['owner', 'admin', 'teacher'] as const
const institutionMemberStatuses = ['active', 'left'] as const
const classAiUsageModes = ['class_only', 'anytime'] as const
/** 机构与班级共用同一套生命周期取值。 */
const lifecycleStatuses = ['active', 'archived'] as const
const classTeacherRoles = ['lead', 'assistant'] as const
const classEnrollmentStatuses = ['active', 'left'] as const

export const institutions = sqliteTable('institutions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  status: text('status', { enum: lifecycleStatuses }).notNull().default('active'),
  createdAt: integer('created_at').notNull().$defaultFn(now),
  updatedAt: integer('updated_at').notNull().$defaultFn(now),
})

export const institutionMembers = sqliteTable(
  'institution_members',
  {
    id: text('id').primaryKey(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: institutionMemberRoles }).notNull(),
    status: text('status', { enum: institutionMemberStatuses }).notNull().default('active'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    institutionUserUnique: uniqueIndex('institution_members_institution_user_unique').on(
      table.institutionId,
      table.userId,
    ),
    userIdx: index('institution_members_user_id_idx').on(table.userId),
  }),
)

export const classes = sqliteTable(
  'classes',
  {
    id: text('id').primaryKey(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // 'class_only' = 仅上课可用；'anytime' = 随时可用
    aiUsageMode: text('ai_usage_mode', { enum: classAiUsageModes }).notNull().default('class_only'),
    // 班级共享额度：null 表示未设置（不限制），与 users.xiaobao_credit_limit 对称
    xiaobaoCreditLimit: integer('xiaobao_credit_limit'),
    status: text('status', { enum: lifecycleStatuses }).notNull().default('active'),
    archivedAt: integer('archived_at'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    institutionStatusIdx: index('classes_institution_status_idx').on(table.institutionId, table.status),
  }),
)

export const classTeachers = sqliteTable(
  'class_teachers',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: classTeacherRoles }).notNull().default('lead'),
    createdAt: integer('created_at').notNull().$defaultFn(now),
  },
  (table) => ({
    classUserPk: primaryKey({ columns: [table.classId, table.userId] }),
    userIdx: index('class_teachers_user_id_idx').on(table.userId),
  }),
)

export const classEnrollments = sqliteTable(
  'class_enrollments',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    studentUserId: text('student_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', { enum: classEnrollmentStatuses }).notNull().default('active'),
    joinedAt: integer('joined_at').notNull().$defaultFn(now),
    // 退班保留历史：写 leftAt 而不是删除记录，否则课堂记录与作品会失去归属
    leftAt: integer('left_at'),
  },
  (table) => ({
    classStudentUnique: uniqueIndex('class_enrollments_class_student_unique').on(table.classId, table.studentUserId),
    studentStatusIdx: index('class_enrollments_student_status_idx').on(table.studentUserId, table.status),
  }),
)

// ─── Courses & Lessons ───────────────────────────────────────────────────────
// 课程（课包）是机构级资源；班级通过 class_courses 关联课包，课时进度按 (班级, 课时) 记录。
// 数组字段（目标/步骤/提示/能力/Skills/MCP）以 JSON 字符串列存储，与 tasks.skillSettings 的做法一致。

const courseStages = ['lower_primary', 'upper_primary', 'middle_school'] as const
const courseStatuses = ['ready', 'draft'] as const
const lessonResourceTypes = ['slides', 'demo', 'worksheet', 'assignment'] as const
const lessonResourceStatuses = ['ready', 'planned'] as const
const lessonProgressStatuses = ['completed', 'next', 'locked'] as const

export const courses = sqliteTable(
  'courses',
  {
    id: text('id').primaryKey(),
    institutionId: text('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // 空字符串表示用品牌默认图，而不是"没有封面"这种需要额外判空的状态
    coverAsset: text('cover_asset').notNull().default(''),
    stage: text('stage', { enum: courseStages }).notNull(),
    topic: text('topic').notNull(),
    status: text('status', { enum: courseStatuses }).notNull().default('draft'),
    ageRange: text('age_range').notNull().default(''),
    goals: text('goals').notNull().default('[]'), // JSON string of string[]
    expectedOutcome: text('expected_outcome').notNull().default(''),
    createdAt: integer('created_at').notNull().$defaultFn(now),
    updatedAt: integer('updated_at').notNull().$defaultFn(now),
  },
  (table) => ({
    institutionStatusIdx: index('courses_institution_status_idx').on(table.institutionId, table.status),
  }),
)

export const courseChapters = sqliteTable(
  'course_chapters',
  {
    id: text('id').primaryKey(),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    // 用 sort_order 而不是 order：order 是 SQL 关键字，已有 subscription_plans 也采用这个命名
    sortOrder: integer('sort_order').notNull(),
  },
  (table) => ({
    courseIdx: index('course_chapters_course_id_idx').on(table.courseId),
  }),
)

export const courseLessons = sqliteTable(
  'course_lessons',
  {
    id: text('id').primaryKey(),
    chapterId: text('chapter_id')
      .notNull()
      .references(() => courseChapters.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    sortOrder: integer('sort_order').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    objectives: text('objectives').notNull().default('[]'),
    steps: text('steps').notNull().default('[]'),
    teacherTips: text('teacher_tips').notNull().default('[]'),
    assignment: text('assignment').notNull().default(''),
    capabilities: text('capabilities').notNull().default('[]'),
    skills: text('skills').notNull().default('[]'),
    mcpServers: text('mcp_servers').notNull().default('[]'),
  },
  (table) => ({
    chapterIdx: index('course_lessons_chapter_id_idx').on(table.chapterId),
  }),
)

export const lessonResources = sqliteTable(
  'lesson_resources',
  {
    id: text('id').primaryKey(),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => courseLessons.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    type: text('type', { enum: lessonResourceTypes }).notNull(),
    status: text('status', { enum: lessonResourceStatuses }).notNull().default('planned'),
  },
  (table) => ({
    lessonIdx: index('lesson_resources_lesson_id_idx').on(table.lessonId),
  }),
)

export const classCourses = sqliteTable(
  'class_courses',
  {
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    courseId: text('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'cascade' }),
    assignedAt: integer('assigned_at').notNull().$defaultFn(now),
  },
  (table) => ({
    classCoursePk: primaryKey({ columns: [table.classId, table.courseId] }),
    courseIdx: index('class_courses_course_id_idx').on(table.courseId),
  }),
)

export const lessonProgress = sqliteTable(
  'lesson_progress',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => courseLessons.id, { onDelete: 'cascade' }),
    status: text('status', { enum: lessonProgressStatuses }).notNull(),
    // 未完成的课时没有完成时间；用 null 而不是 0 冒充时间戳
    completedAt: integer('completed_at'),
  },
  (table) => ({
    classLessonUnique: uniqueIndex('lesson_progress_class_lesson_unique').on(table.classId, table.lessonId),
    classIdx: index('lesson_progress_class_id_idx').on(table.classId),
  }),
)

// ─── Class Sessions ──────────────────────────────────────────────────────────
// 一次开课就是一节课的会话记录：能力、额度与时间是**当时的快照**，不随后续配置修改而回填。
// `endedAt` 为 null 表示进行中；"一个班同时只有一节进行中的课"由部分唯一索引保证。

export const classSessions = sqliteTable(
  'class_sessions',
  {
    id: text('id').primaryKey(),
    classId: text('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    lessonId: text('lesson_id')
      .notNull()
      .references(() => courseLessons.id, { onDelete: 'cascade' }),
    startedByUserId: text('started_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startedAt: integer('started_at').notNull(),
    // null 表示仍在进行中
    endedAt: integer('ended_at'),
    // 下课才写入；进行中的会话没有时长
    durationMinutes: integer('duration_minutes'),
    pointLimit: integer('point_limit').notNull(),
    capabilities: text('capabilities').notNull().default('[]'),
    skills: text('skills').notNull().default('[]'),
    mcpServers: text('mcp_servers').notNull().default('[]'),
    // 开课时的人数快照；名单无法确定时存 null，而不是编造 0
    studentCount: integer('student_count'),
  },
  (table) => ({
    // 一个班同时只能有一节进行中的课：部分唯一索引把这条不变量交给数据库保证
    activeClassUnique: uniqueIndex('class_sessions_active_class_unique')
      .on(table.classId)
      .where(sql`${table.endedAt} is null`),
    classStartedIdx: index('class_sessions_class_started_idx').on(table.classId, table.startedAt),
  }),
)
