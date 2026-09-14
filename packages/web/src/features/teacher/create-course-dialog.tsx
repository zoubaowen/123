import { useState } from 'react'
import { BookPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CreateCourseInput, TeacherCourseStage } from './types'

/** 与后端 `parseCourseTitle` 同口径：去空白后 1–80 字。 */
const COURSE_TITLE_MAX_LENGTH = 80

export const COURSE_TITLE_REQUIRED = '请填写课包名称（1–80 字）或主题'

const stageOptions = [
  { value: 'lower_primary', label: '小学低年级' },
  { value: 'upper_primary', label: '小学高年级' },
  { value: 'middle_school', label: '初中' },
] satisfies Array<{ value: TeacherCourseStage; label: string }>

/** 校验放在界面层：空名与超长不值得跑一趟后端，错误文案保持静态。 */
export function validateCourseName(title: string, topic: string): string | null {
  const name = title.trim()
  if (name === '' || name.length > COURSE_TITLE_MAX_LENGTH || topic.trim() === '') return COURSE_TITLE_REQUIRED
  return null
}

interface CreateCourseDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示真的建好了：只有成功才关闭对话框。 */
  onCreate: (input: CreateCourseInput) => Promise<boolean>
}

export function CreateCourseDialog({ open, onOpenChange, onCreate }: CreateCourseDialogProps) {
  const [title, setTitle] = useState('')
  const [topic, setTopic] = useState('')
  const [stage, setStage] = useState<TeacherCourseStage>('lower_primary')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setTitle('')
    setTopic('')
    setStage('lower_primary')
    setError(null)
    setPending(false)
  }

  async function submit() {
    const invalid = validateCourseName(title, topic)
    if (invalid !== null) {
      setError(invalid)
      return
    }

    setError(null)
    setPending(true)
    const ok = await onCreate({ title: title.trim(), stage, topic: topic.trim() })
    setPending(false)
    // 失败时保留已填内容：关掉对话框会让人以为建好了、又找不到新课包
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
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#3268b5]">
            <BookPlus className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl font-black text-slate-900">新建课包</DialogTitle>
          <DialogDescription>
            新课包默认是草稿：加好章节与课时后再发布，避免班级关联到还没内容的课包。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-course-title" className="text-xs font-black text-slate-700">
              课包名称
            </Label>
            <Input
              id="new-course-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：AI 太空海报创作营"
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="new-course-topic" className="text-xs font-black text-slate-700">
              主题
            </Label>
            <Input
              id="new-course-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="例如：视觉创作"
              className="mt-2"
            />
          </div>

          <div>
            <Label htmlFor="new-course-stage" className="text-xs font-black text-slate-700">
              学段
            </Label>
            <Select value={stage} onValueChange={(value) => setStage(value as TeacherCourseStage)}>
              <SelectTrigger id="new-course-stage" className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-xs font-bold text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button className="bg-[#3268b5] hover:bg-[#28589b]" disabled={pending} onClick={() => void submit()}>
            创建课包
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
