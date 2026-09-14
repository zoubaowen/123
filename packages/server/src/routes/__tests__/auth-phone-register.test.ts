import { beforeEach, describe, expect, it, vi } from 'vitest'

process.env.NODE_ENV = 'development'
process.env.DESKTOP_AUTH_MODE = 'local'
process.env.TCB_PROVISION_MODE = 'local'
process.env.JWE_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
process.env.ENCRYPTION_KEY = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
process.env.CREDITS_SIGNUP_BONUS = '20'

type UserRow = {
  id: string
  provider: string
  externalId: string
  accessToken: string
  username: string
  role: 'user' | 'admin'
  status: string
  phone?: string | null
  phoneVerified?: boolean | null
  apiKey?: string | null
  createdAt: number
  updatedAt: number
  lastLoginAt: number
}

type SmsRow = {
  id: string
  phone: string
  code: string
  expiresAt: number
  used: boolean
}

const users = new Map<string, UserRow>()
const smsCodes: SmsRow[] = []
const credentials = new Map<string, { userId: string; passwordHash: string; createdAt: number; updatedAt: number }>()
const credits = new Map<
  string,
  { userId: string; balance: number; frozenBalance: number; lifetimeBalance: number; updatedAt: number }
>()
const transactions: Array<{
  id: string
  userId: string
  type: string
  amount: number
  balanceAfter: number
  description: string
  metadata: string | null
  createdAt: number
}> = []

const mockDb = {
  users: {
    async findById(id: string) {
      return users.get(id) ?? null
    },
    async findByProviderAndExternalId(provider: string, externalId: string) {
      return [...users.values()].find((user) => user.provider === provider && user.externalId === externalId) ?? null
    },
    async findByPhone(phone: string) {
      return [...users.values()].find((user) => user.phone === phone) ?? null
    },
    async create(user: UserRow) {
      const now = Date.now()
      const row = { createdAt: now, updatedAt: now, lastLoginAt: now, ...user }
      users.set(row.id, row)
      return row
    },
    async update(id: string, data: Partial<UserRow>) {
      const existing = users.get(id)
      if (!existing) return null
      const row = { ...existing, ...data, updatedAt: data.updatedAt ?? Date.now() }
      users.set(id, row)
      return row
    },
    async deleteById(id: string) {
      users.delete(id)
    },
    async count() {
      return users.size
    },
  },
  localCredentials: {
    async findByUserId(userId: string) {
      return credentials.get(userId) ?? null
    },
    async create(credential: { userId: string; passwordHash: string; createdAt?: number; updatedAt?: number }) {
      const now = Date.now()
      const row = {
        ...credential,
        createdAt: credential.createdAt ?? now,
        updatedAt: credential.updatedAt ?? now,
      }
      credentials.set(row.userId, row)
      return row
    },
    async update(userId: string, data: { passwordHash?: string; updatedAt?: number }) {
      const existing = credentials.get(userId)
      if (!existing) return null
      const row = { ...existing, ...data, updatedAt: data.updatedAt ?? Date.now() }
      credentials.set(userId, row)
      return row
    },
  },
  smsCodes: {
    async create(row: SmsRow) {
      smsCodes.push(row)
      return row
    },
    async findByPhoneAndCode(phone: string, code: string) {
      return smsCodes.filter((row) => row.phone === phone && row.code === code).at(-1) ?? null
    },
    async markUsed(id: string) {
      const row = smsCodes.find((item) => item.id === id)
      if (row) row.used = true
    },
  },
  userCredits: {
    async getOrCreate(userId: string) {
      let row = credits.get(userId)
      if (!row) {
        row = { userId, balance: 0, frozenBalance: 0, lifetimeBalance: 0, updatedAt: Date.now() }
        credits.set(userId, row)
      }
      return row
    },
    async updateByUserId(
      userId: string,
      data: Partial<{ balance: number; frozenBalance: number; lifetimeBalance: number; updatedAt: number }>,
    ) {
      const existing = await this.getOrCreate(userId)
      const row = { ...existing, ...data }
      credits.set(userId, row)
      return row
    },
  },
  creditTransactions: {
    async create(row: (typeof transactions)[number]) {
      transactions.push(row)
      return row
    },
    async findByUserId(userId: string) {
      return transactions.filter((row) => row.userId === userId)
    },
    async findByUserIdAndType(userId: string, type: string, limit = 50) {
      return transactions.filter((row) => row.userId === userId && row.type === type).slice(0, limit)
    },
  },
  userResources: {
    async findByUserId() {
      return null
    },
  },
}

vi.mock('../../db/index.js', () => ({
  getDb: () => mockDb,
}))

vi.mock('../../services/sms.js', () => ({
  isSmsMockEnabled: vi.fn().mockReturnValue(false),
  sendSms: vi.fn().mockResolvedValue(undefined),
}))

describe('phone registration auth flow', () => {
  beforeEach(() => {
    users.clear()
    smsCodes.length = 0
    credentials.clear()
    credits.clear()
    transactions.length = 0
  })

  it('requires phone and SMS code for registration', async () => {
    const { default: authRoutes } = await import('../auth')

    const response = await authRoutes.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'student', password: 'Student123' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Valid phone number is required' })
  })

  it('registers with SMS, grants signup credits, rejects duplicate phone, and logs in', async () => {
    const { default: authRoutes } = await import('../auth')
    const phone = '13900008888'
    const username = 'student_phone'
    const password = 'Student123'

    const smsResponse = await authRoutes.request('/send-sms-code', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone }),
    })
    expect(smsResponse.status).toBe(200)
    expect(smsCodes).toHaveLength(1)

    const registerResponse = await authRoutes.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, phone, code: smsCodes[0].code }),
    })
    const registered = await registerResponse.json()

    expect(registerResponse.status).toBe(200)
    expect(registerResponse.headers.get('set-cookie')).toContain('nex_session')
    expect(credits.get(registered.user.id)?.balance).toBe(20)
    expect(transactions).toMatchObject([{ userId: registered.user.id, type: 'signup_bonus', amount: 20 }])

    const duplicateResponse = await authRoutes.request('/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'student_dupe', password, phone, code: smsCodes[0].code }),
    })
    expect(duplicateResponse.status).toBe(409)

    const loginResponse = await authRoutes.request('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    expect(loginResponse.status).toBe(200)
    expect(loginResponse.headers.get('set-cookie')).toContain('nex_session')
  })
})
