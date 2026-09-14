import CloudBase from '@cloudbase/node-sdk'
import CloudBaseManager from '@cloudbase/manager-node'

const COLLECTION_PREFIX = process.env.DB_COLLECTION_PREFIX || 'vibe_agent_'

const COLLECTION_NAMES = [
  'users',
  'local_credentials',
  'tasks',
  'connectors',
  'accounts',
  'keys',
  'user_resources',
  'settings',
  'deployments',
  'miniprogram_apps',
  'cron_tasks',
  'admin_logs',
  'env_pool',
  'community_works',
  'sms_codes',
  'user_credits',
  'credit_transactions',
  'subscription_plans',
  'user_subscriptions',
  'daily_usage',
  'xiaobao_runtime_checkpoints',
  'xiaobao_usage_reservations',
  'institutions',
  'institution_members',
  'classes',
  'class_teachers',
  'class_enrollments',
  'courses',
  'course_chapters',
  'course_lessons',
  'lesson_resources',
  'class_courses',
  'lesson_progress',
  'class_sessions',
] as const

/**
 * Admin-only collection security rule.
 * Web SDK with publishable key cannot read/write these collections — only
 * server-side calls with admin secret pass through.
 */
const ADMIN_ONLY_ACL_TAG = 'ADMINONLY'

let app: ReturnType<typeof CloudBase.init> | null = null
let managerApp: CloudBaseManager | null = null

function getApp(): ReturnType<typeof CloudBase.init> {
  if (app) return app

  const envId = process.env.TCB_ENV_ID
  const region = process.env.TCB_REGION || 'ap-shanghai'
  const secretId = process.env.TCB_SECRET_ID
  const secretKey = process.env.TCB_SECRET_KEY
  const token = process.env.TCB_TOKEN || undefined

  if (!envId || !secretId || !secretKey) {
    throw new Error('CloudBase credentials not configured: TCB_ENV_ID, TCB_SECRET_ID, TCB_SECRET_KEY are required')
  }

  app = CloudBase.init({
    env: envId,
    region,
    secretId,
    secretKey,
    ...(token ? { sessionToken: token } : {}),
  })

  return app
}

function getManager(): CloudBaseManager {
  if (managerApp) return managerApp
  const envId = process.env.TCB_ENV_ID!
  const secretId = process.env.TCB_SECRET_ID!
  const secretKey = process.env.TCB_SECRET_KEY!
  const token = process.env.TCB_TOKEN || ''
  managerApp = new CloudBaseManager({
    envId,
    secretId,
    secretKey,
    ...(token ? { token } : {}),
  })
  return managerApp
}

/**
 * Set admin-only security rule on a collection via TCB ModifySafeRule API.
 * AclTag=ADMINONLY blocks Web SDK (publishable key) reads/writes while
 * server-side calls with admin secret still pass through.
 * Called once per collection on first access. Non-fatal on failure.
 */
async function ensureAdminOnlyRule(collectionName: string): Promise<void> {
  try {
    const envId = process.env.TCB_ENV_ID!
    const manager = getManager()
    const commonService = manager.commonService('tcb', '2018-06-08')
    await commonService.call({
      Action: 'ModifySafeRule',
      Param: {
        EnvId: envId,
        CollectionName: collectionName,
        AclTag: ADMIN_ONLY_ACL_TAG,
      },
    })
  } catch (err) {
    // Non-fatal: server-side SDK uses admin creds and bypasses rules.
    console.error('[cloudbase] Failed to set admin-only rule')
  }
}

export function getDatabase(): any {
  return getApp().database()
}

export function getCommand(): any {
  return getApp().database().command
}

export interface CloudBaseTransactionHandle {
  collection(name: string): any
  commit(): Promise<unknown>
  rollback(customRollbackResult?: unknown): Promise<unknown>
}

export async function runCloudBaseTransaction<T>(
  callback: (transaction: CloudBaseTransactionHandle) => T | Promise<T>,
): Promise<T> {
  const transaction = (await getDatabase().startTransaction()) as CloudBaseTransactionHandle
  try {
    const result = await callback(transaction)
    await transaction.commit()
    return result
  } catch (error) {
    try {
      await transaction.rollback()
    } catch {
      // Preserve the callback or commit failure.
    }
    throw error
  }
}

const ensuredCollections = new Set<string>()

export function getCollectionName(name: string): string {
  return `${COLLECTION_PREFIX}${name}`
}

/** Resolve an already-provisioned collection without creating it or changing its security rules. */
export function getExistingCollection(name: (typeof COLLECTION_NAMES)[number]): any {
  return getDatabase().collection(getCollectionName(name))
}

export async function getCollection(name: (typeof COLLECTION_NAMES)[number]): Promise<any> {
  const db = getDatabase()
  const fullName = getCollectionName(name)

  if (!ensuredCollections.has(fullName)) {
    try {
      await db.createCollection(fullName)
    } catch {
      // Collection already exists, ignore error
    }
    // Ensure admin-only rule (idempotent at TCB side, runs even if collection
    // already existed — covers upgrades from older deployments without rules)
    await ensureAdminOnlyRule(fullName)
    ensuredCollections.add(fullName)
  }

  return db.collection(fullName)
}
