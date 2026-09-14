export interface StudentGrowthState {
  starlight: number
  greeted: boolean
  rewardedCourseIds: string[]
}

export interface StudentGrowthLevel {
  level: number
  current: number
  next: number
  progress: number
}

export interface StudentGrowthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): unknown
}

const STORAGE_KEY = 'ai-xiaobao-student-growth'
export const INITIAL_STUDENT_GROWTH: StudentGrowthState = { starlight: 0, greeted: false, rewardedCourseIds: [] }

export function getGrowthLevel(starlight: number): StudentGrowthLevel {
  const safeStarlight = Math.max(0, Math.floor(starlight))
  const current = safeStarlight % 100
  return { level: Math.floor(safeStarlight / 100) + 1, current, next: 100, progress: current }
}

export function awardGreeting(state: StudentGrowthState): StudentGrowthState {
  return state.greeted ? state : { ...state, greeted: true, starlight: state.starlight + 5 }
}

export function awardCourse(state: StudentGrowthState, courseId: string): StudentGrowthState {
  if (state.rewardedCourseIds.includes(courseId)) return state
  return {
    ...state,
    starlight: state.starlight + 10,
    rewardedCourseIds: [...state.rewardedCourseIds, courseId],
  }
}

function isStudentGrowthState(value: unknown): value is StudentGrowthState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<StudentGrowthState>
  return (
    typeof state.starlight === 'number' &&
    state.starlight >= 0 &&
    typeof state.greeted === 'boolean' &&
    Array.isArray(state.rewardedCourseIds) &&
    state.rewardedCourseIds.every((id) => typeof id === 'string')
  )
}

export function loadStudentGrowth(storage?: StudentGrowthStorage | null): StudentGrowthState {
  if (!storage) return INITIAL_STUDENT_GROWTH
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return INITIAL_STUDENT_GROWTH
    const parsed: unknown = JSON.parse(raw)
    return isStudentGrowthState(parsed) ? parsed : INITIAL_STUDENT_GROWTH
  } catch {
    return INITIAL_STUDENT_GROWTH
  }
}

export function saveStudentGrowth(storage: StudentGrowthStorage | null | undefined, state: StudentGrowthState): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Keep the in-memory state when browser storage is unavailable.
  }
}
