/**
 * BaseAgentRuntime
 *
 * 抽象基类：提供所有 runtime 共享的基础设施：
 * - 沙箱生命周期（SCF 创建 + 健康检查 + workspace init）
 * - MCP Server（sandbox-mcp-proxy）
 * - System Prompt（buildAppendPrompt + getCodingSystemPrompt）
 * - PublishableKey 获取
 *
 * 子类只需实现 `runAgent(ctx, prompt, options)` —— 具体 agent 驱动逻辑。
 *
 * 使用模板方法模式：chatStream() 编排公共流程，调 runAgent() 做子类特定工作。
 * 但目前 CodeBuddyRuntime 因历史原因仍直接委托到 cloudbase-agent.service.ts，
 * 仅 OpencodeAcpRuntime 使用基类提供的 sandbox/MCP/systemPrompt 设施。
 * 未来 CodeBuddyRuntime 迁移后可直接在 runAgent 中使用。
 */

import type { AgentCallback, AgentCallbackMessage, AgentOptions } from '@ai-xiaobao/shared'
import type { ChatStreamResult, IAgentRuntime } from './types.js'
import type { ModelInfo } from '../cloudbase-agent.service.js'
import {
  scfSandboxManager,
  type SandboxInstance,
  type SandboxProgressCallback,
} from '../../sandbox/scf-sandbox-manager.js'
import { createSandboxMcpClient, type SandboxMcpDeps } from '../../sandbox/sandbox-mcp-proxy.js'
import { getDb } from '../../db/index.js'
import { resolveSandboxConfig, backfillSandboxConfig } from '../../lib/sandbox-config.js'
import { getCodingSystemPrompt } from '../coding-mode.js'
import { decrypt } from '../../lib/crypto.js'
import { encryptJWE } from '../../lib/session.js'
import { sessionPermissions } from '../session-permissions.js'
import { initSkills } from '../../services/skill-manager.js'

// ─── Constants ─────────────────────────────────────────────────────────────

const HEALTH_MAX_RETRIES = 20
const HEALTH_INTERVAL_MS = 2000

/**
 * 需要用户确认的写操作工具集合。
 * 所有 runtime 共享此白名单（TencentSdk 的 canUseTool + OpenCode 的 requestPermission）。
 */
export const WRITE_TOOLS = new Set([
  'writeNoSqlDatabaseStructure',
  'writeNoSqlDatabaseContent',
  'executeWriteSQL',
  'modifyDataModel',
  'createFunction',
  'updateFunctionCode',
  'updateFunctionConfig',
  'invokeFunction',
])

// ─── Shared Helpers ────────────────────────────────────────────────────────

/**
 * 等待沙箱健康检查就绪（轮询 /health）
 */
export async function waitForSandboxHealth(
  sandbox: SandboxInstance,
  onProgress?: SandboxProgressCallback,
): Promise<boolean> {
  onProgress?.({ phase: 'wait_ready', message: '等待沙箱就绪...\n' })
  for (let i = 0; i < HEALTH_MAX_RETRIES; i++) {
    try {
      const res = await sandbox.request('/health', {
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        return true
      }
    } catch {
      // 继续轮询
    }
    await new Promise((r) => setTimeout(r, HEALTH_INTERVAL_MS))
  }
  return false
}

/**
 * 初始化沙箱工作空间：POST /api/session/init 注入凭证和环境变量
 * 然后 poll /api/scope/info 获取工作目录
 */
export async function initSandboxWorkspace(
  sandbox: SandboxInstance,
  secret: { envId: string; secretId: string; secretKey: string; token?: string },
  conversationId: string,
  preferredCwd?: string,
  onProgress?: SandboxProgressCallback,
): Promise<{ workspace: string; vitePort?: number }> {
  const fallbackWorkspace = preferredCwd || `/tmp/workspace/${secret.envId}/${conversationId}`

  onProgress?.({ phase: 'init_mcp', message: '初始化工作空间...\n' })

  // Fire session/init in background — injects credentials into the sandbox session.
  sandbox
    .request('/api/session/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        env: {
          CLOUDBASE_ENV_ID: secret.envId,
          TENCENTCLOUD_SECRETID: secret.secretId,
          TENCENTCLOUD_SECRETKEY: secret.secretKey,
          ...(secret.token ? { TENCENTCLOUD_SESSIONTOKEN: secret.token } : {}),
        },
      }),
      signal: AbortSignal.timeout(300_000),
    })
    .then((res) => {
      if (!res.ok) {
        console.warn('[BaseRuntime] session/init returned non-ok status')
      }
    })
    .catch((e) => {
      console.warn('[BaseRuntime] session/init background error')
    })

  // Poll /api/scope/info to get the workspace path
  const maxWaitMs = 120_000
  const pollInterval = 2000
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const res = await sandbox.request('/api/scope/info', {
        signal: AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const data = (await res.json()) as {
          success?: boolean
          workspace?: string
          vitePort?: number | null
        }
        if (data.success && data.workspace) {
          onProgress?.({ phase: 'ready', message: '沙箱已就绪\n' })
          return { workspace: data.workspace, vitePort: data.vitePort ?? undefined }
        }
      }
    } catch {
      // scope/info not available yet
    }
    await new Promise((r) => setTimeout(r, pollInterval))
  }

  console.warn('[BaseRuntime] initSandboxWorkspace timeout')
  return { workspace: fallbackWorkspace }
}

