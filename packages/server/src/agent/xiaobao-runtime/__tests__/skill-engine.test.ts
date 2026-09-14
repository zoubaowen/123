import { describe, expect, it } from 'vitest'
import type { XiaobaoCapability } from '../domain.js'
import type { SkillSnapshot } from '../ports.js'
import { SkillEngine } from '../skill-engine.js'
import { InMemorySkillProvider } from '../testing.js'

const expectedSkills: ReadonlyArray<[XiaobaoCapability, string]> = [
  ['image', 'student-image-master'],
  ['video', 'student-video-master'],
  ['music', 'student-music-master'],
  ['game', 'scratch-game-coach'],
  ['writing', 'student-writing-coach'],
  ['learning', 'student-learning-master'],
]

function skill(name: string): SkillSnapshot {
  return {
    name,
    version: '1.0.0',
    instructions: `Instructions for ${name}`,
    qualityGates: ['真实成果', '学习复盘'],
  }
}

describe('xiaobao skill engine', () => {
  it.each(expectedSkills)('resolves %s to its required master skill', async (capability, expectedName) => {
    const provider = new InMemorySkillProvider(new Map([[capability, skill(expectedName)]]))
    const engine = new SkillEngine(provider)

    await expect(engine.resolve(capability)).resolves.toMatchObject({ name: expectedName, version: '1.0.0' })
  })

  it('rejects a provider result with the wrong skill identity', async () => {
    const provider = new InMemorySkillProvider(new Map([['video', skill('student-image-master')]]))

    await expect(new SkillEngine(provider).resolve('video')).rejects.toThrow('Xiaobao skill unavailable')
  })

  it('rejects a missing required skill', async () => {
    const provider = new InMemorySkillProvider(new Map())

    await expect(new SkillEngine(provider).resolve('music')).rejects.toThrow('Xiaobao skill unavailable')
  })

  it('returns an immutable clone of the provider snapshot', async () => {
    const source = skill('student-learning-master')
    const provider = new InMemorySkillProvider(new Map([['learning', source]]))
    const resolved = await new SkillEngine(provider).resolve('learning')

    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.qualityGates)).toBe(true)
    expect(resolved).not.toBe(source)
  })
})
