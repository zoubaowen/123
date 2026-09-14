import { BookOpen, CheckCircle2, Clock3, ListChecks } from 'lucide-react'
import { Link } from 'react-router'
import { Progress } from '@/components/ui/progress'
import type { TeacherCourseChapter } from './types'

export function TeacherCourseOutline({ courseId, chapters }: { courseId: string; chapters: TeacherCourseChapter[] }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-blue-50 p-2.5 text-[#3268b5]">
          <ListChecks className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-900">章节与课时</h2>
          <p className="mt-1 text-xs text-slate-500">按章节安排备课，随时查看每节课的完成情况。</p>
        </div>
      </div>

      <div className="mt-5 space-y-5">
        {chapters.map((chapter) => (
          <section key={chapter.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <div className="flex items-center gap-2 text-sm font-black text-slate-800">
              <BookOpen className="h-4 w-4 text-[#3268b5]" />第 {chapter.order} 章 · {chapter.title}
            </div>
            <div className="mt-3 space-y-3">
              {chapter.lessons.map((lesson) => (
                <article key={lesson.id} className="rounded-xl bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-black text-slate-900">{lesson.title}</h3>
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                        <Clock3 className="h-3.5 w-3.5" /> {lesson.durationMinutes} 分钟
                      </p>
                    </div>
                    <Link
                      to={`/teacher/courses/${courseId}/lessons/${lesson.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-2 text-xs font-black text-[#3268b5] hover:bg-blue-100"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> 准备课时
                    </Link>
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <Progress
                      value={lesson.completion}
                      className="h-2 flex-1 bg-blue-100 [&>[data-slot=progress-indicator]]:bg-[#3268b5]"
                    />
                    <span className="text-xs font-black text-[#3268b5]">完善度 {lesson.completion}%</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}
