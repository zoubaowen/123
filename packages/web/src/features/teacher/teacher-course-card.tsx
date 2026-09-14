import { ArrowRight, BookOpen, Layers3, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { formatPercent, progressBarValue } from './teacher-format'
import type { TeacherCourseSummary } from './types'

const courseStageLabels = {
  lower_primary: '小学低年级',
  upper_primary: '小学高年级',
  middle_school: '初中',
} satisfies Record<TeacherCourseSummary['stage'], string>

const courseStatusLabels = {
  ready: '已就绪',
  draft: '待完善',
} satisfies Record<TeacherCourseSummary['status'], string>

export function TeacherCourseCard({ course }: { course: TeacherCourseSummary }) {
  const [isCoverVisible, setIsCoverVisible] = useState(true)

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg">
      {isCoverVisible && (
        <img
          src={course.coverAsset}
          alt={`${course.title}课程封面`}
          className="h-44 w-full bg-gradient-to-br from-[#eef4ff] via-white to-[#fff7e8] object-contain p-4 sm:h-48"
          onError={() => setIsCoverVisible(false)}
        />
      )}

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-black text-[#3268b5]">
              {courseStageLabels[course.stage]}
            </span>
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-black text-violet-700">
              {course.topic}
            </span>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black ${
              course.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {courseStatusLabels[course.status]}
          </span>
        </div>

        <h2 className="mt-4 text-lg font-black text-slate-900">{course.title}</h2>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{course.description}</p>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
              <BookOpen className="h-3.5 w-3.5" /> 课程课时
            </p>
            <p className="mt-2 text-lg font-black text-slate-800">
              {course.lessonCount}
              <span className="ml-1 text-[10px] text-slate-400">课时</span>
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
              <UsersRound className="h-3.5 w-3.5" /> 已分配班级
            </p>
            <p className="mt-2 text-lg font-black text-slate-800">
              {course.assignedClassIds.length}
              <span className="ml-1 text-[10px] text-slate-400">个</span>
            </p>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5 font-bold text-slate-600">
              <Layers3 className="h-3.5 w-3.5 text-[#3268b5]" /> 完善进度
            </span>
            {/* 完善度后端还不提供：显示占位符而不是 0%——那会被读成"这门课一点没做" */}
            <span className="font-black text-[#3268b5]">{formatPercent(course.completion)}</span>
          </div>
          <Progress
            value={progressBarValue(course.completion)}
            className="mt-2 h-2 bg-blue-100 [&>[data-slot=progress-indicator]]:bg-[#3268b5]"
          />
        </div>

        <Button asChild className="mt-5 w-full rounded-xl bg-[#3268b5] hover:bg-[#28589b]">
          <Link to={`/teacher/courses/${course.id}`}>
            查看课程 <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </article>
  )
}
