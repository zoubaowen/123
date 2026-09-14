import type { Context, Next } from 'hono'
import { nanoid } from 'nanoid'
import { getDb } from '../db/index.js'
import { requireAuth } from './auth.js'
import type { AppEnv } from './auth.js'

const now = () => Date.now()

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function trackUsage(userId: string, type: 'task' | 'sandbox_duration', value: number): Promise<void> {
  const date = getTodayDate()

  const existing = await getDb().dailyUsage.findByUserIdAndDate(userId, date)
  if (existing) {
    const updates: { taskCount?: number; sandboxDuration?: number; updatedAt: number } = {
      updatedAt: now(),
    }
    if (type === 'task') {
      updates.taskCount = existing.taskCount + value
    } else {
      updates.sandboxDuration = existing.sandboxDuration + value
    }
    await getDb().dailyUsage.update(existing.id, updates)
  } else {
    const ts = now()
    await getDb().dailyUsage.create({
      id: nanoid(),
      userId,
      date,
      taskCount: type === 'task' ? value : 0,
      sandboxDuration: type === 'sandbox_duration' ? value : 0,
      creditsConsumed: 0,
      createdAt: ts,
      updatedAt: ts,
    })
  }

  console.log('[Usage] Daily usage tracked')
}

export async function checkDailyLimit(
  userId: string,
): Promise<{ allowed: boolean; limit: number | null; used: number }> {
  const sub = await getDb().userSubscriptions.findActiveByUserId(userId)
  if (!sub) {
    return { allowed: true, limit: null, used: 0 }
  }

  const plan = await getDb().subscriptionPlans.findById(sub.planId)
  if (!plan || plan.maxTasksPerDay === null) {
    return { allowed: true, limit: null, used: 0 }
  }

  const date = getTodayDate()
  const usage = await getDb().dailyUsage.findByUserIdAndDate(userId, date)
  const used = usage?.taskCount ?? 0

  return {
    allowed: used < plan.maxTasksPerDay,
    limit: plan.maxTasksPerDay,
    used,
  }
}

export async function requireCredits(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const authErr = requireAuth(c)
  if (authErr) return authErr

  const session = c.get('session')!
  const userId = session.user.id

  const credits = await getDb().userCredits.findByUserId(userId)
  const balance = credits?.balance ?? 0

  if (balance <= 0) {
    return c.json({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }, 402)
  }

  return next()
}

export async function requireSubscription(c: Context<AppEnv>, next: Next): Promise<Response | void> {
  const authErr = requireAuth(c)
  if (authErr) return authErr

  const session = c.get('session')!
  const userId = session.user.id

  const sub = await getDb().userSubscriptions.findActiveByUserId(userId)
  if (!sub) {
    return c.json({ error: 'No active subscription' }, 402)
  }

  const plan = await getDb().subscriptionPlans.findById(sub.planId)
  if (!plan) {
    return c.json({ error: 'No active subscription' }, 402)
  }

  if (sub.status !== 'active') {
    return c.json({ error: 'Subscription is not active' }, 402)
  }

  const nowTs = now()
  if (sub.currentPeriodEnd < nowTs) {
    return c.json({ error: 'Subscription has expired' }, 402)
  }

  if (plan.maxTasksPerDay !== null) {
    const date = getTodayDate()
    const usage = await getDb().dailyUsage.findByUserIdAndDate(userId, date)
    const used = usage?.taskCount ?? 0

    if (used >= plan.maxTasksPerDay) {
      return c.json(
        {
          error: 'Daily task limit reached',
          code: 'DAILY_LIMIT_REACHED',
          limit: plan.maxTasksPerDay,
          used,
        },
        402,
      )
    }
  }

  return next()
}