// ─── System Prompt ─────────────────────────────────────────────────────────

/**
 * 获取 CloudBase 前端 SDK 的 publishableKey
 */
const publishableKeyCache = new Map<string, string>()

export async function getPublishableKey(envId: string): Promise<string> {
  if (publishableKeyCache.has(envId)) return publishableKeyCache.get(envId)!

  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  if (!secretId || !secretKey || !envId) return ''
  try {
    const CloudBase = (await import('@cloudbase/manager-node')).default
    const manager = new CloudBase({
      secretId,
      secretKey,
      envId,
      proxy: process.env.http_proxy,
    })
    const result = await manager.commonService('tcb', '2018-06-08').call({
      Action: 'CreateApiKey',
      Param: { EnvId: envId, KeyType: 'publish_key' },
    })
    const apiKey = result?.ApiKey || result?.Response?.ApiKey || ''
    if (apiKey) {
      publishableKeyCache.set(envId, apiKey)
    }
    return apiKey
  } catch (e) {
    console.warn('[BaseRuntime] Failed to get publishableKey')
    return ''
  }
}

/**
 * 构建通用 system prompt（AI小宝学院学生向 persona + 创作指引 + 沙箱上下文）
 *
 * 产品定位：面向中小学学生的 AI 学习伙伴，主打学习辅导、游戏/动画/音乐/图片/小网页创作。
 * 语言保持亲切、易懂，避免开发者术语；技术细节（沙箱、命令、部署）仅在需要动手创作时给到 agent。
 */
