import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const deployRoot = path.join(repoRoot, 'packages', 'server', 'deploy')
const tsupBin = path.join(
  repoRoot,
  'packages',
  'server',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsup.CMD' : 'tsup',
)

const builds = [
  ['src/sandbox/tool-override.ts', '--format', 'cjs', '--outDir', 'dist/sandbox', '--no-splitting'],
  ['src/util/skill-loader-override.ts', '--format', 'cjs', '--outDir', 'dist/util', '--no-splitting'],
  ['src/index.ts', '--format', 'esm', '--target', 'node22'],
]

function run(args) {
  return new Promise((resolve, reject) => {
    const command = process.platform === 'win32' ? 'cmd.exe' : tsupBin
    const commandArgs = process.platform === 'win32' ? ['/d', '/c', tsupBin, ...args] : args
    const child = spawn(command, commandArgs, {
      cwd: deployRoot,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('electron server build failed'))
      }
    })
  })
}

for (const args of builds) {
  await run(args)
}

console.log('[build-electron-server] Built server resources')
