import { nanoid } from 'nanoid'
import { getDb } from '../db/index.js'
import type { CreditTransaction } from '../db/types.js'
import { getSignupBonusCredits } from './credit-pricing.js'

const now = () => Date.now()

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function getBalance(userId: string): Promise<{ balance: number; frozenBalance: number }> {
  const credits = await getDb().userCredits.getOrCreate(userId)
  return { balance: credits.balance, frozenBalance: credits.frozenBalance }
}

export async function consumeCredits(
  userId: string,
  amount: number,
  description: string,
  metadata?: Record<string, string>,
): Promise<{ newBalance: number }> {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  await getDb().userCredits.getOrCreate(userId)

  const ts = now()
  const updated = await getDb().userCredits.consumeByUserId(userId, amount, ts)

  if (!updated) {
    throw new Error('INSUFFICIENT_CREDITS')
  }

  await getDb().creditTransactions.create({
    id: nanoid(),
    userId,
    type: 'consumption',
    amount: -amount,
    balanceAfter: updated.balance,
    description,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: ts,
  })

  console.log('[Credits] Credits consumed')
  return { newBalance: updated.balance }
}

export async function grantCredits(
  userId: string,
  amount: number,
  type: string,
  description: string,
  metadata?: Record<string, string>,
): Promise<{ newBalance: number }> {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  const credits = await getDb().userCredits.getOrCreate(userId)
  const ts = now()
  const newBalance = credits.balance + amount
  const newLifetime = credits.lifetimeBalance + amount

  await getDb().userCredits.updateByUserId(userId, {
    balance: newBalance,
    lifetimeBalance: newLifetime,
    updatedAt: ts,
  })

  await getDb().creditTransactions.create({
    id: nanoid(),
    userId,
    type,
    amount,
    balanceAfter: newBalance,
    description,
    metadata: metadata ? JSON.stringify(metadata) : null,
    createdAt: ts,
  })

  console.log('[Credits] Credits granted')
  return { newBalance }
}

export async function grantSignupBonusCredits(userId: string): Promise<boolean> {
  const existing = await getDb().creditTransactions.findByUserIdAndType(userId, 'signup_bonus', 1)
  if (existing.length > 0) {
    console.log('[Credits] Signup bonus already granted')
    return false
  }

  await grantCredits(userId, getSignupBonusCredits(), 'signup_bonus', 'Signup bonus')
  console.log('[Credits] Signup bonus granted')
  return true
}

export async function freezeCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  const credits = await getDb().userCredits.getOrCreate(userId)

  if (credits.balance < amount) {
    throw new Error('INSUFFICIENT_CREDITS')
  }

  const ts = now()
  await getDb().userCredits.updateByUserId(userId, {
    balance: credits.balance - amount,
    frozenBalance: credits.frozenBalance + amount,
    updatedAt: ts,
  })

  console.log('[Credits] Credits frozen')
}

export async function unfreezeCredits(userId: string, amount: number): Promise<void> {
  if (amount <= 0) {
    throw new Error('Amount must be positive')
  }

  const credits = await getDb().userCredits.getOrCreate(userId)
  const toUnfreeze = Math.min(credits.frozenBalance, amount)
  if (toUnfreeze <= 0) return

  const ts = now()
  await getDb().userCredits.updateByUserId(userId, {
    balance: credits.balance + toUnfreeze,
    frozenBalance: credits.frozenBalance - toUnfreeze,
    updatedAt: ts,
  })

  console.log('[Credits] Credits unfrozen')
}

export async function getTransactionHistory(
  userId: string,
  limit?: number,
  offset?: number,
): Promise<CreditTransaction[]> {
  return getDb().creditTransactions.findByUserId(userId, limit ?? 50, offset ?? 0)
}

export async function grantDailyFreeCredits(userId: string, amount: number): Promise<boolean> {
  const today = getTodayDate()

  const txs = await getDb().creditTransactions.findByUserIdAndType(userId, 'free_daily', 1)
  const latestTx = txs[0]

  if (latestTx) {
    const txDate = new Date(latestTx.createdAt).toISOString().slice(0, 10)
    if (txDate === today) {
      console.log('[Credits] Daily free credits already granted')
      return false
    }
  }

  await grantCredits(userId, amount, 'free_daily', 'Daily free credits')
  console.log('[Credits] Daily free credits granted')
  return true
}
