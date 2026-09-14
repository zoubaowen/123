import { XiaoBao } from '@ai-xiaobao/chat-core'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Lightbulb, Play, Route, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StartClassDialog } from './start-class-dialog'
import { formatCount } from './teacher-format'
import {
  createCourseLessonStartInput,
  getTeacherCourseDetail,
  getTeacherCourseLesson,
} from './teacher-course-repository'
import { TeacherLessonAiConfig } from './teacher-lesson-ai-config'
import { TeacherLessonResourceList } from './teacher-lesson-resource-list'
import { useTeacherWorkspace } from './teacher-provider'
import type { StartClassInput, TeacherCourseDetail, TeacherCourseLessonDetail, TeacherDashboardData } from './types'

export function TeacherLessonPreparationPage() {
  const { courseId = '', lessonId = '' } = useParams()
  const { data, start } = useTeacherWorkspace()
  const course = getTeacherCourseDetail(data, courseId)

  if (!course) return <Navigate to="/teacher/courses" replace />

  const lesson = getTeacherCourseLesson(data, course.id, lessonId)
  if (!lesson) return <Navigate to={`/teacher/courses/${course.id}`} replace />

  return (
    <TeacherLessonPreparationContent
      key={`${course.id}-${lesson.id}`}
      data={data}
      course={course}
      lesson={lesson}
      start={start}
    />
  )
}

