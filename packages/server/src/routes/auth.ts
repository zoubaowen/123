import { Hono, type Context } from 'hono'
import { setCookie, deleteCookie } from 'hono/cookie'
import { getDb } from '../db/index.js'
import bcrypt from 'bcryptjs'
import { nanoid } from 'nanoid'
import { encrypt, hashToken } from '../lib/crypto.js'
import { checkRateLimit } from '../lib/rate-limiter.js'
import { encryptJWE } from '../lib/session'
import {
  callCentralAuth,
  getCentralAuthBaseUrl,
  getDesktopCloudAuthRequirement,
  type CentralAuthUser,
} from '../lib/central-auth.js'
import { requireAuth, type AppEnv, type AppSession } from '../middleware/auth'
import { resolveRegisteredUserRole } from '../lib/user-role.js'
import type { User } from '../db/types.js'
import { grantSignupBonusCredits } from '../services/credits.js'
import {
  provisionUserResources,
  rollbackProvisionedResources,
  ensureSharedEnvAuthDomains,
} from '../cloudbase/provision.js'
import { acquireEnv } from '../cloudbase/env-lifecycle.js'

const SESSION_COOKIE_NAME = 'nex_session'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 year in seconds

const SECURE_COOKIE = process.env.NODE_ENV === 'production'

const auth = new Hono<AppEnv>()

function buildAvatar(username: string, avatar?: string | null) {
  return avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=6366f1&color=fff`
}

function toPublicUser(user: User) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || undefined,
    name: user.name || user.username,
    avatar: buildAvatar(user.username, user.avatarUrl),
    role: user.role || 'user',
  }
}

async function setSessionCookie(c: Context<AppEnv>, user: User) {
  const session: AppSession = {
    created: Date.now(),
    authProvider: 'local',
    user: {
      id: user.id,
      username: user.username,
      email: user.email || undefined,
      name: user.name || user.username,
      avatar: buildAvatar(user.username, user.avatarUrl),
    },
  }

  const sessionValue = await encryptJWE(session, '1y')

  setCookie(c, SESSION_COOKIE_NAME, sessionValue, {
    path: '/',
    maxAge: COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'Lax',
    secure: SECURE_COOKIE,
  })
}

async function resolveUserEnvId(userId: string, fallback?: string) {
  try {
    const resource = await getDb().userResources.findByUserId(userId)
    return resource?.envId || fallback
  } catch {
    return fallback
  }
}

async function mirrorCentralUser(remoteUser: CentralAuthUser, password: string) {
  const db = getDb()
  const username = remoteUser.username.trim().toLowerCase()
  const role = remoteUser.role === 'admin' ? 'admin' : 'user'
  const now = Date.now()

  let user = (await db.users.findByProviderAndExternalId('local', username)) || (await db.users.findById(remoteUser.id))

  if (user) {
    user = await db.users.update(user.id, {
      provider: 'local',
      externalId: username,
      username,
      email: remoteUser.email || null,
      name: remoteUser.name || username,
      avatarUrl: remoteUser.avatar || null,
      role,
      status: 'active',
      lastLoginAt: now,
      updatedAt: now,
    })
  } else {
    user = await db.users.create({
      id: remoteUser.id,
      provider: 'local',
      externalId: username,
      accessToken: '',
      username,
      email: remoteUser.email || null,
      name: remoteUser.name || username,
      avatarUrl: remoteUser.avatar || null,
      role,
      status: 'active',
      apiKey: hashToken(`sak_${nanoid(40)}`),
      lastLoginAt: now,
    })
  }

  if (!user) {
    throw new Error('Failed to mirror central user')
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const credential = await db.localCredentials.findByUserId(user.id)
  if (credential) {
    await db.localCredentials.update(user.id, { passwordHash, updatedAt: now })
  } else {
    await db.localCredentials.create({ userId: user.id, passwordHash, createdAt: now, updatedAt: now })
  }

  return user
}

function requireDesktopCloudAuth() {
  const requirement = getDesktopCloudAuthRequirement()
  if (requirement.required && !requirement.configured) {
    return { error: 'Desktop cloud account service is not configured' }
  }
  return undefined
}

auth.post('/send-sms-code', async (c) => {
  try {
    const { phone } = await c.req.json()

    if (!phone || typeof phone !== 'string') {
      return c.json({ error: 'Phone number is required' }, 400)
    }

    if (!/^1\d{10}$/.test(phone)) {
      return c.json({ error: 'Invalid phone number' }, 400)
    }

    const centralAuthBaseUrl = getCentralAuthBaseUrl()
    if (centralAuthBaseUrl) {
      const response = await fetch(`${centralAuthBaseUrl}/api/auth/send-sms-code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(10_000),
      })
      const payload = await response.json().catch(() => ({ error: 'Failed to send verification code' }))
      return c.json(payload, response.status as never)
    }

    const existingPhoneUser = await getDb().users.findByPhone(phone)
    if (existingPhoneUser) {
      return c.json({ error: 'Phone number already registered' }, 409)
    }

    const rateCheck = checkRateLimit(`sms:${phone}`)
    if (!rateCheck.allowed) {
      return c.json({ error: 'Too many requests, please try again later' }, 429)
    }

    const { isSmsMockEnabled, sendSms } = await import('../services/sms.js')
    const code = isSmsMockEnabled() ? '123456' : String(Math.floor(100000 + Math.random() * 900000))

    await getDb().smsCodes.create({
      id: nanoid(),
      phone,
      code,
      expiresAt: Date.now() + 5 * 60 * 1000,
      used: false,
    })

    await sendSms(phone, code)

    return c.json({
      success: true,
      message: isSmsMockEnabled() ? '验证码已发送（开发模式，请输入 123456）' : '验证码已发送',
    })
  } catch (error) {
    console.error('[Auth] Error sending SMS code')
    return c.json({ error: 'Failed to send verification code' }, 500)
  }
})

