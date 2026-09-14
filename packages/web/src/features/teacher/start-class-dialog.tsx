import { Bot, BrainCircuit, Image, Music2, Palette, ShieldCheck, Video } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { StartClassInput, TeacherCapability, TeacherScheduleItem } from './types'

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

const skillOptions = ['创意海报助手', '学习任务拆解', '游戏设计教练']
const mcpOptions = ['安全素材库', '课程知识库', '班级作品库']

export function createDefaultStartClassInput(schedule: TeacherScheduleItem): StartClassInput {
  return {
    classId: schedule.classId,
    lessonId: schedule.lessonId,
    pointLimit: 80,
    capabilities: ['chat', 'image'],
    skills: ['创意海报助手', '学习任务拆解'],
    mcpServers: ['安全素材库'],
  }
}

function toggleValue<T>(items: T[], item: T, enabled: boolean) {
  return enabled ? Array.from(new Set([...items, item])) : items.filter((value) => value !== item)
}

interface StartClassPanelProps {
  className: string
  lessonTitle: string
  value: StartClassInput
  onChange: (value: StartClassInput) => void
  onCancel: () => void
  onConfirm: () => void
}

export function StartClassPanel({
  className,
  lessonTitle,
  value,
  onChange,
  onCancel,
  onConfirm,
}: StartClassPanelProps) {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-[#3268b5]">
          <Palette className="h-5 w-5" />
        </div>
        <DialogTitle className="text-xl font-black text-slate-900">开始上课</DialogTitle>
        <DialogDescription>
          {className} · {lessonTitle}
        </DialogDescription>
      </DialogHeader>

      <section>
        <h3 className="text-sm font-black text-slate-800">本节课允许的 AI 能力</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {capabilityOptions.map((option) => (
            <label
              key={option.id}
              className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 p-3 hover:border-blue-200 hover:bg-blue-50/40"
            >
              <Checkbox
                checked={value.capabilities.includes(option.id)}
                disabled={option.required}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    capabilities: toggleValue(value.capabilities, option.id, checked === true),
                  })
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

      <div className="grid gap-4 sm:grid-cols-2">
        <OptionGroup
          title="课堂 Skills"
          options={skillOptions}
          selected={value.skills}
          onChange={(skills) => onChange({ ...value, skills })}
        />
        <OptionGroup
          title="MCP 资源"
          options={mcpOptions}
          selected={value.mcpServers}
          onChange={(mcpServers) => onChange({ ...value, mcpServers })}
        />
      </div>

      <div className="rounded-2xl bg-amber-50 p-4">
        <Label htmlFor="class-point-limit" className="flex items-center gap-2 text-xs font-black text-amber-900">
          <ShieldCheck className="h-4 w-4" />
          每位学生课堂点数上限
        </Label>
        <div className="mt-2 flex items-center gap-3">
          <Input
            id="class-point-limit"
            type="number"
            min={10}
            max={500}
            value={value.pointLimit}
            onChange={(event) => onChange({ ...value, pointLimit: Number(event.target.value) })}
            className="w-28 bg-white"
          />
          <p className="text-[11px] leading-4 text-amber-800">用于控制本节课的 AI 使用额度，可在课堂中调整。</p>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
        <Button variant="outline" onClick={onCancel}>
          取消
        </Button>
        <Button className="bg-[#3268b5] hover:bg-[#28589b]" onClick={onConfirm}>
          确认开始上课
        </Button>
      </div>
    </div>
  )
}

function OptionGroup({
  title,
  options,
  selected,
  onChange,
}: {
  title: string
  options: string[]
  selected: string[]
  onChange: (value: string[]) => void
}) {
  return (
    <section>
      <h3 className="text-sm font-black text-slate-800">{title}</h3>
      <div className="mt-2 space-y-2 rounded-2xl border border-slate-200 p-3">
        {options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
            <Checkbox
              checked={selected.includes(option)}
              onCheckedChange={(checked) => onChange(toggleValue(selected, option, checked === true))}
              aria-label={option}
            />
            {option}
          </label>
        ))}
      </div>
    </section>
  )
}

interface StartClassDialogProps extends StartClassPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function StartClassDialog({ open, onOpenChange, ...panelProps }: StartClassDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-2xl">
        <StartClassPanel {...panelProps} />
      </DialogContent>
    </Dialog>
  )
}
