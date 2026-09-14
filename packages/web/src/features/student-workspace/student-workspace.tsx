import type { ReactElement, ReactNode } from 'react'
import { getStudentCapability, type StudentCapabilityId } from './student-capabilities'
import { StudentCreationStage } from './student-creation-stage'
import { SelectedStudentMasterSkillCard } from './student-master-skill-card'
import { StudentResourcePanel } from './student-resource-panel'

interface StudentWorkspaceProps {
  composer: ReactNode
  onPromptChange: (prompt: string) => void
  onMasterSkillChange: (skillName: string) => void
  onCapabilityChange: (id: StudentCapabilityId) => void
}

export function StudentWorkspace({
  composer,
  onPromptChange,
  onMasterSkillChange,
  onCapabilityChange,
}: StudentWorkspaceProps): ReactElement {
  const handleCapabilitySelect = (id: StudentCapabilityId) => {
    const capability = getStudentCapability(id)
    onPromptChange(capability.prompt)
    onMasterSkillChange(capability.skillName)
    onCapabilityChange(id)
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-slate-50/60">
      <StudentCreationStage
        composer={
          <>
            <SelectedStudentMasterSkillCard />
            {composer}
          </>
        }
        onCapabilitySelect={handleCapabilitySelect}
      />
      <StudentResourcePanel />
    </div>
  )
}
