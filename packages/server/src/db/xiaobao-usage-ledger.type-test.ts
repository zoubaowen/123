import type {
  DatabaseProvider,
  UsageReservationLedgerResult,
  XiaobaoUsageLedgerRepository,
  XiaobaoUsageReservationRecord,
} from './types'

declare const database: DatabaseProvider
declare const taskId: string
declare const userId: string
declare const reservationId: string
declare const now: number
declare const record: XiaobaoUsageReservationRecord

async function verifyXiaobaoUsageLedgerContract(): Promise<void> {
  const repository: XiaobaoUsageLedgerRepository = database.xiaobaoUsageLedger

  const reservation: UsageReservationLedgerResult = await repository.reserve({
    taskId,
    userId,
    category: 'model',
    reservedUnits: 10,
    creditCostReserved: 10,
    now,
  })

  if (reservation.allowed) {
    const record: XiaobaoUsageReservationRecord = reservation.record
    void record
  } else {
    const reason: 'insufficient_credits' = reservation.reason
    void reason
  }

  const settled: XiaobaoUsageReservationRecord = await repository.settle({
    reservationId,
    taskId,
    category: 'model',
    settledUnits: 4,
    creditCostSettled: 4,
    now,
  })

  const released: XiaobaoUsageReservationRecord = await repository.release(reservationId, 'safety_denied')
  const found: XiaobaoUsageReservationRecord | null = await repository.findByTaskAndCategory(taskId, 'model')
  const healthy: boolean = await repository.healthCheck()

  void settled
  void released
  void found
  void healthy

  // @ts-expect-error Categories are restricted to the ledger's four supported values.
  await repository.reserve({ taskId, userId, category: 'other', reservedUnits: 10, creditCostReserved: 10, now })

  // @ts-expect-error Reservation status values are restricted to the stable ledger state union.
  const invalidStatus: XiaobaoUsageReservationRecord = { ...record, status: 'other' }
  void invalidStatus

  // @ts-expect-error Release reasons are restricted to safety denials and runtime failures.
  await repository.release(reservationId, 'other')
}

void verifyXiaobaoUsageLedgerContract
