import { describe, expect, it } from 'vitest'
import { resolveCorsOrigin } from '../lib/cors-origin.js'

describe('resolveCorsOrigin', () => {
  it('allows configured origins in production', () => {
    expect(resolveCorsOrigin('https://app.example.com', ['https://app.example.com'], 'production')).toBe(
      'https://app.example.com',
    )
  })

  it('blocks arbitrary localhost origins in production', () => {
    expect(resolveCorsOrigin('http://localhost:9999', ['https://app.example.com'], 'production')).toBe('null')
  })

  it('allows the production loopback origin for the serving port', () => {
    expect(resolveCorsOrigin('http://127.0.0.1:3101', [], 'production', '3101')).toBe('http://127.0.0.1:3101')
    expect(resolveCorsOrigin('http://localhost:3101', [], 'production', '3101')).toBe('http://localhost:3101')
  })

  it('blocks production loopback origins on other ports', () => {
    expect(resolveCorsOrigin('http://127.0.0.1:9999', [], 'production', '3101')).toBe('null')
    expect(resolveCorsOrigin('http://localhost:9999', [], 'production', '3101')).toBe('null')
  })

  it('allows localhost origins outside production', () => {
    expect(resolveCorsOrigin('http://localhost:9999', [], 'development')).toBe('http://localhost:9999')
  })

  it('does not grant credentialed access to missing or null origins', () => {
    expect(resolveCorsOrigin(undefined, ['https://app.example.com'], 'production')).toBe('null')
    expect(resolveCorsOrigin('null', ['https://app.example.com'], 'production')).toBe('null')
  })
})
