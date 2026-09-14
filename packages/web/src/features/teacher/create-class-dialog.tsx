import { useState } from 'react'
import { School } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ClassAiUsageMode, CreateClassInput } from './types'

/** 后端口径：班级名去空白后 1–80 个字符。 */
const CLASS_NAME_MAX_LENGTH = 80

export const CREATE_CLASS_NAME_REQUIRED = '请填写班级名称'
export const CREATE_CLASS_NAME_TOO_LONG = '班级名称不能超过 80 个字'

/** 校验放在界面这一层：不值得为一次输入错误跑一趟后端，错误文案保持静态。 */
export function validateClassName(value: string): string | null {
  const name = value.trim()
  if (name === '') return CREATE_CLASS_NAME_REQUIRED
  if (name.length > CLASS_NAME_MAX_LENGTH) return CREATE_CLASS_NAME_TOO_LONG
  return null
}

interface CreateClassDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示真的建好了：只有成功才关闭对话框。 */
  onCreate: (input: CreateClassInput) => Promise<boolean>
}

export function CreateClassDialog({ open, onOpenChange, onCreate }: CreateClassDialogProps) {
  const [name, setName] = useState('')
  const [aiUsageMode, setAiUsageMode] = useState<ClassAiUsageMode>('class_only')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  function reset() {
    setName('')
    setAiUsageMode('class_only')
    setError(null)
    setPending(false)
  }

  async function submit() {
    const invalid = validateClassName(name)
    if (invalid !== null) {
      setError(invalid)
      return
    }

    setError(null)
    setPending(true)
    const ok = await onCreate({ name: name.trim(), aiUsageMode })
    setPending(false)
    // 失败时保留已填内容与对话框：关掉会让人以为建好了，又找不到新建的班
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
            <School className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl font-black text-slate-900">新建班级</DialogTitle>
          <DialogDescription>建好之后可以在班级详情里加学生、关联课包并分配任课老师。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="new-class-name" className="text-xs font-black text-slate-700">
              班级名称
            </Label>
            <Input
              id="new-class-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：二年级创作 A 班"
              className="mt-2"
            />
            {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
          </div>

          <fieldset>
            <legend className="text-xs font-black text-slate-700">AI 使用模式</legend>
            <div className="mt-2 space-y-2">
              {(
                [
                  { id: 'class_only', label: '仅上课可用', description: '只有开课期间学生才能使用 AI 能力' },
                  { id: 'anytime', label: '随时可用', description: '学生课后也能使用，不受课堂时间限制' },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-3 hover:border-blue-200 hover:bg-blue-50/40"
                >
                  <input
                    type="radio"
                    name="new-class-ai-usage-mode"
                    className="mt-1"
                    checked={aiUsageMode === option.id}
                    onChange={() => setAiUsageMode(option.id)}
                    aria-label={option.label}
                  />
                  <span>
                    <span className="block text-xs font-bold text-slate-800">{option.label}</span>
                    <span className="mt-1 block text-[10px] leading-4 text-slate-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button className="bg-[#3268b5] hover:bg-[#28589b]" onClick={() => void submit()} disabled={pending}>
            创建班级
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
