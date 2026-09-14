import { describe, expect, it } from 'vitest'
import {
  parseXiaobaoCapabilities,
  resolveStudentRuntimeSelection,
  resolveStudentXiaobaoCapability,
} from './student-runtime-selection'

describe('resolveStudentXiaobaoCapability', () => {
  it.each([
    ['writing', 'writing'],
    ['study', 'learning'],
    ['game', 'game'],
    ['image', 'image'],
    ['video', 'video'],
    ['music', null],
  ] as const)('maps %s to %s', (id, expected) => {
    expect(resolveStudentXiaobaoCapability(id)).toBe(expected)
  })

  it.each([null, undefined, 'unknown', '', 'STUDY', 42, {}, []])('returns null for %j without throwing', (id) => {
    expect(resolveStudentXiaobaoCapability(id)).toBeNull()
  })
})

describe('resolveStudentRuntimeSelection', () => {
  it('requests the XiaoBao runtime when the server allows the mapped capability', () => {
    expect(resolveStudentRuntimeSelection({ capabilityId: 'study', xiaobaoCapabilities: ['learning'] })).toEqual({
      selectedRuntime: 'xiaobao',
      xiaobaoCapability: 'learning',
    })
  })

  it.each([
    ['writing', 'writing'],
    ['game', 'game'],
    ['image', 'image'],
    ['video', 'video'],
  ] as const)('requests %s when the server allows it', (capabilityId, capability) => {
    expect(resolveStudentRuntimeSelection({ capabilityId, xiaobaoCapabilities: [capability] })).toEqual({
      selectedRuntime: 'xiaobao',
      xiaobaoCapability: capability,
    })
  })

  it('returns nothing when the server has not allowed the capability', () => {
    expect(resolveStudentRuntimeSelection({ capabilityId: 'image', xiaobaoCapabilities: [] })).toEqual({})
    expect(resolveStudentRuntimeSelection({ capabilityId: 'image', xiaobaoCapabilities: ['writing'] })).toEqual({})
  })

  it.each([null, undefined, 'unknown', 'music'])('returns nothing for the non-mapped entry %j', (capabilityId) => {
    expect(
      resolveStudentRuntimeSelection({
        capabilityId,
        xiaobaoCapabilities: ['writing', 'learning', 'game', 'image', 'video'],
      }),
    ).toEqual({})
  })
})

describe('parseXiaobaoCapabilities', () => {
  it('returns the allowed capabilities of an eligible response', () => {
    expect(
      parseXiaobaoCapabilities({ eligible: true, runtime: 'xiaobao', capabilities: ['writing', 'image'] }),
    ).toEqual(['writing', 'image'])
  })

  it('drops unknown capability names instead of trusting them', () => {
    expect(parseXiaobaoCapabilities({ eligible: true, capabilities: ['writing', 'music', 'nope', 42] })).toEqual([
      'writing',
    ])
  })

  it.each([
    { eligible: false, capabilities: ['writing'] },
    { capabilities: ['writing'] },
    { eligible: true },
    { eligible: true, capabilities: 'writing' },
    { eligible: 'yes', capabilities: ['writing'] },
    null,
    undefined,
    'eligible',
    42,
    [],
    new Error('failed'),
  ])('fails closed for %j', (payload) => {
    expect(parseXiaobaoCapabilities(payload)).toEqual([])
  })
})
