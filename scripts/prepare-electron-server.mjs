import { cp, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const repoRoot = path.resolve(path.dirname(__filename), '..')
const serverDist = path.join(repoRoot, 'packages', 'server', 'dist')
const deployRoot = path.join(repoRoot, 'packages', 'server', 'deploy')
const preparedRoot = path.join(repoRoot, '.electron', 'server-packaged')
const nativeSqlite = path.join(preparedRoot, 'node_modules', 'better-sqlite3')
const opencodeCli = path.join(repoRoot, 'node_modules', 'opencode-ai')
const opencodeConfig = path.join(repoRoot, '.opencode')

async function copyDirectory(source, target) {
  await cp(source, target, { recursive: true, dereference: true })
}

async function writePreparedPackageJson() {
  const source = path.join(deployRoot, 'package.json')
  const target = path.join(preparedRoot, 'package.json')
  const rootPkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf-8'))
  const pkg = JSON.parse(await readFile(source, 'utf-8'))
  if (pkg.dependencies?.['@ai-xiaobao/shared']) {
    pkg.dependencies['@ai-xiaobao/shared'] = 'file:../../packages/shared'
  }
  if (rootPkg.pnpm) {
    pkg.pnpm = JSON.parse(JSON.stringify(rootPkg.pnpm))
    if (pkg.pnpm.patchedDependencies) {
      for (const [name, patchPath] of Object.entries(pkg.pnpm.patchedDependencies)) {
        pkg.pnpm.patchedDependencies[name] = `../../${patchPath}`
      }
    }
  }
  await writeFile(target, `${JSON.stringify(pkg, null, 2)}\n`, 'utf-8')
}

function runPnpmInstall() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, CI: 'true' }
    delete env.npm_config_dir
    delete env.NPM_CONFIG_DIR
    const command =
      process.platform === 'win32'
        ? 'pnpm.cmd install --prod --config.node-linker=hoisted --ignore-workspace --no-frozen-lockfile'
        : 'pnpm install --prod --config.node-linker=hoisted --ignore-workspace --no-frozen-lockfile'
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/c', command], {
            cwd: preparedRoot,
            env,
            stdio: 'inherit',
          })
        : spawn('sh', ['-c', command], {
            cwd: preparedRoot,
            env,
            stdio: 'inherit',
          })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error('pnpm install failed'))
      }
    })
  })
}

async function assertRealDirectory(dir) {
  const stat = await lstat(dir)
  if (stat.isSymbolicLink()) {
    throw new Error('Prepared electron server contains symlinks')
  }
}

async function resetPreparedRoot() {
  try {
    await rm(preparedRoot, { recursive: true, force: true })
    return
  } catch {
    console.warn('[prepare-electron-server] Clean failed, archiving target')
  }

  const archivedRoot = path.join(repoRoot, '.electron', `server-packaged-stale-${Date.now()}`)
  try {
    await rename(preparedRoot, archivedRoot)
  } catch {
    throw new Error('Unable to reset prepared electron server')
  }
}

async function main() {
  if (!existsSync(serverDist)) {
    throw new Error('Server dist is missing. Run pnpm build:server first.')
  }

  console.log('[prepare-electron-server] Cleaning target')
  await resetPreparedRoot()
  console.log('[prepare-electron-server] Creating target')
  await mkdir(preparedRoot, { recursive: true })
  console.log('[prepare-electron-server] Writing package manifest')
  await writePreparedPackageJson()
  console.log('[prepare-electron-server] Copying server dist')
  await copyDirectory(serverDist, path.join(preparedRoot, 'dist'))
  console.log('[prepare-electron-server] Copying deploy source')
  await copyDirectory(path.join(deployRoot, 'src'), path.join(preparedRoot, 'src'))
  console.log('[prepare-electron-server] Copying deploy scripts')
  await copyDirectory(path.join(deployRoot, 'scripts'), path.join(preparedRoot, 'scripts'))

  console.log('[prepare-electron-server] Installing dependencies')
  await runPnpmInstall()

  console.log('[prepare-electron-server] Checking native sqlite')
  if (!existsSync(nativeSqlite)) {
    throw new Error('Prepared electron server is missing better-sqlite3.')
  }

  console.log('[prepare-electron-server] Checking directory layout')
  await assertRealDirectory(nativeSqlite)

  if (existsSync(opencodeCli)) {
    console.log('[prepare-electron-server] Bundling opencode CLI')
    await copyDirectory(opencodeCli, path.join(preparedRoot, 'node_modules', 'opencode-ai'))
  } else {
    throw new Error('Prepared electron server is missing opencode-ai CLI.')
  }

  if (existsSync(opencodeConfig)) {
    console.log('[prepare-electron-server] Bundling opencode config')
    await copyDirectory(opencodeConfig, path.join(preparedRoot, '.opencode'))
  }

  console.log('[prepare-electron-server] Prepared server resources')
}

main().catch(() => {
  console.error('[prepare-electron-server] Failed')
  process.exitCode = 1
})
