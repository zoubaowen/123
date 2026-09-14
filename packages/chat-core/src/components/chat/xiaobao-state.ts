import type { XiaoBaoState } from './xiaobao-types'

export type LoginFocus = 'username' | 'password' | 'phone' | 'code' | null

export interface LoginXiaoBaoStateInput {
  mode: 'login' | 'register'
  focus: LoginFocus
  loading: boolean
  success: boolean
  error: boolean
}

export function getLoginXiaoBaoState(input: LoginXiaoBaoStateInput): XiaoBaoState {
  if (input.success) return { outfit: 'academy', mood: 'excited', action: 'celebrate' }
  if (input.loading) return { outfit: 'academy', mood: 'working', action: 'write' }
  if (input.error) return { outfit: 'academy', mood: 'comforting', action: 'wave' }
  if (input.focus === 'password') return { outfit: 'academy', mood: 'thinking', action: 'cover-eyes' }
  if (input.focus) return { outfit: 'academy', mood: 'happy', action: 'look-left' }
  if (input.mode === 'register') return { outfit: 'academy', mood: 'excited', action: 'wave' }
  return { outfit: 'academy', mood: 'happy', action: 'breathe' }
}
