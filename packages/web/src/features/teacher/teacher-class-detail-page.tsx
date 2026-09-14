import { XiaoBao } from '@ai-xiaobao/chat-core'
import { ArrowLeft, BookOpen, CalendarClock, CheckCircle2, Clock3, Coins, Play, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ClassBudgetDialog } from './class-budget-dialog'
import { ClassTeachersDialog } from './class-teachers-dialog'
import { getTeacherClassDetail } from './teacher-class-repository'
import { formatCount, formatPercent, progressBarValue } from './teacher-format'
import { TeacherLessonProgressList } from './teacher-lesson-progress-list'
import { StartClassDialog, createDefaultStartClassInput } from './start-class-dialog'
import { TeacherStudentRoster } from './teacher-student-roster'
import { useTeacherWorkspace } from './teacher-provider'
import type { StartClassInput } from './types'

export function TeacherClassDetailPage() {
  const { classId = '' } = useParams()
  const navigate = useNavigate()
  const {
    data,
    start,
    canManage,
    canSearchStudents,
    canSearchTeachers,
    searchStudents,
    searchTeachers,
    addStudent,
    removeStudent,
    setClassBudget,
    assignTeacher,
    removeTeacher,
  } = useTeacherWorkspace()
  const detail = getTeacherClassDetail(data, classId)
  const [startInput, setStartInput] = useState<StartClassInput | null>(null)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [teachersOpen, setTeachersOpen] = useState(false)

  if (!detail) return <Navigate to="/teacher/classes" replace />

  const nextLesson = data.lessons.find((lesson) => lesson.id === detail.summary.nextLessonId)
  const nextSchedule = data.todaySchedule.find(
    (schedule) => schedule.classId === detail.summary.id && schedule.lessonId === detail.summary.nextLessonId,
  )
  const canPrepare = detail.summary.status === 'active' && nextLesson && nextSchedule

  const confirmStartClass = () => {
    if (!startInput) return
    start(startInput)
    toast.success('课堂已开始')
    navigate('/teacher/classroom/active')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <Link
        to="/teacher/classes"
        className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-[#3268b5]"
      >
        <ArrowLeft className="h-4 w-4" /> 返回班级总览
      </Link>

      <header className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#214a89] via-[#3268b5] to-[#4d86d2] p-6 text-white shadow-[0_18px_45px_rgba(39,79,148,0.2)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
              <BookOpen className="h-3.5 w-3.5" /> 进行中的教学班
            </div>
            <h1 className="mt-4 text-3xl font-black">{detail.summary.name}</h1>
            <p className="mt-2 text-sm text-blue-100">{detail.summary.courseTitle}</p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs font-bold text-blue-50">
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <UsersRound className="h-4 w-4" />
                {formatCount(detail.summary.studentCount, ' 名学生')}
              </span>
              <span className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2">
                <CheckCircle2 className="h-4 w-4" />
                完成率 {formatPercent(detail.summary.completionRate)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden rounded-full bg-white/10 p-2 sm:block">
              <XiaoBao outfit="academy" mood="happy" action="wave" size={104} ariaLabel="小宝班级助手" />
            </div>
            {canPrepare && (
              <Button
                className="h-12 rounded-xl bg-white px-5 text-[#285a9f] hover:bg-blue-50"
                disabled={Boolean(data.activeSession)}
                onClick={() => setStartInput(createDefaultStartClassInput(nextSchedule))}
              >
                <Play className="h-4 w-4" /> {data.activeSession ? '已有课堂进行中' : '准备上课'}
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-slate-900">整体学习进度</h2>
              <p className="mt-1 text-xs text-slate-500">根据课程课节和学生任务完成情况计算</p>
            </div>
            <span className="text-2xl font-black text-[#3268b5]">{formatPercent(detail.summary.progress)}</span>
          </div>
          <Progress value={progressBarValue(detail.summary.progress)} className="mt-5 h-2.5" />
        </article>

        <article className="rounded-3xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-black text-[#315f9f]">
            <CalendarClock className="h-4 w-4" />
            下一课节
          </div>
          <p className="mt-3 text-sm font-black text-slate-900">{nextLesson?.title ?? '课程已全部完成'}</p>
          <p className="mt-2 text-xs text-slate-500">
            {nextSchedule ? `${nextSchedule.time} · 今日安排` : '暂无待上课程安排'}
          </p>
        </article>
      </section>

      {canManage && (
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <article className="rounded-3xl border border-amber-100 bg-amber-50/50 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-black text-amber-900">
                  <Coins className="h-4 w-4" />
                  班级共享额度
                </div>
                <p className="mt-2 text-sm font-black text-slate-900">
                  {detail.summary.xiaobaoCreditLimit === null || detail.summary.xiaobaoCreditLimit === undefined
                    ? '未设上限'
                    : `${detail.summary.xiaobaoCreditLimit} 点`}
                </p>
                <p className="mt-1 text-xs text-slate-500">整班共用；用完后学生无法开始新任务，直到上限被调高。</p>
              </div>
              <Button variant="outline" className="h-10 rounded-xl" onClick={() => setBudgetOpen(true)}>
                设置额度
              </Button>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-black text-slate-700">
                  <UsersRound className="h-4 w-4" />
                  任课老师
                </div>
                <p className="mt-2 text-sm font-black text-slate-900">
                  {(detail.teachers ?? []).length === 0
                    ? '尚未分配'
                    : (detail.teachers ?? []).map((teacher) => teacher.name).join('、')}
                </p>
                <p className="mt-1 text-xs text-slate-500">主班老师可以开课与关联课包；协助老师默认只能查看。</p>
              </div>
              <Button
                variant="outline"
                className="h-10 rounded-xl"
                // 演示源没有机构成员目录：按钮留着也选不出人来
                disabled={!canSearchTeachers}
                onClick={() => setTeachersOpen(true)}
              >
                分配老师
              </Button>
            </div>
          </article>
        </section>
      )}

      <section className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <TeacherStudentRoster
          students={detail.students}
          canManage={canManage}
          // 演示源没有机构学生目录：不提供"加入学生"，也就不会让老师搜出一堆假学生
          onSearch={canSearchStudents ? searchStudents : undefined}
          onAdd={(studentUserId) => addStudent(detail.summary.id, studentUserId)}
          onRemove={(studentUserId) => removeStudent(detail.summary.id, studentUserId)}
        />
        <TeacherLessonProgressList lessons={detail.lessonProgress} />
      </section>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-black text-slate-900">近期课堂记录</h2>
        {detail.recentSessions.length > 0 ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {detail.recentSessions.map((session) => (
              <article key={session.id} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-black text-slate-800">{session.lessonTitle}</p>
                <div className="mt-3 flex items-center gap-4 text-[11px] font-semibold text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5" />
                    {session.durationMinutes} 分钟
                  </span>
                  <span>8月14日</span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-xs text-slate-500">
            暂无已完成课堂记录，完成下一节课后会自动出现在这里。
          </p>
        )}
      </section>

      {startInput && nextLesson && (
        <StartClassDialog
          open
          onOpenChange={(open) => !open && setStartInput(null)}
          className={detail.summary.name}
          lessonTitle={nextLesson.title}
          value={startInput}
          onChange={setStartInput}
          onCancel={() => setStartInput(null)}
          onConfirm={confirmStartClass}
        />
      )}

      {canManage && (
        <ClassBudgetDialog
          open={budgetOpen}
          creditLimit={detail.summary.xiaobaoCreditLimit ?? null}
          onOpenChange={setBudgetOpen}
          onSave={(creditLimit) => setClassBudget(detail.summary.id, creditLimit)}
        />
      )}

      {canManage && canSearchTeachers && (
        <ClassTeachersDialog
          open={teachersOpen}
          teachers={detail.teachers ?? []}
          onOpenChange={setTeachersOpen}
          onSearch={searchTeachers}
          onAssign={(userId, role) => assignTeacher(detail.summary.id, userId, role)}
          onRemove={(userId) => removeTeacher(detail.summary.id, userId)}
        />
      )}
    </main>
  )
}