export function buildAppendPrompt(
  sandboxCwd?: string,
  conversationId?: string,
  envId?: string,
  sandboxMode?: 'shared' | 'isolated',
  isCodingMode?: boolean,
): string {
  const roleLine = isCodingMode
    ? '你是小宝，AI小宝学院的创作伙伴，陪伴学生做小游戏、动画、音乐和网页作品。'
    : '你是小宝，AI小宝学院的学习伙伴。你既能像朋友一样陪学生聊天、辅导功课，也能帮他们把点子变成游戏、动画、音乐、图片和小网页作品。'

  const taskClassificationSection = isCodingMode
    ? ''
    : `
<task-classification priority="highest">
收到请求后，先判断类型再决定怎么做：

1) **学习/聊天/文字类**（做题、讲题、背课文古诗、写作文周记、翻译、起名、解释知识、答疑、情绪陪伴、写手抄报文案等）
   → 直接在对话中用**文字/Markdown**清晰解答，**不要**创建文件、不要调用创作工具。
   → 解答要适合中小学生的理解水平：步骤清楚、多用例子、鼓励思考而不是直接给答案。

2) **创作作品类**（做小游戏、做动画、做音乐、做网页/海报/相册等作品）
   → 动手用工具完成：创建项目、写代码、生成图片、部署，最终给用户一个能玩/能看的作品。

3) **图片生成/编辑类**（"帮我画一张…""生成一张…的图""做一张海报图片""把这张图改成…"）
   → 使用 ImageGen / ImageEdit 工具生成或编辑图片。

4) **定时/打卡类**（"每天…""每周…""提醒我…"）
   → 使用 cronTask 工具管理定时任务（见下）。

**不确定时先问学生**："你是想让我直接讲讲，还是帮你把它做成一个能玩的作品？" 不要擅自大动干戈。
</task-classification>
`

  const base = `<role>
${roleLine}
- 用中文和学生们交流，语气亲切、耐心、有童趣，多用鼓励和夸奖。
- 面对中小学生：语言要简单清楚，不懂的专业词要主动解释，避免一次给太多信息。
- 删除文件、清空数据等破坏性操作，必须先得到学生或家长确认。
</role>
${taskClassificationSection}

<guiding-rules>
- 辅导学习时，先问清楚年级和科目，讲题要分步骤、给例子、鼓励举一反三，作业题先引导思考再给答案。
- 做创作作品时，主动把功能做完整：小游戏能玩、动画能看、音乐能听、网页能打开，不要半成品。
- 作品风格要适合学生：色彩明快、界面可爱、操作简单。
- 学生描述模糊时，先猜一个简单的方案并说明，不要反复追问让 TA 有压力。
</guiding-rules>

<cloudbase-guideline>
- 当前云开发环境为 ${envId || '(未指定)'}。创作完成的作品（网页、图片、音视频）会被保存和发布，返回可分享的链接给用户。
- 纯学习/聊天不涉及创建文件，不要为聊天内容部署资源。
</cloudbase-guideline>

<bash-usage>
创作作品时可能需要运行命令（比如安装依赖、启动项目）。如果命令执行时间较长：
1. 改为后台执行，获取 pid
2. 定期检查进程状态确认完成
3. 通过 BashOutput 查看输出结果
4. 也可以用 KillShell 关闭后台任务
</bash-usage>

<cron-task-usage>
当学生提到定时执行、定期提醒、每日打卡等需求时，使用 cronTask 工具管理定时任务。
- 创建：action="create"，需要 name、prompt、cronExpression
- 查询：action="list"，查看当前所有定时任务
- 更新：action="update"，通过 id 修改已有任务（可改 prompt、cronExpression、enabled 等）
- 删除：action="delete"，通过 id 删除任务
Cron 表达式格式：分 时 日 月 周，例如 "0 20 * * *" 表示每天 20:00。
</cron-task-usage>

<tools-extra-info>
- **ImageGen** — 用 AI 画图。学生说"帮我画一张…""生成一张…的图""做一张海报图片"时使用。生成的图会保存并给可分享链接。
- **ImageEdit** — 用 AI 改图。学生上传一张图片，要求换风格、加元素、局部修改时使用。
</tools-extra-info>`

  if (sandboxCwd) {
    const homeDir = sandboxMode === 'isolated' ? sandboxCwd : sandboxCwd.substring(0, sandboxCwd.lastIndexOf('/'))
    const sandboxPreamble = isCodingMode
      ? ''
      : '（以下仅在你动手创作作品、需要读写文件或运行命令时适用；纯学习/聊天请忽略本节。）\n'
    return `${base}

<sandbox-context>
${sandboxPreamble}作品文件默认放在工作区 Home: ${homeDir} 下
当前作品工作目录为: ${sandboxCwd}
云开发环境为: ${envId}
请注意：
- 所有文件读写、命令操作都在作品工作目录中进行。
- 作品完成后，要发布到可访问的链接（cloudbase_uploadFiles 等），把链接清楚地告诉学生。
- 发布文件的本地路径必须是工作区内的绝对路径，例如 ${sandboxCwd}/index.html
- 如学生没有特别要求，发布路径放在当前会话 ${conversationId} 下。
</sandbox-context>`
  }
  return base
}

// ─── RuntimeContext ────────────────────────────────────────────────────────

