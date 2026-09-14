import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getDb } from '../../db/index.js'
import type { CheckpointRepository, DatabaseProvider, XiaobaoUsageLedgerRepository } from '../../db/types.js'
import { parseSkillFromRaw } from '../../util/skill-loader-shared.js'
import { DatabaseCheckpointStore } from './checkpoint-store.js'
import { loadXiaobaoModelConfig, type XiaobaoModelConfig, type XiaobaoModelEnvironment } from './config.js'
import type { XiaobaoCapability } from './domain.js'
import type { OpenAICompatibleToolDefinition } from './openai-compatible-provider.js'
import { OpenAICompatibleModelProvider } from './openai-compatible-provider.js'
import { ProductionSafetyProvider } from './production-safety-provider.js'
import {
  loadXiaobaoProductionGuardConfig,
  type XiaobaoProductionGuardConfig,
  type XiaobaoProductionGuardEnvironment,
} from './production-guard-config.js'
import { ProductionUsageProvider } from './production-usage-provider.js'
import { createMediaToolHttpClient, loadMediaToolEnvironment } from './media-http-client.js'
import { createVolcengineMediaClient, loadVolcengineMediaEnvironment } from './volcengine-media-client.js'
import {
  BudgetedUsageProvider,
  budgetConfigurationIsInvalid,
  createLayeredBudgetPolicy,
  createUserBudgetCapReader,
  loadBudgetEnvironment,
} from './budget-policy.js'
import { createDatabaseClassBudgetReader } from './class-budget-reader.js'
import {
  artifactPublicUrlBase,
  createArtifactStore,
  createCosArtifactUploader,
  loadArtifactStoreEnvironment,
  withArtifactStore,
} from './artifact-store.js'
import type { ArtifactStore } from './ports.js'
import {
  MediaToolsProvider,
  MEDIA_TOOL_DEFINITIONS,
  MEDIA_TOOL_WHITELIST,
  type MediaToolClient,
} from './media-tools.js'
import { createSandboxToolHttpClient, loadSandboxToolEnvironment } from './sandbox-http-client.js'
import {
  SandboxToolsProvider,
  SANDBOX_TOOL_DEFINITIONS,
  SANDBOX_TOOL_WHITELIST,
  type SandboxToolClient,
} from './sandbox-tools.js'
import {
  createTencentTmsClient,
  TencentTmsSafetyProvider,
  type TencentTmsClient,
} from './tencent-tms-safety-provider.js'
import type {
  SafetyProvider,
  SkillProvider,
  SkillSnapshot,
  UsageProvider,
  XiaobaoRuntimeDependencies,
} from './ports.js'
import type { ToolProvider } from './ports.js'

type ApprovedBaseCapability = Extract<XiaobaoCapability, 'writing' | 'learning'>
type ApprovedToolCapability = Extract<XiaobaoCapability, 'game'>
type ApprovedCapability = ApprovedBaseCapability | ApprovedToolCapability
type XiaobaoDatabase = Pick<DatabaseProvider, 'xiaobaoRuntimeCheckpoints'>
// Production guards need the usage ledger for accounting and the users repository for the
// per-student budget cap that 第 64 轮 persisted on the user row.
type XiaobaoProductionGuardDatabase = Pick<
  DatabaseProvider,
  'xiaobaoUsageLedger' | 'users' | 'classes' | 'classEnrollments'
>

export interface ProductionAdapters {
  safety: SafetyProvider
  usage: UsageProvider
}

export type ProductionAdapterFactory = () => ProductionAdapters | null | Promise<ProductionAdapters | null>

export interface XiaobaoProductionDependenciesOptions {
  environment?: XiaobaoModelEnvironment
  adaptersFactory?: ProductionAdapterFactory
  getDatabase?: () => XiaobaoDatabase
  skillsDirectory?: string
  fetchImplementation?: typeof fetch
  sandboxClient?: SandboxToolClient
  mediaClient?: MediaToolClient
  artifactStore?: ArtifactStore
  now?: () => number
  successTtlMs?: number
  failureTtlMs?: number
}

