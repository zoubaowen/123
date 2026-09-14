import { useMemo, useState } from 'react'
import { Bot, CalendarDays, Clock3, Search, Timer, UsersRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { filterTeacherRecords, getTeacherRecordMetrics } from './teacher-record-repository'
import { useTeacherWorkspace } from './teacher-provider'
import type { ClassSessionRecord, TeacherCapability } from './types'

const capabilityLabels: Record<TeacherCapability, string> = {
  chat: 'AI 对话',
  image: '图片生成',
  music: '音乐创作',
  video: '视频创作',
  code: '编程助手',
}

function formatRecordDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }).format(new Date(value))
}

function formatRecordTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value))
}

export function TeacherRecordReview({ record }: { record: ClassSessionRecord }) {
  return (
    <section className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs text-slate-400">课堂时间</p>
        <p className="mt-2 text-sm font-black text-slate-900">
          {formatRecordTime(record.startedAt)} - {formatRecordTime(record.endedAt)}
        </p>
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs text-slate-400">参与情况</p>
        <p className="mt-2 text-sm font-black text-slate-900">
          {record.studentCount} 人 · {record.durationMinutes} 分钟
        </p>
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs text-slate-400">安全额度</p>
        <p className="mt-2 text-sm font-black text-slate-900">{record.pointLimit} 点 / 人</p>
      </div>
      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-xs text-slate-400">课堂状态</p>
        <p className="mt-2 text-sm font-black text-emerald-600">已完成并保存</p>
      </div>
    </section>
  )
}

export function TeacherRecordsPage() {
  const { data } = useTeacherWorkspace()
  const [keyword, setKeyword] = useState('')
  const [className, setClassName] = useState('all')
  const [selectedRecord, setSelectedRecord] = useState<ClassSessionRecord | null>(null)
  const records = useMemo(
    () => filterTeacherRecords(data.recentSessions, { keyword, className }),
    [className, data.recentSessions, keyword],
  )
  const metrics = getTeacherRecordMetrics(data.recentSessions)

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header>
        <p className="text-sm font-semibold text-[#4c6fa9]">教学复盘</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-900">课堂记录</h1>
        <p className="mt-2 text-sm text-slate-500">回顾已完成课堂的时长、参与情况与 AI 教学配置。</p>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: '课堂次数',
            value: metrics.sessionCount,
            suffix: '节',
            icon: CalendarDays,
            color: 'bg-blue-50 text-blue-600',
          },
          {
            label: '累计课时',
            value: metrics.totalMinutes,
            suffix: '分钟',
            icon: Clock3,
            color: 'bg-violet-50 text-violet-600',
          },
          {
            label: '平均时长',
            value: metrics.averageMinutes,
            suffix: '分钟',
            icon: Timer,
            color: 'bg-emerald-50 text-emerald-600',
          },
          {
            label: '覆盖学生',
            value: metrics.coveredStudents,
            suffix: '人次',
            icon: UsersRound,
            color: 'bg-orange-50 text-orange-600',
          },
        ].map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className={`grid h-9 w-9 place-items-center rounded-xl ${metric.color}`}>
              <metric.icon className="h-[18px] w-[18px]" />
            </div>
            <p className="mt-3 text-xs font-medium text-slate-500">{metric.label}</p>
            <p className="mt-1 text-2xl font-black text-slate-900">
              {metric.value}
              <span className="ml-1 text-xs font-semibold text-slate-400">{metric.suffix}</span>
            </p>
          </article>
        ))}
      </section>

      <section className="mt-6 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row">
        <label className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索课节或班级"
            className="h-11 rounded-xl border-slate-200 pl-9"
          />
        </label>
        <select
          aria-label="按班级筛选"
          value={className}
          onChange={(event) => setClassName(event.target.value)}
          className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="all">全部班级</option>
          {data.classes.map((item) => (
            <option key={item.id} value={item.name}>
              {item.name}
            </option>
          ))}
        </select>
      </section>

      {records.length > 0 ? (
        <section className="mt-6 space-y-4">
          {records.map((record) => (
            <article
              key={record.id}
              className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm lg:flex-row lg:items-center"
            >
              <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#3268b5]">
                <CalendarDays className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-black text-slate-900">{record.lessonTitle}</h2>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                    已完成
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{record.className}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-slate-400">
                  <span>{formatRecordDate(record.startedAt)}</span>
                  <span>
                    {formatRecordTime(record.startedAt)} - {formatRecordTime(record.endedAt)}
                  </span>
                  <span>{record.durationMinutes} 分钟</span>
                  <span>{record.studentCount} 人参与</span>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setSelectedRecord(record)}
                className="rounded-xl bg-white text-[#3268b5]"
              >
                查看课堂回顾
              </Button>
            </article>
          ))}
        </section>
      ) : (
        <section className="mt-6 rounded-3xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <p className="font-bold text-slate-700">没有找到符合条件的课堂记录</p>
          <p className="mt-2 text-sm text-slate-400">请调整搜索词或班级筛选。</p>
        </section>
      )}

      <Dialog open={Boolean(selectedRecord)} onOpenChange={(open) => !open && setSelectedRecord(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl sm:max-w-xl">
          {selectedRecord && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedRecord.lessonTitle}课堂回顾</DialogTitle>
                <DialogDescription>
                  {selectedRecord.className} · {formatRecordDate(selectedRecord.startedAt)}
                </DialogDescription>
              </DialogHeader>
              <TeacherRecordReview record={selectedRecord} />
              <section>
                <h3 className="flex items-center gap-2 text-sm font-black text-slate-800">
                  <Bot className="h-4 w-4 text-[#3268b5]" />
                  AI 能力
                </h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedRecord.capabilities.map((item) => (
                    <span key={item} className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
                      {capabilityLabels[item]}
                    </span>
                  ))}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-black text-slate-800">Skills</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedRecord.skills.length ? (
                    selectedRecord.skills.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-bold text-violet-700"
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">本节课未启用额外 Skill</span>
                  )}
                </div>
              </section>
              <section>
                <h3 className="text-sm font-black text-slate-800">MCP 服务</h3>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedRecord.mcpServers.length ? (
                    selectedRecord.mcpServers.map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700"
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">本节课未连接 MCP 服务</span>
                  )}
                </div>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
