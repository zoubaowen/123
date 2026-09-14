export type CreditProduct = 'chat' | 'task' | 'image' | 'music' | 'video'

export interface CreditPack {
  id: string
  name: string
  credits: number
  priceCents: number
}

export interface CreditPricing {
  currency: 'CNY'
  creditPriceCents: number
  signupBonusCredits: number
  products: Record<CreditProduct, number>
  packs: CreditPack[]
}

const DEFAULT_CREDIT_PRICE_CENTS = 10
const DEFAULT_SIGNUP_BONUS_CREDITS = 20
const DEFAULT_PRODUCT_COSTS: Record<CreditProduct, number> = {
  chat: 1,
  task: 10,
  image: 8,
  music: 30,
  video: 180,
}

function readPositiveInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getCreditPricing(): CreditPricing {
  const creditPriceCents = readPositiveInt('CREDIT_PRICE_CENTS', DEFAULT_CREDIT_PRICE_CENTS)
  const signupBonusCredits = readPositiveInt('CREDITS_SIGNUP_BONUS', DEFAULT_SIGNUP_BONUS_CREDITS)

  return {
    currency: 'CNY',
    creditPriceCents,
    signupBonusCredits,
    products: {
      chat: readPositiveInt('CREDITS_COST_CHAT', DEFAULT_PRODUCT_COSTS.chat),
      task: readPositiveInt('CREDITS_COST_TASK', DEFAULT_PRODUCT_COSTS.task),
      image: readPositiveInt('CREDITS_COST_IMAGE', DEFAULT_PRODUCT_COSTS.image),
      music: readPositiveInt('CREDITS_COST_MUSIC', DEFAULT_PRODUCT_COSTS.music),
      video: readPositiveInt('CREDITS_COST_VIDEO', DEFAULT_PRODUCT_COSTS.video),
    },
    packs: [
      { id: 'pack_starter', name: 'Starter Pack', credits: 100, priceCents: 1000 },
      { id: 'pack_creator', name: 'Creator Pack', credits: 320, priceCents: 2990 },
      { id: 'pack_video', name: 'Video Pack', credits: 1200, priceCents: 9900 },
    ],
  }
}

export function getCreditCost(product: CreditProduct): number {
  return getCreditPricing().products[product]
}

export function getSignupBonusCredits(): number {
  return getCreditPricing().signupBonusCredits
}
