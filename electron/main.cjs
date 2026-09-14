'use strict'

const { app, BrowserWindow, screen, ipcMain, dialog, globalShortcut, shell, nativeTheme, systemPreferences, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const http = require('node:http')
const { spawn } = require('node:child_process')
const { autoUpdater } = require('electron-updater')

const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('--dev')
let mainWindow = null
let serverProcess = null

function getAppResourcesDir() {
  return isDev ? path.join(__dirname, '..') : path.join(process.resourcesPath, '..')
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    console.error('[Main] Failed to read desktop config')
    return {}
  }
}

function getDesktopConfig() {
  const candidates = [
    process.env.XIAOBAO_DESKTOP_CONFIG,
    path.join(getAppResourcesDir(), 'resources', 'desktop-config.local.json'),
    path.join(getAppResourcesDir(), 'resources', 'desktop-config.json'),
    path.join(process.resourcesPath || '', 'resources', 'desktop-config.local.json'),
    path.join(process.resourcesPath || '', 'resources', 'desktop-config.json'),
    path.join(__dirname, '..', 'resources', 'desktop-config.local.json'),
    path.join(__dirname, '..', 'resources', 'desktop-config.json'),
  ].filter(Boolean)

  for (const filePath of candidates) {
    const config = readJsonFile(filePath)
    if (Object.keys(config).length > 0) return config
  }
  return {}
}

function getConfiguredCloudAuthUrl(config) {
  return (
    process.env.CENTRAL_AUTH_BASE_URL ||
    process.env.XIAOBAO_CLOUD_API_URL ||
    config.centralAuthBaseUrl ||
    config.xiaobaoCloudApiUrl ||
    ''
  )
}

function getConfiguredAccountSyncSecret(config) {
  return process.env.CENTRAL_ACCOUNT_SYNC_SECRET || config.centralAccountSyncSecret || ''
}

function getHermesHome() {
  const home = process.env.XIAOBAO_HOME || path.join(app.getPath('userData'), 'ai-xiaobao')
  if (!fs.existsSync(home)) {
    fs.mkdirSync(home, { recursive: true })
  }
  return home
}

function getServerLogFiles() {
  const logDir = path.join(getHermesHome(), 'logs')
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true })
  }
  return {
    stdout: path.join(logDir, 'server.out.log'),
    stderr: path.join(logDir, 'server.err.log'),
  }
}

function getOrCreateSecret(keyName, envName) {
  if (process.env[envName]) return process.env[envName]
  const configPath = path.join(getHermesHome(), 'config.json')
  let config = {}
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    }
  } catch {}
  if (config[keyName]) return config[keyName]
  const secret = require('crypto').randomBytes(32).toString('hex')
  config[keyName] = secret
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
  } catch {
    console.error('[Main] Failed to persist config')
  }
  return secret
}

function getVibePythonPath() {
  const platform = process.platform
  const home = getHermesHome()
  const venvRoot = path.join(home, 'managed-venv')

  if (platform === 'win32') {
    const candidates = [
      process.env.VIBE_STUDENT_PYTHON,
      path.join(venvRoot, 'Scripts', 'python.exe'),
    ]
    for (const c of candidates) {
      if (c && fs.existsSync(c)) return c
    }
    return 'python'
  }

  const candidates = [
    process.env.VIBE_STUDENT_PYTHON,
    path.join(venvRoot, 'bin', 'python'),
    path.join(venvRoot, 'bin', 'python3'),
  ]
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c
  }
  return 'python3'
}

function waitForServer(port, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now()
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
          return
        }
        scheduleRetry()
      })
      req.on('error', () => scheduleRetry())
      req.setTimeout(2000, () => { req.destroy(); scheduleRetry() })
    }
    const scheduleRetry = () => {
      if (Date.now() - start >= timeoutMs) {
        resolve(false)
        return
      }
      setTimeout(check, 500)
    }
    check()
  })
}

