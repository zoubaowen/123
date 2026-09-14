import type {
  XiaobaoCapability,
  XiaobaoObservation,
  XiaobaoRuntimeEvent,
  XiaobaoRuntimeEventPayload,
  XiaobaoTaskSnapshot,
  XiaobaoTaskStatus,
} from './domain.js'
import { xiaobaoTaskSnapshotSchema } from './domain.js'
import type { OrderedEventSink } from './events.js'
import {
  ModelProviderError,
  type ModelProviderErrorCode,
  type ToolProvider,
  type XiaobaoRuntimeDependencies,
} from './ports.js'
import type { SkillEngine } from './skill-engine.js'
import { createTaskSnapshot, transitionTask } from './state-machine.js'
import { SafetyProviderUnavailableError } from './tencent-tms-safety-provider.js'

export interface XiaobaoRunRequest {
  taskId: string
  userId: string
  capability: XiaobaoCapability
  prompt: string
  /** 恢复场景：学生对提问的回答，keyed by assistantMessageId（acp askAnswers 原样透传）。 */
  studentAnswers?: Record<string, { toolCallId: string; answers: Record<string, string> }>
  /** 视觉理解：学生随首轮上传的参考图（原始 base64 + mimeType）。 */
  imageBlocks?: readonly { data: string; mimeType: string }[]
}

export interface XiaobaoRunResult {
  status: XiaobaoTaskStatus
  snapshot: XiaobaoTaskSnapshot
}

export interface XiaobaoAgentLoopLimits {
  maxTurns: number
}

const MODEL_PROVIDER_FAILURE_MESSAGES: Record<ModelProviderErrorCode, string> = {
  authentication: '小宝暂时无法连接模型服务，请联系老师或管理员检查设置。',
  rate_limit: '小宝正在稍作休息，请稍后再试。',
  unavailable: '模型服务暂时不可用，请稍后再试。',
  timeout: '等待模型回复超时，请稍后再试。',
  invalid_response: '模型回复格式有问题，请稍后再试。',
}

export class XiaobaoAgentLoop {
  constructor(
    private readonly dependencies: XiaobaoRuntimeDependencies,
    private readonly skillEngine: SkillEngine,
    private readonly limits: XiaobaoAgentLoopLimits,
  ) {}

