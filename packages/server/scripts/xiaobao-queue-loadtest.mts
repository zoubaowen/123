/**
 * 小宝任务队列本地负荷测试（内存实现）。
 *
 * 用法（在 packages/server 下）：
 *   pnpm exec tsx scripts/xiaobao-queue-loadtest.mts --tasks=20000 --workers=16 --lease=60000
 *
 * 说明：
 * - 只使用**内存队列**，因此它是单进程吞吐与并发领取正确性的验证，**不代表**多节点表现；
 *   真实 Redis 队列 / 多节点 / 300 并发压测需要基础设施支持，见 docs 中的待验证项。
 * - 结果写入 JSON 报告文件；控制台只输出**静态**行（仓库规则：日志不含动态值）。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MeteredXiaobaoTaskQueue } from '../src/agent/xiaobao-runtime/queue-metrics.js'
import { simulateXiaobaoQueueLoad } from '../src/agent/xiaobao-runtime/queue-load-simulation.js'
import { InMemoryXiaobaoTaskQueue } from '../src/agent/xiaobao-runtime/task-queue.js'

const REPORT_FILE_NAME = 'xiaobao-queue-loadtest-report.json'

function readPositiveInteger(argumentName: string, fallback: number): number {
  const prefix = `--${argumentName}=`
  const raw = process.argv.slice(2).find((argument) => argument.startsWith(prefix))
  if (!raw) return fallback
  const value = Number(raw.slice(prefix.length))
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

const tasks = readPositiveInteger('tasks', 20_000)
const workers = readPositiveInteger('workers', 16)
const leaseMs = readPositiveInteger('lease', 60_000)

console.log('[loadtest] starting in-memory xiaobao queue load simulation')

const queue = new MeteredXiaobaoTaskQueue(new InMemoryXiaobaoTaskQueue())
const result = await simulateXiaobaoQueueLoad(queue, { tasks, workers, leaseMs })

writeFileSync(
  resolve(process.cwd(), REPORT_FILE_NAME),
  JSON.stringify({ taskCount: tasks, workerCount: workers, leaseMs, ...result }, null, 2),
)

console.log(`[loadtest] report written to ./${REPORT_FILE_NAME}`)

if (result.duplicateClaims !== 0 || result.leftover !== 0 || result.processed !== result.enqueued) {
  console.error('[loadtest] invariant violated: see report')
  process.exitCode = 1
} else {
  console.log('[loadtest] invariants hold: every task processed exactly once')
}