function startServer() {
  return new Promise((resolve) => {
    // Auto-detect server dist: workspace dev path first, then packaged prod path
    const devDist = path.join(__dirname, '..', 'packages', 'server', 'dist', 'index.js')
    const prodDist = path.join(process.resourcesPath || '', 'server', 'dist', 'index.js')
    const serverDist = fs.existsSync(devDist) ? devDist : prodDist
    if (!fs.existsSync(serverDist)) {
      console.log('[Main] Server dist not found, starting without backend')
      resolve(false)
      return
    }

    const desktopConfig = getDesktopConfig()
    const env = {
      ...process.env,
      PORT: '3001',
      NODE_ENV: 'desktop',
      DB_PROVIDER: 'drizzle',
      TCB_PROVISION_MODE: 'local',
      DATABASE_PATH: path.join(getHermesHome(), 'data', 'app.db'),
      XIAOBAO_HOME: getHermesHome(),
      XIAOBAO_PYTHON: getVibePythonPath(),
      JWE_SECRET: getOrCreateSecret('jweSecret', 'JWE_SECRET'),
      ENCRYPTION_KEY: getOrCreateSecret('encryptionKey', 'ENCRYPTION_KEY'),
      CENTRAL_AUTH_BASE_URL: getConfiguredCloudAuthUrl(desktopConfig),
      CENTRAL_ACCOUNT_SYNC_SECRET: getConfiguredAccountSyncSecret(desktopConfig),
      DESKTOP_AUTH_MODE: process.env.DESKTOP_AUTH_MODE || desktopConfig.desktopAuthMode || 'cloud',
      NODE_PATH: path.join(path.dirname(path.dirname(serverDist)), 'node_modules'),
      // AI 模型 API Keys
      DEEPSEEK_API_KEY: desktopConfig.deepseekApiKey || 'sk-e0e45447d20946f193d6d021c057127c',
      OPENAI_API_KEY: desktopConfig.openaiApiKey || '',
      CODEBUDDY_API_KEY: desktopConfig.codebuddyApiKey || '',
    }
    // 确保 server 子进程能扫到 opencode CLI（bundled 于 resources/server/node_modules/opencode-ai）
    const serverNodeModulesBin = path.join(path.dirname(path.dirname(serverDist)), 'node_modules', '.bin')
    const opencodeBinDir = path.join(path.dirname(path.dirname(serverDist)), 'node_modules', 'opencode-ai', 'bin')
    const extraPath = [serverNodeModulesBin, opencodeBinDir]
      .filter((dir) => fs.existsSync(dir))
      .join(path.delimiter)
    if (extraPath) {
      env.PATH = extraPath + path.delimiter + (env.PATH || '')
    }
    Object.assign(process.env, env)

    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const logFiles = getServerLogFiles()
    const stdoutFd = fs.openSync(logFiles.stdout, 'a')
    const stderrFd = fs.openSync(logFiles.stderr, 'a')

    serverProcess = spawn(process.execPath, [serverDist], {
      cwd: path.dirname(path.dirname(serverDist)),
      env: {
        ...env,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['ignore', stdoutFd, stderrFd],
      windowsHide: true,
    })

    serverProcess.on('error', () => {
      console.error('[Server] Failed to start')
      finish(false)
    })
    serverProcess.on('exit', () => {
      serverProcess = null
    })

    waitForServer(3001, 60000).then(finish)
  })
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: Math.min(1400, width),
    height: Math.min(900, height),
    minWidth: 800,
    minHeight: 600,
    title: 'AI小宝学院',
    icon: path.join(__dirname, '..', 'resources', 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    show: false,
  })
  mainWindow.setMenuBarVisibility(false)

  if (isDev) {
    mainWindow.loadURL('http://localhost:5174')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
    mainWindow.once('ready-to-show', () => {
      mainWindow.show()
    })
  } else {
    const loadFromServer = (retriesLeft) => {
      mainWindow.loadURL('http://localhost:3001').catch(() => {
        if (retriesLeft > 0) {
          setTimeout(() => loadFromServer(retriesLeft - 1), 1000)
        } else {
          const errHtml = [
            '<html><body style="background:#0a0a0a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:sans-serif">',
            '<div style="text-align:center"><h2 style="color:#f87171">无法连接到本地服务</h2>',
            '<p>请重试或联系技术支持</p></div></body></html>',
          ].join('')
          mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errHtml)}`)
        }
      })
    }
    loadFromServer(60)
    mainWindow.show()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  nativeTheme.themeSource = 'dark'
}

function setupIpcHandlers() {
  ipcMain.handle('download-update', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch {
      return { success: false, error: 'Update download failed' }
    }
  })

  ipcMain.handle('install-update', () => {
    autoUpdater.quitAndInstall()
  })


  ipcMain.handle('get-python-path', () => getVibePythonPath())

  ipcMain.handle('exec-python', async (_event, scriptPath, args = []) => {
    const { spawn } = require('node:child_process')
    const pyPath = getVibePythonPath()
    return new Promise((resolve) => {
      const child = spawn(pyPath, [scriptPath, ...args], {
        cwd: path.dirname(scriptPath),
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code })
      })
    })
  })

  ipcMain.handle('exec-pip-install', async (_event, pkgName) => {
    const { spawn } = require('node:child_process')
    const safePkgName = String(pkgName || '').trim()
    if (!/^[a-zA-Z0-9._-]+([<>=!~]=?[a-zA-Z0-9.*+!._-]+)?$/.test(safePkgName)) {
      return { success: false, error: 'Invalid package name' }
    }
    return new Promise((resolve) => {
      const pyPath = getVibePythonPath()
      const child = spawn(pyPath, ['-m', 'pip', 'install', safePkgName], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })
      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill()
      }, 120000)
      child.stdout.on('data', (d) => {
        stdout += d.toString()
      })
      child.stderr.on('data', (d) => {
        stderr += d.toString()
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolve(code === 0 ? { success: true, output: stdout } : { success: false, error: stderr || 'Install failed' })
      })
      child.on('error', () => {
        clearTimeout(timeout)
        resolve({ success: false, error: 'Install failed' })
      })
    })
  })

  ipcMain.handle('get-arduino-cli-path', () => {
    const home = getHermesHome()
    const platform = process.platform
    const binName = platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli'
    const cliPath = path.join(home, 'bin', binName)
    return fs.existsSync(cliPath) ? cliPath : null
  })

  ipcMain.handle('exec-arduino', async (_event, args = []) => {
    const { spawn } = require('node:child_process')
    const cliPath = await ipcMain.emit('get-arduino-cli-path')
    if (!cliPath) return { error: 'Arduino CLI not installed' }
    const home = getHermesHome()
    const dataDir = path.join(home, 'arduino-data')

    return new Promise((resolve) => {
      const child = spawn(cliPath, args, {
        env: { ...process.env, ARDUINO_DIRECTORIES_DATA: dataDir },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code })
      })
    })
  })

  ipcMain.handle('take-screenshot', async () => {
    if (!mainWindow) return null
    const image = await mainWindow.webContents.capturePage()
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '保存截图',
      defaultPath: `screenshot-${Date.now()}.png`,
      filters: [{ name: 'PNG Image', extensions: ['png'] }],
    })
    if (filePath) {
      fs.writeFileSync(filePath, image.toPNG())
      return filePath
    }
    return null
  })

  ipcMain.handle('show-open-dialog', async (_event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options)
    return result
  })

  ipcMain.handle('get-hermes-home', () => getHermesHome())

  ipcMain.handle('get-app-version', () => app.getVersion())

  ipcMain.handle('shell-open-external', (_event, url) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('set-auto-start', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
  })

  ipcMain.handle('get-platform', () => process.platform)

  ipcMain.handle('export-sessions', async () => {
    const { filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出会话数据',
      defaultPath: `xiaobao-sessions-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (filePath) {
      const home = getHermesHome()
      const sessionsDir = path.join(home, 'sessions')
      const sessions = []
      if (fs.existsSync(sessionsDir)) {
        for (const file of fs.readdirSync(sessionsDir)) {
          if (file.endsWith('.json')) {
            sessions.push(JSON.parse(fs.readFileSync(path.join(sessionsDir, file), 'utf8')))
          }
        }
      }
      fs.writeFileSync(filePath, JSON.stringify(sessions, null, 2), 'utf8')
      return filePath
    }
    return null
  })

  ipcMain.handle('import-sessions', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '导入会话数据',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (filePaths && filePaths.length > 0) {
      const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'))
      const home = getHermesHome()
      const sessionsDir = path.join(home, 'sessions')
      if (!fs.existsSync(sessionsDir)) {
        fs.mkdirSync(sessionsDir, { recursive: true })
      }
      let count = 0
      for (const session of data) {
        if (session.id) {
          fs.writeFileSync(path.join(sessionsDir, `${session.id}.json`), JSON.stringify(session, null, 2), 'utf8')
          count++
        }
      }
      return { count }
    }
    return { count: 0 }
  })
}

function setupAutoUpdater() {
  if (isDev) return
  autoUpdater.autoDownload = false
  autoUpdater.on('update-available', () => {
    mainWindow?.webContents.send('update-available')
  })
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-downloaded')
  })
  autoUpdater.checkForUpdates().catch(() => {})
}

async function main() {
  Menu.setApplicationMenu(null)
  await startServer()
  createWindow()
  setupIpcHandlers()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('before-quit', () => {
    if (serverProcess) {
      serverProcess.kill()
      serverProcess = null
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

app.whenReady().then(main)
