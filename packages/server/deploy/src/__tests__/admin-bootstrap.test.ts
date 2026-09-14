import { afterEach, describe, expect, it } from 'vitest'
import { getInitialAdminPassword } from '../lib/admin-bootstrap.js'

const OLD_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('getInitialAdminPassword', () => {
  it('does not create a default admin password in production', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.INITIAL_ADMIN_PASSWORD

    expect(getInitialAdminPassword()).toBeUndefined()
  })

  it('keeps the local development bootstrap password outside production', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.INITIAL_ADMIN_PASSWORD

    expect(getInitialAdminPassword()).toBe('Admin123')
  })

  it('rejects weak configured production passwords', () => {
    process.env.NODE_ENV = 'production'
    process.env.INITIAL_ADMIN_PASSWORD = 'weak'

    expect(() => getInitialAdminPassword()).toThrow(/INITIAL_ADMIN_PASSWORD/)
  })

  it('uses a strong configured production password', () => {
    process.env.NODE_ENV = 'production'
    process.env.INITIAL_ADMIN_PASSWORD = 'StrongAdmin123'

    expect(getInitialAdminPassword()).toBe('StrongAdmin123')
  })
})
