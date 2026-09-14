type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info'
const currentLevelValue = LOG_LEVELS[currentLevel] ?? LOG_LEVELS.info

function formatMessage(level: LogLevel, message: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase()}]`
  if (extra) {
    try {
      return `${prefix} ${message} ${JSON.stringify(extra)}`
    } catch {
      return `${prefix} ${message} [unserializable]`
    }
  }
  return `${prefix} ${message}`
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= currentLevelValue
}

export const logger = {
  debug(message: string, extra?: Record<string, unknown>) {
    if (shouldLog('debug')) console.debug(formatMessage('debug', message, extra))
  },
  info(message: string, extra?: Record<string, unknown>) {
    if (shouldLog('info')) console.info(formatMessage('info', message, extra))
  },
  warn(message: string, extra?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(formatMessage('warn', message, extra))
  },
  error(message: string, extra?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(formatMessage('error', message, extra))
  },
}
