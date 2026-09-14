/**
 * 单元测试：resolveOnPath / tryBins / getResolvedBin
 *
 * 用 vi.mock + vi.mocked 控制 fs.existsSync，vi.stubEnv 控制 PATH / OPENCODE_BIN。
 * 全程无真实 PATH 扫描、无子进程。
 *
 * 注意：vi.resetModules() 在每个 it 前清空 acp-transport 的模块缓存，
 *       确保每次 import 都拿到新实例（新的 _resolvedBin 缓存）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path, { delimiter } from 'node:path'

// Mock node:fs 整体，这样 existsSync 可被控制
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

import * as fs from 'node:fs'

describe('resolveOnPath + getResolvedBin', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ── resolveOnPath ──────────────────────────────────────────────────────────

  it('resolveOnPath returns absolute path when bin found in PATH', async () => {
    const binDir = path.join('/usr', 'local', 'bin')
    const expected = path.join(binDir, 'opencode')
    vi.stubEnv('PATH', [binDir, path.join('/usr', 'bin')].join(delimiter))
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expected)
    const { resolveOnPath } = await import('../acp-transport.js')
    expect(resolveOnPath('opencode')).toBe(expected)
  })

  it('resolveOnPath returns null when bin not found in any PATH dir', async () => {
    vi.stubEnv('PATH', [path.join('/usr', 'local', 'bin'), path.join('/usr', 'bin')].join(delimiter))
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { resolveOnPath } = await import('../acp-transport.js')
    expect(resolveOnPath('opencode')).toBeNull()
  })

  it('resolveOnPath returns null when PATH is empty', async () => {
    vi.stubEnv('PATH', '')
    const { resolveOnPath } = await import('../acp-transport.js')
    expect(resolveOnPath('opencode')).toBeNull()
  })

  // ── getResolvedBin: OPENCODE_BIN env override ──────────────────────────────

  it('getResolvedBin returns OPENCODE_BIN env if it exists on disk', async () => {
    vi.stubEnv('OPENCODE_BIN', '/opt/custom/opencode')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === '/opt/custom/opencode')
    const { getResolvedBin } = await import('../acp-transport.js')
    expect(getResolvedBin()).toBe('/opt/custom/opencode')
  })

  it('getResolvedBin skips OPENCODE_BIN env if file does not exist, falls back to PATH', async () => {
    vi.stubEnv('OPENCODE_BIN', '/opt/custom/opencode')
    const binDir = path.join('/usr', 'local', 'bin')
    const expected = path.join(binDir, 'opencode')
    vi.stubEnv('PATH', binDir)
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expected)
    const { getResolvedBin } = await import('../acp-transport.js')
    expect(getResolvedBin()).toBe(expected)
  })

  // ── getResolvedBin: fallback chain ─────────────────────────────────────────

  it('getResolvedBin finds "opencode" before fallback "opencode-ai"', async () => {
    const binDir = path.join('/usr', 'local', 'bin')
    const expected = path.join(binDir, 'opencode')
    vi.stubEnv('PATH', binDir)
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expected)
    const { getResolvedBin } = await import('../acp-transport.js')
    expect(getResolvedBin()).toBe(expected)
  })

  it('getResolvedBin falls back to "opencode-ai" when "opencode" is absent', async () => {
    const binDir = path.join('/usr', 'local', 'bin')
    const expected = path.join(binDir, 'opencode-ai')
    vi.stubEnv('PATH', binDir)
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expected)
    const { getResolvedBin } = await import('../acp-transport.js')
    expect(getResolvedBin()).toBe(expected)
  })

  it('getResolvedBin returns null when all bins absent', async () => {
    vi.stubEnv('PATH', path.join('/usr', 'local', 'bin'))
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { getResolvedBin } = await import('../acp-transport.js')
    expect(getResolvedBin()).toBeNull()
  })
})

describe('isResolvedBinAvailable via getResolvedBin', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.mocked(fs.existsSync).mockReturnValue(false)
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when getResolvedBin finds opencode', async () => {
    const binDir = path.join('/usr', 'local', 'bin')
    const expected = path.join(binDir, 'opencode')
    vi.stubEnv('PATH', binDir)
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockImplementation((p) => p === expected)
    const { isResolvedBinAvailable } = await import('../acp-transport.js')
    expect(isResolvedBinAvailable()).toBe(true)
  })

  it('returns false when getResolvedBin cannot find any opencode bin', async () => {
    vi.stubEnv('PATH', path.join('/usr', 'local', 'bin'))
    vi.stubEnv('PATHEXT', '')
    vi.mocked(fs.existsSync).mockReturnValue(false)
    const { isResolvedBinAvailable } = await import('../acp-transport.js')
    expect(isResolvedBinAvailable()).toBe(false)
  })
})
