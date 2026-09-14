import { ClipboardList, FileText, MonitorPlay, Presentation } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { TeacherLessonResource, TeacherLessonResourceType } from './types'

const resourceMeta: Record<TeacherLessonResourceType, { label: string; icon: LucideIcon; className: string }> = {
  slides: { label: '课件', icon: Presentation, className: 'bg-blue-50 text-blue-700' },
  demo: { label: '演示', icon: MonitorPlay, className: 'bg-violet-50 text-violet-700' },
  worksheet: { label: '练习单', icon: FileText, className: 'bg-amber-50 text-amber-700' },
  assignment: { label: '作业', icon: ClipboardList, className: 'bg-emerald-50 text-emerald-700' },
}

const resourceStatusLabels = {
  ready: '已就绪',
  planned: '待准备',
} as const

export function TeacherLessonResourceList({ resources }: { resources: TeacherLessonResource[] }) {
  if (resources.length === 0) {
    return <p className="rounded-2xl bg-slate-50 p-4 text-sm font-medium text-slate-500">本课时暂无教学资源</p>
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="教学资源列表">
      {resources.map((resource) => {
        const meta = resourceMeta[resource.type]
        const Icon = meta.icon
        const statusLabel = resourceStatusLabels[resource.status]

        return (
          <li
            key={resource.id}
            className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3"
          >
            <span className={`grid h-10 w-10 place-items-center rounded-xl ${meta.className}`} aria-hidden="true">
              <Icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-black text-slate-800">{resource.title}</span>
              <span className="mt-1 block text-xs font-bold text-slate-500">
                {meta.label} · {statusLabel}
              </span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}