/**
 * 由 BaseAgentRuntime 在 chatStream 中构建，传给子类 runAgent()。
 * 包含所有已初始化的公共资源。
 */
export interface RuntimeContext {
  conversationId: string
  envId: string
  userId: string
  userCredentials?: { secretId: string; secretKey: string; sessionToken?: string }
  model: string
  mode: 'default' | 'coding'
  isCodingMode: boolean

  /** SCF 沙箱实例（null 表示沙箱不可用或禁用） */
  sandbox: SandboxInstance | null
  /** 沙箱内工作目录路径 */
  sandboxCwd: string | null
  /** sandbox isolation mode */
  sandboxMode: 'shared' | 'isolated'
  /** sandbox session id */
  sandboxSessionId: string

  /** MCP client (sandbox-mcp-proxy)，用于 CloudBase 工具调用 */
  mcpClient: Awaited<ReturnType<typeof createSandboxMcpClient>> | null

  /** 构建好的 system prompt（含沙箱上下文 + coding mode） */
  systemPrompt: string
  /** CloudBase publishableKey */
  publishableKey: string

  /** tool override config（沙箱 → agent SDK 工具路由） */
  toolOverrideConfig: { url: string; headers: Record<string, string> } | null
}

// ─── BaseAgentRuntime ──────────────────────────────────────────────────────

export abstract class BaseAgentRuntime implements IAgentRuntime {
  abstract readonly name: string
  abstract isAvailable(): Promise<boolean>
  abstract getSupportedModels(): Promise<ModelInfo[]>
  abstract chatStream(prompt: string, callback: AgentCallback | null, options: AgentOptions): Promise<ChatStreamResult>

  // ─── 公共设施方法（子类可在 runAgent 中调用） ────────────────────

