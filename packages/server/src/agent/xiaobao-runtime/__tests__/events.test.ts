import { describe, expect, it } from 'vitest'
import type { XiaobaoRuntimeEvent } from '../domain.js'
import { OrderedEventSink, toAgentCallbackMessage } from '../events.js'

function phaseEvent(sequence: number): XiaobaoRuntimeEvent {
  return {
    type: 'phase',
    taskId: 'task-1',
    sequence,
    timestamp: 100 + sequence,
    phase: 'preparing',
  }
}

describe('xiaobao runtime events', () => {
  it('serializes concurrent event emissions', async () => {
    const received: number[] = []
    const sink = new OrderedEventSink(async (event) => {
      await Promise.resolve()
      received.push(event.sequence)
    })

    await Promise.all([sink.emit(phaseEvent(1)), sink.emit(phaseEvent(2))])

    expect(received).toEqual([1, 2])
  })

  it('maps completion to the existing result callback', () => {
    expect(
      toAgentCallbackMessage({
        type: 'completed',
        taskId: 'task-1',
        sequence: 3,
        timestamp: 103,
        text: '完成啦',
      }),
    ).toEqual({ type: 'result', content: '完成啦' })
  })

  it('preserves tool identity and structured output', () => {
    expect(
      toAgentCallbackMessage({
        type: 'tool_finished',
        taskId: 'task-1',
        sequence: 2,
        timestamp: 102,
        observation: { actionId: 'action-1', ok: true, output: { url: '/work.png' } },
      }),
    ).toEqual({
      type: 'tool_result',
      tool_use_id: 'action-1',
      content: '{"url":"/work.png"}',
      is_error: false,
    })
  })

  it('renders a truncated sandbox output as readable text with a truncation note', () => {
    expect(
      toAgentCallbackMessage({
        type: 'tool_finished',
        taskId: 'task-1',
        sequence: 2,
        timestamp: 102,
        observation: {
          actionId: 'action-1',
          ok: true,
          output: { value: 'partial output only', truncated: true },
        },
      }),
    ).toEqual({
      type: 'tool_result',
      tool_use_id: 'action-1',
      content: 'partial output only\n\n[输出过长已截断]',
      is_error: false,
    })
  })

  it('bridges a waiting_for_student event into structured ask_user questions with a tool call id', () => {
    expect(
      toAgentCallbackMessage({
        type: 'waiting_for_student',
        taskId: 'task-1',
        sequence: 4,
        timestamp: 104,
        toolCallId: 'ask-9',
        header: '写作主题',
        questions: ['你想写什么故事？', '给谁看？'],
      }),
    ).toEqual({
      type: 'ask_user',
      id: 'ask-9',
      name: 'AskUserQuestion',
      input: {
        questions: [
          { question: '你想写什么故事？', header: '写作主题', options: [], multiSelect: false },
          { question: '给谁看？', header: '写作主题', options: [], multiSelect: false },
        ],
      },
    })
  })
})
