const DEVELOPMENT_ADMIN_PASSWORD = 'Admin123'

function isStrongPassword(password: string): boolean {
  return password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password)
}

export function getInitialAdminPassword(): string | undefined {
  const configured = process.env.INITIAL_ADMIN_PASSWORD
  if (configured) {
    if (!isStrongPassword(configured)) {
      throw new Error(
        'INITIAL_ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, and numbers',
      )
    }
    return configured
  }

  if (process.env.NODE_ENV === 'production') {
    return undefined
  }

  return DEVELOPMENT_ADMIN_PASSWORD
}