export interface XiaobaoProductionAdapterInitializationOptions {
  environment?: XiaobaoProductionGuardEnvironment
  getDatabase?: () => XiaobaoProductionGuardDatabase
  createTmsClient?: (config: XiaobaoProductionGuardConfig['tms']) => TencentTmsClient
  now?: () => number
}

interface AdapterRegistration {
  readonly token: symbol
  readonly factory: ProductionAdapterFactory
}

interface DependencyIdentity {
  readonly config: XiaobaoModelConfig
  readonly adaptersFactory: ProductionAdapterFactory
  readonly registrationVersion: number
  readonly checkpointRepository: CheckpointRepository
  readonly skillsDirectory: string
  readonly sandboxClient: SandboxToolClient | null
  readonly mediaClient: MediaToolClient | null
  readonly artifactStore: ArtifactStore | null
}

interface DependencyCache extends DependencyIdentity {
  readonly dependencies: XiaobaoRuntimeDependencies | null
  readonly expiresAt: number
}

interface PendingDependencyBuild extends DependencyIdentity {
  readonly promise: Promise<XiaobaoRuntimeDependencies | null>
}

const DEFAULT_SUCCESS_TTL_MS = 30_000
const DEFAULT_FAILURE_TTL_MS = 5_000

const approvedSkillDescriptors: Readonly<
  Record<ApprovedBaseCapability, { readonly name: string; readonly qualityGates: readonly string[] }>
> = Object.freeze({
  writing: Object.freeze({
    name: 'student-writing-coach',
    qualityGates: Object.freeze(['保留学生自己的声音', '不提供可直接提交的代写全文', '内容适龄安全且不泄露个人信息']),
  }),
  learning: Object.freeze({
    name: 'student-learning-master',
    qualityGates: Object.freeze([
      '一次只给一个合适提示并等待学生作答',
      '不替学生完成作业或测验',
      '内容适龄安全且不索取个人信息',
    ]),
  }),
})

const toolSkillDescriptor: Readonly<{
  name: string
  qualityGates: readonly string[]
}> = Object.freeze({
  name: 'scratch-game-coach',
  qualityGates: Object.freeze(['真实项目文件与可启动入口', '实际运行验证核心玩法', '交付可玩的预览或项目']),
})

/** 媒体能力的大师 Skill：只在媒体服务已装配时装载，避免"能力可选但没有技能"。 */
const mediaSkillDescriptors: Readonly<
  Record<'image' | 'video', { readonly name: string; readonly qualityGates: readonly string[] }>
> = Object.freeze({
  image: Object.freeze({
    name: 'student-image-master',
    qualityGates: Object.freeze(['真实生成可展示的图片', '内容适龄安全且不泄露个人信息']),
  }),
  video: Object.freeze({
    name: 'student-video-master',
    qualityGates: Object.freeze(['真实生成可播放的视频', '内容适龄安全且不泄露个人信息']),
  }),
})

let adapterRegistration: AdapterRegistration | null = null
let adapterRegistrationVersion = 0

class ApprovedProjectSkillProvider implements SkillProvider {
  constructor(private readonly skills: ReadonlyMap<XiaobaoCapability, SkillSnapshot>) {}

  async getByCapability(capability: XiaobaoCapability): Promise<SkillSnapshot | null> {
    return this.skills.get(capability) ?? null
  }
}

/**
 * Registers the process-owned production protection adapters.
 * The returned disposer only removes the registration it created, so tests and service shutdown can clean up safely.
 */
export function configureXiaobaoProductionAdapters(factory: ProductionAdapterFactory): () => void {
  const registration = { token: Symbol('xiaobao-production-adapters'), factory }
  adapterRegistration = registration
  adapterRegistrationVersion += 1

  return () => {
    if (adapterRegistration?.token !== registration.token) return
    adapterRegistration = null
    adapterRegistrationVersion += 1
  }
}

/**
 * Registers only real production adapters. Any invalid configuration, unavailable TMS client,
 * unsupported ledger, or failed ledger health check leaves XiaoBao unavailable.
 */
