// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useXiaobaoEligibility } from './use-xiaobao-eligibility'

function mockFetch(implementation: () => Promise<Response>) {
  const fetchMock = vi.fn(implementation)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useXiaobaoEligibility', () => {
  it('does not request eligibility while disabled and stays empty', () => {
    const fetchMock = mockFetch(async () => jsonResponse({ eligible: true, capabilities: ['writing'] }))

    const { result } = renderHook(() => useXiaobaoEligibility(false))

    expect(result.current).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns the allowed capability list using a credentialed request', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ eligible: true, runtime: 'xiaobao', capabilities: ['writing', 'image', 'video'] }),
    )

    const { result } = renderHook(() => useXiaobaoEligibility(true))

    await waitFor(() => expect(result.current).toEqual(['writing', 'image', 'video']))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/agent/xiaobao/eligibility'),
      expect.objectContaining({ credentials: 'include' }),
    )
  })

  it('stays empty when the endpoint answers with a non-200 status', async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ eligible: true, capabilities: ['writing'] }, 403))

    const { result } = renderHook(() => useXiaobaoEligibility(true))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it('stays empty when the request rejects', async () => {
    mockFetch(async () => {
      throw new Error('network down')
    })

    const { result } = renderHook(() => useXiaobaoEligibility(true))

    await waitFor(() => expect(result.current).toEqual([]))
  })

  it('stays empty when the response body is not JSON', async () => {
    const fetchMock = mockFetch(async () => new Response('<html>login</html>', { status: 200 }))

    const { result } = renderHook(() => useXiaobaoEligibility(true))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it('stays empty when the flag is not a literal boolean true', async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ eligible: 'yes', capabilities: ['writing'] }))

    const { result } = renderHook(() => useXiaobaoEligibility(true))

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it('does not update state after unmount', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    mockFetch(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve
        }),
    )
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { unmount } = renderHook(() => useXiaobaoEligibility(true))
    unmount()
    resolveFetch?.(jsonResponse({ eligible: true, capabilities: ['writing'] }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
