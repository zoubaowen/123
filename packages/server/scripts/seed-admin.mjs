#!/usr/bin/env node
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin'
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'Admin123'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@xiaobao.com'

function getDbPaths() {
  const paths = []
  if (process.env.DATABASE_PATH) paths.push(process.env.DATABASE_PATH)
  if (process.env.XIAOBAO_HOME) paths.push(path.join(process.env.XIAOBAO_HOME, 'data', 'app.db'))
  paths.push(path.join(process.cwd(), 'data', 'app.db'))
  return [...new Set(paths)]
}

async function seedDb(dbPath) {
  const dir = path.dirname(dbPath)
  fs.mkdirSync(dir, { recursive: true })
  const db = new Database(dbPath)

  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL, external_id TEXT NOT NULL,
    access_token TEXT NOT NULL DEFAULT '', refresh_token TEXT, scope TEXT,
    username TEXT NOT NULL, email TEXT, name TEXT, avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
    disabled_reason TEXT, disabled_at INTEGER, disabled_by TEXT,
    api_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL DEFAULT 0
  )`)

  db.exec(`CREATE TABLE IF NOT EXISTS local_credentials (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(ADMIN_USER)
  if (existing) {
    console.log(`  [${dbPath}] Admin exists: ${existing.username} (role: ${existing.role})`)
    if (existing.role !== 'admin' || existing.external_id !== ADMIN_USER) {
      db.prepare('UPDATE users SET role = ?, external_id = ?, updated_at = ? WHERE id = ?')
        .run('admin', ADMIN_USER, Date.now(), existing.id)
      console.log(`  -> Fixed: role=admin, external_id=${ADMIN_USER}`)
    }
  } else {
    const userId = crypto.randomUUID()
    const hashed = await bcrypt.hash(ADMIN_PASS, 12)
    const ts = Date.now()
    db.prepare(`INSERT INTO users (id, provider, external_id, username, email, role, status, created_at, updated_at, last_login_at)
      VALUES (?, 'local', ?, ?, ?, 'admin', 'active', ?, ?, ?)`)
      .run(userId, ADMIN_USER, ADMIN_USER, ADMIN_EMAIL, ts, ts, 0)
    db.prepare(`INSERT INTO local_credentials (user_id, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)`)
      .run(userId, hashed, ts, ts)
    console.log(`  [${dbPath}] Admin created`)
  }
  db.close()
}

async function main() {
  const paths = getDbPaths()
  console.log('Seeding admin account...')
  for (const dbPath of paths) {
    await seedDb(dbPath)
  }
  console.log(`\n  Username: ${ADMIN_USER}`)
  console.log(`  Password: ${ADMIN_PASS}`)
}

main().catch(console.error)
