export type UserRole = 'admin' | 'user'

export function resolveRegisteredUserRole(userCount: number, nodeEnv = process.env.NODE_ENV): UserRole {
  if (userCount === 0 && nodeEnv !== 'production') {
    return 'admin'
  }
  return 'user'
}