export function initializeXiaobaoProductionAdapters(
  options: XiaobaoProductionAdapterInitializationOptions = {},
): (() => void) | null {
  const config = loadXiaobaoProductionGuardConfig(options.environment ?? process.env)
  if (!config) return null

  try {
    const database = (options.getDatabase ?? getDb)()
    const ledger = database.xiaobaoUsageLedger
    if (!isUsageLedgerRepository(ledger)) return null
    const client = (options.createTmsClient ?? createTencentTmsClient)(config.tms)
    const safety = new ProductionSafetyProvider(new TencentTmsSafetyProvider(config.tms, client))
    // 预算上限分三层：学生个人设置 → 班级共享额度 → 环境默认上限，第一个非空者生效。
    // 班级层用**全班合计**比较（与上限同口径），因此这里同时提供班级列表/名单与多用户用量聚合。
    // 未设上限的学生仍然走数据库查询，所以"只在数据库里设了上限"同样生效；查询失败一律 fail-closed。
    const productionUsage = new ProductionUsageProvider(config.pricing, ledger, options.now)
    const budgetEnvironment = loadBudgetEnvironment(options.environment ?? process.env)
    if (budgetConfigurationIsInvalid(options.environment ?? process.env)) {
      console.warn('[xiaobao] budget configuration is invalid; budgeting stays disabled')
    }
    const classBudgetReader = createDatabaseClassBudgetReader({
      listActiveClassesForStudent: (studentUserId) => database.classes.listByStudent(studentUserId),
      listActiveStudentIds: async (classId) => {
        const roster = await database.classEnrollments.listByClass(classId)
        return roster === null ? null : roster.map((enrollment) => enrollment.studentUserId)
      },
      sumSettledCreditsByUsers: (userIds, since) => ledger.sumSettledCreditsByUsers(userIds, since),
    })
    const usage = new BudgetedUsageProvider(
      productionUsage,
      createLayeredBudgetPolicy({
        personalCapReader: createUserBudgetCapReader(database.users),
        personalUsage: { settledCreditsFor: (userId) => ledger.sumSettledCreditsByUser(userId, null) },
        classBudgetReader,
        environment: budgetEnvironment,
      }),
      { settledCreditsFor: (userId) => ledger.sumSettledCreditsByUser(userId, null) },
    )

    return configureXiaobaoProductionAdapters(async () => {
      try {
        if (!(await ledger.healthCheck())) return null
        return { safety, usage }
      } catch {
        return null
      }
    })
  } catch {
    return null
  }
}

export async function loadApprovedProjectSkills(
  skillsDirectory: string,
  options: { includeGame?: boolean; includeMedia?: boolean } = {},
): Promise<SkillProvider | null> {
  const skills = new Map<XiaobaoCapability, SkillSnapshot>()

  try {
    for (const capability of ['writing', 'learning'] as const) {
      const descriptor = approvedSkillDescriptors[capability]
      const filePath = join(skillsDirectory, descriptor.name, 'SKILL.md')
      const raw = await readFile(filePath, 'utf8')
      const normalizedFilePath = filePath.replaceAll('\\', '/')
      const normalizedBaseDirectory = skillsDirectory.replaceAll('\\', '/')
      const parsed = parseSkillFromRaw(raw, normalizedFilePath, normalizedBaseDirectory, 'project')
      if (!parsed || parsed.name !== descriptor.name || parsed.instructions.length === 0) return null

      skills.set(
        capability,
        Object.freeze({
          name: parsed.name,
          version: '1.0.0',
          instructions: parsed.instructions,
          qualityGates: descriptor.qualityGates,
        }),
      )
    }

    if (options.includeGame) {
      const filePath = join(skillsDirectory, toolSkillDescriptor.name, 'SKILL.md')
      const raw = await readFile(filePath, 'utf8')
      const normalizedFilePath = filePath.replaceAll('\\', '/')
      const normalizedBaseDirectory = skillsDirectory.replaceAll('\\', '/')
      const parsed = parseSkillFromRaw(raw, normalizedFilePath, normalizedBaseDirectory, 'project')
      if (!parsed || parsed.name !== toolSkillDescriptor.name || parsed.instructions.length === 0) return null

      skills.set(
        'game',
        Object.freeze({
          name: parsed.name,
          version: '1.0.0',
          instructions: parsed.instructions,
          qualityGates: toolSkillDescriptor.qualityGates,
        }),
      )
    }

    if (options.includeMedia) {
      for (const capability of ['image', 'video'] as const) {
        const descriptor = mediaSkillDescriptors[capability]
        const filePath = join(skillsDirectory, descriptor.name, 'SKILL.md')
        const raw = await readFile(filePath, 'utf8')
        const normalizedFilePath = filePath.replaceAll('\\', '/')
        const normalizedBaseDirectory = skillsDirectory.replaceAll('\\', '/')
        const parsed = parseSkillFromRaw(raw, normalizedFilePath, normalizedBaseDirectory, 'project')
        if (!parsed || parsed.name !== descriptor.name || parsed.instructions.length === 0) return null

        skills.set(
          capability,
          Object.freeze({
            name: parsed.name,
            version: '1.0.0',
            instructions: parsed.instructions,
            qualityGates: descriptor.qualityGates,
          }),
        )
      }
    }
  } catch {
    return null
  }

  return new ApprovedProjectSkillProvider(skills)
}

