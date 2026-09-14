import type { UsageProvider, UsageRecord, UsageReservation, UsageReservationResult } from './ports.js'

/**
 * 学生的小宝学分上限。
 *
 * 返回 `null` 表示**未设上限**（不限制）；查询失败必须抛错，由调用方按 fail-closed 处理。
 * 上限按 **学生个人设置 > 班级共享额度 > 环境默认上限** 的顺序解析，见 `createLayeredBudgetPolicy`。
 */
export interface XiaobaoBudgetPolicy {
  limitFor(userId: string): Promise<number | null>
  /**
   * 可选：与 `limitFor` **同一口径**的已用额度。
   *
   * 班级共享额度必须拿**全班合计**来比，而 `BudgetedUsageProvider` 默认只拿学生个人用量；
   * 一旦用错口径，班级上限就会被当成个人上限使用。提供本方法时装饰器改用它取用量，
   * 不提供时行为与第 63/64 轮完全一致。
   */
  settledCreditsFor?(userId: string): Promise<number | null>
}

/** 已用额度口径：由用量账本提供；`null` 表示**无法确定**。 */
export interface XiaobaoBudgetUsage {
  settledCreditsFor(userId: string): Promise<number | null>
}

export interface BudgetEnvironment {
  /** 未单独配置时对所有学生生效的上限；null 表示未设默认上限。 */
  readonly defaultCredits: number | null
  /** 按学生覆盖的上限。 */
  readonly perUserCredits: ReadonlyMap<string, number>
}

const DEFAULT_CREDITS_KEY = 'XIAOBAO_BUDGET_DEFAULT_CREDITS'
const USER_CREDITS_KEY = 'XIAOBAO_BUDGET_USER_CREDITS'

