import type { XiaobaoCapability } from './domain.js'
import type { SkillProvider, SkillSnapshot } from './ports.js'

export const SKILL_NAMES_BY_CAPABILITY: Readonly<Record<XiaobaoCapability, string>> = Object.freeze({
  image: 'student-image-master',
  video: 'student-video-master',
  music: 'student-music-master',
  game: 'scratch-game-coach',
  writing: 'student-writing-coach',
  learning: 'student-learning-master',
})

function immutableSkillSnapshot(snapshot: SkillSnapshot): SkillSnapshot {
  const clone = structuredClone(snapshot)
  Object.freeze(clone.qualityGates)
  return Object.freeze(clone)
}

export class SkillEngine {
  constructor(private readonly provider: SkillProvider) {}

  async resolve(capability: XiaobaoCapability): Promise<SkillSnapshot> {
    const expectedName = SKILL_NAMES_BY_CAPABILITY[capability]
    const snapshot = await this.provider.getByCapability(capability)

    if (!snapshot || snapshot.name !== expectedName) {
      throw new Error('Xiaobao skill unavailable')
    }

    return immutableSkillSnapshot(snapshot)
  }
}
