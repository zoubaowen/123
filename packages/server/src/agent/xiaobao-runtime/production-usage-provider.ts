import type { XiaobaoUsageLedgerRepository } from '../../db/types.js'
import type { UsageProvider, UsageRecord, UsageReservation, UsageReservationResult } from './ports.js'
import type { XiaobaoProductionGuardConfig } from './production-guard-config.js'

type Pricing = XiaobaoProductionGuardConfig['pricing']

const insufficientCreditsMessage = '小宝本次可用额度不足，请联系老师或管理员'

export function priceModelUnits(tokens: number, pricing: Pricing): number {
  if (
    !Number.isSafeInteger(tokens) ||
    tokens < 0 ||
    !Number.isSafeInteger(pricing.tokensPerCredit) ||
    !Number.isSafeInteger(pricing.maxCreditsPerTask)
  ) {
    throw new Error('Usage exceeds reservation')
  }
  const credits = Math.ceil(tokens / pricing.tokensPerCredit)
  if (credits > pricing.maxCreditsPerTask) throw new Error('Usage exceeds reservation')
  return credits
}

/** Translates runtime model usage into the transactional XiaoBao credit ledger. */
export class ProductionUsageProvider implements UsageProvider {
  constructor(
    private readonly pricing: Pricing,
    private readonly ledger: XiaobaoUsageLedgerRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async reserve(input: UsageReservation): Promise<UsageReservationResult> {
    const result = await this.ledger.reserve({
      taskId: input.taskId,
      userId: input.userId,
      category: input.category,
      reservedUnits: this.pricing.tokensPerCredit * this.pricing.maxCreditsPerTask,
      creditCostReserved: this.pricing.maxCreditsPerTask,
      now: this.now(),
    })
    if (!result.allowed) return { allowed: false, reason: insufficientCreditsMessage }
    return { allowed: true, reservationId: result.record.id }
  }

  async record(input: UsageRecord): Promise<void> {
    await this.ledger.settle({
      taskId: input.taskId,
      reservationId: input.reservationId,
      category: input.category,
      settledUnits: input.units,
      creditCostSettled: priceModelUnits(input.units, this.pricing),
      now: this.now(),
    })
  }

  async release(reservationId: string, reason: 'safety_denied' | 'runtime_failed'): Promise<void> {
    await this.ledger.release(reservationId, reason)
  }
}