function parsePositiveInteger(value: string | undefined): number | null | undefined {
  if (value === undefined || value.trim() === '') return null
  if (!/^\d+$/.test(value.trim())) return undefined
  const parsed = Number(value.trim())
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function parseUserCredits(value: string | undefined): ReadonlyMap<string, number> | undefined {
  const entries = new Map<string, number>()
  if (value === undefined || value.trim() === '') return entries

  for (const chunk of value.split(',')) {
    const entry = chunk.trim()
    if (entry === '') continue
    const separator = entry.indexOf('=')
    if (separator <= 0) return undefined
    const userId = entry.slice(0, separator).trim()
    const credits = parsePositiveInteger(entry.slice(separator + 1))
    if (userId === '' || credits === undefined || credits === null) return undefined
    entries.set(userId, credits)
  }
  return entries
}

function readBudgetEnvironment(environment: Record<string, string | undefined>): BudgetEnvironment | null | undefined {
  const defaultCredits = parsePositiveInteger(environment[DEFAULT_CREDITS_KEY])
  if (defaultCredits === undefined) return undefined
  const perUserCredits = parseUserCredits(environment[USER_CREDITS_KEY])
  if (perUserCredits === undefined) return undefined
  if (defaultCredits === null && perUserCredits.size === 0) return null
  return { defaultCredits, perUserCredits }
}

/**
 * 读取预算配置：**未配置**时返回 null（不做任何限制，行为与今天一致）。
 * 配置存在但格式非法时同样返回 null —— 可用 `budgetConfigurationIsInvalid` 区分并给出静态告警。
 */
export function loadBudgetEnvironment(
  environment: Record<string, string | undefined> = process.env,
): BudgetEnvironment | null {
  const parsed = readBudgetEnvironment(environment)
  return parsed ?? null
}

/** 配置了预算变量但内容非法：调用方应发出静态告警，避免"以为有预算其实没有"。 */
export function budgetConfigurationIsInvalid(environment: Record<string, string | undefined> = process.env): boolean {
  const configured = environment[DEFAULT_CREDITS_KEY] !== undefined || environment[USER_CREDITS_KEY] !== undefined
  return configured && readBudgetEnvironment(environment) === undefined
}

export function createEnvironmentBudgetPolicy(environment: BudgetEnvironment): XiaobaoBudgetPolicy {
  return {
    async limitFor(userId) {
      return environment.perUserCredits.get(userId) ?? environment.defaultCredits
    },
  }
}

/** 学生可见的静态提示：不含任何动态值（用户 id、额度数字都不出现）。 */
export const XIAOBAO_BUDGET_EXHAUSTED_REASON = '小宝课堂额度已用完，请联系老师'

/**
 * 学生或班级的额度上限入参校验：只接受正整数，或显式 `null`（取消上限）。
 *
 * 与运行时读取器**同一口径**：0 / 负数 / 小数会被判为配置错误并**拒绝学生开始任务**，
 * 所以写入口必须在写入前就挡住它们，避免一次误操作把学生锁死。
 * 省略字段按非法处理，避免"误清空上限"。放在这里是为了让写入口与运行时共用同一份规则。
 */
export function parseCreditLimit(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return { ok: false }
  return { ok: true, value }
}

/**
 * 按学生上限的读取口子。
 *
 * 刻意用**结构化窄接口**而不是直接依赖 `User` 仓储类型：这样预算策略与拒绝路径
 * 都不需要知道上限是存在列里、独立表里还是别的什么地方。
 */
export interface XiaobaoBudgetCapReader {
  /** 返回该学生的上限；null 表示数据库里没有单独设置。查询失败必须抛错。 */
  readCreditLimit(userId: string): Promise<number | null>
}

/**
 * 读取上限所需的最小来源：只要一个按 id 取用户的方法。
 * `xiaobaoCreditLimit` 声明为可选，因为该列之前的旧数据与 CloudBase 文档里并没有这个字段。
 */
export interface XiaobaoBudgetCapSource {
  findById(id: string): Promise<{ xiaobaoCreditLimit?: number | null } | null>
}

/** 内部失败原因：静态字符串，不含用户 id 或额度数字。 */
const BUDGET_CAP_USER_MISSING = 'xiaobao budget cap user is missing'
const BUDGET_CAP_INVALID = 'xiaobao budget cap is invalid'

/**
 * 从学生记录里读取上限。
 *
 * 全部 fail-closed，避免"以为有预算其实没有"：
 * - 学生记录找不到 ⇒ 抛错（无法判断是否设过上限，宁可挡住）；
 * - 字段缺失或为 null ⇒ 返回 null（明确没有单独设置，继续回退到环境默认值）；
 * - 值不是正整数（0 / 负数 / 小数 / 非数字）⇒ 抛错，绝不把它当成"不限制"。
 */
export function createUserBudgetCapReader(source: XiaobaoBudgetCapSource): XiaobaoBudgetCapReader {
  return {
    async readCreditLimit(userId) {
      const user = await source.findById(userId)
      if (user === null) throw new Error(BUDGET_CAP_USER_MISSING)

      const limit = user.xiaobaoCreditLimit
      if (limit === null || limit === undefined) return null
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error(BUDGET_CAP_INVALID)
      return limit
    },
  }
}

/**
 * 组合策略：**数据库按学生设置的上限优先**，其次环境默认上限，都没有则不限制。
 *
 * 这是**不启用班级共享额度**时的等价组合，保留向后兼容；生产装配已改用
 * `createLayeredBudgetPolicy`（多一层班级共享额度）。
 */
export function createCompositeBudgetPolicy(
  capReader: XiaobaoBudgetCapReader,
  environment: BudgetEnvironment | null,
): XiaobaoBudgetPolicy {
  return {
    async limitFor(userId) {
      const perStudent = await capReader.readCreditLimit(userId)
      if (perStudent !== null) return perStudent
      return environment?.perUserCredits.get(userId) ?? environment?.defaultCredits ?? null
    },
  }
}

/**
 * 班级共享额度：**整班共用**的上限与全班已用合计。
 *
 * `settledCredits` 为 `null` 表示**无法确定**（读取被截断），调用方必须按 fail-closed 处理：
 * 不确定的全班用量不能被当成"还没用"。
 */
export interface XiaobaoClassBudget {
  /** 班级共享上限。 */
  limit: number
  /** 该班所有在班学生已结算的学分合计；null 表示无法确定。 */
  settledCredits: number | null
}

/**
 * 班级共享额度的读取口子：解析**该学生当前适用**的班级共享额度。
 *
 * 返回 `null` 表示该学生没有适用的班级上限（不在任何设了上限的班里）；
 * 查询失败必须抛错，由调用方按 fail-closed 处理。
 */
export interface XiaobaoClassBudgetReader {
  readClassBudget(userId: string): Promise<XiaobaoClassBudget | null>
}

export interface LayeredBudgetPolicyOptions {
  /** 学生个人上限（数据库按学生设置）。 */
  personalCapReader: XiaobaoBudgetCapReader
  /** 学生个人已用额度（用量账本）。 */
  personalUsage: XiaobaoBudgetUsage
  /** 班级共享额度；缺省表示该部署不启用班级共享额度。 */
  classBudgetReader?: XiaobaoClassBudgetReader
  /** 运营侧环境上限；缺省表示没配。 */
  environment: BudgetEnvironment | null
}

/**
 * 分层策略：**学生个人上限 → 班级共享额度 → 环境默认上限**，第一个非空者生效。
 *
 * 每层都带**自己的用量口径**：学生个人层与环境层用学生个人用量，班级层用**全班合计**。
 * 这正是 `settledCreditsFor` 存在的原因——用错口径会把班级上限错当成个人上限。
 * 任何一层查询抛错都会向上传播，由 `BudgetedUsageProvider` 按 fail-closed 拒绝。
 */
export function createLayeredBudgetPolicy(options: LayeredBudgetPolicyOptions): XiaobaoBudgetPolicy {
  type Scope = { limit: number; settledCredits: number | null | undefined }

  async function resolveScope(userId: string): Promise<Scope | null> {
    const personal = await options.personalCapReader.readCreditLimit(userId)
    if (personal !== null) return { limit: personal, settledCredits: undefined }

    if (options.classBudgetReader) {
      const classBudget = await options.classBudgetReader.readClassBudget(userId)
      if (classBudget !== null) return { limit: classBudget.limit, settledCredits: classBudget.settledCredits }
    }

    const environmentLimit =
      options.environment?.perUserCredits.get(userId) ?? options.environment?.defaultCredits ?? null
    if (environmentLimit === null) return null
    return { limit: environmentLimit, settledCredits: undefined }
  }

  return {
    async limitFor(userId) {
      const scope = await resolveScope(userId)
      return scope?.limit ?? null
    },

    async settledCreditsFor(userId) {
      const scope = await resolveScope(userId)
      // 不限制时装饰器不会比较用量，这里返回 null 不会被误用成"用量为零"
      if (scope === null) return null
      if (scope.settledCredits !== undefined) return scope.settledCredits
      return options.personalUsage.settledCreditsFor(userId)
    },
  }
}

/**
 * 把预算上限加到用量 Provider 前面。
 *
 * 语义（全部 fail-closed）：
 * - 未设上限 ⇒ 直接放行给内层（行为与今天一致）；
 * - 已用额度 **达到或超过** 上限 ⇒ 拒绝开始新任务，返回静态提示；
 * - 用量**无法确定**（账本返回 null）或查询抛错 ⇒ 同样拒绝：宁可挡住，也不放行本该被预算拦下的任务。
 */
export class BudgetedUsageProvider implements UsageProvider {
  constructor(
    private readonly inner: UsageProvider,
    private readonly policy: XiaobaoBudgetPolicy,
    private readonly usage: XiaobaoBudgetUsage,
  ) {}

  async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    let limit: number | null
    let settled: number | null

    try {
      limit = await this.policy.limitFor(input.userId)
      if (limit === null) return this.inner.reserve(input)
      // 策略若声明了口径，就必须与 limitFor 取同一口径（班级共享额度是全班合计）
      settled = this.policy.settledCreditsFor
        ? await this.policy.settledCreditsFor(input.userId)
        : await this.usage.settledCreditsFor(input.userId)
    } catch {
      return { allowed: false, reason: XIAOBAO_BUDGET_EXHAUSTED_REASON }
    }

    if (settled === null || settled >= limit) {
      return { allowed: false, reason: XIAOBAO_BUDGET_EXHAUSTED_REASON }
    }

    return this.inner.reserve(input)
  }

  async record(input: UsageRecord): Promise<void> {
    return this.inner.record(input)
  }
}
