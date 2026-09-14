import { useMemo, useState } from 'react'
import { Award, CheckCircle2, Clock3, MessageSquareText, Search, Sparkles, Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { filterTeacherWorks } from './teacher-work-repository'
import { useTeacherWorkspace } from './teacher-provider'
import type { TeacherWork, TeacherWorkRating, TeacherWorkStatus } from './types'

const ratingOptions: Array<{ value: TeacherWorkRating; label: string }> = [
  { value: 'encouraging', label: '继续加油' },
  { value: 'good', label: '表现良好' },
  { value: 'excellent', label: '非常出色' },
]

const ratingLabels: Record<TeacherWorkRating, string> = {
  encouraging: '继续加油',
  good: '表现良好',
  excellent: '非常出色',
}

export function TeacherWorksPage() {
  const { data, reviewWork, toggleFeaturedWork } = useTeacherWorkspace()
  const [keyword, setKeyword] = useState('')
  const [classId, setClassId] = useState('all')
  const [status, setStatus] = useState<TeacherWorkStatus | 'all'>('all')
  const [selectedWork, setSelectedWork] = useState<TeacherWork | null>(null)
  const [rating, setRating] = useState<TeacherWorkRating>('good')
  const [comment, setComment] = useState('')

  const works = useMemo(
    () => filterTeacherWorks(data.works, { keyword, classId, status }),
    [classId, data.works, keyword, status],
  )
  const pendingCount = data.works.filter((work) => work.status === 'pending').length
  const reviewedCount = data.works.filter((work) => work.status === 'reviewed').length
  const featuredCount = data.works.filter((work) => work.featured).length

  const openReview = (work: TeacherWork) => {
    setSelectedWork(work)
    setRating(work.rating ?? 'good')
    setComment(work.comment ?? '')
  }

  const saveReview = () => {
    if (!selectedWork || !comment.trim()) {
      toast.error('请填写点评内容')
      return
    }
    reviewWork(selectedWork.id, { rating, comment })
    setSelectedWork(null)
    toast.success('点评已保存')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-[#4c6fa9]">教学成果</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">作业与作品</h1>
        <p className="mt-2 text-sm text-slate-500">集中查看学生提交内容，完成点评并推荐优秀作品。</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '作品总数', value: data.works.length, icon: Sparkles, color: 'bg-blue-50 text-blue-600' },
          { label: '待点评', value: pendingCount, icon: Clock3, color: 'bg-orange-50 text-orange-600' },
          { label: '已点评', value: reviewedCount, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
          { label: '优秀作品', value: featuredCount, icon: Award, color: 'bg-violet-50 text-violet-600' },
        ].map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`grid h-9 w-9 place-items-center rounded-xl ${metric.color}`}>
              <metric.icon className="h-[18px] w-[18px]" />
            </div>
            <p className="mt-3 text-xs font-medium text-slate-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">{metric.value}</p>
          </article>
        ))}
      </section>

      <section className="mt-6 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索作品或学生"
            className="h-11 rounded-xl border-slate-200 pl-9"
          />
        </label>
        <select
          aria-label="按班级筛选"
          value={classId}
          onChange={(event) => setClassId(event.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="all">全部班级</option>
          {data.classes.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="按点评状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value as TeacherWorkStatus | 'all')}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="all">全部状态</option>
          <option value="pending">待点评</option>
          <option value="reviewed">已点评</option>
        </select>
      </section>

      {works.length > 0 ? (
        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {works.map((work) => (
            <article key={work.id} className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="relative bg-gradient-to-br from-[#eef4ff] via-white to-[#fff7e8]">
                <img src={work.previewAsset} alt={`${work.title}作品预览`} className="h-52 w-full object-contain p-5" />
                <button
                  type="button"
                  aria-label={work.featured ? `取消推荐${work.title}` : `推荐${work.title}`}
                  onClick={() => toggleFeaturedWork(work.id)}
                  className={`absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full border bg-white shadow-sm ${work.featured ? 'border-amber-300 text-amber-500' : 'border-slate-200 text-slate-400'}`}
                >
                  <Star className={`h-4 w-4 ${work.featured ? 'fill-current' : ''}`} />
                </button>
              </div>
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${work.status === 'pending' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-50 text-emerald-700'}`}
                  >
                    {work.status === 'pending' ? '待点评' : '已点评'}
                  </span>
                  <span className="text-[11px] text-slate-400">{work.submittedAt}</span>
                </div>
                <h2 className="mt-3 text-lg font-black text-slate-900">{work.title}</h2>
                <p className="mt-1 text-xs text-slate-500">
                  {work.studentName} · {work.type}
                </p>
                <p className="mt-1 truncate text-xs text-slate-400">{work.courseTitle}</p>
                {work.comment && (
                  <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                    <span className="font-bold text-[#3268b5]">
                      {work.rating ? ratingLabels[work.rating] : '教师点评'}：
                    </span>
                    {work.comment}
                  </div>
                )}
                <Button
                  onClick={() => openReview(work)}
                  className="mt-4 w-full rounded-xl bg-[#3268b5] hover:bg-[#28589b]"
                >
                  <MessageSquareText className="h-4 w-4" />
                  {work.status === 'pending' ? '点评作品' : '修改点评'}
                </Button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="font-bold text-slate-700">没有找到符合条件的作品</p>
          <p className="mt-2 text-sm text-slate-400">请尝试调整搜索词或筛选条件。</p>
        </section>
      )}

      <Dialog open={Boolean(selectedWork)} onOpenChange={(open) => !open && setSelectedWork(null)}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>点评作品</DialogTitle>
            <DialogDescription>
              {selectedWork ? `${selectedWork.studentName} · ${selectedWork.title}` : ''}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="mt-2">
            <legend className="text-sm font-bold text-slate-700">表现等级</legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {ratingOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRating(option.value)}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold ${rating === option.value ? 'border-[#3268b5] bg-blue-50 text-[#3268b5]' : 'border-slate-200 text-slate-500'}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-2 block text-sm font-bold text-slate-700">
            点评内容
            <Textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="写下具体、鼓励性的建议"
              className="mt-2 min-h-28 rounded-xl"
            />
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSelectedWork(null)} className="rounded-xl">
              取消
            </Button>
            <Button onClick={saveReview} className="rounded-xl bg-[#3268b5] hover:bg-[#28589b]">
              保存点评
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  )
}
