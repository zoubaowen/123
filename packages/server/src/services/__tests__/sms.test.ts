import { afterEach, describe, expect, it } from 'vitest'
import { isSmsMockEnabled } from '../sms'

const originalNodeEnv = process.env.NODE_ENV
const originalSmsMock = process.env.SMS_MOCK

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv
  process.env.SMS_MOCK = originalSmsMock
})

describe('SMS mock mode', () => {
  it('uses the fixed verification code path in development', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.SMS_MOCK

    expect(isSmsMockEnabled()).toBe(true)
  })
})
