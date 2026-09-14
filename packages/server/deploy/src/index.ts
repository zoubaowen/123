import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Prevent unhandled rejections from crashing the process (agent-sdk Transport errors)
process.on('unhandledRejection', (err) => {
  // "Session not found" is thrown by agent-sdk's internal ProcessTransport when
  // the child process sends data after abort/cancel. This happens asynchronously
  // inside the SDK's readline handler — we cannot catch it at the source.
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('Session not found')) {
    console.debug('[Server] SDK cleanup rejection after cancel')
    return
  }
  console.error('[Server] Unhandled rejection')
})

// Prevent EPIPE / ECONNRESET etc from crashing the process.
// These occur when agent-sdk's internal stdio pipe or sandbox socket closes
// while data is still being written — expected during agent cleanup.
process.on('uncaughtException', (err) => {
  const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined
  if (code === 'EPIPE' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
    console.warn('[Server] Ignored transient uncaught exception')
  } else {
    console.error('[Server] Uncaught exception, shutting down')
    process.exit(1)
  }
})

import { authMiddleware } from './middleware/auth'
import type { AppEnv } from './middleware/auth'
import authRoutes from './routes/auth'
import githubAuthRoutes from './routes/github-auth'
import cloudbaseAuthRoutes from './routes/cloudbase-auth'
import githubRoutes from './routes/github'
import acpRoutes from './routes/acp'
import tasksRoutes from './routes/tasks'
import connectorsRoutes from './routes/connectors'
import miniprogramRoutes from './routes/miniprogram'
import crontaskRoutes from './routes/crontask'
import apiKeysRoutes from './routes/api-keys'
import miscRoutes from './routes/misc'
import reposRoutes from './routes/repos'
import databaseRoutes from './routes/database.js'
import mcpCloudbaseRoutes from './routes/cloudbase-mcp.js'
import storageRoutes from './routes/storage.js'
import functionsRoutes from './routes/functions.js'
import sqlRoutes from './routes/sql.js'
import capiRoutes from './routes/capi.js'
import adminRoutes from './routes/admin'
import billingRoutes from './routes/billing'
import skillsRoutes from './routes/skills'
import communityRoutes from './routes/community'
import downloadRoutes from './routes/download'
import { checkUserStatus } from './middleware/admin'
import { resolveCorsOrigin } from './lib/cors-origin.js'

const app = new Hono<AppEnv>()

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS || 'http://localhost:3001,http://localhost:5173,http://localhost:5174'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Security headers
app.use('*', async (c, next) => {
  await next()
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  c.res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
})

// CORS configuration
app.use(
  '*',
  cors({
    origin: (origin) => {
      const resolved = resolveCorsOrigin(origin, ALLOWED_ORIGINS)
      if (resolved === 'null' && origin && origin !== 'null') {
        console.warn('[CORS] Blocked origin')
      }
      return resolved
    },
    credentials: true,
  }),
)

// API routes (must be before static files)
app.use('*', authMiddleware)
app.use('*', checkUserStatus)

// CloudBase MCP HTTP server (for OpenCode ACP runtime — self-authenticates via X-Sandbox-Auth)
app.route('/cloudbase-mcp', mcpCloudbaseRoutes)

