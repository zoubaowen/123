#!/usr/bin/env node

/**
 * Arduino CLI Downloader & Installer
 *
 * Downloads and installs the Arduino CLI binary to XIAOBAO_HOME/bin/
 * for use by the Electron app's Arduino compilation features.
 *
 * Usage: node scripts/setup-arduino-cli.mjs [version]
 */

import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { platform, arch, env } from 'node:process'
import { get } from 'node:https'
import { pipeline } from 'node:stream/promises'

const IS_WINDOWS = platform === 'win32'
const IS_MAC = platform === 'darwin'
const XIAOBAO_HOME = env.XIAOBAO_HOME || join(homedir(), '.ai-xiaobao')
const BIN_DIR = join(XIAOBAO_HOME, 'bin')
const DATA_DIR = join(XIAOBAO_HOME, 'arduino-data')

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

function getDownloadUrl(version) {
  const osMap = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }
  const osName = osMap[platform] || 'Linux'

  // arduino-cli binary name format
  const osSuffixMap = { Windows: 'Windows_64bit', macOS: 'macOS_64bit', Linux: 'Linux_64bit' }
  const osSuffix = osSuffixMap[osName]

  const base = `https://downloads.arduino.cc/arduino-cli`
  const ext = osName === 'Windows' ? '.zip' : '.tar.gz'

  return {
    url: `${base}/arduino-cli_${version}_${osSuffix}${ext}`,
    osName,
  }
}

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)
    log(`正在从 ${url} 下载...`, 'info')

    get(url, { timeout: 300000 }, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        const redirectUrl = response.headers.location
        log(`跟随重定向: ${redirectUrl}`, 'info')
        get(redirectUrl, { timeout: 300000 }, (redirectRes) => {
          pipeline(redirectRes, file)
            .then(() => resolve())
            .catch(reject)
        }).on('error', reject)
        return
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`))
        return
      }

      const total = parseInt(response.headers['content-length'] || '0', 10)
      let downloaded = 0
      let lastPercent = -1

      if (total > 0) {
        response.on('data', (chunk) => {
          downloaded += chunk.length
          const percent = Math.round((downloaded / total) * 100)
          if (percent > lastPercent) {
            lastPercent = percent
            process.stdout.write(`\r  下载进度: ${percent}%`)
          }
        })
      }

      pipeline(response, file)
        .then(() => {
          if (total > 0) process.stdout.write('\n')
          resolve()
        })
        .catch(reject)
    }).on('error', reject)
  })
}

async function extractArchive(archivePath, destDir, osName) {
  // Use platform-appropriate extraction
  if (osName === 'Windows') {
    // For .zip on Windows, use PowerShell Expand-Archive
    const { execSync } = await import('node:child_process')
    execSync(
      `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`,
      { stdio: 'pipe' },
    )
  } else {
    // For .tar.gz on macOS/Linux
    const { execSync } = await import('node:child_process')
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'pipe' })
  }
}

async function main() {
  const version = env.argv?.[2] || '1.3.0'

  console.log('')
  console.log(`${colors.bright}${colors.cyan}=== AI小宝学院 Arduino CLI 安装 ===${colors.reset}`)
  console.log('')

  log(`XIAOBAO_HOME: ${XIAOBAO_HOME}`)
  log(`目标版本: ${version}`)
  log(`安装目录: ${BIN_DIR}`)

  // Create directories
  if (!existsSync(XIAOBAO_HOME)) {
    mkdirSync(XIAOBAO_HOME, { recursive: true })
  }
  if (!existsSync(BIN_DIR)) {
    mkdirSync(BIN_DIR, { recursive: true })
    log('已创建 bin 目录', 'success')
  }
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
    log('已创建 arduino-data 目录', 'success')
  }

  // Check if already installed
  const binName = IS_WINDOWS ? 'arduino-cli.exe' : 'arduino-cli'
  const binPath = join(BIN_DIR, binName)

  if (existsSync(binPath)) {
    try {
      const { execSync } = await import('node:child_process')
      const out = execSync(`"${binPath}" version`, { encoding: 'utf8', stdio: 'pipe' })
      log(`Arduino CLI 已安装: ${out.trim()}`, 'success')
      log('如需更新，请删除 bin/arduino-cli 后重新运行此脚本', 'info')
      return
    } catch {
      log('现有二进制文件损坏，将重新下载', 'warn')
    }
  }

  const { url, osName } = getDownloadUrl(version)
  log(`平台: ${osName} (${platform}, ${arch})`, 'info')

  const tempDir = join(XIAOBAO_HOME, 'tmp')
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true })
  }

  const ext = osName === 'Windows' ? '.zip' : '.tar.gz'
  const archiveName = `arduino-cli-${version}${ext}`
  const archivePath = join(tempDir, archiveName)

  // Download
  try {
    await downloadFile(url, archivePath)
    log('下载完成', 'success')
  } catch (e) {
    log(`下载失败: ${e.message}`, 'error')
    log(`请手动下载: ${url}`, 'info')
    log(`解压 arduino-cli 到: ${BIN_DIR}`, 'info')
    return
  }

  // Extract
  try {
    log('正在解压...', 'step')
    await extractArchive(archivePath, BIN_DIR, osName)
    log('解压完成', 'success')
  } catch (e) {
    log(`解压失败: ${e.message}`, 'error')
    log(`请手动解压: ${archivePath}`, 'info')
    return
  }

  // Make executable on non-Windows
  if (!IS_WINDOWS) {
    try {
      chmodSync(binPath, 0o755)
    } catch { /* ignore on some FS */ }
  }

  // Verify installation
  try {
    const { execSync } = await import('node:child_process')
    const out = execSync(`"${binPath}" version`, { encoding: 'utf8', stdio: 'pipe' })
    log(`Arduino CLI 安装成功: ${out.trim()}`, 'success')
  } catch (e) {
    log(`安装验证失败: ${e.message}`, 'error')
    log(`请检查二进制文件: ${binPath}`, 'warn')
    return
  }

  // Initialize Arduino data directory
  log('正在初始化 Arduino CLI 配置...', 'step')
  try {
    const { execSync } = await import('node:child_process')
    execSync(`"${binPath}" config init --additional-urls https://downloads.arduino.cc/packages/package_index.json`, {
      env: { ...env, ARDUINO_DIRECTORIES_DATA: DATA_DIR },
      stdio: 'pipe',
      encoding: 'utf8',
    })
    execSync(`"${binPath}" core update-index`, {
      env: { ...env, ARDUINO_DIRECTORIES_DATA: DATA_DIR },
      stdio: 'pipe',
      encoding: 'utf8',
    })
    log('Arduino CLI 初始化完成', 'success')
  } catch (e) {
    log(`初始化失败: ${e.message}`, 'warn')
    log('首次使用时会自动完成初始化', 'info')
  }

  // Cleanup temp
  try {
    const { rmSync } = await import('node:fs')
    rmSync(tempDir, { recursive: true, force: true })
  } catch { /* ignore */ }

  console.log('')
  log('Arduino CLI 安装完成！', 'success')
  log(`二进制路径: ${binPath}`, 'info')
  log(`数据目录: ${DATA_DIR}`, 'info')
}

main().catch((err) => {
  console.error('')
  log(`安装失败: ${err.message}`, 'error')
  process.exit(1)
})
