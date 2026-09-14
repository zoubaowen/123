import type { AgentCallback, AgentCallbackMessage, AgentOptions, UnifiedMessagePart } from '@ai-xiaobao/shared'
import { nanoid } from 'nanoid'
import { CloudbaseAgentService, type ModelInfo } from '../cloudbase-agent.service.js'
import { completeAgent, getAgentRun, registerAgent } from '../agent-registry.js'
import { EventBuffer } from '../event-buffer.js'
import { persistenceService } from '../persistence.service.js'
import type { IAgentRuntime, ChatStreamResult } from '../runtime/types.js'
import { getDb } from '../../db/index.js'
import { XiaobaoAgentLoop } from './agent-loop.js'
import { getXiaobaoProductionDependencies } from './dependencies.js'
import { xiaobaoCapabilitySchema, XIAOBAO_PRODUCTION_CAPABILITIES, type XiaobaoCapability } from './domain.js'
import { OrderedEventSink, toAgentCallbackMessage } from './events.js'
import { MEDIA_TOOL_BY_CAPABILITY } from './media-tools.js'
import { loadVolcengineMediaEnvironment } from './volcengine-media-client.js'
import type { XiaobaoRuntimeDependencies } from './ports.js'
import { SkillEngine } from './skill-engine.js'

export interface XiaobaoRuntimeConfiguration {
  dependenciesFactory: () => Promise<XiaobaoRuntimeDependencies | null>
  capabilityResolver: (prompt: string, options: AgentOptions) => Promise<XiaobaoCapability>
  idFactory?: () => string
}

interface ActiveRun {
  turnId: string
  promise: Promise<void>
}

class XiaobaoAssistantTurn {
  private readonly parts: UnifiedMessagePart[] = []

  push(message: AgentCallbackMessage): void {
    if ((message.type === 'text' || message.type === 'error') && message.content) {
      const previous = this.parts.at(-1)
      if (previous?.contentType === 'text') {
        previous.content = `${previous.content ?? ''}${message.content}`
        return
      }
      this.parts.push({ partId: nanoid(), contentType: 'text', content: message.content })
      return
    }

    if (message.type === 'tool_use') {
      this.parts.push({
        partId: nanoid(),
        contentType: 'tool_call',
        content: JSON.stringify(message.input ?? {}),
        toolCallId: message.id,
        metadata: {
          toolCallName: message.name,
          toolName: message.name,
          input: message.input,
          status: 'in_progress',
        },
      })
      return
    }

    if (message.type === 'tool_result') {
      const toolCallId = message.tool_use_id ?? message.id
      const toolCall = this.parts.find((part) => part.contentType === 'tool_call' && part.toolCallId === toolCallId)
      if (toolCall) {
        toolCall.metadata = {
          ...(toolCall.metadata ?? {}),
          status: message.is_error ? 'error' : 'completed',
        }
      }
      this.parts.push({
        partId: nanoid(),
        contentType: 'tool_result',
        content: message.content ?? '',
        toolCallId,
        metadata: { status: message.is_error ? 'error' : 'completed', isError: Boolean(message.is_error) },
      })
    }
  }

  snapshot(): UnifiedMessagePart[] {
    return structuredClone(this.parts)
  }
}

const unsupportedCapabilityMessage = '小宝目前只支持写作和学习，其他创作工具尚未接入'
const missingCapabilityMessage = '请选择小宝的写作或学习能力后再开始'
export const unsupportedXiaobaoInputMessage = '小宝写作和学习暂不支持编程模式或图片输入'
const unavailableGameCapabilityMessage = '游戏创作需要连接创作沙箱，当前暂未开放，请联系老师'
const unavailableMediaCapabilityMessage = '图片与视频创作需要先连接媒体服务，当前暂未开放，请联系老师'

type TerminalAgentStatus = 'completed' | 'waiting_for_student' | 'error' | 'cancelled'

export class UnsupportedXiaobaoCapabilityError extends Error {
  constructor() {
    super('Xiaobao capability is not supported')
    this.name = 'UnsupportedXiaobaoCapabilityError'
  }
}

export class MissingXiaobaoCapabilityError extends Error {
  constructor() {
    super('Xiaobao capability must be selected')
    this.name = 'MissingXiaobaoCapabilityError'
  }
}

export class UnsupportedXiaobaoInputError extends Error {
  constructor() {
    super('Xiaobao input is not supported')
    this.name = 'UnsupportedXiaobaoInputError'
  }
}

/**
 * 视觉理解开关：只有显式开启（`XIAOBAO_VISION_ENABLED=true`）才接受图片输入，
 * 否则保持与今天一致的 fail-closed 行为。
 */
