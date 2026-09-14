import { describe, expect, it } from 'vitest'
import { resolveRegisteredUserRole } from '../lib/user-role.js'

describe('resolveRegisteredUserRole', () => {
  it('does not promote the first registered user in production by default', () => {
    expect(resolveRegisteredUserRole(0, 'production')).toBe('user')
  })

  it('keeps the development first-user admin bootstrap', () => {
    expect(resolveRegisteredUserRole(0, 'development')).toBe('admin')
  })

  it('keeps later users as regular users', () => {
    expect(resolveRegisteredUserRole(3, 'development')).toBe('user')
    expect(resolveRegisteredUserRole(3, 'production')).toBe('user')
  })
})