export function createXiaobaoProductionDependenciesFactory(
  options: XiaobaoProductionDependenciesOptions = {},
): () => Promise<XiaobaoRuntimeDependencies | null> {
  let cache: DependencyCache | null = null
  let pending: PendingDependencyBuild | null = null
  const now = options.now ?? Date.now
  const fetchImplementation = options.fetchImplementation ?? fetch
  const successTtlMs = Math.max(1, options.successTtlMs ?? DEFAULT_SUCCESS_TTL_MS)
  const failureTtlMs = Math.max(1, options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS)
  const sandboxClient =
    options.sandboxClient ?? createEnvironmentSandboxClient(options.environment ?? process.env, fetchImplementation)
  // 媒体服务配置缺失时保持 null：工具不装配、能力不可用（fail-closed），不使用任何空实现顶替。
  // 优先火山方舟（ARK_API_KEY），其次是自建/第三方 OpenAI 兼容媒体服务（XIAOBAO_MEDIA_*）。
  const mediaClient =
    options.mediaClient ??
    (() => {
      const mediaSource = options.environment ?? process.env
      const volcengine = loadVolcengineMediaEnvironment(mediaSource)
      if (volcengine) return createVolcengineMediaClient(volcengine, { fetchImplementation })
      const generic = loadMediaToolEnvironment(mediaSource)
      return generic ? createMediaToolHttpClient(generic, fetchImplementation) : null
    })()

  // 对象存储未配置时保持 null：媒体产物保留上游临时链接（行为与今天一致），不伪造长期地址。
  const artifactStore =
    options.artifactStore ??
    (() => {
      const artifactEnvironment = loadArtifactStoreEnvironment(options.environment ?? process.env)
      if (!artifactEnvironment) return null
      return createArtifactStore({
        uploader: createCosArtifactUploader(artifactEnvironment),
        publicUrlBase: artifactPublicUrlBase(artifactEnvironment),
        prefix: artifactEnvironment.prefix,
        timeoutMs: artifactEnvironment.timeoutMs,
        fetchImplementation,
      })
    })()

  return async () => {
    const config = loadXiaobaoModelConfig(options.environment ?? process.env)
    const adaptersFactory = options.adaptersFactory ?? adapterRegistration?.factory
    if (!config || !adaptersFactory) {
      cache = null
      pending = null
      return null
    }

    try {
      const database = (options.getDatabase ?? getDb)()
      const checkpointRepository = database.xiaobaoRuntimeCheckpoints
      if (!isCheckpointRepository(checkpointRepository)) return null

      const skillsDirectory = options.skillsDirectory ?? resolveApprovedSkillsDirectory()
      if (!skillsDirectory) return null
      const registrationVersion = options.adaptersFactory ? 0 : adapterRegistrationVersion

      if (
        cache &&
        cache.expiresAt > now() &&
        sameDependencyIdentity(
          cache,
          config,
          adaptersFactory,
          registrationVersion,
          checkpointRepository,
          skillsDirectory,
          sandboxClient,
          mediaClient,
          artifactStore,
        )
      ) {
        return cache.dependencies
      }
      if (
        pending &&
        sameDependencyIdentity(
          pending,
          config,
          adaptersFactory,
          registrationVersion,
          checkpointRepository,
          skillsDirectory,
          sandboxClient,
          mediaClient,
          artifactStore,
        )
      ) {
        return pending.promise
      }

      const build: PendingDependencyBuild = {
        config,
        adaptersFactory,
        registrationVersion,
        checkpointRepository,
        skillsDirectory,
        sandboxClient,
        mediaClient,
        artifactStore,
        promise: assembleDependencies(
          config,
          adaptersFactory,
          checkpointRepository,
          skillsDirectory,
          fetchImplementation,
          sandboxClient,
          mediaClient,
          artifactStore,
        ).catch(() => null),
      }
      pending = build
      try {
        const dependencies = await build.promise
        if (pending === build) {
          cache = {
            config,
            adaptersFactory,
            registrationVersion: build.registrationVersion,
            checkpointRepository,
            skillsDirectory,
            sandboxClient,
            mediaClient,
            artifactStore,
            dependencies,
            expiresAt: now() + (dependencies ? successTtlMs : failureTtlMs),
          }
        }
        return dependencies
      } finally {
        if (pending === build) pending = null
      }
    } catch {
      cache = null
      return null
    }
  }
}

