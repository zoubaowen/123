import { AlertCircle, CheckCircle2, PencilLine, Search, UserMinus, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { progressBarValue } from './teacher-format'
import type { TeacherStudentLearningStatus, TeacherStudentOption, TeacherStudentSummary } from './types'

const studentStatusLabel: Record<TeacherStudentLearningStatus, string> = {
  creating: '创作中',
  completed: '本周任务完成',
  needs_attention: '需要关注',
}

const studentStatusTone: Record<TeacherStudentLearningStatus, string> = {
  creating: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  needs_attention: 'bg-orange-50 text-orange-700',
}

const studentStatusIcon = {
  creating: PencilLine,
  completed: CheckCircle2,
  needs_attention: AlertCircle,
} as const

/** 查找失败与"没查到"必须给出不同的话，否则网络挂了会被读成"这个学生不在机构里"。 */
export const ROSTER_SEARCH_FAILED = '没有查到学生，请稍后再试'
export const ROSTER_SEARCH_EMPTY = '没有匹配的学生'
export const ROSTER_SEARCH_HINT = '输入姓名或账号后开始查找'

interface TeacherStudentRosterProps {
  students: TeacherStudentSummary[]
  /** 只有机构 owner/admin 才会看到加/移学生的按钮（后端仍独立判权）。 */
  canManage?: boolean
  onSearch?: (query: string) => Promise<TeacherStudentOption[] | null>
  onAdd?: (studentUserId: string) => Promise<boolean>
  onRemove?: (studentUserId: string) => Promise<boolean>
}

export function TeacherStudentRoster({
  students,
  canManage = false,
  onSearch,
  onAdd,
  onRemove,
}: TeacherStudentRosterProps) {
  const [addOpen, setAddOpen] = useState(false)

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-slate-900">学生名单</h2>
          <p className="mt-1 text-xs text-slate-500">
            {canManage ? '在班学生；加入与移出都会写入后端记录。' : '在班学生；名单由机构管理员维护。'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
            {students.length} 人
          </span>
          {canManage && onSearch && onAdd && (
            <Button variant="outline" className="h-9 rounded-xl" onClick={() => setAddOpen(true)}>
              <UserPlus className="mr-1.5 h-4 w-4" />
              加入学生
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-0 text-left">
          <thead>
            <tr className="text-[11px] font-bold text-slate-400">
              <th className="border-b border-slate-100 px-3 py-3">学生</th>
              <th className="border-b border-slate-100 px-3 py-3">学习状态</th>
              <th className="border-b border-slate-100 px-3 py-3">任务完成</th>
              <th className="border-b border-slate-100 px-3 py-3">最近活跃</th>
              {canManage && onRemove && <th className="border-b border-slate-100 px-3 py-3" aria-label="操作" />}
            </tr>
          </thead>
          <tbody>
            {students.map((student, index) => {
              const StatusIcon = student.status ? studentStatusIcon[student.status] : undefined
              const hasCounters = student.completedTasks !== undefined && student.totalTasks !== undefined
              const percentage =
                hasCounters && student.totalTasks! > 0
                  ? Math.round((student.completedTasks! / student.totalTasks!) * 100)
                  : null
              return (
                <tr key={student.id} className="text-sm text-slate-700">
                  <td className="border-b border-slate-50 px-3 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className={`grid h-9 w-9 place-items-center rounded-full text-xs font-black ${index % 2 ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}
                      >
                        {student.name.slice(0, 1)}
                      </div>
                      <span className="font-bold">{student.name}</span>
                    </div>
                  </td>
                  <td className="border-b border-slate-50 px-3 py-3.5">
                    {student.status && StatusIcon ? (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black ${studentStatusTone[student.status]}`}
                      >
                        <StatusIcon className="h-3.5 w-3.5" /> {studentStatusLabel[student.status]}
                      </span>
                    ) : (
                      // 后端还没提供学习状态：显示占位符，不硬塞一个看起来像事实的状态
                      <span className="text-xs font-bold text-slate-400">—</span>
                    )}
                  </td>
                  <td className="border-b border-slate-50 px-3 py-3.5">
                    <div className="flex min-w-36 items-center gap-3">
                      <Progress value={progressBarValue(percentage)} className="h-1.5" />
                      <span className="whitespace-nowrap text-xs font-bold text-slate-500">
                        {hasCounters ? `${student.completedTasks}/${student.totalTasks}` : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="border-b border-slate-50 px-3 py-3.5 text-xs font-medium text-slate-500">
                    {student.lastActiveAt ?? '—'}
                  </td>
                  {canManage && onRemove && (
                    <td className="border-b border-slate-50 px-3 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-slate-500 hover:text-red-600"
                        aria-label={`移出 ${student.name}`}
                        onClick={() => void onRemove(student.id)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {onSearch && onAdd && (
        <AddStudentDialog open={addOpen} onOpenChange={setAddOpen} onSearch={onSearch} onAdd={onAdd} />
      )}
    </section>
  )
}

interface AddStudentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<TeacherStudentOption[] | null>
  onAdd: (studentUserId: string) => Promise<boolean>
}

function AddStudentDialog({ open, onOpenChange, onSearch, onAdd }: AddStudentDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TeacherStudentOption[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [failed, setFailed] = useState(false)

  async function runSearch(value: string) {
    setQuery(value)
    if (value.trim() === '') {
      setResults(null)
      setSearched(false)
      setFailed(false)
      return
    }
    const found = await onSearch(value.trim())
    setResults(found)
    setFailed(found === null)
    setSearched(true)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setQuery('')
          setResults(null)
          setSearched(false)
          setFailed(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900">加入学生</DialogTitle>
          <DialogDescription>按姓名或账号查找本机构的学生；加入后该生进入本班在班名单。</DialogDescription>
        </DialogHeader>

        <div>
          <label htmlFor="student-search" className="text-xs font-black text-slate-700">
            搜索学生
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Search className="h-4 w-4 text-slate-400" />
            <Input
              id="student-search"
              value={query}
              onChange={(event) => void runSearch(event.target.value)}
              placeholder="输入姓名或账号"
            />
          </div>
        </div>

        <div className="min-h-16 space-y-2">
          {failed && <p className="text-xs font-bold text-red-600">{ROSTER_SEARCH_FAILED}</p>}
          {!failed && searched && results?.length === 0 && (
            <p className="text-xs font-medium text-slate-500">{ROSTER_SEARCH_EMPTY}</p>
          )}
          {!failed && !searched && <p className="text-xs font-medium text-slate-400">{ROSTER_SEARCH_HINT}</p>}
          {(results ?? []).map((student) => (
            <button
              key={student.id}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-200 hover:bg-blue-50/40"
              onClick={() => {
                void (async () => {
                  const ok = await onAdd(student.id)
                  // 失败就停在原地：关掉窗口会让人以为加上了
                  if (ok) onOpenChange(false)
                })()
              }}
            >
              <span className="font-bold text-slate-800">{student.name}</span>
              <span className="text-xs text-slate-500">{student.username}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
