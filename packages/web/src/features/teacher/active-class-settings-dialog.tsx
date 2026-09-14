import { Bot, BrainCircuit, Image, Music2, ShieldCheck, Video } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActiveClassSettingsInput, TeacherCapability } from './types'

const capabilityOptions: Array<{
  id: TeacherCapability
  label: string
  description: string
  icon: typeof Bot
  required?: boolean
}> = [
  { id: 'chat', label: 'AI 对话', description: '提问、启发和学习陪伴', icon: Bot, required: true },
  { id: 'image', label: '图片生成', description: '生成插画、海报与视觉素材', icon: Image },
  { id: 'music', label: '音乐创作', description: '创作旋律、音效与歌曲', icon: Music2 },
  { id: 'video', label: '视频创作', description: '生成课堂短片与动画', icon: Video },
  { id: 'code', label: '编程助手', description: '制作网页、游戏与互动作品', icon: BrainCircuit },
]

function toggleCapability(items: TeacherCapability[], item: TeacherCapability, enabled: boolean) {
  return enabled ? Array.from(new Set([...items, item])) : items.filter((value) => value !== item)
}

interface ActiveClassSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: ActiveClassSettingsInput
  onSave: (value: ActiveClassSettingsInput) => void
}

export function ActiveClassSettingsDialog({ open, onOpenChange, value, onSave }: ActiveClassSettingsDialogProps) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    if (open) setDraft({ pointLimit: value.pointLimit, capabilities: value.capabilities })
  }, [open, value.capabilities, value.pointLimit])

  const validPointLimit = draft.pointLimit >= 10 && draft.pointLimit <= 500

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">调整课堂能力</DialogTitle>
          <DialogDescription>修改会立即应用到当前课堂；Skills 与 MCP 资源需在下次开课前调整。</DialogDescription>
        </DialogHeader>

        <section className="mt-2">
          <h3 className="text-sm font-black text-slate-800">本节课允许的 AI 能力</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {capabilityOptions.map((option) => (
              <label key={option.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3">
                <Checkbox
                  checked={draft.capabilities.includes(option.id)}
                  disabled={option.required}
                  onCheckedChange={(checked) =>
                    setDraft((current) => ({
                      ...current,
                      capabilities: toggleCapability(current.capabilities, option.id, checked === true),
                    }))
                  }
                  aria-label={option.label}
                />
                <option.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#3268b5]" />
                <span>
                  <span className="block text-xs font-bold text-slate-800">
                    {option.label}
                    {option.required ? '（必选）' : ''}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="rounded-2xl bg-amber-50 p-4">
          <Label
            htmlFor="active-class-point-limit"
            className="flex items-center gap-2 text-xs font-black text-amber-900"
          >
            <ShieldCheck className="h-4 w-4" />
            每位学生课堂点数上限
          </Label>
          <div className="mt-2 flex items-center gap-3">
            <Input
              id="active-class-point-limit"
              type="number"
              min={10}
              max={500}
              value={draft.pointLimit}
              onChange={(event) => setDraft((current) => ({ ...current, pointLimit: Number(event.target.value) }))}
              className="w-28 bg-white"
            />
            <p className="text-[11px] text-amber-800">可设置 10–500 点。</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={!validPointLimit} className="bg-[#3268b5] hover:bg-[#28589b]" onClick={() => onSave(draft)}>
            保存课堂设置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
