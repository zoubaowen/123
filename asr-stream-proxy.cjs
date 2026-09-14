/**
 * Platform ASR WebSocket proxy for the renderer.
 * Node/Electron main can open wss:// reliably; renderer direct WS may fail in dev.
 */

function buildAsrStreamUrl(backendUrl, token) {
  const base = String(backendUrl || '').replace(/\/+$/, '')
  const wsProto = base.startsWith('https') ? 'wss' : 'ws'
  const host = base.replace(/^https?:\/\//, '')

  return `${wsProto}://${host}/api/asr/stream?token=${encodeURIComponent(token)}`
}

function createAsrStreamProxy({ url, onReady, onMessage, onError, onClose, connectTimeoutMs = 8000 }) {
  if (typeof globalThis.WebSocket !== 'function') {
    throw new Error('当前环境不支持 WebSocket')
  }

  const ws = new globalThis.WebSocket(url)
  let settled = false
  let connectTimer = null

  const finishError = message => {
    if (settled) {
      return
    }
    settled = true
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    onError(message)
    try {
      ws.close()
    } catch {
      // ignore
    }
  }

  connectTimer = setTimeout(() => {
    finishError('语音服务连接超时，请稍后重试')
  }, connectTimeoutMs)

  ws.addEventListener('message', event => {
    const payload = String(event.data || '')

    if (!settled) {
      try {
        const parsed = JSON.parse(payload)
        if (parsed && parsed.type === 'ready') {
          settled = true
          if (connectTimer) {
            clearTimeout(connectTimer)
            connectTimer = null
          }
          if (typeof onReady === 'function') {
            onReady()
          }
        } else if (parsed && parsed.type === 'error') {
          finishError(parsed.message || '语音识别失败')
          return
        }
      } catch {
        finishError('语音服务响应异常')
        return
      }
    }

    onMessage(payload)
  })

  ws.addEventListener('error', () => {
    finishError('语音服务连接失败，请稍后重试')
  })

  ws.addEventListener('close', event => {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    onClose(event && event.code ? event.code : 1006)
  })

  return {
    send(text) {
      if (ws.readyState === ws.OPEN) {
        ws.send(text)
      }
    },
    close() {
      if (ws.readyState === ws.OPEN) {
        ws.send('end')
        setTimeout(() => {
          if (ws.readyState !== ws.CLOSED && ws.readyState !== ws.CLOSING) {
            ws.close()
          }
        }, 5000)
      } else if (ws.readyState !== ws.CLOSED && ws.readyState !== ws.CLOSING) {
        ws.close()
      }
    }
  }
}

module.exports = {
  buildAsrStreamUrl,
  createAsrStreamProxy
}
