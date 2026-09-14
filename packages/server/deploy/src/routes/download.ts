import { Hono } from 'hono'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { basename, join, resolve } from 'path'
import type { AppEnv } from '../middleware/auth'

const app = new Hono<AppEnv>()

app.get('/win', async (c) => {
  const configuredPath = process.env.DOWNLOAD_WINDOWS_PATH
  const exePath = configuredPath
    ? resolve(configuredPath)
    : join(process.cwd(), 'public', 'downloads', 'AI-XiaoBao-Academy-Setup.exe')
  const altPath = join(process.cwd(), '..', 'release-slim-check', 'AI-XiaoBao-Academy-1.0.0-x64.exe')

  const filePath = existsSync(exePath) ? exePath : existsSync(altPath) ? altPath : null

  if (!filePath) {
    return c.json({ error: 'Windows installer is not available' }, 404)
  }

  try {
    const fileStat = await stat(filePath)
    const fileBuffer = await readFile(filePath)
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${basename(filePath)}"`,
        'Content-Length': String(fileStat.size),
      },
    })
  } catch {
    return c.json({ error: 'Failed to read installer' }, 500)
  }
})

app.get('/mac', async (c) => {
  return c.json({ error: 'macOS installer is not available' }, 404)
})

app.get('/latest', async (c) => {
  const packageJson = await import('../../package.json')
  return c.json({
    version: packageJson.version,
    windows: '/api/download/win',
    mac: '/api/download/mac',
  })
})

export default app