export function isXiaobaoVisionEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.XIAOBAO_VISION_ENABLED === 'true'
}

export function hasUnsupportedXiaobaoInput(
  options: Pick<AgentOptions, 'mode' | 'imageBlocks'>,
  visionEnabled: boolean = isXiaobaoVisionEnabled(),
): boolean {
  if (options.mode === 'coding') return true
  if (options.imageBlocks?.length && !visionEnabled) return true
  return false
}

export function parseXiaobaoCapabilitySelection(value: unknown): XiaobaoCapability | undefined {
  const result = xiaobaoCapabilitySchema.safeParse(value)
  return result.success ? result.data : undefined
}

/**
 * 生产实际放行的能力集合：基础能力始终放行；图片/视频**只在火山方舟媒体已配置时**放行。
 * 资格端点与运行期门禁共用这一个来源，避免"向学生承诺了实际必然失败的能力"。
 */
export function xiaobaoProductionCapabilities(
  environment: Record<string, string | undefined> = process.env,
): readonly XiaobaoCapability[] {
  const media: XiaobaoCapability[] = loadVolcengineMediaEnvironment(environment) ? ['image', 'video'] : []
  return [...XIAOBAO_PRODUCTION_CAPABILITIES, ...media]
}

export async function resolveProductionXiaobaoCapability(
  _prompt: string,
  options: AgentOptions,
  environment: Record<string, string | undefined> = process.env,
): Promise<XiaobaoCapability> {
  if (hasUnsupportedXiaobaoInput(options, isXiaobaoVisionEnabled(environment))) {
    throw new UnsupportedXiaobaoInputError()
  }
  const capability = options.xiaobaoCapability
  if (!capability) throw new MissingXiaobaoCapabilityError()
  if (xiaobaoProductionCapabilities(environment).includes(capability)) return capability
  throw new UnsupportedXiaobaoCapabilityError()
}

export class XiaobaoRuntime implements IAgentRuntime {
  readonly name = 'xiaobao'
  private readonly activeRuns = new Map<string, ActiveRun>()
  private readonly idFactory: () => string

  constructor(private readonly configuration: XiaobaoRuntimeConfiguration) {
    this.idFactory = configuration.idFactory ?? (() => nanoid(12))
  }

  async isAvailable(): Promise<boolean> {
    const dependencies = await this.configuration.dependenciesFactory()
    return dependencies ? dependencies.model.healthCheck() : false
  }

  async getSupportedModels(): Promise<ModelInfo[]> {
    const dependencies = await this.configuration.dependenciesFactory()
    if (!dependencies || !(await dependencies.model.healthCheck())) return []

    return (await dependencies.model.listModels()).map((model) => ({
      id: model.id,
      name: model.name,
      vendor: dependencies.model.name,
      supportsToolCall: true,
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    }))
  }

  async chatStream(prompt: string, callback: AgentCallback | null, options: AgentOptions): Promise<ChatStreamResult> {
    const taskId = options.conversationId
    const userId = options.userId
    if (!taskId || !userId) throw new Error('Xiaobao runtime requires task and user')

    if (options.envId) {
      const task = await getDb().tasks.findById(taskId)
      if (!task || task.deletedAt || task.userId !== userId || (task.envId && task.envId !== options.envId)) {
        throw new Error('Xiaobao task is unavailable')
      }
    }

    const active = this.activeRuns.get(taskId)
    if (active) {
      const registered = getAgentRun(taskId)
      if (registered?.status === 'running' && !registered.abortController.signal.aborted) {
        return { turnId: active.turnId, alreadyRunning: true }
      }
      await active.promise
      return this.chatStream(prompt, callback, options)
    }
    const registered = getAgentRun(taskId)
    if (registered?.status === 'running') return { turnId: registered.turnId, alreadyRunning: true }

    const turnId = this.idFactory()
    const abortController = new AbortController()
    registerAgent({
      conversationId: taskId,
      turnId,
      envId: options.envId ?? '',
      userId,
      abortController,
    })
    const promise = this.runTurn(turnId, taskId, userId, prompt, callback, options, abortController)
      .catch(() => {
        if (getAgentRun(taskId)?.turnId === turnId) {
          completeAgent(taskId, 'error', '小宝 Runtime 执行失败', 'refusal')
        }
      })
      .finally(() => {
        if (this.activeRuns.get(taskId)?.turnId === turnId) this.activeRuns.delete(taskId)
      })
    this.activeRuns.set(taskId, { turnId, promise })

    return { turnId, alreadyRunning: false }
  }