app.get('/health', (c) => c.json({ status: 'ok' }))
app.route('/api/auth', authRoutes)
app.route('/api/auth/github', githubAuthRoutes)
app.route('/api/auth/cloudbase', cloudbaseAuthRoutes)
app.route('/api/github', githubRoutes)
app.route('/api/agent', acpRoutes)
app.route('/api/tasks', tasksRoutes)
app.route('/api/connectors', connectorsRoutes)
app.route('/api/miniprogram', miniprogramRoutes)
app.route('/api/crontask', crontaskRoutes)
app.route('/api/api-keys', apiKeysRoutes)
app.route('/api/repos', reposRoutes)
app.route('/api/database', databaseRoutes)
app.route('/api/storage', storageRoutes)
app.route('/api/functions', functionsRoutes)
app.route('/api/sql', sqlRoutes)
app.route('/api/capi', capiRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/billing', billingRoutes)
app.route('/api/skills', skillsRoutes)
app.route('/api/community', communityRoutes)
app.route('/api/download', downloadRoutes)
app.route('/api', miscRoutes)

// Static file serving for production (web build output)
const webDistPath = resolve(__dirname, '../../web/dist')
const serveStaticFiles = existsSync(webDistPath)

if (serveStaticFiles) {
  console.log('[Server] Serving static files')

  // Read index.html once at startup for SPA fallback
  const indexHtml = readFileSync(resolve(webDistPath, 'index.html'), 'utf-8')

  // Serve static assets (JS, CSS, images, etc.)
  app.use('/assets/*', serveStatic({ root: webDistPath }))

  // Serve other static files (favicon, logos, etc.)
  app.use('/*', serveStatic({ root: webDistPath }))

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api')) {
      return next()
    }
    return c.html(indexHtml)
  })
} else {
  console.log('[Server] Running in API-only mode (no static files)')
  console.log('[Server] For full-stack mode, build the web package first: pnpm build:web')
}

import { initCronScheduler, stopAllCronJobs } from './services/cron-scheduler.js'
import { getDb } from './db/index.js'
import { encrypt, hashToken } from './lib/crypto.js'
import { nanoid } from 'nanoid'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { getInitialAdminPassword } from './lib/admin-bootstrap.js'

async function seedAdmin() {
  try {
    const db = getDb()
    const allUsers = await db.users.findAll(10, 0)
    if (allUsers.length > 0) return
    const initialPassword = getInitialAdminPassword()
    if (!initialPassword) return
    const id = crypto.randomUUID()
    const hashed = await bcrypt.hash(initialPassword, 12)
    const ts = Date.now()
    await db.users.create({
      id,
      provider: 'local',
      externalId: 'admin',
      accessToken: '',
      username: 'admin',
      email: 'admin@xiaobao.com',
      role: 'admin',
      status: 'active',
      apiKey: hashToken(`sak_${nanoid(40)}`),
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: 0,
    } as any)
    await db.localCredentials.create({ userId: id, passwordHash: hashed } as any)
    console.log('[Server] Default admin account created')
  } catch (err) {
    console.error('[Server] Failed to seed admin')
  }
}

// Backfill apiKey for existing users that don't have one
async function backfillApiKeys() {
  try {
    const db = getDb()
    const users = await db.users.findAll(1000, 0)
    let count = 0
    for (const user of users) {
      if (!user.apiKey) {
        const plainKey = `sak_${nanoid(40)}`
        await db.users.update(user.id, { apiKey: hashToken(plainKey) })
        count++
      }
    }
    if (count > 0) {
      console.log('[Server] Backfilled API keys')
    }
  } catch (err) {
    console.error('[Server] Failed to backfill API keys')
  }
}

const PORT = Number(process.env.PORT) || 3001

// 让 OpencodeAcpRuntime 知道自己的 base URL（用于 spawn opencode 时注入 ASK_USER_URL）。
// 仅 127.0.0.1 回环，opencode 子进程同机运行。
if (!process.env.ASK_USER_BASE_URL) {
  process.env.ASK_USER_BASE_URL = `http://127.0.0.1:${PORT}`
}

// Prepare local auth data before exposing the server. The desktop app polls
// /health and may immediately submit the default admin login after it passes.
await seedAdmin()
await backfillApiKeys()

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log('[Server] Listening')
  if (serveStaticFiles) {
    console.log('[Server] Web UI available')
  } else {
    console.log('[Server] API endpoint available')
    console.log('[Server] Web package not built')
  }

  // Initialize cron scheduler
  initCronScheduler().catch((err) => {
    console.error('[Server] Failed to initialize cron scheduler')
  })

  // Initialize environment pool (if enabled)
  import('./cloudbase/env-lifecycle.js').then(({ initEnvLifecycle }) => {
    initEnvLifecycle().catch((err) => {
      console.error('[Server] Failed to initialize env lifecycle')
    })
  })
})

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  console.log('[Server] Received shutdown signal')
  stopAllCronJobs()
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

export default app
