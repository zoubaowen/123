import { z } from 'zod'

export type XiaobaoProductionGuardEnvironment = Record<string, string | undefined>

export interface XiaobaoProductionGuardConfig {
  tms: {
    secretId: string
    secretKey: string
    token?: string
    region: string
    bizType: string
    timeoutMs: number
  }
  pricing: {
    tokensPerCredit: number
    maxCreditsPerTask: number
  }
}

const requiredText = z.string().trim().min(1)
const positiveInteger = z.number().int().positive().refine(Number.isSafeInteger)
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  requiredText.optional(),
)
const requiredPositiveInteger = z.preprocess((value) => Number(value), positiveInteger)

const environmentSchema = z.object({
  XIAOBAO_TMS_SECRET_ID: requiredText,
  XIAOBAO_TMS_SECRET_KEY: requiredText,
  XIAOBAO_TMS_TOKEN: optionalText,
  XIAOBAO_TMS_REGION: requiredText,
  XIAOBAO_TMS_BIZ_TYPE: requiredText,
  XIAOBAO_TMS_TIMEOUT_MS: requiredPositiveInteger,
  XIAOBAO_MODEL_TOKENS_PER_CREDIT: requiredPositiveInteger,
  XIAOBAO_MODEL_MAX_CREDITS_PER_TASK: requiredPositiveInteger,
})

export function loadXiaobaoProductionGuardConfig(
  environment: XiaobaoProductionGuardEnvironment = process.env,
): XiaobaoProductionGuardConfig | null {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) return null

  const values = result.data
  if (!Number.isSafeInteger(values.XIAOBAO_MODEL_TOKENS_PER_CREDIT * values.XIAOBAO_MODEL_MAX_CREDITS_PER_TASK)) {
    return null
  }
  return {
    tms: {
      secretId: values.XIAOBAO_TMS_SECRET_ID,
      secretKey: values.XIAOBAO_TMS_SECRET_KEY,
      ...(values.XIAOBAO_TMS_TOKEN ? { token: values.XIAOBAO_TMS_TOKEN } : {}),
      region: values.XIAOBAO_TMS_REGION,
      bizType: values.XIAOBAO_TMS_BIZ_TYPE,
      timeoutMs: values.XIAOBAO_TMS_TIMEOUT_MS,
    },
    pricing: {
      tokensPerCredit: values.XIAOBAO_MODEL_TOKENS_PER_CREDIT,
      maxCreditsPerTask: values.XIAOBAO_MODEL_MAX_CREDITS_PER_TASK,
    },
  }
}
