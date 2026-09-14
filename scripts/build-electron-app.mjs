import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const cacheDir = path.join(repoRoot, '.electron-builder-cache')
const builderBin = path.join(
  repoRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.CMD' : 'electron-builder',
)

await mkdir(cacheDir, { recursive: true })

const args = process.argv.slice(2)
const command = process.platform === 'win32' ? 'cmd.exe' : builderBin
const commandArgs = process.platform === 'win32' ? ['/d', '/c', builderBin, ...args] : args

const child = spawn(command, commandArgs, {
  cwd: repoRoot,
  env: {
    ...process.env,
    ELECTRON_BUILDER_CACHE: cacheDir,
  },
  stdio: 'inherit',
})

child.on('error', () => {
  console.error('[build-electron-app] Failed to start builder')
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
