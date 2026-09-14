import { useState } from 'react'
import { Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const BUDGET_INVALID = '请填写正整数，或用"清除上限"取消班级共享额度'

/**
 * 与后端 `parseCreditLimit` **同一口径**：只接受正整数，或显式 `null`（取消上限）。
 *
 * 0 / 负数 / 小数会被运行时读取器判为配置错误、进而拒绝学生开始任务，所以写入口必须先挡住。
 * 输入框留空点"保存"不算取消上限——取消要走明确的那颗按钮，避免误操作把上限清掉。
 */
export function parseBudgetInput(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return { ok: false }
  const value = Number(trimmed)
  if (!Number.isSafeInteger(value) || value <= 0) return { ok: false }
  return { ok: true, value }
}

interface ClassBudgetDialogProps {
  open: boolean
  /** 当前班级共享额度；null 表示未设上限。 */
  creditLimit: number | null
  onOpenChange: (open: boolean) => void
  /** 返回 true 表示保存成功：只有成功才关闭对话框。 */
  onSave: (creditLimit: number | null) => Promise<boolean>
}

export function ClassBudgetDialog({ open, creditLimit, onOpenChange, onSave }: ClassBudgetDialogProps) {
  const [raw, setRaw] = useState(creditLimit === null ? '' : String(creditLimit))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function save(value: number | null) {
    setError(null)
    setPending(true)
    const ok = await onSave(value)
    setPending(false)
    if (ok) onOpenChange(false)
  }

  function submit() {
    const parsed = parseBudgetInput(raw)
    if (!parsed.ok) {
      setError(BUDGET_INVALID)
      return
    }
    void save(parsed.value)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRaw(creditLimit === null ? '' : String(creditLimit))
          setError(null)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <Coins className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl font-black text-slate-900">班级共享额度</DialogTitle>
          <DialogDescription>
            整班共用的 AI 使用额度上限。额度用完后学生无法开始新任务，直到上限被调高。
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="class-budget" className="text-xs font-black text-slate-700">
            额度上限
          </Label>
          <Input
            id="class-budget"
            type="number"
            min={1}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            placeholder="例如：300"
            className="mt-2"
          />
          {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            当前：{creditLimit === null ? '未设上限' : `${creditLimit} 点`}
          </p>
        </div>

        <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
          <Button variant="ghost" disabled={pending} onClick={() => void save(null)}>
            清除上限
          </Button>
          <div className="flex gap-3">
            <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button className="bg-[#3268b5] hover:bg-[#28589b]" disabled={pending} onClick={submit}>
              保存额度
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
