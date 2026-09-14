export function resolveCorsOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  nodeEnv = process.env.NODE_ENV,
  serverPort = process.env.PORT,
): string {
  if (!origin || origin === 'null') return 'null'
  if (allowedOrigins.includes(origin)) return origin
  if (serverPort && isLoopbackOriginForPort(origin, serverPort)) return origin
  if (nodeEnv !== 'production' && origin.startsWith('http://localhost:')) return origin
  return 'null'
}

function isLoopbackOriginForPort(origin: string, serverPort: string): boolean {
  try {
    const url = new URL(origin)
    return (
      url.protocol === 'http:' &&
      url.port === serverPort &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}
