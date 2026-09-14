import { Bot, Braces, DatabaseZap } from 'lucide-react'
import type { TeacherCapability } from './types'

const capabilityLabels: Record<TeacherCapability, string> = {
  chat: 'AI 对话',
  image: '图片生成',
  music: '音乐创作',
  video: '视频创作',
  code: '编程助手',
}

const configColumns = [
  { key: 'capabilities', title: 'AI 能力', icon: Bot },
  { key: 'skills', title: '课堂 Skills', icon: Braces },
  { key: 'mcpServers', title: 'MCP', icon: DatabaseZap },
] as const

export function TeacherLessonAiConfig({
  capabilities,
  skills,
  mcpServers,
}: {
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}) {
  const values = {
    capabilities: capabilities.map((capability) => capabilityLabels[capability]),
    skills,
    mcpServers,
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {configColumns.map((column) => {
        const Icon = column.icon
        const items = values[column.key]

        return (
          <section key={column.key} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
            <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
              <Icon className="h-4 w-4 text-[#3268b5]" />
              {column.title}
            </h3>
            {items.length === 0 ? (
              <p className="mt-4 text-xs font-medium text-slate-500">本课时未配置</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {items.map((item) => (
                  <li key={item} className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