function createEnvironmentSandboxClient(
  environment: XiaobaoModelEnvironment,
  fetchImplementation: typeof fetch,
): SandboxToolClient | null {
  const sandboxEnvironment = loadSandboxToolEnvironment(environment)
  if (!sandboxEnvironment) return null
  return createSandboxToolHttpClient(sandboxEnvironment, fetchImplementation)
}

function resolveApprovedSkillsDirectory(): string | null {
  const candidates = [
    process.env.CODEBUDDY_BUNDLED_SKILLS_DIR,
    resolve(process.cwd(), 'skills'),
    resolve(process.cwd(), '..', '..', 'skills'),
  ].filter((candidate): candidate is string => Boolean(candidate))

  return (
    candidates.find(
      (candidate) =>
        existsSync(join(candidate, approvedSkillDescriptors.writing.name, 'SKILL.md')) &&
        existsSync(join(candidate, approvedSkillDescriptors.learning.name, 'SKILL.md')),
    ) ?? null
  )
}

function isCheckpointRepository(repository: unknown): repository is CheckpointRepository {
  if (!repository || typeof repository !== 'object') return false
  const candidate = repository as Partial<CheckpointRepository>
  return (
    typeof candidate.healthCheck === 'function' &&
    typeof candidate.findByTaskId === 'function' &&
    typeof candidate.create === 'function' &&
    typeof candidate.compareAndSwap === 'function'
  )
}

function isUsageLedgerRepository(repository: unknown): repository is XiaobaoUsageLedgerRepository {
  if (!repository || typeof repository !== 'object') return false
  const candidate = repository as Partial<XiaobaoUsageLedgerRepository>
  return (
    typeof candidate.reserve === 'function' &&
    typeof candidate.settle === 'function' &&
    typeof candidate.release === 'function' &&
    typeof candidate.findByTaskAndCategory === 'function' &&
    typeof candidate.healthCheck === 'function'
  )
}

