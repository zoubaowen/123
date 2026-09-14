import { describe, expect, it } from 'vitest'
import { loadXiaobaoProductionGuardConfig } from '../index.js'

function validEnvironment(): Record<string, string> {
  return {
    XIAOBAO_TMS_SECRET_ID: 'test-secret-id',
    XIAOBAO_TMS_SECRET_KEY: 'test-secret-key',
    XIAOBAO_TMS_REGION: 'ap-guangzhou',
    XIAOBAO_TMS_BIZ_TYPE: 'xiaobao-writing',
    XIAOBAO_TMS_TIMEOUT_MS: '3000',
    XIAOBAO_MODEL_TOKENS_PER_CREDIT: '1000',
    XIAOBAO_MODEL_MAX_CREDITS_PER_TASK: '10',
  }
}

describe('loadXiaobaoProductionGuardConfig', () => {
  it('returns null when required production guard configuration is missing', () => {
    expect(loadXiaobaoProductionGuardConfig({})).toBeNull()
  })

  it('parses complete production guard configuration', () => {
    expect(loadXiaobaoProductionGuardConfig(validEnvironment())).toMatchObject({
      tms: { region: 'ap-guangzhou', timeoutMs: 3000 },
      pricing: { tokensPerCredit: 1000, maxCreditsPerTask: 10 },
    })
  })

  it('rejects non-positive model pricing', () => {
    expect(
      loadXiaobaoProductionGuardConfig({
        ...validEnvironment(),
        XIAOBAO_MODEL_TOKENS_PER_CREDIT: '0',
      }),
    ).toBeNull()
  })
})
