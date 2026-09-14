'use strict'

const { app, BrowserWindow, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourceSvg = path.join(root, 'resources', 'icons', 'icon.svg')
const pngPath = path.join(root, 'resources', 'icons', 'icon.png')
const icoPath = path.join(root, 'resources', 'icons', 'icon.ico')

function makePngIco(png) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry.writeUInt8(0, 0)
  entry.writeUInt8(0, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  return Buffer.concat([header, entry, png])
}

async function captureIconPng() {
  const svg = fs.readFileSync(sourceSvg, 'utf-8')
  const win = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
    },
  })

  const html = [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<style>html,body{width:512px;height:512px;margin:0;background:transparent;overflow:hidden}svg{display:block;width:512px;height:512px}</style>',
    '</head><body>',
    svg,
    '</body></html>',
  ].join('')

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolve) => setTimeout(resolve, 250))
  const image = await win.webContents.capturePage()
  win.destroy()
  return image.toPNG()
}

app
  .whenReady()
  .then(async () => {
    const png = await captureIconPng()
    const image = nativeImage.createFromBuffer(png)
    if (image.isEmpty()) {
      throw new Error('icon capture failed')
    }
    fs.writeFileSync(pngPath, png)
    fs.writeFileSync(icoPath, makePngIco(image.resize({ width: 256, height: 256, quality: 'best' }).toPNG()))
    console.log('[icons] Desktop icons exported')
  })
  .catch(() => {
    console.error('[icons] Failed to export desktop icons')
    process.exitCode = 1
  })
  .finally(() => {
    app.quit()
  })
