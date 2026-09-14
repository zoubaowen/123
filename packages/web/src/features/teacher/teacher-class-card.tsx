import { ArrowRight, BookOpen, CalendarClock, CheckCircle2, UsersRound } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatCount, formatPercent, progressBarValue } from './teacher-format'
import type { TeacherClassDetail } from './types'

export function TeacherClassCard({ classInfo }: { classInfo: TeacherClassDetail['summary'] }) {
  const isCompleted = classInfo.status === 'completed'

  return (
    <article className="group flex h-full flex-col rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef4ff] text-[#3268b5]">
          <BookOpen className="h-5 w-5" />
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[10px] font-black ${
            isCompleted ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {isCompleted ? '已结课' : '进行中'}
        </span>
      </div>

      <h2 className="mt-4 text-lg font-black text-slate-900">{classInfo.name}</h2>
      <p className="mt-1 text-xs font-medium text-slate-500">{classInfo.courseTitle}</p>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
            <UsersRound className="h-3.5 w-3.5" /> 学生人数
          </div>
          <p className="mt-2 text-lg font-black text-slate-800">
            {formatCount(classInfo.studentCount, '')}
            <span className="ml-1 text-[10px] text-slate-400">人</span>
          </p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> 完成率
          </div>
          <p className="mt-2 text-lg font-black text-slate-800">{formatPercent(classInfo.completionRate)}</p>
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-600">课程进度</span>
          <span className="font-black text-[#3268b5]">{formatPercent(classInfo.progress)}</span>
        </div>
        <Progress value={progressBarValue(classInfo.progress)} className="mt-2 h-2" />
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-2xl bg-blue-50/70 px-3 py-2.5 text-[11px] font-bold text-[#315f9f]">
        <CalendarClock className="h-4 w-4" />
        {isCompleted ? '课程已完成' : classInfo.nextLessonId ? '下一课节已安排' : '等待安排下一课节'}
      </div>

      <Button asChild className="mt-5 w-full rounded-xl bg-[#3268b5] hover:bg-[#28589b]">
        <Link to={`/teacher/classes/${classInfo.id}`}>
          查看班级 <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    </article>
  )
}
