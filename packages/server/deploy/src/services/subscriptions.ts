import { nanoid } from 'nanoid'
import { getDb } from '../db/index.js'
import type { SubscriptionPlan, UserSubscription } from '../db/types.js'
import { grantCredits } from './credits.js'

const now = () => Date.now()

export async function getActivePlans(): Promise<SubscriptionPlan[]> {
  return getDb().subscriptionPlans.findActive()
}

export async function getPlan(planId: string): Promise<SubscriptionPlan | null> {
  return getDb().subscriptionPlans.findById(planId)
}

export async function subscribe(userId: string, planId: string): Promise<UserSubscription> {
  const plan = await getDb().subscriptionPlans.findById(planId)
  if (!plan) {
    throw new Error('Plan not found')
  }
  if (!plan.active) {
    throw new Error('Plan is not active')
  }

  const existing = await getDb().userSubscriptions.findActiveByUserId(userId)
  if (existing) {
    const ts = now()
    await getDb().userSubscriptions.update(existing.id, {
      status: 'cancelled',
      cancelledAt: ts,
      updatedAt: ts,
    })
  }

  const ts = now()
  const periodMs = plan.periodDays * 24 * 60 * 60 * 1000

  const subscription = await getDb().userSubscriptions.create({
    id: nanoid(),
    userId,
    planId: plan.id,
    status: 'active',
    currentPeriodStart: ts,
    currentPeriodEnd: ts + periodMs,
    autoRenew: true,
    cancelledAt: null,
    createdAt: ts,
    updatedAt: ts,
  })

  if (plan.creditsPerPeriod > 0) {
    await grantCredits(userId, plan.creditsPerPeriod, 'subscription', `Subscription: ${plan.name}`, { planId: plan.id })
  }

  console.log('[Subscriptions] User subscribed to plan')
  return subscription
}

export async function processRenewals(): Promise<void> {
  const activeSubs = await getDb().userSubscriptions.findAllActive()

  for (const sub of activeSubs) {
    const nowTs = now()

    if (sub.currentPeriodEnd > nowTs && sub.status === 'active') {
      continue
    }

    const plan = await getDb().subscriptionPlans.findById(sub.planId)
    if (!plan || !plan.active) {
      if (plan && !plan.active) {
        await getDb().userSubscriptions.update(sub.id, {
          status: 'expired',
          updatedAt: nowTs,
        })
      }
      continue
    }

    const periodMs = plan.periodDays * 24 * 60 * 60 * 1000
    await getDb().userSubscriptions.update(sub.id, {
      currentPeriodStart: nowTs,
      currentPeriodEnd: nowTs + periodMs,
      updatedAt: nowTs,
    })

    if (plan.creditsPerPeriod > 0) {
      await grantCredits(sub.userId, plan.creditsPerPeriod, 'subscription', `Subscription renewal: ${plan.name}`, {
        planId: plan.id,
      })
    }
  }

  console.log('[Subscriptions] Renewals processed')
}

export async function cancelSubscription(userId: string): Promise<void> {
  const sub = await getDb().userSubscriptions.findActiveByUserId(userId)
  if (!sub) {
    throw new Error('No active subscription')
  }

  const ts = now()
  await getDb().userSubscriptions.update(sub.id, {
    status: 'cancelled',
    autoRenew: false,
    cancelledAt: ts,
    updatedAt: ts,
  })

  console.log('[Subscriptions] Subscription cancelled')
}

export async function getUserSubscription(
  userId: string,
): Promise<{ subscription: UserSubscription | null; plan: SubscriptionPlan | null }> {
  const subscription = await getDb().userSubscriptions.findActiveByUserId(userId)
  if (!subscription) {
    return { subscription: null, plan: null }
  }

  const plan = await getDb().subscriptionPlans.findById(subscription.planId)
  return { subscription, plan }
}

export async function seedDefaultPlans(): Promise<void> {
  const existing = await getDb().subscriptionPlans.findActive()
  if (existing.length > 0) {
    console.log('[Subscriptions] Plans already seeded')
    return
  }

  const ts = now()
  const plans = [
    {
      id: 'plan_free',
      name: 'Trial',
      description: 'One-time starter access for new students',
      type: 'free',
      creditsPerPeriod: 0,
      periodDays: 30,
      priceCents: 0,
      maxTasksPerDay: 5,
      maxSandboxDuration: 300,
      features: JSON.stringify(['basic_agents', 'community_support']),
      active: true,
      sortOrder: 0,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'plan_basic',
      name: 'Starter',
      description: 'Light creative access for students',
      type: 'basic',
      creditsPerPeriod: 300,
      periodDays: 30,
      priceCents: 2990,
      maxTasksPerDay: 20,
      maxSandboxDuration: 600,
      features: JSON.stringify(['all_agents', 'priority_support', 'private_projects']),
      active: true,
      sortOrder: 1,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'plan_pro',
      name: 'Creator',
      description: 'More images, music, and guided project creation',
      type: 'pro',
      creditsPerPeriod: 1200,
      periodDays: 30,
      priceCents: 9900,
      maxTasksPerDay: 100,
      maxSandboxDuration: 1200,
      features: JSON.stringify([
        'all_agents',
        'advanced_sandbox',
        'priority_support',
        'team_collaboration',
        'custom_plugins',
      ]),
      active: true,
      sortOrder: 2,
      createdAt: ts,
      updatedAt: ts,
    },
    {
      id: 'plan_enterprise',
      name: 'School',
      description: 'Classroom-scale access for schools and learning centers',
      type: 'enterprise',
      creditsPerPeriod: 4200,
      periodDays: 30,
      priceCents: 29900,
      maxTasksPerDay: null,
      maxSandboxDuration: 3600,
      features: JSON.stringify([
        'all_agents',
        'advanced_sandbox',
        'dedicated_support',
        'team_collaboration',
        'custom_plugins',
        'sso',
        'audit_logs',
      ]),
      active: true,
      sortOrder: 3,
      createdAt: ts,
      updatedAt: ts,
    },
  ]

  for (const plan of plans) {
    await getDb().subscriptionPlans.create(plan)
  }

  console.log('[Subscriptions] Default plans seeded')
}