  /**
   * 初始化完整的沙箱环境：创建 SCF → 健康检查 → workspace init → MCP client。
   *
   * @returns RuntimeContext 中与沙箱相关的字段
   */
  protected async setupSandbox(options: {
    conversationId: string
    envId: string
    userId: string
    userCredentials?: { secretId: string; secretKey: string; sessionToken?: string }
    isCodingMode: boolean
    callback?: AgentCallback | null
    model?: string
  }): Promise<{
    sandbox: SandboxInstance | null
    sandboxCwd: string | null
    sandboxMode: 'shared' | 'isolated'
    sandboxSessionId: string
    toolOverrideConfig: { url: string; headers: Record<string, string> } | null
    mcpClient: Awaited<ReturnType<typeof createSandboxMcpClient>> | null
    /** Short-lived JWE session cookie for authenticating localhost requests (e.g. /cloudbase-mcp) */
    sessionJwe: string | null
  }> {
    const { conversationId, envId, userId, userCredentials, isCodingMode, callback, model } = options

    const sandboxEnabled = !!(
      process.env.TCB_ENV_ID &&
      (process.env.SANDBOX_IMAGE_URI || process.env.SCF_SANDBOX_IMAGE_URI)
    )
    if (!sandboxEnabled || !envId) {
      return {
        sandbox: null,
        sandboxCwd: null,
        sandboxMode: 'shared',
        sandboxSessionId: envId || conversationId,
        toolOverrideConfig: null,
        mcpClient: null,
        sessionJwe: null,
      }
    }

    // Read sandbox config from task record
    let sandboxConfig = resolveSandboxConfig({ envId, taskId: conversationId })
    try {
      const taskRecord = await getDb().tasks.findById(conversationId)
      await backfillSandboxConfig(
        conversationId,
        {
          sandboxMode: taskRecord?.sandboxMode,
          sandboxSessionId: taskRecord?.sandboxSessionId,
          sandboxCwd: taskRecord?.sandboxCwd,
        },
        envId,
        getDb(),
      )
      sandboxConfig = resolveSandboxConfig({
        sandboxMode: taskRecord?.sandboxMode,
        sandboxSessionId: taskRecord?.sandboxSessionId,
        sandboxCwd: taskRecord?.sandboxCwd,
        envId,
        taskId: conversationId,
      })
    } catch {
      // Non-critical
    }

    const { sandboxMode, sandboxSessionId } = sandboxConfig

    // Progress bridge
    const progressBridge: SandboxProgressCallback = ({ phase }) => {
      if (callback) {
        callback({ type: 'agent_phase', phase: 'preparing', phaseToolName: `sandbox:${phase}` })
      }
    }

    let sandboxInstance: SandboxInstance | null = null
    let toolOverrideConfig: { url: string; headers: Record<string, string> } | null = null
    let mcpClient: Awaited<ReturnType<typeof createSandboxMcpClient>> | null = null
    let detectedCwd: string | null = null
    let capturedSessionJwe: string | null = null

    try {
      sandboxInstance = await scfSandboxManager.getOrCreate(
        conversationId,
        envId,
        {
          mode: 'shared',
          workspaceIsolation: sandboxMode,
          sandboxSessionId,
          isCodingMode,
        },
        progressBridge,
      )

      toolOverrideConfig = await sandboxInstance.getToolOverrideConfig()

      // Inject hosting presign config for ImageGen, and capture sessionJwe for /cloudbase-mcp auth
      try {
        const user = await getDb().users.findById(userId)
        if (user) {
          const session = {
            created: Date.now(),
            authProvider: (user.provider || 'local') as 'github' | 'local' | 'cloudbase' | 'api-key',
            user: {
              id: user.id,
              username: user.username,
              email: user.email || undefined,
              avatar: user.avatarUrl || '',
              name: user.name || undefined,
            },
          }
          const sessionJwe = await encryptJWE(session, '2h')
          capturedSessionJwe = sessionJwe
          const serverPort = Number(process.env.PORT) || 3001
          ;(toolOverrideConfig as any).hosting = {
            presignUrl: `http://localhost:${serverPort}/api/storage/presign?bucketType=static`,
            sessionCookie: sessionJwe,
            sessionId: conversationId,
          }
        }
      } catch {
        // hosting presign failure doesn't affect main flow
      }

      // Health check
      const sandboxReady = await waitForSandboxHealth(sandboxInstance, progressBridge)
      if (!sandboxReady) {
        if (callback) {
          callback({ type: 'text', content: '沙箱启动超时，将使用受限模式继续对话。\n\n' })
        }
        sandboxInstance = null
      } else {
        // Init workspace
        const initResult = await initSandboxWorkspace(
          sandboxInstance,
          {
            envId,
            secretId: userCredentials?.secretId || '',
            secretKey: userCredentials?.secretKey || '',
            token: userCredentials?.sessionToken,
          },
          conversationId,
          sandboxConfig.sandboxCwd || undefined,
          progressBridge,
        )
        if (initResult.workspace) {
          detectedCwd = initResult.workspace
        }

        // ── Skills 初始化：检查 skillSettings.initialized，仅首次执行 ──
        if (toolOverrideConfig) {
          try {
            const taskForSkills = await getDb().tasks.findById(conversationId)
            if (taskForSkills?.skillSettings) {
              const skillSettings = JSON.parse(taskForSkills.skillSettings)
              if (
                !skillSettings.initialized &&
                Array.isArray(skillSettings.skillList) &&
                skillSettings.skillList.length > 0
              ) {
                progressBridge({ phase: 'init_skills', message: '初始化 Skills...\n' })
                const skillResult = await initSkills(
                  toolOverrideConfig,
                  conversationId,
                  skillSettings.skillList,
                  userId,
                )
                if (skillResult.success) {
                  console.log('[BaseRuntime] Skills initialized successfully')
                } else {
                  console.error('[BaseRuntime] Skills initialization failed')
                }
                // 无论成功失败都标记为已初始化，避免重复执行
                skillSettings.initialized = true
                await getDb().tasks.update(conversationId, {
                  skillSettings: JSON.stringify(skillSettings),
                  updatedAt: Date.now(),
                })
              }
            }
          } catch (e) {
            console.error('[BaseRuntime] Skills initialization error')
          }
        }

        // Create MCP client
        mcpClient = await createSandboxMcpClient({
          sandbox: sandboxInstance,
          userId,
          envId,
          workspaceFolderPaths: detectedCwd || sandboxConfig.sandboxCwd,
          log: (msg) => console.log(msg),
          onArtifact: (artifact) => {
            if (callback) {
              callback({ type: 'artifact', artifact })
            }
            // 持久化部署记录（所有 runtime 共用）
            persistDeploymentFromArtifact(conversationId, artifact).catch((err) => {
              console.error('[BaseRuntime] Failed to persist deployment')
            })
          },
          getMpDeployCredentials: async (appId: string) => {
            const app = await getDb().miniprogramApps.findByAppIdAndUserId(appId, userId)
            if (!app) return null
            return { appId: app.appId, privateKey: decrypt(app.privateKey) }
          },
          currentModel: model,
        })

        // Persist sandboxId to task record
        try {
          await getDb().tasks.update(conversationId, {
            sandboxId: sandboxInstance.functionName,
          })
        } catch {
          // Non-critical
        }
      }
    } catch (err) {
      console.error('[BaseRuntime] Sandbox creation failed')
      if (callback) {
        callback({
          type: 'text',
          content: `【沙箱环境创建失败】${(err as Error).message}。将使用受限模式继续对话。\n\n`,
        })
      }
    }

    return {
      sandbox: sandboxInstance,
      sandboxCwd: detectedCwd,
      sandboxMode,
      sandboxSessionId,
      toolOverrideConfig,
      mcpClient,
      sessionJwe: capturedSessionJwe,
    }
  }

