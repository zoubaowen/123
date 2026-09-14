import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { Button } from '../../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { toast } from 'sonner'

interface BudgetUser {
  id: string
  username: string
}

interface BudgetSummary {
  /** null 表示未设上限（不限制）。 */
  creditLimit: number | null
  /** null 表示无法确定，必须与 0 区分显示。 */
  settledCredits: number | null
  /** 缺失或 null 都表示无法确定；四个分类都为 0 才是"确实没有用量"。 */
  usageByCategory?: UsageByCategory | null
}

interface UsageByCategory {
  model: number
  tool: number
  sandbox: number
  media: number
}

function describeUsageByCategory(usage: UsageByCategory | null): string {
  if (!usage) return '用途明细暂时无法确定'
  return `用途明细：模型 ${usage.model} · 工具 ${usage.tool} · 沙箱 ${usage.sandbox} · 媒体 ${usage.media}`
}

interface UserBudgetDialogProps {
  user: BudgetUser | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}

const LIMIT_INPUT_ID = 'user-budget-limit'

/**
 * 只接受正整数字符串。
 *
 * 与服务端 `parseCreditLimit` 保持同一口径：0 / 负数 / 小数 / 非数字都会被运行时的预算读取器
 * 当成配置错误并拒绝学生开始任务，所以这里先挡住，不把会锁死学生的值发出去。
 */
function parseCreditLimitInput(raw: string): { ok: true; value: number } | { ok: false } {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return { ok: false }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return { ok: false }
  return { ok: true, value: parsed }
}

export function UserBudgetDialog({ user, open, onOpenChange, onSaved }: UserBudgetDialogProps) {
  const [summary, setSummary] = useState<BudgetSummary | null>(null)
  const [limitInput, setLimitInput] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !user) return undefined

    let cancelled = false
    setSummary(null)
    setError('')

    api
      .get(`/api/admin/users/${user.id}/budget`)
      .then((data) => {
        if (cancelled) return
        const budget = data as BudgetSummary
        setSummary(budget)
        setLimitInput(budget.creditLimit === null ? '' : String(budget.creditLimit))
      })
      .catch(() => {
        if (cancelled) return
        toast.error('加载小宝额度失败')
      })

    return () => {
      cancelled = true
    }
  }, [open, user])

  async function submit(creditLimit: number | null) {
    if (!user) return
    setIsSubmitting(true)
    setError('')
    try {
      await api.post(`/api/admin/users/${user.id}/budget`, { creditLimit })
      toast.success('小宝额度已保存')
      onSaved()
      onOpenChange(false)
    } catch {
      toast.error('保存额度失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleSave() {
    const parsed = parseCreditLimitInput(limitInput)
    if (!parsed.ok) {
      setError('请输入大于 0 的整数')
      return
    }
    void submit(parsed.value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>小宝额度</DialogTitle>
          <DialogDescription>
            设置用户 "{user?.username}" 的小宝课堂学分上限。达到上限后该学生无法开始新的小宝任务。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-md bg-muted px-3 py-2 text-sm">
            {summary === null ? (
              <span className="text-muted-foreground">加载中...</span>
            ) : (
              <div className="space-y-1">
                <div>{summary.creditLimit === null ? '当前未设上限' : `当前上限 ${summary.creditLimit} 点`}</div>
                <div className="text-muted-foreground">
                  {summary.settledCredits === null ? '已用额度暂时无法确定' : `已用 ${summary.settledCredits} 点`}
                </div>
                <div className="text-muted-foreground">{describeUsageByCategory(summary.usageByCategory ?? null)}</div>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={LIMIT_INPUT_ID} className="text-sm">
              额度上限（点）
            </Label>
            <Input
              id={LIMIT_INPUT_ID}
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
              placeholder="留空并使用“取消限制”表示不限制"
              inputMode="numeric"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void submit(null)}
            disabled={isSubmitting || summary?.creditLimit === null}
          >
            取消限制
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSubmitting}>
            {isSubmitting ? '处理中...' : '保存额度'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
