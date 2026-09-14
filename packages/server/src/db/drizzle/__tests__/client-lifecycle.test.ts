import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalDatabasePath = process.env.DATABASE_PATH
let closeClient: (() => void) | undefined
let directory: string | undefined

afterEach(() => {
  closeClient?.()
  if (directory && existsSync(directory)) rmSync(directory, { recursive: true, force: true })
  if (originalDatabasePath === undefined) delete process.env.DATABASE_PATH
  else process.env.DATABASE_PATH = originalDatabasePath
})

describe('Drizzle client lifecycle', () => {
  it('closes its SQLite connection so the exact test directory can be removed', async () => {
    directory = mkdtempSync(join(tmpdir(), 'drizzle-client-lifecycle-'))
    process.env.DATABASE_PATH = join(directory, 'test.db')
    vi.resetModules()

    const client = await import('../client.js')
    closeClient = client.closeDrizzleClient

    expect(closeClient).toBeTypeOf('function')
    closeClient()
    closeClient = undefined
    rmSync(directory, { recursive: true, force: true })

    expect(existsSync(directory)).toBe(false)
    directory = undefined
  })
})
