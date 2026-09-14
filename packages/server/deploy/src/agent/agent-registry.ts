import type { AgentRunStatus } from '@ai-xiaobao/shared'

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * ACP 鍗忚瀹氫箟鐨?stopReason 鍚堟硶鍊笺€? * 瑙?@agentclientprotocol/sdk 鐨?StopReason schema銆? * 杩欓噷涓嶅紩鍏?ACP SDK 鐨勭被鍨嬩緷璧栵紝鐩存帴鐢ㄥ瓧闈㈤噺鑱斿悎瓒充互銆? */
export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'

export interface AgentRun {
  conversationId: string
  turnId: string
  envId: string
  userId: string
  status: AgentRunStatus
  abortController: AbortController
  startTime: number
  lastSeq: number
  error?: string
  /**
   * 鐪熷疄缁堟鍘熷洜銆俽untime 鍦?completeAgent 鏃堕€忎紶锛宺outes/acp.ts 缁堢粨鎶ユ枃浼樺厛浣跨敤姝ゅ€硷紱
   * 鑻?undefined 鍒?acp.ts 浼氭牴鎹?status 娲剧敓锛坈ancelled鈫抍ancelled銆乪rror鈫抮efusal銆乪lse鈫抏nd_turn锛夈€?   */
  stopReason?: StopReason
}

// 鈹€鈹€鈹€ Registry 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

const runningAgents = new Map<string, AgentRun>()

export function registerAgent(run: Omit<AgentRun, 'status' | 'startTime' | 'lastSeq'>): AgentRun {
  const existing = runningAgents.get(run.conversationId)
  if (existing) {
    console.log('[Registry] registerAgent overwriting existing entry')
  }
  const agentRun: AgentRun = {
    ...run,
    status: 'running',
    startTime: Date.now(),
    lastSeq: -1,
  }
  runningAgents.set(run.conversationId, agentRun)
  return agentRun
}

export function getAgentRun(conversationId: string): AgentRun | undefined {
  return runningAgents.get(conversationId)
}

export function completeAgent(
  conversationId: string,
  status: 'completed' | 'error' | 'cancelled',
  error?: string,
  stopReason?: StopReason,
): void {
  const run = runningAgents.get(conversationId)
  if (run) {
    console.log('[Registry] completeAgent updated run status')
    run.status = status
    if (error) run.error = error
    if (stopReason) run.stopReason = stopReason
  } else {
    console.log('[Registry] completeAgent found no run')
  }
}

/**
 * Remove agent from registry.
 * Only deletes if the current entry matches the given turnId (prevents a stale
 * setTimeout from removing a newer run that reused the same conversationId).
 * Also refuses to delete a 'running' entry 鈥?this prevents the case where
 * a resume reuses the same turnId and a stale timer from the previous run
 * would incorrectly delete the active entry.
 */
export function removeAgent(conversationId: string, turnId?: string): void {
  const run = runningAgents.get(conversationId)
  if (!run) return
  if (turnId && run.turnId !== turnId) return // stale removal 鈥?different turnId
  runningAgents.delete(conversationId)
}

export function isAgentRunning(conversationId: string): boolean {
  const run = runningAgents.get(conversationId)
  return run?.status === 'running'
}

export function getNextSeq(conversationId: string): number {
  const run = runningAgents.get(conversationId)
  if (!run) return 0
  run.lastSeq += 1
  return run.lastSeq
}
