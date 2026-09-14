import { describe, expect, it } from 'vitest'

import { isDynamicModelDiscoveryEnabled } from '../model-discovery'

describe('CodeBuddy model discovery', () => {
  it('uses the live account catalog by default', () => {
    expect(isDynamicModelDiscoveryEnabled(undefined)).toBe(true)
  })

  it('allows live discovery to be explicitly disabled', () => {
    expect(isDynamicModelDiscoveryEnabled('0')).toBe(false)
    expect(isDynamicModelDiscoveryEnabled('false')).toBe(false)
  })

  it('accepts the documented enabled values', () => {
    expect(isDynamicModelDiscoveryEnabled('1')).toBe(true)
    expect(isDynamicModelDiscoveryEnabled('true')).toBe(true)
    expect(isDynamicModelDiscoveryEnabled('yes')).toBe(true)
  })
})
