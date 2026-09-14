import { afterEach, describe, expect, it } from 'vitest'
import { getCreditCost, getCreditPricing, getSignupBonusCredits } from '../credit-pricing'

const keys = [
  'CREDIT_PRICE_CENTS',
  'CREDITS_SIGNUP_BONUS',
  'CREDITS_COST_CHAT',
  'CREDITS_COST_TASK',
  'CREDITS_COST_IMAGE',
  'CREDITS_COST_MUSIC',
  'CREDITS_COST_VIDEO',
]

afterEach(() => {
  for (const key of keys) {
    delete process.env[key]
  }
})

describe('credit pricing', () => {
  it('uses margin-protected commercial defaults', () => {
    const pricing = getCreditPricing()

    expect(pricing.creditPriceCents).toBe(10)
    expect(pricing.signupBonusCredits).toBe(20)
    expect(pricing.products).toEqual({
      chat: 1,
      task: 10,
      image: 8,
      music: 30,
      video: 180,
    })
  })

  it('allows server-side overrides without code changes', () => {
    process.env.CREDITS_SIGNUP_BONUS = '12'
    process.env.CREDITS_COST_VIDEO = '240'

    expect(getSignupBonusCredits()).toBe(12)
    expect(getCreditCost('video')).toBe(240)
  })

  it('ignores invalid non-positive overrides', () => {
    process.env.CREDITS_COST_IMAGE = '0'
    process.env.CREDIT_PRICE_CENTS = '-1'

    expect(getCreditCost('image')).toBe(8)
    expect(getCreditPricing().creditPriceCents).toBe(10)
  })
})
