import { atom } from 'jotai'
import type { StudentCapabilityId } from '@/features/student-workspace/student-capabilities'

export const taskPromptAtom = atom('')

export const studentMasterSkillNameAtom = atom<string | null>(null)

export const studentCapabilityIdAtom = atom<StudentCapabilityId | null>(null)
