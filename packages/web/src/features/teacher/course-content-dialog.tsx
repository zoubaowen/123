import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CreateLessonInput, CreateResourceInput, TeacherLessonResourceType } from './types'

export const CONTENT_TITLE_REQUIRED = '请填写名称（1–80 字）'
export const LESSON_DURATION_INVALID = '课时时长请填 1–600 之间的整数'

export type CourseContentKind = 'chapter' | 'lesson' | 'resource'

const kindTitles: Record<CourseContentKind, string> = {
  chapter: '添加章节',
  lesson: '添加课时',
  resource: '添加资源',
}

const resourceTypes = [
  { value: 'slides', label: '课件' },
  { value: 'demo', label: '演示' },
  { value: 'worksheet', label: '练习单' },
  { value: 'assignment', label: '作业' },
] satisfies Array<{ value: TeacherLessonResourceType; label: string }>

/** 目标/步骤这类多行文本：按行拆成数组，空行丢掉。 */
export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

interface CourseContentDialogProps {
  kind: CourseContentKind
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示真的写成功了：只有成功才关闭对话框。 */
  onCreate: (input: {
    title: string
    durationMinutes?: number
    objectives?: string[]
    type?: TeacherLessonResourceType
    status?: CreateResourceInput['status']
  }) => Promise<boolean>
}

export function CourseContentDialog({ kind, open, onOpenChange, onCreate }: CourseContentDialogProps) {
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState('40')
  const [objectives, setObjectives] = useState('')
  const [type, setType] = useState<TeacherLessonResourceType>('slides')
  const [status, setStatus] = useState<'ready' | 'planned'>('planned')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setTitle('')
    setDuration('40')
    setObjectives('')
    setType('slides')
    setStatus('planned')
    setError(null)
    setPending(false)
  }

  async function submit() {
    const name = title.trim()
    if (name === '' || name.length > 80) {
      setError(CONTENT_TITLE_REQUIRED)
      return
    }

    let durationMinutes: number | undefined
    if (kind === 'lesson') {
      durationMinutes = Number(duration)
      if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 600) {
        setError(LESSON_DURATION_INVALID)
        return
      }
    }

    setError(null)
    setPending(true)
    const ok = await onCreate({
      title: name,
      ...(durationMinutes === undefined ? {} : { durationMinutes }),
      ...(kind === 'lesson' ? { objectives: parseLines(objectives) } : {}),
      ...(kind === 'resource' ? { type, status } : {}),
    })
    setPending(false)
    // 失败保留已填内容：关掉会让人以为加上了
    if (ok) onOpenChange(false)
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
          <DialogTitle className="text-xl font-black text-slate-900">{kindTitles[kind]}</DialogTitle>
          <DialogDescription>
            顺序由服务端追加决定（永远排在最后），不需要手工填序号——两个人同时加内容时序号会撞车。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="content-title" className="text-xs font-black text-slate-700">
              名称
            </Label>
            <Input
              id="content-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={
                kind === 'chapter' ? '例如：第一章：认识太空' : kind === 'lesson' ? '例如：第一课时' : '例如：课堂课件'
              }
              className="mt-2"
            />
          </div>

          {kind === 'lesson' && (
            <>
              <div>
                <Label htmlFor="content-duration" className="text-xs font-black text-slate-700">
                  时长（分钟）
                </Label>
                <Input
                  id="content-duration"
                  type="number"
                  min={1}
                  max={600}
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="content-objectives" className="text-xs font-black text-slate-700">
                  学习目标（每行一条，可留空）
                </Label>
                <textarea
                  id="content-objectives"
                  value={objectives}
                  onChange={(event) => setObjectives(event.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm"
                  placeholder={'说出海报三要素\n写出自己的提示词'}
                />
              </div>
            </>
          )}

          {kind === 'resource' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="content-type" className="text-xs font-black text-slate-700">
                  资源类型
                </Label>
                <Select value={type} onValueChange={(value) => setType(value as TeacherLessonResourceType)}>
                  <SelectTrigger id="content-type" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {resourceTypes.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="content-status" className="text-xs font-black text-slate-700">
                  就绪状态
                </Label>
                <Select value={status} onValueChange={(value) => setStatus(value as 'ready' | 'planned')}>
                  <SelectTrigger id="content-status" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">待完善</SelectItem>
                    <SelectItem value="ready">已就绪</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="bg-[#3268b5] hover:bg-[#28589b]" disabled={pending} onClick={() => void submit()}>
            {kindTitles[kind]}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 把对话框的返回值整理成课时入参。 */
export function toLessonInput(input: {
  title: string
  durationMinutes?: number
  objectives?: string[]
}): CreateLessonInput {
  return {
    title: input.title,
    durationMinutes: input.durationMinutes ?? 40,
    objectives: input.objectives ?? [],
    steps: [],
    teacherTips: [],
    assignment: '',
    capabilities: [],
    skills: [],
    mcpServers: [],
  }
}