  async run(request: XiaobaoRunRequest, sink: OrderedEventSink, signal: AbortSignal): Promise<XiaobaoRunResult> {
    let sequence = 0
    const emit = async (event: XiaobaoRuntimeEventPayload) => {
      sequence += 1
      await sink.emit({
        ...event,
        taskId: request.taskId,
        sequence,
        timestamp: this.dependencies.clock.now(),
      } as XiaobaoRuntimeEvent)
    }

    let snapshot =
      (await this.dependencies.checkpoints.load(request.taskId)) ??
      createTaskSnapshot({ ...request, now: this.dependencies.clock.now() })

    if (signal.aborted) {
      if (snapshot.status !== 'cancelled' && snapshot.status !== 'completed') {
        snapshot = transitionTask(snapshot, 'cancelled', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
      }
      await emit({ type: 'failed', message: '任务已取消', recoverable: true })
      return { status: snapshot.status, snapshot }
    }

    if (snapshot.status === 'completed' || snapshot.status === 'failed_terminal' || snapshot.status === 'cancelled') {
      return { status: snapshot.status, snapshot }
    }

    if (snapshot.status === 'waiting_for_student') {
      const pendingStep = snapshot.currentStepId
      const matched = request.studentAnswers
        ? Object.values(request.studentAnswers).find((entry) => pendingStep && entry.toolCallId === pendingStep)
        : undefined
      const answer = matched?.answers
      if (!answer || Object.keys(answer).length === 0) {
        // 学生尚未作答：保持等待，用持久化的提问观察幂等重发提问事件。
        const pendingQuestion = snapshot.observations
          .filter((observation) => observation.toolName === 'xiaobao_ask' && observation.ok)
          .at(-1)
        const payload =
          pendingQuestion && typeof pendingQuestion.output === 'object' && pendingQuestion.output !== null
            ? (pendingQuestion.output as { header?: string; questions?: unknown })
            : undefined
        await emit({
          type: 'waiting_for_student',
          toolCallId: pendingStep ?? 'student-answer',
          header: payload && typeof payload.header === 'string' ? payload.header : pendingStep ? '请继续' : '请回答',
          questions:
            payload && Array.isArray(payload.questions) && payload.questions.every((q) => typeof q === 'string')
              ? (payload.questions as string[])
              : pendingStep
                ? ['请回答小宝刚才的问题后继续']
                : ['请先回答小宝的问题'],
        })
        return { status: snapshot.status, snapshot }
      }
      const observation: XiaobaoObservation = {
        actionId: pendingStep ?? 'student-answer',
        ok: true,
        output: answer,
        toolName: 'xiaobao_ask',
      }
      snapshot = transitionTask(snapshot, 'requirements', this.dependencies.clock.now())
      snapshot = this.updateSnapshot(snapshot, {
        observations: [...snapshot.observations, observation],
      })
      snapshot = xiaobaoTaskSnapshotSchema.parse({ ...snapshot, currentStepId: null })
      await this.dependencies.checkpoints.save(snapshot)
    }

    if (snapshot.status === 'quality_check' && snapshot.resultText !== null && snapshot.usageReservationId !== null) {
      // 先取出已确认非空的结果文本：`transitionTask` 会返回新快照，重新赋值会让收窄失效。
      const resultText = snapshot.resultText
      await this.recordModelUsage(request.taskId, snapshot)
      snapshot = transitionTask(snapshot, 'completed', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
      await emit({ type: 'completed', text: resultText })
      return { status: snapshot.status, snapshot }
    }

    if (snapshot.status === 'failed_recoverable' && snapshot.usageReservationId === null && snapshot.turnCount === 0) {
      snapshot = transitionTask(snapshot, 'safety_check', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
    }

    if (snapshot.status === 'created') {
      snapshot = transitionTask(snapshot, 'safety_check', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
      await emit({ type: 'phase', phase: 'preparing' })
    }

    if (snapshot.status === 'safety_check') {
      let safety
      try {
        safety = await this.dependencies.safety.check(
          {
            taskId: request.taskId,
            userId: request.userId,
            capability: request.capability,
            prompt: request.prompt,
          },
          signal,
        )
      } catch (error) {
        if (!(error instanceof SafetyProviderUnavailableError)) throw error
        snapshot = transitionTask(snapshot, 'failed_recoverable', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'failed', message: '安全检查暂时不可用，请稍后再试', recoverable: true })
        return { status: snapshot.status, snapshot }
      }
      if (!safety.allowed) {
        snapshot = transitionTask(snapshot, 'failed_terminal', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'failed', message: safety.reason, recoverable: false })
        return { status: snapshot.status, snapshot }
      }

      snapshot = transitionTask(snapshot, 'requirements', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
    }

    let skill
    try {
      skill = await this.skillEngine.resolve(request.capability)
    } catch {
      snapshot = this.toTerminalFailure(snapshot)
      await this.dependencies.checkpoints.save(snapshot)
      await emit({ type: 'failed', message: 'Xiaobao skill unavailable', recoverable: false })
      return { status: snapshot.status, snapshot }
    }

    if (snapshot.status === 'requirements') {
      snapshot = transitionTask(snapshot, 'planned', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
    }

    if (snapshot.status === 'planned') {
      if (snapshot.usageReservationId) {
        snapshot = transitionTask(snapshot, 'running', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
      } else {
        const reservation = await this.dependencies.usage.reserve({
          taskId: request.taskId,
          userId: request.userId,
          category: 'model',
          units: this.limits.maxTurns,
        })
        if (!reservation.allowed) {
          snapshot = transitionTask(snapshot, 'paused_budget', this.dependencies.clock.now())
          await this.dependencies.checkpoints.save(snapshot)
          await emit({ type: 'failed', message: reservation.reason, recoverable: true })
          return { status: snapshot.status, snapshot }
        }
        snapshot = xiaobaoTaskSnapshotSchema.parse({
          ...transitionTask(snapshot, 'running', this.dependencies.clock.now()),
          usageReservationId: reservation.reservationId,
        })
        await this.dependencies.checkpoints.save(snapshot)
      }
    }

    if (snapshot.status === 'failed_recoverable') {
      snapshot = transitionTask(snapshot, 'retrying', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
      snapshot = transitionTask(snapshot, 'running', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
    }

    if (snapshot.status === 'running' && !snapshot.usageReservationId) {
      const reservation = await this.dependencies.usage.reserve({
        taskId: request.taskId,
        userId: request.userId,
        category: 'model',
        units: this.limits.maxTurns,
      })
      if (!reservation.allowed) {
        snapshot = transitionTask(snapshot, 'paused_budget', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'failed', message: reservation.reason, recoverable: true })
        return { status: snapshot.status, snapshot }
      }
      snapshot = this.updateSnapshot(snapshot, { usageReservationId: reservation.reservationId })
      await this.dependencies.checkpoints.save(snapshot)
    }

    if (snapshot.status !== 'running') {
      await emit({ type: 'failed', message: '任务当前无法继续', recoverable: true })
      return { status: snapshot.status, snapshot }
    }

    while (snapshot.turnCount < this.limits.maxTurns) {
      if (signal.aborted) {
        snapshot = transitionTask(snapshot, 'cancelled', this.dependencies.clock.now())
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'failed', message: '任务已取消', recoverable: true })
        return { status: snapshot.status, snapshot }
      }

      let response
      try {
        response = await this.dependencies.model.complete(
          {
            task: snapshot,
            prompt: request.prompt,
            skill,
            observations: snapshot.observations,
            ...(request.imageBlocks?.length ? { imageBlocks: request.imageBlocks } : {}),
          },
          signal,
        )
      } catch (error) {
        if (!(error instanceof ModelProviderError)) throw error

        const recoverable = error.code === 'rate_limit' || error.code === 'timeout' || error.code === 'unavailable'
        snapshot = transitionTask(
          snapshot,
          recoverable ? 'failed_recoverable' : 'failed_terminal',
          this.dependencies.clock.now(),
        )
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'failed', message: MODEL_PROVIDER_FAILURE_MESSAGES[error.code], recoverable })
        return { status: snapshot.status, snapshot }
      }
      const responseChanges = {
        turnCount: snapshot.turnCount + 1,
        ...(response.usage
          ? {
              modelUsageTokens: snapshot.modelUsageTokens + response.usage.totalTokens,
              hasExactModelUsage: true,
            }
          : {}),
      }

      if (response.kind === 'text') {
        snapshot = this.updateSnapshot(snapshot, responseChanges)
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'text', text: response.text })
        continue
      }

      if (response.kind === 'tool') {
        await emit({ type: 'tool_started', action: response.action })
        const provider = this.dependencies.tools.get(response.action.toolName)
        if (!provider) {
          snapshot = transitionTask(snapshot, 'failed_terminal', this.dependencies.clock.now())
          await this.dependencies.checkpoints.save(snapshot)
          await emit({ type: 'failed', message: '所需工具不可用', recoverable: false })
          return { status: snapshot.status, snapshot }
        }

        const observation = await this.executeWithSingleRetry(provider, request.taskId, response.action, signal)
        const observationWithToolName: XiaobaoObservation = {
          ...observation,
          toolName: observation.toolName ?? response.action.toolName,
        }
        snapshot = this.updateSnapshot(snapshot, {
          ...responseChanges,
          observations: [...snapshot.observations, observationWithToolName],
        })
        await this.dependencies.checkpoints.save(snapshot)
        await emit({ type: 'tool_finished', observation: observationWithToolName })
        continue
      }

      if (response.kind === 'ask') {
        // 学生交互：向学生提问后暂停，等待下一轮注入答案再继续。不结算用量。
        const questionObservation: XiaobaoObservation = {
          actionId: response.toolCallId,
          ok: true,
          output: { header: response.header, questions: response.questions },
          toolName: 'xiaobao_ask',
        }
        snapshot = transitionTask(snapshot, 'waiting_for_student', this.dependencies.clock.now())
        snapshot = this.updateSnapshot(snapshot, {
          ...responseChanges,
          observations: [...snapshot.observations, questionObservation],
        })
        snapshot = xiaobaoTaskSnapshotSchema.parse({
          ...snapshot,
          currentStepId: response.toolCallId,
        })
        await this.dependencies.checkpoints.save(snapshot)
        await emit({
          type: 'waiting_for_student',
          toolCallId: response.toolCallId,
          header: response.header,
          questions: response.questions,
        })
        return { status: snapshot.status, snapshot }
      }

      if (response.kind !== 'complete') {
        throw new Error('Unknown model response kind')
      }
      snapshot = xiaobaoTaskSnapshotSchema.parse({
        ...transitionTask(snapshot, 'quality_check', this.dependencies.clock.now()),
        ...responseChanges,
        resultText: response.text,
      })
      await this.dependencies.checkpoints.save(snapshot)
      await this.recordModelUsage(request.taskId, snapshot)
      snapshot = transitionTask(snapshot, 'completed', this.dependencies.clock.now())
      await this.dependencies.checkpoints.save(snapshot)
      await emit({ type: 'completed', text: response.text })
      return { status: snapshot.status, snapshot }
    }

    snapshot = transitionTask(snapshot, 'failed_recoverable', this.dependencies.clock.now())
    await this.dependencies.checkpoints.save(snapshot)
    await emit({ type: 'failed', message: '任务达到最大执行轮次', recoverable: true })
    return { status: snapshot.status, snapshot }
  }