async function assembleDependencies(
  config: XiaobaoModelConfig,
  adaptersFactory: ProductionAdapterFactory,
  checkpointRepository: CheckpointRepository,
  skillsDirectory: string,
  fetchImplementation: typeof fetch,
  sandboxClient: SandboxToolClient | null,
  mediaClient: MediaToolClient | null,
  artifactStore: ArtifactStore | null,
): Promise<XiaobaoRuntimeDependencies | null> {
  if (typeof checkpointRepository.checkReadWriteReadiness !== 'function') return null
  const checkpointReadiness = await checkpointRepository.checkReadWriteReadiness()
  if (!checkpointReadiness.readable || !checkpointReadiness.writable) return null
  if (!(await probeProductionReadiness(config, fetchImplementation))) return null

  const sandboxHealthy = sandboxClient ? await sandboxClient.healthCheck() : false
  // 媒体服务必须健康才装配媒体工具；不健康或未配置时保持工具缺失（fail-closed）。
  const mediaHealthy = mediaClient ? await mediaClient.healthCheck() : false
  const [adapters, skills] = await Promise.all([
    adaptersFactory(),
    loadApprovedProjectSkills(skillsDirectory, { includeGame: sandboxHealthy, includeMedia: mediaHealthy }),
  ])
  if (!isProductionAdapters(adapters) || !skills) return null
  const { healthCheckUrl: _healthCheckUrl, ...modelConfig } = config

  const tools = new Map<string, ToolProvider>()
  if (sandboxClient && sandboxHealthy) {
    const provider = new SandboxToolsProvider(sandboxClient)
    for (const toolName of Object.keys(SANDBOX_TOOL_WHITELIST)) {
      tools.set(toolName, provider)
    }
  }
  if (mediaClient && mediaHealthy) {
    // 媒体产物是上游临时链接（约 24 小时失效）：配置了对象存储时转存为自己的长期地址，
    // 未配置或转存失败则保留上游链接（见 artifact-store.ts 的降级说明）。
    const mediaProvider = withArtifactStore(new MediaToolsProvider(mediaClient), artifactStore)
    for (const toolName of Object.keys(MEDIA_TOOL_WHITELIST)) {
      tools.set(toolName, mediaProvider)
    }
  }
  const modelTools = [
    ...(sandboxClient && sandboxHealthy ? SANDBOX_TOOL_DEFINITIONS : []),
    ...(mediaClient && mediaHealthy ? MEDIA_TOOL_DEFINITIONS : []),
  ]

  return {
    model: new OpenAICompatibleModelProvider(
      { ...modelConfig, tools: modelTools.length > 0 ? modelTools : undefined },
      fetchImplementation,
    ),
    tools,
    skills,
    checkpoints: new DatabaseCheckpointStore(checkpointRepository),
    safety: adapters.safety,
    usage: adapters.usage,
    clock: { now: Date.now },
  }
}

function sameDependencyIdentity(
  candidate: DependencyIdentity,
  config: XiaobaoModelConfig,
  adaptersFactory: ProductionAdapterFactory,
  registrationVersion: number,
  checkpointRepository: CheckpointRepository,
  skillsDirectory: string,
  sandboxClient: SandboxToolClient | null,
  mediaClient: MediaToolClient | null,
  artifactStore: ArtifactStore | null,
): boolean {
  return (
    candidate.adaptersFactory === adaptersFactory &&
    candidate.registrationVersion === registrationVersion &&
    candidate.checkpointRepository === checkpointRepository &&
    candidate.skillsDirectory === skillsDirectory &&
    candidate.sandboxClient === sandboxClient &&
    candidate.mediaClient === mediaClient &&
    candidate.artifactStore === artifactStore &&
    sameModelConfig(candidate.config, config)
  )
}

function isProductionAdapters(adapters: ProductionAdapters | null): adapters is ProductionAdapters {
  return Boolean(
    adapters &&
    typeof adapters.safety?.check === 'function' &&
    typeof adapters.usage?.reserve === 'function' &&
    typeof adapters.usage?.record === 'function',
  )
}

function sameModelConfig(left: XiaobaoModelConfig, right: XiaobaoModelConfig): boolean {
  return (
    left.baseUrl === right.baseUrl &&
    left.healthCheckUrl === right.healthCheckUrl &&
    left.apiKey === right.apiKey &&
    left.modelId === right.modelId &&
    left.modelName === right.modelName &&
    left.timeoutMs === right.timeoutMs &&
    left.contextWindow === right.contextWindow
  )
}

async function probeProductionReadiness(
  config: XiaobaoModelConfig,
  fetchImplementation: typeof fetch,
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  let response: Response | undefined

  try {
    response = await fetchImplementation(config.healthCheckUrl, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
    if (response?.body) await response.body.cancel().catch(() => undefined)
  }
}

export const getXiaobaoProductionDependencies = createXiaobaoProductionDependenciesFactory()
