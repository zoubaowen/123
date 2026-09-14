import { XiaoBao } from '@ai-xiaobao/chat-core'
import { BookOpenCheck, ClipboardList, Search, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TeacherCourseCard } from './teacher-course-card'
import { filterTeacherCourses, getTeacherCourseMetrics, type TeacherCourseFilter } from './teacher-course-repository'
import { useTeacherWorkspace } from './teacher-provider'

interface TeacherCoursesPageProps {
  initialQuery?: string
}

const stageOptions = [
  { value: 'all', label: '全部学段' },
  { value: 'lower_primary', label: '小学低年级' },
  { value: 'upper_primary', label: '小学高年级' },
  { value: 'middle_school', label: '初中' },
] satisfies Array<{ value: TeacherCourseFilter['stage']; label: string }>

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'ready', label: '已就绪' },
  { value: 'draft', label: '待完善' },
] satisfies Array<{ value: TeacherCourseFilter['status']; label: string }>

export function TeacherCoursesPage({ initialQuery = '' }: TeacherCoursesPageProps) {
  const { data } = useTeacherWorkspace()
  const [query, setQuery] = useState(initialQuery)
  const [stage, setStage] = useState<TeacherCourseFilter['stage']>('all')
  const [topic, setTopic] = useState<TeacherCourseFilter['topic']>('all')
  const [status, setStatus] = useState<TeacherCourseFilter['status']>('all')
  const courses = filterTeacherCourses(data, { query, stage, topic, status })
  const metrics = getTeacherCourseMetrics(data)
  const topics = [...new Set(data.courses.map((course) => course.topic))]

  const clearFilters = () => {
    setQuery('')
    setStage('all')
    setTopic('all')
    setStatus('all')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header>
        <p className="text-sm font-bold text-[#4c6fa9]">教学资源</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">课程中心</h1>
        <p className="mt-2 text-sm text-slate-500">集中了解内容安排、班级分配与备课完善进度。</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: '课程总数',
            value: metrics.courseCount,
            suffix: '门',
            icon: BookOpenCheck,
            tone: 'bg-blue-50 text-blue-600',
          },
          {
            label: '总课时',
            value: metrics.lessonCount,
            suffix: '课时',
            icon: ClipboardList,
            tone: 'bg-violet-50 text-violet-600',
          },
          {
            label: '已分配班级',
            value: metrics.assignedClassCount,
            suffix: '个',
            icon: UsersRound,
            tone: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: '待完善课程',
            value: metrics.draftCourseCount,
            suffix: '门',
            icon: Search,
            tone: 'bg-amber-50 text-amber-600',
          },
        ].map((metric) => (
          <article
            key={metric.label}
            aria-label={`${metric.label}：${metric.value}${metric.suffix}`}
            className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className={`grid h-9 w-9 place-items-center rounded-xl ${metric.tone}`}>
              <metric.icon className="h-[18px] w-[18px]" />
            </div>
            <p className="mt-3 text-xs font-semibold text-slate-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">
              {metric.value}
              <span className="ml-1 text-xs text-slate-400">{metric.suffix}</span>
            </p>
          </article>
        ))}
      </section>

      <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索课程、主题或课程简介"
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Select value={stage} onValueChange={(value) => setStage(value as TeacherCourseFilter['stage'])}>
              <SelectTrigger className="h-10 w-full rounded-xl bg-white sm:w-36">
                <SelectValue placeholder="选择学段" />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={topic} onValueChange={(value) => setTopic(value as TeacherCourseFilter['topic'])}>
              <SelectTrigger className="h-10 w-full rounded-xl bg-white sm:w-36">
                <SelectValue placeholder="选择主题" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部主题</SelectItem>
                {topics.map((topicOption) => (
                  <SelectItem key={topicOption} value={topicOption}>
                    {topicOption}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(value) => setStatus(value as TeacherCourseFilter['status'])}>
              <SelectTrigger className="h-10 w-full rounded-xl bg-white sm:w-36">
                <SelectValue placeholder="选择状态" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {courses.length > 0 ? (
        <>
          <section className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {courses.map((course) => (
              <TeacherCourseCard key={course.id} course={course} />
            ))}
          </section>
          <section className="mt-6 flex items-center gap-4 rounded-3xl bg-gradient-to-r from-[#eef4ff] to-[#fff7e8] p-5 ring-1 ring-slate-200">
            <XiaoBao outfit="academy" mood="happy" action="wave" size={76} ariaLabel="小宝课程备课助手" />
            <div>
              <p className="text-sm font-black text-[#244a82]">小宝备课提示</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                先完善待备课程的课堂活动和资源，再安排下一次班级教学会更从容。
              </p>
            </div>
          </section>
        </>
      ) : (
        <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300" />
          <h2 className="mt-4 text-lg font-black text-slate-800">没有找到课程</h2>
          <p className="mt-2 text-sm text-slate-500">换个关键词或清除当前筛选后再试。</p>
          <Button variant="outline" className="mt-5 rounded-xl" onClick={clearFilters}>
            清除筛选
          </Button>
        </section>
      )}
    </main>
  )
}
