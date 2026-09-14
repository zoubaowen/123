import { useState } from 'react'
import { Search, Trash2, UserRoundPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ClassTeacherRecord, ClassTeacherRole, InstitutionRole, TeacherMemberOption } from './types'

/** 查找失败与"没查到"给不同的话：网络挂了被读成"机构里没这个人"会误导管理员。 */
export const TEACHER_SEARCH_FAILED = '没有查到机构成员，请稍后再试'
export const TEACHER_SEARCH_EMPTY = '没有匹配的机构成员'
export const TEACHER_SEARCH_HINT = '输入姓名或账号后开始查找'

const roleLabels: Record<ClassTeacherRole, string> = {
  lead: '主班老师',
  assistant: '协助老师',
}

const memberRoleLabels: Record<InstitutionRole, string> = {
  owner: '机构负责人',
  admin: '机构管理员',
  teacher: '机构老师',
}

export interface ClassTeachersDialogProps {
  open: boolean
  teachers: ClassTeacherRecord[]
  onOpenChange: (open: boolean) => void
  onSearch: (query: string) => Promise<TeacherMemberOption[] | null>
  /** 返回 true 表示分配成功：只有成功才关闭搜索页。 */
  onAssign: (userId: string, role: ClassTeacherRole) => Promise<boolean>
  /** 返回 true 表示解除成功。 */
  onRemove: (userId: string) => Promise<boolean>
}

export function ClassTeachersDialog({
  open,
  teachers,
  onOpenChange,
  onSearch,
  onAssign,
  onRemove,
}: ClassTeachersDialogProps) {
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TeacherMemberOption[] | null>(null)
  const [searched, setSearched] = useState(false)
  const [failed, setFailed] = useState(false)
  const [role, setRole] = useState<ClassTeacherRole>('lead')

  function reset() {
    setAdding(false)
    setQuery('')
    setResults(null)
    setSearched(false)
    setFailed(false)
    setRole('lead')
  }

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
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-black text-slate-900">任课老师</DialogTitle>
          <DialogDescription>
            主班老师可以开课、下课与关联课包；协助老师默认不能，只能查看班级与进度。
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2">
          {teachers.map((teacher) => (
            <li
              key={teacher.userId}
              className="flex items-center justify-between rounded-2xl border border-slate-200 px-3 py-2"
            >
              <span className="text-sm font-bold text-slate-800">{teacher.name}</span>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">
                  {roleLabels[teacher.role]}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-500 hover:text-red-600"
                  aria-label={`解除 ${teacher.name}`}
                  onClick={() => void onRemove(teacher.userId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
          {teachers.length === 0 && (
            <li className="rounded-2xl bg-slate-50 px-3 py-4 text-xs text-slate-500">
              这个班还没有任课老师，机构管理员也无法在这里开课。
            </li>
          )}
        </ul>

        {adding ? (
          <div className="space-y-3 border-t border-slate-100 pt-4">
            <div>
              <label htmlFor="teacher-search" className="text-xs font-black text-slate-700">
                搜索老师
              </label>
              <div className="mt-2 flex items-center gap-2">
                <Search className="h-4 w-4 text-slate-400" />
                <Input
                  id="teacher-search"
                  value={query}
                  onChange={(event) => void runSearch(event.target.value)}
                  placeholder="输入姓名或账号"
                />
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
              {(['lead', 'assistant'] as const).map((option) => (
                <label key={option} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="class-teacher-role"
                    checked={role === option}
                    onChange={() => setRole(option)}
                    aria-label={roleLabels[option]}
                  />
                  {roleLabels[option]}
                </label>
              ))}
            </div>

            <div className="min-h-12 space-y-2">
              {failed && <p className="text-xs font-bold text-red-600">{TEACHER_SEARCH_FAILED}</p>}
              {!failed && searched && results?.length === 0 && (
                <p className="text-xs font-medium text-slate-500">{TEACHER_SEARCH_EMPTY}</p>
              )}
              {!failed && !searched && <p className="text-xs font-medium text-slate-400">{TEACHER_SEARCH_HINT}</p>}
              {(results ?? []).map((member) => (
                <button
                  key={member.userId}
                  type="button"
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 px-3 py-2 text-left text-sm hover:border-blue-200 hover:bg-blue-50/40"
                  onClick={() => {
                    void (async () => {
                      const ok = await onAssign(member.userId, role)
                      if (ok) reset()
                    })()
                  }}
                >
                  <span className="font-bold text-slate-800">{member.name}</span>
                  <span className="text-xs text-slate-500">{memberRoleLabels[member.role]}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex justify-end border-t border-slate-100 pt-4">
            <Button variant="outline" className="h-10 rounded-xl" onClick={() => setAdding(true)}>
              <UserRoundPlus className="mr-1.5 h-4 w-4" />
              分配老师
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
