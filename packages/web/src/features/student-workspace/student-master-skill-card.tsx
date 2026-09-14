import { CheckCircle2, Circle, Sparkles } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { studentMasterSkillNameAtom } from '@/lib/atoms/task'
import { STUDENT_CAPABILITIES, type StudentCapability, type StudentMasterStage } from './student-capabilities'

interface StudentMasterSkillCardProps {
  capability: StudentCapability
}

const stageLabels: Record<StudentMasterStage, string> = {
  discover: '理解想法',
  plan: '制定方案',
  produce: '开始创作',
  inspect: '作品体检',
  revise: '认真修改',
  deliver: '交付作品',
  reflect: '学习复盘',
}

export function StudentMasterSkillCard({ capability }: StudentMasterSkillCardProps) {
  return (
    <section
      className="mb-3 rounded-3xl border border-blue-100 bg-white/85 p-4 text-left shadow-sm"
      aria-label={`${capability.masterTitle}创作流程`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-slate-900">{capability.masterTitle}</h2>
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">准备开始</span>
          </div>
          <p className="mt-1 text-sm leading-5 text-slate-600">{capability.masterDescription}</p>
        </div>
      </div>

      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" aria-label="七步创作流程">
        {capability.stages.map((stage, index) => (
          <li
            key={stage}
            className={
              index === 0
                ? 'flex items-center gap-1.5 rounded-xl bg-blue-50 px-2.5 py-2 text-xs font-medium text-blue-700'
                : 'flex items-center gap-1.5 rounded-xl bg-slate-50 px-2.5 py-2 text-xs text-slate-500'
            }
          >
            {index === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {stageLabels[stage]}
          </li>
        ))}
      </ol>

      {capability.id === 'video' && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-sky-700">
          <span className="rounded-full bg-sky-50 px-2.5 py-1">确认 1：角色参考图</span>
          <span className="rounded-full bg-sky-50 px-2.5 py-1">确认 2：九宫格分镜</span>
        </div>
      )}

      {capability.toolState === 'planned' && capability.toolMessage && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
          {capability.toolMessage}
        </p>
      )}
    </section>
  )
}

export function SelectedStudentMasterSkillCard() {
  const skillName = useAtomValue(studentMasterSkillNameAtom)
  const capability = STUDENT_CAPABILITIES.find((item) => item.skillName === skillName)

  return capability ? <StudentMasterSkillCard capability={capability} /> : null
}
