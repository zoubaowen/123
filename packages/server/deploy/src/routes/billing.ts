import { Hono, type Context } from 'hono'
import { requireAuth, type AppEnv } from '../middleware/auth'
import { getDb } from '../db/index.js'
import { nanoid } from 'nanoid'
import { getCreditPricing } from '../services/credit-pricing.js'
import { consumeCredits, getBalance } from '../services/credits.js'
import {
  getCentralCreditBalance,
  isCentralCreditsConfigured,
  shouldUseCentralCredits,
} from '../services/central-credits.js'

const billing = new Hono<AppEnv>()

billing.get('/pricing', (c) => {
  return c.json(getCreditPricing())
})

function requireSyncSecret(c: Context<AppEnv>) {
  const expected = process.env.CENTRAL_ACCOUNT_SYNC_SECRET
  const actual = c.req.header('x-xiaobao-sync-secret')
  if (!expected || actual !== expected) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return null
}

billing.post('/internal/credits/balance', async (c) => {
  const authErr = requireSyncSecret(c)
  if (authErr) return authErr

  const { userId } = await c.req.json()
  if (!userId || typeof userId !== 'string') return c.json({ error: 'userId is required' }, 400)

  return c.json(await getBalance(userId))
})

billing.post('/internal/credits/consume', async (c) => {
  const authErr = requireSyncSecret(c)
  if (authErr) return authErr

  const { userId, amount, description, metadata } = await c.req.json()
  if (!userId || typeof userId !== 'string') return c.json({ error: 'userId is required' }, 400)
  if (!Number.isInteger(amount) || amount <= 0) return c.json({ error: 'amount must be positive' }, 400)
  if (!description || typeof description !== 'string') return c.json({ error: 'description is required' }, 400)

  try {
    const safeMetadata =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, string>)
        : undefined
    return c.json(await consumeCredits(userId, amount, description, safeMetadata))
  } catch (error) {
    if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') {
      return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402)
    }
    throw error
  }
})

billing.get('/credits', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const userId = c.get('session')!.user.id
  if (shouldUseCentralCredits()) {
    if (!isCentralCreditsConfigured()) {
      return c.json({ error: 'Desktop cloud credit service is not configured' }, 503)
    }
    const credits = await getCentralCreditBalance(userId)
    if (!credits) return c.json({ error: 'Credit service is not available' }, 503)
    return c.json({ ...credits, transactions: [] })
  }
  const credits = await getDb().userCredits.getOrCreate(userId)
  const transactions = await getDb().creditTransactions.findByUserId(userId, 50, 0)
  return c.json({ balance: credits.balance, frozenBalance: credits.frozenBalance, transactions })
})

billing.get('/subscriptions/plans', async (c) => {
  const plans = await getDb().subscriptionPlans.findAllActive()
  return c.json(plans)
})

billing.get('/subscriptions/my', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const userId = c.get('session')!.user.id
  const sub = await getDb().userSubscriptions.findByUserId(userId)
  const plan = sub ? await getDb().subscriptionPlans.findById(sub.planId) : null
  return c.json({ subscription: sub, plan })
})

billing.post('/subscriptions/subscribe', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const userId = c.get('session')!.user.id
  const { planId } = await c.req.json()
  const plan = await getDb().subscriptionPlans.findById(planId)
  if (!plan || !plan.active) return c.json({ error: 'Plan not found' }, 404)

  const existing = await getDb().userSubscriptions.findByUserId(userId)
  if (existing && existing.status === 'active') {
    return c.json({ error: 'Already have an active subscription' }, 409)
  }

  const now = Date.now()
  const periodEnd = now + plan.periodDays * 24 * 60 * 60 * 1000
  const subId = nanoid()

  await getDb().userSubscriptions.create({
    id: subId,
    userId,
    planId,
    status: plan.priceCents > 0 ? 'pending' : 'active',
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    autoRenew: true,
    cancelledAt: null,
  })

  if (plan.priceCents === 0 && plan.creditsPerPeriod > 0) {
    const { grantCredits } = await import('../services/credits.js')
    await grantCredits(userId, plan.creditsPerPeriod, 'subscription', `Subscription: ${plan.name}`, { planId })
  }

  if (plan.priceCents > 0) {
    return c.json({
      success: true,
      subscription: { id: subId, status: 'pending', planId, currentPeriodEnd: periodEnd },
      paymentRequired: true,
      amount: plan.priceCents,
    })
  }

  return c.json({ success: true, subscription: { id: subId, status: 'active', planId, currentPeriodEnd: periodEnd } })
})

billing.post('/subscriptions/cancel', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const userId = c.get('session')!.user.id
  const sub = await getDb().userSubscriptions.findByUserId(userId)
  if (!sub) return c.json({ error: 'No active subscription' }, 404)
  await getDb().userSubscriptions.update(sub.id, { status: 'cancelled', autoRenew: false, cancelledAt: Date.now() })
  return c.json({ success: true })
})

export default billing
