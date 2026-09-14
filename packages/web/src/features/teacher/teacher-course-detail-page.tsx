import { XiaoBao } from '@ai-xiaobao/chat-core'
import { ArrowLeft, CheckCircle2, CircleDotDashed, ClipboardCheck, Sparkles, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { getTeacherCourseDetail } from './teacher-course-repository'
import { formatCount } from './teacher-format'
import { TeacherCourseOutline } from './teacher-course-outline'
import { useTeacherWorkspace } from './teacher-provider'
import type { TeacherCourseDetail, TeacherDashboardData } from './types'

const stageLabels = {
  lower_primary: '小学低年级',
  upper_primary: '小学高年级',
  middle_school: '初中',
} satisfies Record<TeacherCourseDetail['stage'], string>

const statusLabels = {
  ready: '已就绪',
  draft: '待完善',
} satisfies Record<TeacherCourseDetail['status'], string>

export function TeacherCourseDetailPage() {
  const { courseId = '' } = useParams()
  const { data, assignCourse } = useTeacherWorkspace()
  const course = getTeacherCourseDetail(data, courseId)

  if (!course) return <Navigate to="/teacher/courses" replace />

  return (
    <TeacherCourseDetailContent key={course.id} course={course} classes={data.classes} assignCourse={assignCourse} />
  )
}

function TeacherCourseDetailContent({
  course,
  classes,
  assignCourse,
}: {
  course: TeacherCourseDetail
  classes: TeacherDashboardData['classes']
  assignCourse: (courseId: string, classIds: string[]) => void
}) {
  const [selectedClassIds, setSelectedClassIds] = useState(() => course.assignedClassIds)
  const [isSaved, setIsSaved] = useState(false)

  const toggleClass = (classId: string, isSelected: boolean) => {
    setIsSaved(false)
    setSelectedClassIds((current) =>
      isSelected ? [...current, classId] : current.filter((selectedId) => selectedId !== classId),
    )
  }

  const saveAssignment = () => {
    assignCourse(course.id, selectedClassIds)
    setIsSaved(true)
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <nav aria-label="课程详情面包屑" className="flex items-center gap-2 text-xs font-bold text-slate-500">
        <Link to="/teacher/courses" className="inline-flex items-center gap-1.5 hover:text-[#3268b5]">
          <ArrowLeft className="h-3.5 w-3.5" /> 课程中心
        </Link>
        <span>/</span>
        <span className="text-slate-700">{course.title}</span>
      </nav>

      <header className="mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#214a89] via-[#3268b5] to-[#4d86d2] p-6 text-white shadow-[0_18px_45px_rgba(39,79,148,0.2)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap gap-2 text-xs font-black">
              <span className="rounded-full bg-white/15 px-3 py-1">{stageLabels[course.stage]}</span>
              <span className="rounded-full bg-white/15 px-3 py-1">{statusLabels[course.status]}</span>
            </div>
            <h1 className="mt-4 text-3xl font-black">{course.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-blue-100">{course.description}</p>
          </div>
          <div className="hidden rounded-full bg-white/10 p-2 sm:block">
            <XiaoBao outfit="academy" mood="happy" action="wave" size={108} ariaLabel="小宝备课助手" />
          </div>
        </div>
      </header>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="inline-flex items-center gap-2 text-xs font-bold text-slate-500">
            <CircleDotDashed className="h-4 w-4 text-[#3268b5]" />
            适龄年龄
          </p>
          <p className="mt-3 text-xl font-black text-slate-900">{course.ageRange}</p>
        </article>
        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:col-span-2">
          <p className="inline-flex items-center gap-2 text-xs font-bold text-slate-500">
            <ClipboardCheck className="h-4 w-4 text-[#3268b5]" />
            预期作品
          </p>
          <p className="mt-3 text-sm font-bold leading-6 text-slate-800">{course.expectedOutcome}</p>
        </article>
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="space-y-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-slate-900">课程目标</h2>
            <ul className="mt-4 space-y-3">
              {course.goals.map((goal) => (
                <li key={goal} className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> {goal}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap gap-2" aria-label="能力标签">
              {[
                ...new Set(
                  course.chapters.flatMap((chapter) => chapter.lessons.flatMap((lesson) => lesson.capabilities)),
                ),
              ].map((capability) => (
                <span
                  key={capability}
                  className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700"
                >
                  {capability}
                </span>
              ))}
            </div>
          </article>
          <TeacherCourseOutline courseId={course.id} chapters={course.chapters} />
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-white p-2 text-[#3268b5] shadow-sm">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-black text-slate-900">小宝备课建议</h2>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  先和学生一起挑选一个最想实现的太空校园元素，再从一个简单动态效果开始。
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <UsersRound className="h-5 w-5 text-[#3268b5]" />
              <h2 className="text-lg font-black text-slate-900">班级分配</h2>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-500">选择本次演示中使用这门课程的班级。</p>
            <div className="mt-4 space-y-3">
              {classes.map((teacherClass) => (
                <label
                  key={teacherClass.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-100 p-3 hover:bg-slate-50"
                >
                  <Checkbox
                    checked={selectedClassIds.includes(teacherClass.id)}
                    onCheckedChange={(checked) => toggleClass(teacherClass.id, checked === true)}
                    aria-label={`分配给${teacherClass.name}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-slate-800">{teacherClass.name}</span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {formatCount(teacherClass.studentCount, ' 名学生')}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <Button className="mt-5 w-full rounded-xl bg-[#3268b5] hover:bg-[#28589b]" onClick={saveAssignment}>
              保存本次演示配置
            </Button>
            {isSaved && <p className="mt-3 text-center text-xs font-bold text-emerald-700">本次演示配置已保存</p>}
          </section>
        </aside>
      </section>
    </main>
  )
}