  private async runTurn(
    turnId: string,
    taskId: string,
    userId: string,
    prompt: string,
    callback: AgentCallback | null,
    options: AgentOptions,
    abortController: AbortController,
  ): Promise<void> {
    const envId = options.envId ?? ''
    const assistantTurn = new XiaobaoAssistantTurn()
    let eventBuffer: EventBuffer | null = null
    let hasPendingRecord = false
    let terminalStatus: TerminalAgentStatus = 'error'

    const emit = async (message: AgentCallbackMessage): Promise<void> => {
      const persistedMessage: AgentCallbackMessage = {
        ...message,
        id: message.id || turnId,
        assistantMessageId: turnId,
      }
      assistantTurn.push(persistedMessage)

      const acpEvent = CloudbaseAgentService.convertToSessionUpdate(persistedMessage, taskId)
      const sequence = acpEvent && eventBuffer ? eventBuffer.pushAndGetSeq(acpEvent) : undefined
      if (!callback) return
      try {
        await callback(message, sequence)
      } catch {
        // The durable event stream remains authoritative after an SSE disconnect.
      }
    }

    try {
      if (envId) {
        const records = await persistenceService.loadDBMessages(taskId, envId, userId, 2)
        let prevRecordId: string | null = null
        let lastAssistantRecordId: string | null = null
        for (const record of records) {
          prevRecordId = record.recordId
          if (record.role === 'assistant') lastAssistantRecordId = record.recordId
        }
        await persistenceService.preSavePendingRecords({
          conversationId: taskId,
          envId,
          userId,
          prompt,
          prevRecordId,
          lastAssistantRecordId,
          assistantRecordId: turnId,
        })
        hasPendingRecord = true
        eventBuffer = new EventBuffer(taskId, turnId, envId, userId)
      }

      terminalStatus = await this.execute(taskId, userId, prompt, options, abortController.signal, emit)
    } catch {
      console.error('[XiaobaoRuntime] Turn lifecycle failed')
      await emit({ type: 'error', content: '小宝 Runtime 执行失败', is_error: true })
      terminalStatus = abortController.signal.aborted ? 'cancelled' : 'error'
    }

    if (hasPendingRecord) {
      try {
        await persistenceService.setRecordParts(turnId, assistantTurn.snapshot())
      } catch {
        console.error('[XiaobaoRuntime] Failed to persist assistant turn')
        terminalStatus = 'error'
      }
    }

    const resolveFinalStatus = (): TerminalAgentStatus =>
      abortController.signal.aborted ? ('cancelled' as const) : terminalStatus
    let finalStatus = resolveFinalStatus()

    if (hasPendingRecord) {
      let persistedRecordStatus: 'done' | 'error' | 'cancel' | null = null
      const toRecordStatus = (status: TerminalAgentStatus): 'done' | 'error' | 'cancel' =>
        status === 'completed' || status === 'waiting_for_student'
          ? 'done'
          : status === 'cancelled'
            ? 'cancel'
            : 'error'
      try {
        const requestedStatus = toRecordStatus(finalStatus)
        await persistenceService.finalizePendingRecords(turnId, requestedStatus)
        persistedRecordStatus = requestedStatus
      } catch {
        console.error('[XiaobaoRuntime] Failed to finalize assistant turn')
        if (finalStatus !== 'cancelled') {
          terminalStatus = 'error'
          finalStatus = 'error'
          await emit({ type: 'error', content: '小宝 Runtime 保存结果失败', is_error: true })
          try {
            await persistenceService.setRecordParts(turnId, assistantTurn.snapshot())
          } catch {
            console.error('[XiaobaoRuntime] Failed to persist finalization error')
          }
        }
        try {
          const requestedStatus = toRecordStatus(finalStatus)
          await persistenceService.updateRecordStatus(turnId, requestedStatus)
          persistedRecordStatus = requestedStatus
        } catch {
          console.error('[XiaobaoRuntime] Failed to recover assistant turn status')
        }
      }

      finalStatus = resolveFinalStatus()
      const resolvedRecordStatus = toRecordStatus(finalStatus)
      if (persistedRecordStatus !== resolvedRecordStatus) {
        try {
          await persistenceService.updateRecordStatus(turnId, resolvedRecordStatus)
          persistedRecordStatus = resolvedRecordStatus
        } catch {
          console.error('[XiaobaoRuntime] Failed to persist late terminal status')
          if (!abortController.signal.aborted) {
            terminalStatus = 'error'
            finalStatus = 'error'
          }
        }
      }

      if (eventBuffer) await eventBuffer.close()

      finalStatus = resolveFinalStatus()
      const afterCloseRecordStatus = toRecordStatus(finalStatus)
      if (persistedRecordStatus !== afterCloseRecordStatus) {
        try {
          await persistenceService.updateRecordStatus(turnId, afterCloseRecordStatus)
        } catch {
          console.error('[XiaobaoRuntime] Failed to persist terminal status after event close')
          if (!abortController.signal.aborted) {
            terminalStatus = 'error'
            finalStatus = 'error'
          }
        }
      }
    } else if (eventBuffer) {
      await eventBuffer.close()
    }

    const current = getAgentRun(taskId)
    if (current?.turnId === turnId) {
      completeAgent(
        taskId,
        finalStatus === 'waiting_for_student' ? 'completed' : finalStatus,
        finalStatus === 'error' ? '小宝 Runtime 执行失败' : undefined,
        finalStatus === 'completed' || finalStatus === 'waiting_for_student'
          ? 'end_turn'
          : finalStatus === 'cancelled'
            ? 'cancelled'
            : 'refusal',
      )
    }

    if (envId) {
      try {
        const task = await getDb().tasks.findById(taskId)
        if (task && !task.deletedAt && task.userId === userId && (!task.envId || task.envId === envId)) {
          finalStatus = resolveFinalStatus()
          await getDb().tasks.update(taskId, {
            status:
              finalStatus === 'completed'
                ? 'done'
                : finalStatus === 'waiting_for_student'
                  ? 'pending'
                  : finalStatus === 'cancelled'
                    ? 'stopped'
                    : 'error',
            updatedAt: Date.now(),
            ...(finalStatus === 'completed' ? { completedAt: Date.now() } : {}),
          })
        }
      } catch {
        // The durable assistant record still exposes the terminal state.
      }
    }
  }