  /**
   * 构建完整 system prompt（含 coding mode + 沙箱上下文）。
   */
  protected async buildSystemPrompt(options: {
    envId: string
    isCodingMode: boolean
    sandboxCwd: string | null
    sandboxMode: 'shared' | 'isolated'
    conversationId: string
  }): Promise<{ systemPrompt: string; publishableKey: string }> {
    const { envId, isCodingMode, sandboxCwd, sandboxMode, conversationId } = options
    const publishableKey = await getPublishableKey(envId)

    let systemPrompt: string
    if (isCodingMode) {
      systemPrompt =
        getCodingSystemPrompt(envId, publishableKey) +
        '\n\n' +
        buildAppendPrompt(sandboxCwd || undefined, conversationId, envId, sandboxMode, true)
    } else {
      systemPrompt = buildAppendPrompt(sandboxCwd || undefined, conversationId, envId, sandboxMode, false)
    }

    return { systemPrompt, publishableKey }
  }

  /**
   * Coding mode: 标记 preview ready。
   */
  protected async markCodingPreviewReady(conversationId: string, sandbox: SandboxInstance | null): Promise<void> {
    if (!sandbox) return
    try {
      const taskRecord = await getDb().tasks.findById(conversationId)
      if (!taskRecord?.previewUrl) {
        await getDb().tasks.update(conversationId, { previewUrl: 'ready' })
      }
    } catch {
      // Non-critical
    }
  }

  /**
   * Coding mode: 自动放行所有写工具。
   */
  protected allowAllWriteToolsForCodingMode(conversationId: string): void {
    for (const tool of WRITE_TOOLS) {
      sessionPermissions.allowAlways(conversationId, tool)
    }
  }
}

// ─── Artifact Helpers（所有 runtime 共用） ─────────────────────────────────

import { nanoid } from 'nanoid'

/**
 * 从 artifact 事件中持久化部署记录到 DB。
 * 所有 runtime 收到 type='artifact' 的回调时都应调用此函数。
 */
