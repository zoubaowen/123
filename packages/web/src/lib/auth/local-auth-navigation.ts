export type LocalAuthMode = 'login' | 'register'

export function getRegistrationTarget(mode: LocalAuthMode): string | null {
  return mode === 'register' ? '/#/login?mode=register' : null
}

export function resolveInitialLoginMode(search: string, hash = ''): LocalAuthMode {
  const hashSearch = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
  return new URLSearchParams(search || hashSearch).get('mode') === 'register' ? 'register' : 'login'
}
