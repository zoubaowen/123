'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')

const ROOT = path.join(__dirname, '..')

const crypto = require('node:crypto')

function getOrCreateSecret(keyName, envName, homeDir) {
  if (process.env[envName]) return process.env[envName]
  const configPath = path.join(homeDir, 'config.json')
  let config = {}
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch {}
  if (config[keyName]) return config[keyName]
  const secret = crypto.randomBytes(32).toString('hex')
  config[keyName] = secret
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    console.error('[DevRunner] Failed to persist config')
  }
  return secret
}

async function run() {
  console.log('[DevRunner] Starting development mode')

  const devHome = path.join(ROOT, '.xiaobao-dev')

  const serverProc = spawn('node', [path.join(ROOT, 'packages', 'server', 'dist', 'index.js')], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      DB_PROVIDER: 'drizzle',
      TCB_PROVISION_MODE: 'local',
      DATABASE_PATH: path.join(devHome, 'data', 'app.db'),
      ENCRYPTION_KEY: getOrCreateSecret('encryptionKey', 'ENCRYPTION_KEY', devHome),
      JWE_SECRET: getOrCreateSecret('jweSecret', 'JWE_SECRET', devHome),
      XIAOBAO_HOME: devHome,
      CENTRAL_AUTH_BASE_URL: process.env.CENTRAL_AUTH_BASE_URL || process.env.XIAOBAO_CLOUD_API_URL || '',
    },
    stdio: 'inherit',
    cwd: ROOT,
  })

  serverProc.on('error', () => {
    console.error('[DevRunner] Server process error')
  })

  process.on('SIGINT', () => {
    serverProc.kill()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    serverProc.kill()
    process.exit(0)
  })

  await new Promise((resolve) => setTimeout(resolve, 3000))
  console.log('[DevRunner] Server started, launching Electron')

  const electron = require('electron')
  const electronPath = typeof electron === 'string' ? electron : process.execPath

  const electronProc = spawn(electronPath, [path.join(__dirname, 'main.cjs'), '--dev'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      XIAOBAO_HOME: path.join(ROOT, '.xiaobao-dev'),
    },
    stdio: 'inherit',
    cwd: ROOT,
  })

  electronProc.on('close', () => {
    serverProc.kill()
    process.exit(0)
  })
}

run().catch(() => {
  console.error('[DevRunner] Error')
  process.exit(1)
})