export async function persistDeploymentFromArtifact(
  taskId: string,
  artifact: NonNullable<AgentCallbackMessage['artifact']>,
): Promise<void> {
  const now = Date.now()
  const meta = artifact.metadata || {}
  const deploymentType = (meta.deploymentType as string) || (artifact.contentType === 'link' ? 'web' : 'miniprogram')
  const metadataJson = Object.keys(meta).length > 0 ? JSON.stringify(meta) : null

  if (deploymentType === 'miniprogram') {
    const qrCodeUrl = artifact.contentType === 'image' ? artifact.data : (meta.qrCodeUrl as string) || null
    const pagePath = (meta.pagePath as string) || null
    const appId = (meta.appId as string) || null
    const label = artifact.title || null

    const existing = await getDb().deployments.findByTaskIdAndTypePath(taskId, 'miniprogram', null)

    if (existing) {
      await getDb().deployments.update(existing.id, {
        qrCodeUrl: qrCodeUrl || existing.qrCodeUrl,
        pagePath: pagePath || existing.pagePath,
        appId: appId || existing.appId,
        label: label || existing.label,
        metadata: metadataJson || existing.metadata,
        updatedAt: now,
      })
    } else {
      await getDb().deployments.create({
        id: nanoid(12),
        taskId,
        type: 'miniprogram',
        url: null,
        path: null,
        qrCodeUrl,
        pagePath,
        appId,
        label,
        metadata: metadataJson,
        createdAt: now,
        updatedAt: now,
      })
    }
  } else if (artifact.contentType === 'link' && artifact.data) {
    const url = artifact.data
    let urlPath: string | null = null
    try {
      const urlObj = new URL(url)
      urlPath = urlObj.pathname.replace(/\/index\.html$/, '/').replace(/\/+$/, '') || '/'
    } catch {
      /* ignore */
    }

    if (urlPath) {
      const existing = await getDb().deployments.findByTaskIdAndTypePath(taskId, 'web', urlPath)

      if (existing) {
        await getDb().deployments.update(existing.id, {
          url,
          label: artifact.title || existing.label,
          metadata: metadataJson || existing.metadata,
          updatedAt: now,
        })
      } else {
        await getDb().deployments.create({
          id: nanoid(12),
          taskId,
          type: 'web',
          url,
          path: urlPath,
          qrCodeUrl: null,
          pagePath: null,
          appId: null,
          label: artifact.title || null,
          metadata: metadataJson,
          createdAt: now,
          updatedAt: now,
        })
      }
    }

    // Also update legacy previewUrl for backward compatibility
    try {
      await getDb().tasks.update(taskId, { previewUrl: url })
    } catch {
      // Non-critical
    }
  } else {
    // Other artifact types (json, image without miniprogram context, etc.)
    await getDb().deployments.create({
      id: nanoid(12),
      taskId,
      type: deploymentType as 'web' | 'miniprogram',
      url: artifact.contentType === 'link' ? artifact.data : null,
      path: null,
      qrCodeUrl: artifact.contentType === 'image' ? artifact.data : null,
      pagePath: null,
      appId: null,
      label: artifact.title || null,
      metadata: metadataJson,
      createdAt: now,
      updatedAt: now,
    })
  }
}

/**
 * 从 uploadFiles 工具结果 JSON 中递归提取 CloudBase 部署 URL。
 * 纯函数，支持 accessUrl / staticDomain 字段，最多递归 5 层。
 */
export function extractDeployUrl(rawText: string, isFile = false, depth = 0): string | null {
  if (depth > 5) return null
  try {
    const parsed = JSON.parse(rawText)

    if (Array.isArray(parsed)) {
      const firstText = parsed[0]?.text
      if (typeof firstText === 'string') {
        return extractDeployUrl(firstText, isFile, depth + 1)
      }
      return null
    }

    if (typeof parsed !== 'object' || parsed === null) return null

    if (parsed.accessUrl) {
      const url = new URL(parsed.accessUrl)
      if (!isFile && url.pathname !== '/' && !url.pathname.endsWith('/')) {
        url.pathname += '/'
      }
      if (!url.searchParams.get('t')) {
        url.searchParams.set('t', String(Date.now()))
      }
      return url.toString()
    }
    if (parsed.staticDomain) return `https://${parsed.staticDomain}/?t=${Date.now()}`

    const innerText = parsed?.res?.content?.[0]?.text || parsed?.content?.[0]?.text
    if (typeof innerText === 'string') {
      return extractDeployUrl(innerText, isFile, depth + 1)
    }
  } catch {
    // JSON parse 失败，忽略
  }
  return null
}