auth.post('/verify-phone', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const session = c.get('session')!

  const { phone, code } = await c.req.json()

  if (!phone || !code) {
    return c.json({ error: 'Phone and code are required' }, 400)
  }

  if (!/^1\d{10}$/.test(phone)) {
    return c.json({ error: 'Invalid phone number' }, 400)
  }

  const existingPhoneUser = await getDb().users.findByPhone(phone)
  if (existingPhoneUser && existingPhoneUser.id !== session.user.id) {
    return c.json({ error: 'Phone number already registered' }, 409)
  }

  const smsCode = await getDb().smsCodes.findByPhoneAndCode(phone, code)

  if (!smsCode || smsCode.used || smsCode.expiresAt < Date.now()) {
    return c.json({ error: 'Invalid or expired verification code' }, 400)
  }

  await getDb().users.update(session.user.id, { phone, phoneVerified: true })
  await getDb().smsCodes.markUsed(smsCode.id)

  return c.json({ success: true })
})

auth.post('/register', async (c) => {
  try {
    const desktopAuthError = requireDesktopCloudAuth()
    if (desktopAuthError) return c.json(desktopAuthError, 503)

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    const rateCheck = checkRateLimit(`register:${ip}`)
    if (!rateCheck.allowed) {
      return c.json({ error: 'Too many requests, please try again later' }, 429)
    }

    const body = await c.req.json()
    const { username, password, phone, code } = body

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return c.json({ error: 'Username and password are required' }, 400)
    }

    if (!phone || typeof phone !== 'string' || !/^1\d{10}$/.test(phone)) {
      return c.json({ error: 'Valid phone number is required' }, 400)
    }

    if (!code || typeof code !== 'string') {
      return c.json({ error: 'SMS verification code is required' }, 400)
    }

    const existingPhoneUser = await getDb().users.findByPhone(phone)
    if (existingPhoneUser) {
      return c.json({ error: 'Phone number already registered' }, 409)
    }

    const trimmedUsername = username.trim().toLowerCase()
    if (trimmedUsername.length < 3) {
      return c.json({ error: 'Username must be at least 3 characters' }, 400)
    }
    if (password.length < 8) {
      return c.json({ error: 'Password must be at least 8 characters' }, 400)
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return c.json({ error: 'Password must contain uppercase, lowercase, and numbers' }, 400)
    }

    if (getCentralAuthBaseUrl()) {
      const remote = await callCentralAuth('register', { username: trimmedUsername, password, phone, code })
      if (!remote) {
        return c.json({ error: 'Registration failed' }, 502)
      }
      if (!remote.ok) {
        return c.json({ error: remote.failure.error }, remote.failure.status as never)
      }

      const user = await mirrorCentralUser(remote.data.user, password)
      await setSessionCookie(c, user)

      return c.json({
        success: true,
        user: toPublicUser(user),
        envId: await resolveUserEnvId(user.id, remote.data.envId),
      })
    }

    const smsRecord = await getDb().smsCodes.findByPhoneAndCode(phone, code)
    if (!smsRecord || smsRecord.used || smsRecord.expiresAt < Date.now()) {
      return c.json({ error: 'Invalid or expired verification code' }, 400)
    }

    // Check if username already exists
    const existing = await getDb().users.findByProviderAndExternalId('local', trimmedUsername)

    if (existing) {
      return c.json({ error: 'Username already taken' }, 409)
    }

    // Create user — first registered user becomes admin automatically
    const userId = nanoid()
    const now = Date.now()
    const passwordHash = await bcrypt.hash(password, 12)
    const userCount = await getDb().users.count()
    const role = resolveRegisteredUserRole(userCount)

    await getDb().users.create({
      id: userId,
      provider: 'local',
      externalId: trimmedUsername,
      accessToken: '',
      username: trimmedUsername,
      role,
      status: 'active',
      phone: phone || null,
      phoneVerified: phone ? true : false,
      apiKey: hashToken(`sak_${nanoid(40)}`),
    })

    await getDb().localCredentials.create({
      userId,
      passwordHash,
      createdAt: now,
      updatedAt: now,
    })

    // CloudBase 环境配置 — 通过统一生命周期接口
    const { getProvisionMode } = await import('../lib/provision-config.js')
    const provisionMode = await getProvisionMode()

    if (process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY && provisionMode === 'isolated') {
      const resourceId = nanoid()

      // 同步创建独立环境，失败则回滚账号
      try {
        await getDb().userResources.create({
          id: resourceId,
          userId,
          status: 'processing',
          envId: null,
          envAlias: null,
          envRegion: null,
          cosTagValue: null,
          policyHash: null,
          camUsername: null,
          camSecretId: null,
          camSecretKey: null,
          policyId: null,
          failStep: null,
          failReason: null,
          createdAt: now,
          updatedAt: now,
        })

        const result = await acquireEnv({ userId, username: trimmedUsername, mode: 'isolated' })
        await getDb().userResources.update(resourceId, {
          status: 'success',
          envId: result.envId,
          envAlias: result.envAlias,
          envRegion: result.envRegion,
          cosTagValue: result.cosTagValue,
          policyHash: result.policyHash,
          camUsername: result.camUsername,
          camSecretId: result.camSecretId,
          camSecretKey: result.camSecretKey || null,
          policyId: result.policyId,
          updatedAt: Date.now(),
        })
        console.log('[provision] User env ready')
      } catch (err) {
        // 环境创建失败，回滚云端资源和本地账号
        console.error('[provision] Failed, rolling back')
        try {
          const partialResult: Partial<import('../cloudbase/provision.js').ProvisionResult> = {}
          partialResult.camUsername = `vibe_${userId.substring(0, 20)}`
          await rollbackProvisionedResources(partialResult)
        } catch {
          // rollback best-effort
        }
        try {
          await getDb().users.deleteById(userId)
        } catch {
          // rollback best-effort
        }
        return c.json({ error: 'Failed to create cloud environment, please try again later' }, 500)
      }
    }
    // shared / task：注册不做 provision，但 shared 模式需确保主环境安全域名
    if (provisionMode === 'shared') {
      ensureSharedEnvAuthDomains().catch(() => {})
    }

    const user = await getDb().users.findById(userId)
    if (!user) {
      return c.json({ error: 'Registration failed' }, 500)
    }
    await getDb().smsCodes.markUsed(smsRecord.id)
    await grantSignupBonusCredits(userId)
    await setSessionCookie(c, user)

    // Fetch envId (shared mode creates it synchronously above)
    let envId: string | undefined
    try {
      const resource = await getDb().userResources.findByUserId(userId)
      envId = resource?.envId || undefined
    } catch {
      // ignore
    }

    return c.json({
      success: true,
      user: {
        id: userId,
        username: trimmedUsername,
        email: undefined,
        name: trimmedUsername,
        avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(trimmedUsername)}&background=6366f1&color=fff`,
        role,
      },
      envId,
    })
  } catch (error) {
    console.error('[Auth] Error registering local user')
    return c.json({ error: 'Registration failed' }, 500)
  }
})

auth.post('/login', async (c) => {
  try {
    const desktopAuthError = requireDesktopCloudAuth()
    if (desktopAuthError) return c.json(desktopAuthError, 503)

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown'
    const rateCheck = checkRateLimit(`login:${ip}`)
    if (!rateCheck.allowed) {
      return c.json({ error: 'Too many requests, please try again later' }, 429)
    }

    const body = await c.req.json()
    const { username, password } = body

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return c.json({ error: 'Username and password are required' }, 400)
    }

    const trimmedUsername = username.trim().toLowerCase()

    if (getCentralAuthBaseUrl()) {
      const remote = await callCentralAuth('login', { username: trimmedUsername, password })
      if (!remote) {
        return c.json({ error: 'Login failed' }, 502)
      }
      if (!remote.ok) {
        return c.json({ error: remote.failure.error }, remote.failure.status as never)
      }

      const user = await mirrorCentralUser(remote.data.user, password)
      await setSessionCookie(c, user)

      return c.json({
        success: true,
        user: toPublicUser(user),
        envId: await resolveUserEnvId(user.id, remote.data.envId),
      })
    }

    // Find user
    const user = await getDb().users.findByProviderAndExternalId('local', trimmedUsername)

    if (!user) {
      return c.json({ error: 'Invalid username or password' }, 401)
    }

    // Get credentials
    const cred = await getDb().localCredentials.findByUserId(user.id)

    if (!cred) {
      return c.json({ error: 'Invalid username or password' }, 401)
    }

    // Verify password
    const valid = await bcrypt.compare(password, cred.passwordHash)
    if (!valid) {
      return c.json({ error: 'Invalid username or password' }, 401)
    }

    // Check if user is disabled
    if (user.status === 'disabled') {
      return c.json({ error: 'Account has been disabled' }, 403)
    }

    // Update last login
    await getDb().users.update(user.id, { lastLoginAt: Date.now(), updatedAt: Date.now() })

    await setSessionCookie(c, user)

    // Fetch envId for the response (same logic as /me)
    let envId: string | undefined
    try {
      const resource = await getDb().userResources.findByUserId(user.id)
      envId = resource?.envId || undefined
    } catch {
      // ignore
    }

    return c.json({
      success: true,
      user: toPublicUser(user),
      envId,
    })
  } catch (error) {
    console.error('[Auth] Error logging in local user')
    return c.json({ error: 'Login failed' }, 500)
  }
})

auth.post('/signout', async (c) => {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE })
  return c.json({ success: true })
})

auth.get('/me', async (c) => {
  const session = c.get('session')

  if (!session) {
    return c.json({ user: undefined })
  }

  // Get user role and check status
  const user = await getDb().users.findById(session.user.id)

  // If user is disabled, clear session and return no user
  if (user?.status === 'disabled') {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/', secure: SECURE_COOKIE })
    return c.json({ user: undefined })
  }

  // Get user's envId and provision status
  let envId: string | undefined
  let provisionStatus: string = 'not_started'
  try {
    const resource = await getDb().userResources.findByUserId(session.user.id)
    envId = resource?.envId || undefined
    provisionStatus = resource?.status || 'not_started'
  } catch {
    // ignore
  }

  return c.json({
    user: {
      ...session.user,
      role: user?.role || 'user',
      phone: user?.phone || null,
      phoneVerified: user?.phoneVerified || false,
    },
    authProvider: session.authProvider,
    envId,
    provisionStatus,
  })
})

// 查询当前用户的 CloudBase 环境状态
auth.get('/provision-status', async (c) => {
  const session = c.get('session')
  if (!session?.user?.id) return c.json({ error: 'Unauthorized' }, 401)

  const { getProvisionMode } = await import('../lib/provision-config.js')
  const provisionMode = await getProvisionMode()

  // shared / task 模式注册时不写 user_resources：
  //   - shared 永远 ready（直接用支撑账号）
  //   - task 注册时 ready，待用户创建 task 时各自 provision
  if (provisionMode === 'shared' || provisionMode === 'task' || provisionMode === 'local') {
    return c.json({
      status: 'success',
      envId: provisionMode === 'local' ? 'local' : provisionMode === 'shared' ? process.env.TCB_ENV_ID || null : null,
      camUsername: null,
      camSecretId: null,
      failReason: null,
      createdAt: null,
      updatedAt: null,
    })
  }

  const resource = await getDb().userResources.findByUserId(session.user.id)

  if (!resource) return c.json({ status: 'not_started' })

  return c.json({
    status: resource.status,
    envId: resource.envId,
    camUsername: resource.camUsername,
    camSecretId: resource.camSecretId,
    failReason: resource.failReason,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  })
})

// Retry failed provision
auth.post('/provision-retry', async (c) => {
  const session = c.get('session')
  if (!session?.user?.id) return c.json({ error: 'Unauthorized' }, 401)

  const resource = await getDb().userResources.findByUserId(session.user.id)
  if (!resource) return c.json({ error: 'No resource record found' }, 404)
  if (resource.status !== 'failed') return c.json({ error: 'Can only retry failed provisions' }, 400)

  // Reset to processing and retry
  await getDb().userResources.update(resource.id, {
    status: 'processing',
    failReason: null,
    failStep: null,
    updatedAt: Date.now(),
  })

  const user = await getDb().users.findById(session.user.id)
  const username = user?.username || session.user.username || 'unknown'

  provisionUserResources(session.user.id, username)
    .then(async (result) => {
      await getDb().userResources.update(resource.id, {
        status: 'success',
        envId: result.envId,
        envAlias: result.envAlias,
        envRegion: result.envRegion,
        cosTagValue: result.cosTagValue,
        policyHash: result.policyHash,
        camUsername: result.camUsername,
        camSecretId: result.camSecretId,
        camSecretKey: result.camSecretKey || null,
        policyId: result.policyId,
        updatedAt: Date.now(),
      })
      console.log('[provision-retry] User env ready')
    })
    .catch(async (err) => {
      await getDb().userResources.update(resource.id, {
        status: 'failed',
        failStep: err.__provisionFailStep || null,
        failReason: 'Provision failed',
        updatedAt: Date.now(),
      })
      console.error('[provision-retry] Failed')
    })

  return c.json({ status: 'processing' })
})

// Rate limit info
auth.get('/rate-limit', async (c) => {
  const session = c.get('session')
  if (!session?.user?.id) return c.json({ error: 'Unauthorized' }, 401)

  // Return generous default limits
  return c.json({
    allowed: true,
    remaining: 100,
    used: 0,
    total: 100,
    resetAt: new Date(Date.now() + 86400000).toISOString(),
  })
})

// GET /auth-config - Expose auth configuration to frontend (no session required)
auth.get('/auth-config', (c) => {
  const providers = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS || 'local,github').split(',').map((s) => s.trim())
  const githubMode = process.env.AUTH_GITHUB_MODE || 'direct' // 'direct' | 'cloudbase'
  const tcbEnvId = process.env.TCB_ENV_ID || ''
  const desktopCloudAuth = getDesktopCloudAuthRequirement()
  return c.json({ providers, githubMode, tcbEnvId, desktopCloudAuth })
})

// ─── API Key (view / reset) ────────────────────────────────────────────────

// Get current user's API key (plaintext).
auth.get('/api-key', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  return c.json({
    apiKey: null,
    note: 'API key is stored as a hash and cannot be retrieved. Use reset to generate a new one.',
  })
})

// Reset (regenerate) current user's API key.
auth.post('/api-key/reset', async (c) => {
  const authErr = requireAuth(c)
  if (authErr) return authErr
  const session = c.get('session')!

  const plainKey = `sak_${nanoid(40)}`
  await getDb().users.update(session.user.id, { apiKey: hashToken(plainKey) })
  return c.json({ apiKey: plainKey })
})

export default auth
