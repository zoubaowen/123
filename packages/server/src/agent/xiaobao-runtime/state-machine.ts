import {
  type XiaobaoCapability,
  type XiaobaoTaskSnapshot,
  type XiaobaoTaskStatus,
  xiaobaoTaskSnapshotSchema,
} from './domain.js'

const ALLOWED_TRANSITIONS: Record<XiaobaoTaskStatus, readonly XiaobaoTaskStatus[]> = {
  created: ['safety_check', 'cancelled'],
  safety_check: ['requirements', 'failed_recoverable', 'failed_terminal', 'cancelled'],
  requirements: ['planned', 'waiting_for_student', 'failed_terminal', 'cancelled'],
  planned: ['running', 'paused_budget', 'failed_terminal', 'cancelled'],
  running: [
    'waiting_for_student',
    'quality_check',
    'retrying',
    'paused_budget',
    'failed_recoverable',
    'failed_terminal',
    'cancelled',
  ],
  waiting_for_student: ['requirements', 'running', 'cancelled'],
  quality_check: ['revising', 'completed', 'retrying', 'failed_recoverable', 'failed_terminal', 'cancelled'],
  revising: ['quality_check', 'retrying', 'paused_budget', 'failed_recoverable', 'failed_terminal', 'cancelled'],
  retrying: ['running', 'quality_check', 'revising', 'failed_recoverable', 'failed_terminal', 'cancelled'],
  paused_budget: ['planned', 'running', 'revising', 'cancelled'],
  failed_recoverable: ['safety_check', 'retrying', 'cancelled'],
  failed_terminal: [],
  cancelled: [],
  completed: [],
}

export function createTaskSnapshot(input: {
  taskId: string
  userId?: string
  capability: XiaobaoCapability
  prompt?: string
  now: number
}): XiaobaoTaskSnapshot {
  return xiaobaoTaskSnapshotSchema.parse({
    schemaVersion: 1,
    taskId: input.taskId,
    userId: input.userId ?? '',
    capability: input.capability,
    prompt: input.prompt ?? '',
    status: 'created',
    revision: 0,
    turnCount: 0,
    usageReservationId: null,
    modelUsageTokens: 0,
    hasExactModelUsage: false,
    observations: [],
    resultText: null,
    createdAt: input.now,
    updatedAt: input.now,
    currentStepId: null,
  })
}

export function transitionTask(
  snapshot: XiaobaoTaskSnapshot,
  nextStatus: XiaobaoTaskStatus,
  now: number,
): XiaobaoTaskSnapshot {
  if (snapshot.status === nextStatus) return snapshot

  if (!ALLOWED_TRANSITIONS[snapshot.status].includes(nextStatus)) {
    throw new Error('Invalid Xiaobao task transition')
  }

  return xiaobaoTaskSnapshotSchema.parse({
    ...snapshot,
    status: nextStatus,
    revision: snapshot.revision + 1,
    updatedAt: now,
  })
}
