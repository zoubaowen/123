import type { ReactNode } from 'react'
import { BookOpen, Clapperboard, Gamepad2, Image, Music, PenLine } from 'lucide-react'
import { XiaoBao } from '@ai-xiaobao/chat-core'
import { STUDENT_CAPABILITIES, type StudentCapabilityAccent, type StudentCapabilityId } from './student-capabilities'

interface StudentCreationStageProps {
  composer: ReactNode
  onCapabilitySelect: (id: StudentCapabilityId) => void
}

const capabilityIcons = {
  image: Image,
  video: Clapperboard,
  music: Music,
  game: Gamepad2,
  writing: PenLine,
  study: BookOpen,
} satisfies Record<StudentCapabilityId, typeof Image>

const accentClasses: Record<StudentCapabilityAccent, string> = {
  violet: 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100',
}

export function StudentCreationStage({ composer, onCapabilitySelect }: StudentCreationStageProps) {
  return (
    <main
      className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-[radial-gradient(circle_at_50%_38%,rgba(219,234,254,0.72),transparent_34%),linear-gradient(145deg,#f8fbff_0%,#ffffff_48%,#f5f7fb_100%)] px-4 py-5 sm:px-6 lg:px-8"
      aria-label="学生创作区"
    >
      <div className="mx-auto flex min-h-[520px] w-full max-w-4xl flex-1 flex-col">
        <section
          data-student-welcome-stage="true"
          className="flex flex-1 flex-col items-center justify-center pb-8 text-center"
          aria-labelledby="student-welcome-title"
        >
          <div className="mb-3 flex justify-center">
            <XiaoBao
              outfit="academy"
              mood="happy"
              action="wave"
              size={144}
              interactive
              ariaLabel="小宝正在欢迎你开始创作"
            />
          </div>
          <h1 id="student-welcome-title" className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            嗨，我是小宝！
          </h1>
          <p className="mt-2 text-sm text-slate-500 sm:text-base">把你的奇思妙想告诉我，我们一起把它变成作品。</p>
        </section>

        <section
          data-student-creation-dock="true"
          className="mb-3 grid grid-cols-2 gap-2 rounded-3xl border border-white/80 bg-white/70 p-2.5 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:grid-cols-3"
          aria-label="选择创作类型"
        >
          {STUDENT_CAPABILITIES.map((capability) => {
            const Icon = capabilityIcons[capability.id]

            return (
              <button
                key={capability.id}
                type="button"
                aria-label={`开始${capability.title}`}
                onClick={() => onCapabilitySelect(capability.id)}
                className={`group flex min-h-16 items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${accentClasses[capability.accent]}`}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{capability.title}</span>
                  <span className="mt-0.5 hidden text-xs leading-4 opacity-70 sm:block">{capability.description}</span>
                </span>
              </button>
            )
          })}
        </section>

        <div className="w-full">{composer}</div>
        <p className="mt-3 text-center text-xs text-slate-400">
          小宝会陪你思考和创作，重要内容记得和老师或家长一起确认。
        </p>
      </div>
    </main>
  )
}
