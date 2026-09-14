import { describe, expect, it } from 'vitest'
import { isAllowedCapiAction } from '../../lib/capi-allowlist.js'

describe('isAllowedCapiAction', () => {
  it('allows known CloudBase dashboard actions', () => {
    expect(isAllowedCapiAction('tcb', 'DescribeEnvs')).toBe(true)
    expect(isAllowedCapiAction('tcb', 'DescribeCloudBaseRunServers')).toBe(true)
  })

  it('blocks unrelated or account-level cloud API actions', () => {
    expect(isAllowedCapiAction('cam', 'ListUsers')).toBe(false)
    expect(isAllowedCapiAction('tcb', 'DeleteEnv')).toBe(false)
    expect(isAllowedCapiAction('scf', 'DeleteFunction')).toBe(false)
  })

  it('blocks missing service or action values', () => {
    expect(isAllowedCapiAction(undefined, 'DescribeEnvs')).toBe(false)
    expect(isAllowedCapiAction('tcb', undefined)).toBe(false)
  })
})
