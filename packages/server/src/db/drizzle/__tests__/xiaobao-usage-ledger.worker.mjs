import { parentPort, workerData } from 'node:worker_threads'
import { register } from 'tsx/esm/api'

register()

process.env.DATABASE_PATH = workerData.databasePath

const barrier = new Int32Array(workerData.barrier)
const { DrizzleXiaobaoUsageLedgerRepository } = await import('../repositories.ts')
const { closeDrizzleClient } = await import('../client.ts')

const repository = new DrizzleXiaobaoUsageLedgerRepository(
  () => undefined,
  () => {
    Atomics.add(barrier, 0, 1)
    Atomics.notify(barrier, 0)
    while (Atomics.load(barrier, 1) === 0) Atomics.wait(barrier, 1, 0, 5_000)
  },
)

Atomics.add(barrier, 2, 1)
Atomics.notify(barrier, 2)

try {
  let value
  if (workerData.operation === 'reserve') value = await repository.reserve(workerData.input)
  else if (workerData.operation === 'settle') value = await repository.settle(workerData.input)
  else value = await repository.release(workerData.input.reservationId, workerData.input.reason)
  parentPort.postMessage({ ok: true, value })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      message: error instanceof Error ? error.message : 'Unknown worker failure',
    },
  })
} finally {
  closeDrizzleClient()
  parentPort.close()
}
