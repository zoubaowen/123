import { XiaoBao } from '@ai-xiaobao/chat-core'
import { useState } from 'react'
import { ArrowRight, CheckCircle2, Clock3, MessageSquareText, Play, Sparkles, UsersRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { StartClassDialog, createDefaultStartClassInput } from './start-class-dialog'
import { averageOrUnknown, formatCount, formatPercent, progressBarValue, sumOrUnknown } from './teacher-format'
import { useTeacherWorkspace } from './teacher-provider'
import type { StartClassInput } from './types'

interface TeacherDashboardPageProps {
  onStartClass?: (scheduleId: string) => void
}

export function TeacherDashboardPage({ onStartClass }: TeacherDashboardPageProps) {
  const navigate = useNavigate()
  const { data, start } = useTeacherWorkspace()
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null)
  const selectedSchedule = data.todaySchedule.find((item) => item.id === selectedScheduleId)
  const selectedClass = data.classes.find((item) => item.id === selectedSchedule?.classId)
  const selectedLesson = data.lessons.find((item) => item.id === selectedSchedule?.lessonId)
  const [startInput, setStartInput] = useState<StartClassInput | null>(null)
  const totalStudents = sumOrUnknown(data.classes.map((item) => item.studentCount))
  const averageProgress = averageOrUnknown(data.classes.map((item) => item.progress))
  const firstSchedule = data.todaySchedule[0]
  const firstCourse = data.courses.find((course) =>
    course.chapters.some((chapter) => chapter.lessons.some((lesson) => lesson.id === firstSchedule?.lessonId)),
  )
  const preparationPath =
    firstCourse && firstSchedule
      ? `/teacher/courses/${firstCourse.id}/lessons/${firstSchedule.lessonId}`
      : '/teacher/courses'

  const openStartClass = (scheduleId: string) => {
    onStartClass?.(scheduleId)
    const schedule = data.todaySchedule.find((item) => item.id === scheduleId)
    if (!schedule) return
    setSelectedScheduleId(scheduleId)
    setStartInput(createDefaultStartClassInput(schedule))
  }

  const closeStartClass = () => {
    setSelectedScheduleId(null)
    setStartInput(null)
  }

  const confirmStartClass = () => {
    if (!startInput) return
    start(startInput)
    toast.success('课堂已开始')
    navigate('/teacher/classroom/active')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#4c6fa9]">2026年8月15日 · 星期六</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">早上好，林老师</h1>
          <p className="mt-2 text-sm text-slate-500">今天有 2 节课，第一节将在 09:30 开始。</p>
        </div>
        <Button
          variant="outline"
          className="rounded-xl border-slate-200 bg-white"
          onClick={() =>
            document.getElementById('today-schedule')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          查看今日安排
          <ArrowRight className="h-4 w-4" />
        </Button>
      </header>

      <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-3xl bg-gradient-to-br from-[#274f94] via-[#3268bc] to-[#4a82d2] p-6 text-white shadow-[0_18px_45px_rgba(39,79,148,0.2)]">
          <div className="flex items-center justify-between gap-5">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
                <Sparkles className="h-3.5 w-3.5" />
                小宝教学助手
              </div>
              <h2 className="mt-4 text-2xl font-black">二年级创作 A 班还有 5 份作品待点评</h2>
              <p className="mt-2 text-sm leading-6 text-blue-100">
                第一节课建议提前打开“太空海报”课件，并确认图片生成能力已开启。
              </p>
              <Button asChild className="mt-5 rounded-xl bg-white text-[#285a9f] hover:bg-blue-50">
                <Link to={preparationPath}>查看课前准备</Link>
              </Button>
            </div>
            <div className="hidden h-36 w-36 shrink-0 place-items-center rounded-full bg-white/12 sm:grid">
              <XiaoBao outfit="academy" mood="happy" action="wave" size={132} ariaLabel="小宝教学助手" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {[
            { label: '今日课程', value: '2', suffix: '节', icon: Clock3, color: 'text-blue-600 bg-blue-50' },
            {
              label: '负责学生',
              value: formatCount(totalStudents, ''),
              suffix: '人',
              icon: UsersRound,
              color: 'text-violet-600 bg-violet-50',
            },
            {
              label: '平均进度',
              value: formatCount(averageProgress, ''),
              suffix: '%',
              icon: CheckCircle2,
              color: 'text-emerald-600 bg-emerald-50',
            },
            {
              label: '待点评',
              value: String(data.pendingReviews.length),
              suffix: '份',
              icon: MessageSquareText,
              color: 'text-orange-600 bg-orange-50',
            },
          ].map((metric) => (
            <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`grid h-9 w-9 place-items-center rounded-xl ${metric.color}`}>
                <metric.icon className="h-[18px] w-[18px]" />
              </div>
              <p className="mt-3 text-xs font-medium text-slate-500">{metric.label}</p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {metric.value}
                <span className="ml-1 text-xs font-semibold text-slate-400">{metric.suffix}</span>
              </p>
            </article>
          ))}
        </div>
      </section>

      <section
        id="today-schedule"
        className="mt-6 scroll-mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]"
      >
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">今天要上的课</h2>
              <p className="mt-1 text-xs text-slate-500">按时间准备课件并快速开课</p>
            </div>
            <Button asChild variant="ghost" size="sm" className="text-xs font-bold text-[#3268b5]">
              <Link to="/teacher/courses">查看全部课程</Link>
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {data.todaySchedule.map((schedule, index) => {
              const classInfo = data.classes.find((item) => item.id === schedule.classId)!
              const lesson = data.lessons.find((item) => item.id === schedule.lessonId)!
              return (
                <article
                  key={schedule.id}
                  className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-center"
                >
                  <div className="w-16 shrink-0">
                    <p className="text-xl font-black text-slate-900">{schedule.time}</p>
                    <p className="mt-1 text-[10px] font-semibold text-slate-400">{index === 0 ? '第一节' : '第二节'}</p>
                  </div>
                  <div className="min-w-0 flex-1 border-l border-slate-200 pl-4">
                    <p className="text-sm font-black text-slate-900">{lesson.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {classInfo.name} · {lesson.courseTitle}
                    </p>
                  </div>
                  <Button
                    variant={index === 0 ? 'default' : 'outline'}
                    className={index === 0 ? 'rounded-xl bg-[#3268b5] hover:bg-[#28589b]' : 'rounded-xl bg-white'}
                    onClick={() => openStartClass(schedule.id)}
                  >
                    <Play className="h-4 w-4" />
                    开始上课
                  </Button>
                </article>
              )
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black">待点评作品</h2>
            <Button asChild variant="ghost" size="sm" className="text-xs font-bold text-[#3268b5]">
              <Link to="/teacher/works">全部作品</Link>
            </Button>
          </div>
          <div className="mt-4 space-y-4">
            {data.pendingReviews.map((review, index) => (
              <article key={review.id} className="flex items-center gap-3">
                <div
                  className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-black ${index === 0 ? 'bg-orange-50 text-orange-600' : 'bg-violet-50 text-violet-600'}`}
                >
                  {review.studentName.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">{review.title}</p>
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    {review.studentName} · {review.type} · {review.submittedAt}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm" className="text-[#3268b5]">
                  <Link to="/teacher/works">点评</Link>
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.7fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black">班级学习进度</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {data.classes.map((classInfo) => (
              <article key={classInfo.id} className="rounded-2xl border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-black">{classInfo.name}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {classInfo.courseTitle} · {formatCount(classInfo.studentCount, ' 人')}
                    </p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">
                    完成率 {formatPercent(classInfo.completionRate)}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-3">
                  <Progress value={progressBarValue(classInfo.progress)} className="h-2" />
                  <span className="text-xs font-black text-slate-700">{formatPercent(classInfo.progress)}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black">最近课堂记录</h2>
            <Button asChild variant="ghost" size="sm" className="text-xs font-bold text-[#3268b5]">
              <Link to="/teacher/records">全部记录</Link>
            </Button>
          </div>
          <div className="mt-4 space-y-3">
            {data.recentSessions.map((session) => (
              <article key={session.id} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-black">{session.lessonTitle}</p>
                <p className="mt-1 text-xs text-slate-500">{session.className}</p>
                <p className="mt-3 text-[11px] font-semibold text-slate-400">
                  8月14日 · {session.durationMinutes} 分钟
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {startInput && selectedClass && selectedLesson && (
        <StartClassDialog
          open
          onOpenChange={(open) => !open && closeStartClass()}
          className={selectedClass.name}
          lessonTitle={selectedLesson.title}
          value={startInput}
          onChange={setStartInput}
          onCancel={closeStartClass}
          onConfirm={confirmStartClass}
        />
      )}
    </main>
  )
}