  private updateSnapshot(
    snapshot: XiaobaoTaskSnapshot,
    changes: Partial<
      Pick<
        XiaobaoTaskSnapshot,
        'turnCount' | 'usageReservationId' | 'modelUsageTokens' | 'hasExactModelUsage' | 'observations' | 'resultText'
      >
    >,
  ): XiaobaoTaskSnapshot {
    return xiaobaoTaskSnapshotSchema.parse({
      ...snapshot,
      ...changes,
      revision: snapshot.revision + 1,
      updatedAt: this.dependencies.clock.now(),
    })
  }

  private async executeWithSingleRetry(
    provider: ToolProvider,
    taskId: string,
    action: Parameters<ToolProvider['execute']>[0]['action'],
    signal: AbortSignal,
  ): Promise<XiaobaoObservation> {
    try {
      return await provider.execute({ taskId, action }, signal)
    } catch {
      return provider.execute({ taskId, action }, signal)
    }
  }

  private async recordModelUsage(taskId: string, snapshot: XiaobaoTaskSnapshot): Promise<void> {
    if (!snapshot.usageReservationId) return
    await this.dependencies.usage.record({
      taskId,
      reservationId: snapshot.usageReservationId,
      category: 'model',
      units: snapshot.hasExactModelUsage ? snapshot.modelUsageTokens : snapshot.turnCount,
    })
  }

  private toTerminalFailure(snapshot: XiaobaoTaskSnapshot): XiaobaoTaskSnapshot {
    if (snapshot.status === 'requirements' || snapshot.status === 'running' || snapshot.status === 'quality_check') {
      return transitionTask(snapshot, 'failed_terminal', this.dependencies.clock.now())
    }
    return snapshot
  }
}
