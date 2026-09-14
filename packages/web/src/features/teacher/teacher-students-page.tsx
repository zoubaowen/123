import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, PencilLine, Search, UserRound, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { useSearchParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { filterTeacherStudents, listTeacherStudents, type TeacherStudentListItem } from './teacher-student-repository'
import { progressBarValue } from './teacher-format'
import { useTeacherWorkspace } from './teacher-provider'
import type { TeacherStudentLearningStatus } from './types'

const statusLabels: Record<TeacherStudentLearningStatus, string> = {
  creating: '创作中',
  completed: '本周任务完成',
  needs_attention: '需要关注',
}

const statusTones: Record<TeacherStudentLearningStatus, string> = {
  creating: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  needs_attention: 'bg-orange-50 text-orange-700',
}

export function TeacherStudentsPage() {
  const { data, updateStudentStatus } = useTeacherWorkspace()
  const [searchParams] = useSearchParams()
  const [keyword, setKeyword] = useState('')
  const [classId, setClassId] = useState(() => searchParams.get('classId') ?? 'all')
  const [status, setStatus] = useState<TeacherStudentLearningStatus | 'all'>(() => {
    const requestedStatus = searchParams.get('status')
    return requestedStatus === 'creating' || requestedStatus === 'completed' || requestedStatus === 'needs_attention'
      ? requestedStatus
      : 'all'
  })
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null)
  const allStudents = useMemo(() => listTeacherStudents(data), [data])
  const students = useMemo(
    () => filterTeacherStudents(allStudents, { keyword, classId, status }),
    [allStudents, classId, keyword, status],
  )
  const selectedStudent = allStudents.find((student) => student.id === selectedStudentId) ?? null
  const selectedWorks = selectedStudent ? data.works.filter((work) => work.studentName === selectedStudent.name) : []
  const creatingCount = allStudents.filter((student) => student.status === 'creating').length
  const completedCount = allStudents.filter((student) => student.status === 'completed').length
  const attentionCount = allStudents.filter((student) => student.status === 'needs_attention').length

  const toggleAttention = (student: TeacherStudentListItem) => {
    const nextStatus = student.status === 'needs_attention' ? 'creating' : 'needs_attention'
    updateStudentStatus(student.id, nextStatus)
    toast.success(nextStatus === 'needs_attention' ? '已标记为需要关注' : '已恢复为创作中')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-[#4c6fa9]">学习成长</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">学生管理</h1>
        <p className="mt-2 text-sm text-slate-500">跨班级查看学生进度，及时发现需要关注的学习状态。</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: '学生总数', value: allStudents.length, icon: UsersRound, color: 'bg-violet-50 text-violet-600' },
          { label: '创作中', value: creatingCount, icon: PencilLine, color: 'bg-blue-50 text-blue-600' },
          { label: '本周完成', value: completedCount, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
          { label: '需要关注', value: attentionCount, icon: AlertCircle, color: 'bg-orange-50 text-orange-600' },
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
            placeholder="搜索学生姓名"
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
          aria-label="按学习状态筛选"
          value={status}
          onChange={(event) => setStatus(event.target.value as TeacherStudentLearningStatus | 'all')}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="all">全部状态</option>
          <option value="creating">创作中</option>
          <option value="completed">本周任务完成</option>
          <option value="needs_attention">需要关注</option>
        </select>
      </section>

      <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {students.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left">
              <thead className="bg-slate-50 text-[11px] font-bold text-slate-400">
                <tr>
                  <th className="px-5 py-4">学生</th>
                  <th className="px-5 py-4">班级与课程</th>
                  <th className="px-5 py-4">学习状态</th>
                  <th className="px-5 py-4">任务完成</th>
                  <th className="px-5 py-4">最近活跃</th>
                  <th className="px-5 py-4 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {students.map((student, index) => {
                  // 后端还没提供任务数时显示占位符：0/0 会被读成"这个学生什么都没做"
                  const hasCounters = student.completedTasks !== undefined && student.totalTasks !== undefined
                  const percentage =
                    hasCounters && student.totalTasks! > 0
                      ? Math.round((student.completedTasks! / student.totalTasks!) * 100)
                      : null
                  return (
                    <tr key={student.id} className="border-t border-slate-100 text-sm text-slate-700">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`grid h-10 w-10 place-items-center rounded-full text-xs font-black ${index % 2 ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}
                          >
                            {student.name.slice(0, 1)}
                          </div>
                          <span className="font-black text-slate-900">{student.name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-bold">{student.className}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{student.courseTitle}</p>
                      </td>
                      <td className="px-5 py-4">
                        {student.status ? (
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-black ${statusTones[student.status]}`}
                          >
                            {statusLabels[student.status]}
                          </span>
                        ) : (
                          <span className="text-xs font-bold text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex min-w-36 items-center gap-3">
                          <Progress value={progressBarValue(percentage)} className="h-1.5" />
                          <span className="whitespace-nowrap text-xs font-bold text-slate-500">
                            {hasCounters ? `${student.completedTasks}/${student.totalTasks}` : '—'}
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-xs text-slate-500">{student.lastActiveAt ?? '—'}</td>
                      <td className="px-5 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedStudentId(student.id)}
                          className="text-[#3268b5]"
                        >
                          查看学习概况
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-16 text-center">
            <p className="font-bold text-slate-700">没有找到符合条件的学生</p>
            <p className="mt-2 text-sm text-slate-400">请调整姓名或筛选条件。</p>
          </div>
        )}
      </section>

      <Dialog open={Boolean(selectedStudent)} onOpenChange={(open) => !open && setSelectedStudentId(null)}>
        <DialogContent className="rounded-3xl sm:max-w-lg">
          {selectedStudent && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <UserRound className="h-5 w-5 text-[#3268b5]" />
                  {selectedStudent.name}的学习概况
                </DialogTitle>
                <DialogDescription>
                  {selectedStudent.className} · {selectedStudent.courseTitle}
                </DialogDescription>
              </DialogHeader>
              <div className="mt-2 rounded-2xl bg-slate-50 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-bold text-slate-700">任务完成度</span>
                  <span className="font-black text-[#3268b5]">
                    {selectedStudent.completedTasks === undefined || selectedStudent.totalTasks === undefined
                      ? '—'
                      : `${selectedStudent.completedTasks}/${selectedStudent.totalTasks}`}
                  </span>
                </div>
                <Progress
                  value={progressBarValue(
                    selectedStudent.completedTasks === undefined ||
                      selectedStudent.totalTasks === undefined ||
                      selectedStudent.totalTasks === 0
                      ? null
                      : (selectedStudent.completedTasks / selectedStudent.totalTasks) * 100,
                  )}
                  className="mt-3 h-2"
                />
                <p className="mt-3 text-xs text-slate-500">最近活跃：{selectedStudent.lastActiveAt ?? '—'}</p>
              </div>
              <section>
                <h3 className="text-sm font-black text-slate-800">近期作品</h3>
                {selectedWorks.length > 0 ? (
                  selectedWorks.map((work) => (
                    <div key={work.id} className="mt-2 rounded-xl border border-slate-100 p-3">
                      <p className="text-sm font-bold">{work.title}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {work.type} · {work.submittedAt}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="mt-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">暂无近期作品记录</p>
                )}
              </section>
              <Button
                variant={selectedStudent.status === 'needs_attention' ? 'outline' : 'default'}
                onClick={() => toggleAttention(selectedStudent)}
                className={
                  selectedStudent.status === 'needs_attention'
                    ? 'rounded-xl'
                    : 'rounded-xl bg-orange-500 hover:bg-orange-600'
                }
              >
                {selectedStudent.status === 'needs_attention' ? '恢复为创作中' : '标记为需要关注'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
