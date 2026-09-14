'use strict'

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('xiaobao', {
  platform: process.platform,

  async getPythonPath() {
    return ipcRenderer.invoke('get-python-path')
  },

  async execPython(scriptPath, args = []) {
    return ipcRenderer.invoke('exec-python', scriptPath, args)
  },

  async execPipInstall(pkgName) {
    return ipcRenderer.invoke('exec-pip-install', pkgName)
  },

  async getArduinoCliPath() {
    return ipcRenderer.invoke('get-arduino-cli-path')
  },

  async execArduino(args = []) {
    return ipcRenderer.invoke('exec-arduino', args)
  },

  async takeScreenshot() {
    return ipcRenderer.invoke('take-screenshot')
  },

  async showOpenDialog(options) {
    return ipcRenderer.invoke('show-open-dialog', options)
  },

  getHermesHome() {
    return ipcRenderer.invoke('get-hermes-home')
  },

  getAppVersion() {
    return ipcRenderer.invoke('get-app-version')
  },

  shellOpenExternal(url) {
    return ipcRenderer.invoke('shell-open-external', url)
  },

  setAutoStart(enabled) {
    return ipcRenderer.invoke('set-auto-start', enabled)
  },

  async exportSessions() {
    return ipcRenderer.invoke('export-sessions')
  },

  async importSessions() {
    return ipcRenderer.invoke('import-sessions')
  },

  onUpdateAvailable(callback) {
    ipcRenderer.on('update-available', () => callback())
  },

  onUpdateDownloaded(callback) {
    ipcRenderer.on('update-downloaded', () => callback())
  },

  downloadUpdate() {
    return ipcRenderer.invoke('download-update')
  },

  installUpdate() {
    return ipcRenderer.invoke('install-update')
  },
})
