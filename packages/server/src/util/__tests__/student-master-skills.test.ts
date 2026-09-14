import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { parseSkillFromRaw } from '../skill-loader-shared'

const repositoryRoot = fileURLToPath(new URL('../../../../../', import.meta.url))

const masterSkills = [
  'student-image-master',
  'student-video-master',
  'student-music-master',
  'scratch-game-coach',
  'student-writing-coach',
  'student-learning-master',
] as const

const workflowStages = ['discover', 'plan', 'produce', 'inspect', 'revise', 'deliver', 'reflect'] as const

async function loadMasterSkill(name: (typeof masterSkills)[number]) {
  const skillPath = `${repositoryRoot.replaceAll('\\', '/')}/skills/${name}/SKILL.md`
  const raw = await readFile(skillPath, 'utf8')
  return parseSkillFromRaw(raw, skillPath, `${repositoryRoot.replaceAll('\\', '/')}/skills`, 'project')
}

describe('student master skills', () => {
  it.each(masterSkills)('loads %s through the production skill loader', async (name) => {
    const skill = await loadMasterSkill(name)

    expect(skill).toBeDefined()
    expect(skill?.name).toBe(name)
    expect(skill?.description).not.toBe(`${name} (project)`)
  })

  it.each(masterSkills)('%s exposes the complete student workflow', async (name) => {
    const skill = await loadMasterSkill(name)

    for (const stage of workflowStages) {
      expect(skill?.instructions).toContain(` ${stage} `)
    }
  })

  it('keeps character consistency and nine-grid approval as video gates', async () => {
    const skill = await loadMasterSkill('student-video-master')

    expect(skill?.instructions).toContain('角色设定锁')
    expect(skill?.instructions).toContain('故事连续性表')
    expect(skill?.instructions).toContain('九宫格')
    expect(skill?.instructions).toContain('角色参考确认')
    expect(skill?.instructions).toContain('九宫格确认')
    expect(skill?.instructions).toContain('局部返工')
  })

  it('does not let the music skill claim audio before a real tool succeeds', async () => {
    const skill = await loadMasterSkill('student-music-master')

    expect(skill?.instructions).toContain('尚未生成音频')
    expect(skill?.instructions).toContain('真实可播放')
  })
})