function TeacherLessonPreparationContent({
  data,
  course,
  lesson,
  start,
}: {
  data: TeacherDashboardData
  course: TeacherCourseDetail
  lesson: TeacherCourseLessonDetail
  start: (input: StartClassInput) => void
}) {
  const navigate = useNavigate()
  const assignedClasses = course.assignedClassIds
    .map((classId) => data.classes.find((teacherClass) => teacherClass.id === classId))
    .filter((teacherClass): teacherClass is TeacherDashboardData['classes'][number] => Boolean(teacherClass))
  const [selectedClassId, setSelectedClassId] = useState(() => assignedClasses[0]?.id ?? '')
  const [startInput, setStartInput] = useState<StartClassInput | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const noAssignedClass = assignedClasses.length === 0
  const hasActiveSession = Boolean(data.activeSession)
  const selectedClass = assignedClasses.find((teacherClass) => teacherClass.id === selectedClassId)

  const openStartDialog = () => {
    const input = createCourseLessonStartInput(data, course.id, lesson.id, selectedClassId)
    if (!input) return
    setStartInput(input)
    setIsDialogOpen(true)
  }

  const confirmStart = () => {
    if (!startInput) return
    start(startInput)
    setIsDialogOpen(false)
    toast.success('课堂已开始')
    navigate('/teacher/classroom/active')
  }

  const startDisabled = noAssignedClass || hasActiveSession
  const startHint = noAssignedClass
    ? '请先返回课程详情分配班级'
    : hasActiveSession
      ? '已有课堂进行中'
      : '确认课堂 AI 能力与资源后，即可带领学生开始创作。'

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <nav aria-label="课时备课面包屑" className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <Link to={`/teacher/courses/${course.id}`} className="inline-flex items-center gap-1.5 hover:text-[#3268b5]">
          <ArrowLeft className="h-3.5 w-3.5" /> {course.title}
        </Link>
        <span>/</span>
        <span className="text-slate-700">课时备课</span>
      </nav>

      <header className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#214a89] via-[#3268b5] to-[#4d86d2] p-6 text-white shadow-[0_18px_45px_rgba(39,79,148,0.2)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-blue-100">
              课时备课 · {lesson.durationMinutes} 分钟
            </p>
            <h1 className="mt-3 text-3xl font-black">{lesson.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100">为本节课准备清晰的创作步骤与安全的 AI 工具配置。</p>
          </div>
          <div className="hidden rounded-full bg-white/10 p-2 sm:block">
            <XiaoBao outfit="academy" mood="thinking" action="wave" size={108} ariaLabel="小宝备课助手" />
          </div>
        </div>
      </header>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="space-y-6">
          <LessonListCard title="教学目标" icon={CheckCircle2} items={lesson.objectives} />
          <LessonListCard title="课堂步骤" icon={Route} items={lesson.steps} ordered />
          <LessonListCard title="教师提示" icon={Lightbulb} items={lesson.teacherTips} />

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <ClipboardCheck className="h-5 w-5 text-[#3268b5]" /> 课后作业
            </h2>
            <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950">
              {lesson.assignment}
            </p>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">教学资源</h2>
            <div className="mt-4">
              <TeacherLessonResourceList resources={lesson.resources} />
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">课堂 AI 配置</h2>
            <p className="mt-1 text-xs text-slate-500">小宝会仅在本节课中开放以下能力和学习资源。</p>
            <div className="mt-4">
              <TeacherLessonAiConfig
                capabilities={lesson.capabilities}
                skills={lesson.skills}
                mcpServers={lesson.mcpServers}
              />
            </div>
          </article>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white p-2 text-[#3268b5] shadow-sm">
                <UsersRound className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-black text-slate-900">选择上课班级</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">课程分配给的班级才可以开始本节课堂。</p>
              </div>
            </div>
            <div className="mt-5">
              <Label htmlFor="lesson-class-select" className="sr-only">
                选择上课班级
              </Label>
              <Select value={selectedClassId} onValueChange={setSelectedClassId} disabled={noAssignedClass}>
                <SelectTrigger id="lesson-class-select" aria-label="选择上课班级" className="w-full bg-white">
                  <SelectValue placeholder="暂无已分配班级" />
                </SelectTrigger>
                <SelectContent>
                  {assignedClasses.map((teacherClass) => (
                    <SelectItem key={teacherClass.id} value={teacherClass.id}>
                      {teacherClass.name} · {formatCount(teacherClass.studentCount, ' 名学生')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className={`mt-4 text-xs font-bold ${startDisabled ? 'text-amber-700' : 'text-slate-600'}`}>
              {startHint}
            </p>
            <Button
              className="mt-5 h-12 w-full rounded-xl bg-[#3268b5] font-black hover:bg-[#28589b]"
              disabled={startDisabled}
              onClick={openStartDialog}
            >
              <Play className="h-4 w-4" /> 开始上课
            </Button>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <XiaoBao outfit="academy" mood="happy" action="wave" size={64} ariaLabel="小宝课堂提醒" />
              <p className="text-xs font-bold leading-5 text-slate-600">
                小宝已准备好陪同学生创作，也会按本节课配置安全地使用工具。
              </p>
            </div>
          </section>
        </aside>
      </section>

      {startInput && selectedClass && (
        <StartClassDialog
          open={isDialogOpen}
          onOpenChange={setIsDialogOpen}
          className={selectedClass.name}
          lessonTitle={lesson.title}
          value={startInput}
          onChange={setStartInput}
          onCancel={() => setIsDialogOpen(false)}
          onConfirm={confirmStart}
        />
      )}
    </main>
  )
}

function LessonListCard({
  title,
  icon: Icon,
  items,
  ordered = false,
}: {
  title: string
  icon: typeof CheckCircle2
  items: string[]
  ordered?: boolean
}) {
  const List = ordered ? 'ol' : 'ul'

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
        <Icon className="h-5 w-5 text-[#3268b5]" /> {title}
      </h2>
      <List className="mt-4 space-y-3">
        {items.map((item, index) => (
          <li key={item} className="flex gap-3 text-sm font-semibold leading-6 text-slate-700">
            {ordered ? (
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-black text-[#3268b5]">
                {index + 1}
              </span>
            ) : (
              <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-600" />
            )}
            <span>{item}</span>
          </li>
        ))}
      </List>
    </article>
  )
}
