import { getCentralAuthBaseUrl, isDesktopCloudAuthRequired } from '../lib/central-auth.js'

interface CentralBalance {
  balance: number
  frozenBalance: number
}

function getSyncConfig() {
  const baseUrl = getCentralAuthBaseUrl()
  const secret = process.env.CENTRAL_ACCOUNT_SYNC_SECRET
  if (!baseUrl || !secret) return null
  return { baseUrl, secret }
}

export function shouldUseCentralCredits(): boolean {
  return isDesktopCloudAuthRequired() && Boolean(getCentralAuthBaseUrl())
}

export function isCentralCreditsConfigured(): boolean {
  return Boolean(getSyncConfig())
}

async function postCentral<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
  const config = getSyncConfig()
  if (!config) return null

  const response = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-xiaobao-sync-secret': config.secret,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })

  if (!response.ok) {
    throw new Error('CENTRAL_CREDITS_FAILED')
  }

  return (await response.json()) as T
}

export async function getCentralCreditBalance(userId: string): Promise<CentralBalance | null> {
  return postCentral<CentralBalance>('/api/billing/internal/credits/balance', { userId })
}

export async function consumeCentralCredits(
  userId: string,
  amount: number,
  description: string,
  metadata?: Record<string, string>,
): Promise<{ newBalance: number } | null> {
  return postCentral<{ newBalance: number }>('/api/billing/internal/credits/consume', {
    userId,
    amount,
    description,
    metadata,
  })
}
