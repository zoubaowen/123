import { describe, expect, it } from 'vitest'
import {
  awardCourse,
  awardGreeting,
  getGrowthLevel,
  loadStudentGrowth,
  saveStudentGrowth,
  type StudentGrowthState,
} from './student-growth'

const initial: StudentGrowthState = { starlight: 0, greeted: false, rewardedCourseIds: [] }

describe('student growth', () => {
  it('calculates a level for each 100 starlight', () => {
    expect(getGrowthLevel(0)).toEqual({ level: 1, current: 0, next: 100, progress: 0 })
    expect(getGrowthLevel(125)).toEqual({ level: 2, current: 25, next: 100, progress: 25 })
  })

  it('awards greeting and each course only once', () => {
    const greeted = awardGreeting(initial)
    expect(greeted.starlight).toBe(5)
    expect(awardGreeting(greeted)).toEqual(greeted)

    const learned = awardCourse(greeted, 'ai-art')
    expect(learned.starlight).toBe(15)
    expect(awardCourse(learned, 'ai-art')).toEqual(learned)
  })

  it('persists valid growth and falls back safely for invalid data', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    }
    const state = awardCourse(initial, 'game-maker')
    saveStudentGrowth(storage, state)
    expect(loadStudentGrowth(storage)).toEqual(state)
    values.set('ai-xiaobao-student-growth', '{broken')
    expect(loadStudentGrowth(storage)).toEqual(initial)
  })
})
