// @ts-nocheck -- Vitest is supplied by the workspace test runner, not the published chat-core package.
import { describe, expect, it } from 'vitest'
import { getLoginXiaoBaoState } from './xiaobao-state'

describe('getLoginXiaoBaoState', () => {
  it('writes while authentication is loading', () => {
    expect(
      getLoginXiaoBaoState({
        mode: 'login',
        focus: null,
        loading: true,
        success: false,
        error: false,
      }),
    ).toEqual({ outfit: 'academy', mood: 'working', action: 'write' })
  })

  it('covers its eyes while the password field is focused', () => {
    expect(
      getLoginXiaoBaoState({
        mode: 'login',
        focus: 'password',
        loading: false,
        success: false,
        error: false,
      }).action,
    ).toBe('cover-eyes')
  })

  it('celebrates a successful login before other states', () => {
    expect(
      getLoginXiaoBaoState({
        mode: 'login',
        focus: 'password',
        loading: true,
        success: true,
        error: true,
      }),
    ).toEqual({ outfit: 'academy', mood: 'excited', action: 'celebrate' })
  })

  it('comforts the learner after an authentication error', () => {
    expect(
      getLoginXiaoBaoState({
        mode: 'register',
        focus: null,
        loading: false,
        success: false,
        error: true,
      }),
    ).toEqual({ outfit: 'academy', mood: 'comforting', action: 'wave' })
  })
})