  private async execute(
    taskId: string,
    userId: string,
    prompt: string,
    options: AgentOptions,
    signal: AbortSignal,
    emit: (message: AgentCallbackMessage) => Promise<void>,
  ): Promise<TerminalAgentStatus> {
    try {
      const capability = await this.configuration.capabilityResolver(prompt, options)
      const dependencies = await this.configuration.dependenciesFactory()
      if (!dependencies) {
        await emit({ type: 'error', content: '小宝 Runtime 尚未配置可用 Provider', is_error: true })
        return 'error'
      }

      // 工具能力（如游戏）依赖真实沙箱装配；装配未包含对应技能时保持静态提示，不伪造成果。
      if (capability === 'game' && !(await dependencies.skills.getByCapability('game'))) {
        await emit({ type: 'error', content: unavailableGameCapabilityMessage, is_error: true })
        return 'error'
      }

      // 媒体能力（图片/视频）依赖真实媒体服务装配；工具缺失时静态拒绝，不进入 Agent Loop。
      const requiredMediaTool = MEDIA_TOOL_BY_CAPABILITY[capability]
      if (requiredMediaTool && !dependencies.tools.has(requiredMediaTool)) {
        await emit({ type: 'error', content: unavailableMediaCapabilityMessage, is_error: true })
        return 'error'
      }

      const sink = new OrderedEventSink(async (event) => {
        if (event.type === 'completed') {
          await emit({ type: 'text', content: event.text })
        }
        await emit(toAgentCallbackMessage(event))
      })
      const loop = new XiaobaoAgentLoop(dependencies, new SkillEngine(dependencies.skills), {
        maxTurns: options.maxTurns ?? 8,
      })
      const result = await loop.run(
        {
          taskId,
          userId,
          capability,
          prompt,
          ...(options.askAnswers ? { studentAnswers: options.askAnswers } : {}),
          ...(options.imageBlocks?.length ? { imageBlocks: options.imageBlocks } : {}),
        },
        sink,
        signal,
      )
      if (result.status === 'cancelled') return 'cancelled'
      if (result.status === 'waiting_for_student') return 'waiting_for_student'
      return result.status === 'completed' ? 'completed' : 'error'
    } catch (error) {
      if (signal.aborted) {
        await emit({ type: 'error', content: '任务已取消', is_error: true })
        return 'cancelled'
      }
      if (error instanceof MissingXiaobaoCapabilityError) {
        await emit({ type: 'error', content: missingCapabilityMessage, is_error: true })
        return 'error'
      }
      if (error instanceof UnsupportedXiaobaoCapabilityError) {
        await emit({ type: 'error', content: unsupportedCapabilityMessage, is_error: true })
        return 'error'
      }
      if (error instanceof UnsupportedXiaobaoInputError) {
        await emit({ type: 'error', content: unsupportedXiaobaoInputMessage, is_error: true })
        return 'error'
      }
      console.error('[XiaobaoRuntime] Execution failed')
      await emit({ type: 'error', content: '小宝 Runtime 执行失败', is_error: true })
      return 'error'
    }
  }
}

export const xiaobaoRuntime = new XiaobaoRuntime({
  dependenciesFactory: getXiaobaoProductionDependencies,
  capabilityResolver: resolveProductionXiaobaoCapability,
})
