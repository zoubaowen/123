import { z } from 'zod'
import type { OpenAICompatibleModelProviderConfig } from './openai-compatible-provider.js'

export type XiaobaoModelEnvironment = Record<string, string | undefined>
export type XiaobaoModelConfig = Omit<OpenAICompatibleModelProviderConfig, 'tools'> & {
  readonly healthCheckUrl: string
}

const requiredText = z.string().trim().min(1)
const positiveInteger = z.number().int().positive()

const environmentSchema = z.object({
  XIAOBAO_MODEL_BASE_URL: requiredText.url().refine((value) => {
    try {
      const url = new URL(value)
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.search === '' && url.hash === ''
    } catch {
      return false
    }
  }),
  XIAOBAO_MODEL_HEALTHCHECK_URL: requiredText.url().refine((value) => {
    try {
      const url = new URL(value)
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.username === '' &&
        url.password === '' &&
        url.hash === ''
      )
    } catch {
      return false
    }
  }),
  XIAOBAO_MODEL_API_KEY: requiredText,
  XIAOBAO_MODEL_ID: requiredText,
  XIAOBAO_MODEL_NAME: z.string().trim().min(1).optional(),
  XIAOBAO_MODEL_TIMEOUT_MS: z.preprocess(
    (value) => (value === undefined || value === '' ? 30_000 : Number(value)),
    positiveInteger,
  ),
  XIAOBAO_MODEL_CONTEXT_WINDOW: z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : Number(value)),
    positiveInteger.optional(),
  ),
})

export function loadXiaobaoModelConfig(environment: XiaobaoModelEnvironment = process.env): XiaobaoModelConfig | null {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) return null

  const values = result.data
  return {
    baseUrl: values.XIAOBAO_MODEL_BASE_URL,
    healthCheckUrl: values.XIAOBAO_MODEL_HEALTHCHECK_URL,
    apiKey: values.XIAOBAO_MODEL_API_KEY,
    modelId: values.XIAOBAO_MODEL_ID,
    modelName: values.XIAOBAO_MODEL_NAME ?? values.XIAOBAO_MODEL_ID,
    timeoutMs: values.XIAOBAO_MODEL_TIMEOUT_MS,
    ...(values.XIAOBAO_MODEL_CONTEXT_WINDOW ? { contextWindow: values.XIAOBAO_MODEL_CONTEXT_WINDOW } : {}),
  }
}
