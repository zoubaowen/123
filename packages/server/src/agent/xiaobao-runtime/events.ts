import type { AgentCallbackMessage } from '@ai-xiaobao/shared'
import type { XiaobaoRuntimeEvent } from './domain.js'

type EventHandler = (event: XiaobaoRuntimeEvent) => void | Promise<void>

export class OrderedEventSink {
  private tail: Promise<void> = Promise.resolve()

  constructor(private readonly handler: EventHandler) {}

  emit(event: XiaobaoRuntimeEvent): Promise<void> {
    const delivery = this.tail.then(() => this.handler(event))
    this.tail = delivery.catch(() => undefined)
    return delivery
  }
}

function serializeOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (isTruncatedOutput(output)) {
    return `${output.value}\n\n[输出过长已截断]`
  }
  const serialized = JSON.stringify(output)
  return serialized ?? String(output)
}

function isTruncatedOutput(output: unknown): output is { value: string; truncated: true } {
  return Boolean(
    output &&
    typeof output === 'object' &&
    typeof (output as { value?: unknown }).value === 'string' &&
    (output as { truncated?: unknown }).truncated === true,
  )
}

export function toAgentCallbackMessage(event: XiaobaoRuntimeEvent): AgentCallbackMessage {
  switch (event.type) {
    case 'phase':
      return {
        type: 'agent_phase',
        phase: event.phase === 'tool_executing' ? 'tool_executing' : event.phase === 'idle' ? 'idle' : 'preparing',
      }
    case 'text':
      return { type: 'text', content: event.text }
    case 'tool_started':
      return {
        type: 'tool_use',
        id: event.action.id,
        name: event.action.toolName,
        input: event.action.input,
      }
    case 'tool_finished':
      return {
        type: 'tool_result',
        tool_use_id: event.observation.actionId,
        content: serializeOutput(event.observation.output),
        is_error: !event.observation.ok,
      }
    case 'artifact': {
      const contentType =
        event.artifact.contentType === 'image' ? 'image' : event.artifact.contentType === 'json' ? 'json' : 'link'
      return {
        type: 'artifact',
        artifact: {
          title: event.artifact.title,
          contentType,
          data: event.artifact.data,
          metadata: { originalContentType: event.artifact.contentType },
        },
      }
    }
    case 'waiting_for_student':
      return {
        type: 'ask_user',
        id: event.toolCallId,
        name: 'AskUserQuestion',
        input: {
          questions: event.questions.map((question) => ({
            question,
            header: event.header,
            options: [],
            multiSelect: false,
          })),
        },
      }
    case 'failed':
      return { type: 'error', content: event.message, is_error: true }
    case 'completed':
      return { type: 'result', content: event.text }
    default: {
      const exhaustive: never = event
      return exhaustive
    }
  }
}
