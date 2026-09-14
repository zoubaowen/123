import { describe, expect, it } from 'vitest'
import { getRegistrationTarget, resolveInitialLoginMode } from './local-auth-navigation'

describe('local auth navigation', () => {
  it('routes legacy registration forms to the canonical registration page', () => {
    expect(getRegistrationTarget('register')).toBe('/#/login?mode=register')
    expect(getRegistrationTarget('login')).toBeNull()
  })

  it('opens the login page directly in registration mode when requested', () => {
    expect(resolveInitialLoginMode('?mode=register')).toBe('register')
    expect(resolveInitialLoginMode('', '#/login?mode=register')).toBe('register')
    expect(resolveInitialLoginMode('')).toBe('login')
  })
})
