#!/usr/bin/env node

/**
 * Python Managed Virtual Environment Setup
 *
 * Creates a Python virtual environment at XIAOBAO_HOME/managed-venv/
 * for use by the Electron app's Python execution features.
 * Installs common educational packages (turtle, pygame, matplotlib, PIL, rich).
 *
 * Usage: node scripts/setup-python-venv.mjs
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { platform, env } from 'node:process'

const IS_WINDOWS = platform === 'win32'
const XIAOBAO_HOME = env.XIAOBAO_HOME || join(homedir(), '.ai-xiaobao')
const VENV_DIR = join(XIAOBAO_HOME, 'managed-venv')

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
}

function log(msg, type = 'info') {
  const prefix = {
    info: `${colors.cyan}→${colors.reset}`,
    success: `${colors.green}✓${colors.reset}`,
    error: `${colors.red}✗${colors.reset}`,
    warn: `${colors.yellow}!${colors.reset}`,
    step: `${colors.bright}▶${colors.reset}`,
  }[type]
  console.log(`${prefix} ${msg}`)
}

function findPython() {
  const candidates = IS_WINDOWS
    ? ['python', 'python3', 'py', 'py -3']
    : ['python3', 'python']

  for (const cmd of candidates) {
    try {
      const out = execSync(`"${cmd}" --version 2>&1 || ${cmd} --version 2>&1`, {
        encoding: 'utf8',
        stdio: 'pipe',
        shell: true,
      })
      const version = out.trim()
      log(`Found Python: ${version}`, 'success')
      return cmd
    } catch {
      continue
    }
  }
  return null
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: 'pipe' })
  } catch (e) {
    throw new Error(`${cmd}\n${e.stderr || e.stdout || e.message}`)
  }
}

function main() {
  console.log('')
  console.log(`${colors.bright}${colors.cyan}=== AI小宝学院 Python 环境配置 ===${colors.reset}`)
  console.log('')

  log(`XIAOBAO_HOME: ${XIAOBAO_HOME}`)
  log(`Venv 路径: ${VENV_DIR}`)

  if (!existsSync(XIAOBAO_HOME)) {
    mkdirSync(XIAOBAO_HOME, { recursive: true })
    log('已创建 XIAOBAO_HOME 目录', 'success')
  }

  // Check if venv already exists
  const pythonBin = IS_WINDOWS
    ? join(VENV_DIR, 'Scripts', 'python.exe')
    : join(VENV_DIR, 'bin', 'python')
  const pipBin = IS_WINDOWS
    ? join(VENV_DIR, 'Scripts', 'pip.exe')
    : join(VENV_DIR, 'bin', 'pip')

  if (existsSync(pythonBin)) {
    log('Python 虚拟环境已存在', 'success')
    try {
      const ver = execSync(`"${pythonBin}" --version`, { encoding: 'utf8', stdio: 'pipe' })
      log(`Python 版本: ${ver.trim()}`, 'info')
    } catch { /* ignore */ }

    // Show installed packages
    try {
      execSync(`"${pipBin}" list --format=columns`, { stdio: 'inherit' })
    } catch { /* ignore */ }

    log('如需重新创建，请删除目录后重新运行此脚本', 'info')
    log(`  rm -rf "${VENV_DIR}"`)
    return
  }

  // Find system Python
  const pythonCmd = findPython()
  if (!pythonCmd) {
    log('未找到 Python。请安装 Python 3.9+ 后重试', 'error')
    log('  https://www.python.org/downloads/', 'info')
    return
  }

  // Create virtual environment
  log('正在创建虚拟环境...', 'step')
  try {
    run(`"${pythonCmd}" -m venv "${VENV_DIR}"`)
    log('虚拟环境创建成功', 'success')
  } catch (e) {
    log(`创建虚拟环境失败: ${e.message}`, 'error')
    log('请确认 Python 版本 >= 3.9', 'info')
    return
  }

  // Upgrade pip
  log('正在升级 pip...')
  try {
    run(`"${pythonBin}" -m pip install --upgrade pip`)
    log('pip 升级成功', 'success')
  } catch (e) {
    log(`pip 升级失败: ${e.message}`, 'warn')
  }

  // Install core educational packages
  const packages = [
    'pygame',
    'matplotlib',
    'pillow',
    'numpy',
    'rich',
  ]

  log('正在安装核心 Python 库（pygame, matplotlib, pillow, numpy, rich）...', 'step')
  for (const pkg of packages) {
    try {
      run(`"${pipBin}" install ${pkg}`)
      log(`${pkg} 安装成功`, 'success')
    } catch (e) {
      log(`${pkg} 安装失败: ${e.message}`, 'warn')
    }
  }

  // Verify installation
  log('验证安装...')
  try {
    execSync(`"${pipBin}" list --format=columns`, { stdio: 'inherit' })
  } catch { /* ignore */ }

  console.log('')
  log('Python 环境配置完成！', 'success')
  log(`Venv 路径: ${VENV_DIR}`, 'info')
  log('Electron 应用启动时会自动使用此 Python 环境', 'info')
}

main()
