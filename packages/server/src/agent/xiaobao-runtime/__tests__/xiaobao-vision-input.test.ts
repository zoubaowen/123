import { describe, expect, it, vi } from 'vitest'
import type { XiaobaoTaskSnapshot } from '../domain.js'
import { OpenAICompatibleModelProvider } from '../openai-compatible-provider.js'
import { hasUnsupportedXiaobaoInput, isXiaobaoVisionEnabled } from '../runtime.js'

const task: XiaobaoTaskSnapshot = {
  schemaVersion: 1,
  taskId: 'task-vision',
  userId: 'student-1',
  capability: 'image',
  prompt: '这张画里有什么？',
  status: 'created',
  revision: 0,
  turnCount: 0,
  usageReservationId: null,
  modelUsageTokens: 0,
  hasExactModelUsage: false,
  observations: [],
  resultText: null,
  createdAt: 1,
  updatedAt: 1,
  currentStepId: null,
}

const skill = {
  name: 'student-image-master',
  version: '1.0.0',
  instructions: '引导学生观察画面',
  qualityGates: ['保留学生自己的表达'],
}

function completionResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            tool_calls: [
              {
                id: 'complete-1',
                type: 'function',
                function: { name: 'xiaobao_complete', arguments: '{"text":"画面里有一只猫"}' },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

async function sendMessage(imageBlocks?: readonly { data: string; mimeType: string }[]) {
  let requestBody: { messages: Array<{ role: string; content: unknown }> } | undefined
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (typeof init?.body === 'string') requestBody = JSON.parse(init.body)
    return completionResponse()
  })
  const provider = new OpenAICompatibleModelProvider(
    {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      apiKey: 'ark-secret-key',
      modelId: 'doubao-seed-1-6',
      modelName: 'Doubao Seed',
      timeoutMs: 30_000,
      contextWindow: 32_768,
    },
    fetchMock as unknown as typeof fetch,
  )

  await provider.complete(
    { task, prompt: '这张画里有什么？', skill, observations: [], ...(imageBlocks ? { imageBlocks } : {}) },
    new AbortController().signal,
  )
  return requestBody!.messages.find((message) => message.role === 'user')!.content
}

describe('xiaobao vision input guard', () => {
  it('keeps image input rejected unless vision is explicitly enabled', () => {
    const withImage = { mode: 'default' as const, imageBlocks: [{ data: 'QUJD', mimeType: 'image/png' }] }

    expect(isXiaobaoVisionEnabled({})).toBe(false)
    expect(isXiaobaoVisionEnabled({ XIAOBAO_VISION_ENABLED: 'false' })).toBe(false)
    expect(hasUnsupportedXiaobaoInput(withImage, false)).toBe(true)
    expect(hasUnsupportedXiaobaoInput(withImage, true)).toBe(false)
  })

  it('keeps text-only tasks unaffected in both modes', () => {
    expect(hasUnsupportedXiaobaoInput({ mode: 'default', imageBlocks: [] }, false)).toBe(false)
    expect(hasUnsupportedXiaobaoInput({ mode: 'default', imageBlocks: [] }, true)).toBe(false)
  })

  it('still rejects coding mode regardless of vision', () => {
    expect(hasUnsupportedXiaobaoInput({ mode: 'coding', imageBlocks: [] }, true)).toBe(true)
  })
})

describe('xiaobao vision message shape', () => {
  it('keeps a plain string content when no image is attached', async () => {
    await expect(sendMessage()).resolves.toBe('这张画里有什么？')
  })

  it('switches to OpenAI-compatible content parts with an inline data url', async () => {
    await expect(sendMessage([{ data: 'QUJD', mimeType: 'image/png' }])).resolves.toEqual([
      { type: 'text', text: '这张画里有什么？' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ])
  })

  it('keeps every attached image in order', async () => {
    const content = (await sendMessage([
      { data: 'QUJD', mimeType: 'image/png' },
      { data: 'REVG', mimeType: 'image/jpeg' },
    ])) as Array<{ type: string; image_url?: { url: string } }>

    expect(content).toHaveLength(3)
    expect(content[1]?.image_url?.url).toBe('data:image/png;base64,QUJD')
    expect(content[2]?.image_url?.url).toBe('data:image/jpeg;base64,REVG')
  })
})
