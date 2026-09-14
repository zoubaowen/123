import { CheckCircle2, LockKeyhole, PlayCircle } from 'lucide-react'
import type { TeacherLessonProgress } from './types'

const lessonStatusLabel = {
  completed: '已完成',
  next: '下一节',
  locked: '未开始',
} as const

const lessonAppearance = {
  completed: { icon: CheckCircle2, iconTone: 'bg-emerald-50 text-emerald-600', badgeTone: 'bg-emerald-50 text-emerald-700' },
  next: { icon: PlayCircle, iconTone: 'bg-blue-50 text-blue-600', badgeTone: 'bg-blue-50 text-blue-700' },
  locked: { icon: LockKeyhole, iconTone: 'bg-slate-100 text-slate-400', badgeTone: 'bg-slate-100 text-slate-500' },
} as const

export function TeacherLessonProgressList({ lessons }: { lessons: TeacherLessonProgress[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-black text-slate-900">课程进度</h2>
        <p className="mt-1 text-xs text-slate-500">按课程顺序查看已完成内容和下一课节。</p>
      </div>
      <div className="mt-5 space-y-3">
        {lessons.map((lesson) => {
          const appearance = lessonAppearance[lesson.status]
          const LessonIcon = appearance.icon
          return (
            <article key={lesson.lessonId} className={`flex items-center gap-3 rounded-2xl border p-3.5 ${lesson.status === 'next' ? 'border-blue-200 bg-blue-50/40' : 'border-slate-100'}`}>
              <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${appearance.iconTone}`}>
                <LessonIcon className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold text-slate-400">第 {lesson.order} 课</p>
                <p className="mt-1 truncate text-sm font-black text-slate-800">{lesson.title}</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${appearance.badgeTone}`}>
                {lessonStatusLabel[lesson.status]}
              </span>
            </article>
          )
        })}
      </div>
    </section>
  )
}
