import { describe, expect, it } from 'vitest'

import { mergeTaskSkillNames } from './task-form-skills'

describe('mergeTaskSkillNames', () => {
  it('returns no skill list when neither source has a skill', () => {
    expect(mergeTaskSkillNames(new Set(), null)).toBeUndefined()
  })

  it('automatically includes the student master skill', () => {
    expect(mergeTaskSkillNames(new Set(), 'student-image-master')).toEqual(['student-image-master'])
  })

  it('keeps manually selected skills and removes duplicates', () => {
    expect(
      mergeTaskSkillNames(new Set(['student-image-master', 'student-safe-explainer']), 'student-image-master'),
    ).toEqual(['student-image-master', 'student-safe-explainer'])
  })
})
