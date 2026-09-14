import { describe, expect, it, vi } from 'vitest'
import type { XiaobaoAction } from '../domain.js'
import { SandboxToolsProvider, type SandboxToolClient } from '../sandbox-tools.js'

function action(overrides: Partial<XiaobaoAction> = {}): XiaobaoAction {
  return { id: 'action-1', toolName: 'write_file', input: { path: '/tmp/project/main.js' }, ...overrides }
}

function client(result: { ok: true; result: unknown } | { ok: false; error: string }): SandboxToolClient {
  return {
    execute: vi.fn(async () => result),
    healthCheck: vi.fn(async () => true),
  }
}

describe('SandboxToolsProvider', () => {
  it('maps whitelisted runtime tools to sandbox endpoints', async () => {
    const httpClient = client({ ok: true, result: { bytesWritten: 42 } })
    const provider = new SandboxToolsProvider(httpClient, () => 5_000)

    const observation = await provider.execute({ taskId: 'task-1', action: action() }, new AbortController().signal)

    expect(observation).toMatchObject({ actionId: 'action-1', ok: true, output: { bytesWritten: 42 } })
    expect(httpClient.execute).toHaveBeenCalledWith(
      'write',
      { path: '/tmp/project/main.js', content: undefined },
      5_000,
    )
  })

  it('rejects an unknown tool name before reaching the client', async () => {
    const httpClient = client({ ok: true, result: {} })
    const provider = new SandboxToolsProvider(httpClient)

    const observation = await provider.execute(
      { taskId: 'task-1', action: action({ toolName: 'rm_rf' }) },
      new AbortController().signal,
    )

    expect(observation).toMatchObject({ actionId: 'action-1', ok: false })
    expect(observation.errorCode).toMatch(/unknown_tool/)
    expect(httpClient.execute).not.toHaveBeenCalled()
  })

  it('maps a client failure to a stable error observation without upstream text', async () => {
    const httpClient = client({ ok: false, error: 'shell: permission denied for /root' })
    const provider = new SandboxToolsProvider(httpClient)

    const observation = await provider.execute(
      { taskId: 'task-1', action: action({ toolName: 'run_command', input: { command: 'rm -rf /' } }) },
      new AbortController().signal,
    )

    expect(observation).toMatchObject({ actionId: 'action-1', ok: false })
    expect(observation.errorCode).toMatch(/tool_failed|sandbox/)
    expect(JSON.stringify(observation)).not.toContain('permission denied')
    expect(JSON.stringify(observation)).not.toContain('rm -rf')
  })

  it('propagates an aborted signal as a cancelled observation without retry', async () => {
    const httpClient: SandboxToolClient = {
      execute: vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError')
      }),
      healthCheck: vi.fn(async () => true),
    }
    const provider = new SandboxToolsProvider(httpClient)
    const controller = new AbortController()
    controller.abort()

    const observation = await provider.execute({ taskId: 'task-1', action: action() }, controller.signal)

    expect(observation).toMatchObject({ actionId: 'action-1', ok: false })
  })

  it('delegates health checks to the client', async () => {
    const httpClient = client({ ok: true, result: {} })
    const provider = new SandboxToolsProvider(httpClient)

    await expect(provider.healthCheck()).resolves.toBe(true)
    expect(httpClient.healthCheck).toHaveBeenCalledTimes(1)
  })

  it('truncates oversized textual sandbox output before persisting the observation', async () => {
    const hugeOutput = 'a'.repeat(200_000)
    const httpClient = client({ ok: true, result: { output: hugeOutput, exitCode: 0 } })
    const provider = new SandboxToolsProvider(httpClient)

    const observation = await provider.execute(
      { taskId: 'task-1', action: action({ toolName: 'run_command', input: { command: 'cat big.log' } }) },
      new AbortController().signal,
    )

    expect(observation).toMatchObject({ actionId: 'action-1', ok: true })
    const output = observation.output as { value: string; truncated: boolean }
    expect(output.truncated).toBe(true)
    expect(output.value.length).toBeLessThanOrEqual(100_000)
    // The raw giant string must not be persisted for model replay or UI rendering.
    expect(JSON.stringify(observation).length).toBeLessThan(110_000)
  })

  it('caps the serialized observation for non-text sandbox results', async () => {
    const nested = { list: Array.from({ length: 50_000 }, (_, i) => ({ id: i, blob: 'x'.repeat(20) })) }
    const httpClient = client({ ok: true, result: nested })
    const provider = new SandboxToolsProvider(httpClient)

    const observation = await provider.execute(
      { taskId: 'task-1', action: action({ toolName: 'read_file', input: { path: 'big.json' } }) },
      new AbortController().signal,
    )

    expect(observation).toMatchObject({ actionId: 'action-1', ok: true })
    expect(JSON.stringify(observation).length).toBeLessThanOrEqual(120_000)
  })
})
