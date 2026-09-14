import { XiaoBao } from '@ai-xiaobao/chat-core'
import { BookOpenCheck, MessageSquareText, Plus, Search, TrendingUp, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CreateClassDialog } from './create-class-dialog'
import { TeacherClassCard } from './teacher-class-card'
import { filterTeacherClasses, getTeacherClassMetrics, type TeacherClassFilter } from './teacher-class-repository'
import { useTeacherWorkspace } from './teacher-provider'

interface TeacherClassesPageProps {
  initialQuery?: string
  initialStatus?: TeacherClassFilter['status']
}

export function TeacherClassesPage({ initialQuery = '', initialStatus = 'all' }: TeacherClassesPageProps) {
  const { data, createClass } = useTeacherWorkspace()
  const [query, setQuery] = useState(initialQuery)
  const [status, setStatus] = useState<TeacherClassFilter['status']>(initialStatus)
  const [createOpen, setCreateOpen] = useState(false)
  const classes = filterTeacherClasses(data, { query, status })
  const metrics = getTeacherClassMetrics(data)

  const clearFilters = () => {
    setQuery('')
    setStatus('all')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[#4c6fa9]">教学组织</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">班级管理</h1>
          <p className="mt-2 text-sm text-slate-500">查看负责班级、学生规模和课程进度，提前准备下一节课。</p>
        </div>
        <Button className="h-11 rounded-xl bg-[#3268b5] hover:bg-[#28589b]" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          新建班级
        </Button>
      </header>

      <CreateClassDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={createClass} />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: '负责班级',
            value: metrics.classCount,
            suffix: '个',
            icon: BookOpenCheck,
            tone: 'bg-blue-50 text-blue-600',
          },
          {
            label: '学生总数',
            value: metrics.studentCount,
            suffix: '人',
            icon: UsersRound,
            tone: 'bg-violet-50 text-violet-600',
          },
          {
            label: '平均进度',
            value: metrics.averageProgress,
            suffix: '%',
            icon: TrendingUp,
            tone: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: '待点评作品',
            value: metrics.pendingReviewCount,
            suffix: '份',
            icon: MessageSquareText,
            tone: 'bg-orange-50 text-orange-600',
          },
        ].map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索班级或课程"
              className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all', label: '全部班级' },
              { value: 'active', label: '进行中' },
              { value: 'completed', label: '已结课' },
            ].map((option) => (
              <Button
                key={option.value}
                size="sm"
                variant={status === option.value ? 'default' : 'outline'}
                className={status === option.value ? 'rounded-xl bg-[#3268b5]' : 'rounded-xl bg-white'}
                onClick={() => setStatus(option.value as TeacherClassFilter['status'])}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {classes.length > 0 ? (
        <section className="mt-6 grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
          {classes.map((classInfo) => (
            <TeacherClassCard key={classInfo.id} classInfo={classInfo} />
          ))}
        </section>
      ) : (
        <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Search className="mx-auto h-8 w-8 text-slate-300" />
          <h2 className="mt-4 text-lg font-black text-slate-800">没有找到班级</h2>
          <p className="mt-2 text-sm text-slate-500">换个关键词或清除当前状态筛选后再试。</p>
          <Button variant="outline" className="mt-5 rounded-xl" onClick={clearFilters}>
            清除筛选
          </Button>
        </section>
      )}

      {classes.length > 0 && (
        <section className="mt-6 flex items-center gap-4 rounded-3xl bg-gradient-to-r from-[#eef4ff] to-[#fff7e8] p-5 ring-1 ring-slate-200">
          <XiaoBao outfit="academy" mood="happy" action="wave" size={76} ariaLabel="小宝班级教学助手" />
          <div>
            <p className="text-sm font-black text-[#244a82]">小宝教学提示</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              二年级创作 A 班有 1 位学生近期活跃度偏低，建议下节课重点关注。
            </p>
          </div>
        </section>
      )}
    </main>
  )
}
