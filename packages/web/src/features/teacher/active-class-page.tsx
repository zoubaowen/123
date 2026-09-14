import { XiaoBao } from '@ai-xiaobao/chat-core'
import { useEffect, useState } from 'react'
import { Bot, CheckCircle2, Clock3, MonitorUp, Radio, Settings2, ShieldCheck, UsersRound, Wifi } from 'lucide-react'
import { Link, Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ActiveClassSettingsDialog } from './active-class-settings-dialog'
import { useTeacherWorkspace } from './teacher-provider'
import type { TeacherCapability } from './types'

const capabilityLabels: Record<TeacherCapability, string> = {
  chat: 'AI 对话',
  image: '图片生成',
  music: '音乐创作',
  video: '视频创作',
  code: '编程助手',
}

const activeStudents = [
  { name: '陈小雨', status: '正在创作', points: 22 },
  { name: '周星宇', status: '正在向小宝提问', points: 31 },
  { name: '李可心', status: '正在生成图片', points: 18 },
  { name: '王一诺', status: '已完成任务', points: 16 },
]

function formatDuration(startedAt: string, now: number) {
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000))
  const minutes = Math.floor(elapsedSeconds / 60)
    .toString()
    .padStart(2, '0')
  const seconds = (elapsedSeconds % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
}

export function ActiveClassPage() {
  const navigate = useNavigate()
  const { data, end, updateActiveSettings } = useTeacherWorkspace()
  const session = data.activeSession
  const [now, setNow] = useState(() => Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!session) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [session])

  if (!session) return <Navigate to="/teacher/dashboard" replace />

  const finishClass = () => {
    end()
    toast.success('课堂已结束，记录已保存')
    navigate('/teacher/dashboard')
  }

  return (
    <main className="mx-auto min-h-full max-w-[1480px] px-6 py-6 lg:px-8">
      <header className="flex flex-col gap-4 rounded-3xl bg-[#17376f] p-5 text-white shadow-[0_18px_45px_rgba(23,55,111,0.2)] md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/12">
            <Radio className="h-6 w-6 text-emerald-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
              <p className="text-xs font-black tracking-wider text-emerald-200">课堂进行中</p>
            </div>
            <h1 className="mt-1 text-xl font-black">{session.lessonTitle}</h1>
            <p className="mt-1 text-xs text-blue-100">{session.className} · 林老师</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-white/10 px-5 py-3 text-center">
            <p className="text-[10px] font-semibold text-blue-100">已上课</p>
            <p className="mt-1 font-mono text-2xl font-black tabular-nums">{formatDuration(session.startedAt, now)}</p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" className="h-12 rounded-xl px-5">
                结束课堂
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="rounded-3xl">
              <AlertDialogHeader>
                <AlertDialogTitle>确定结束本节课堂吗？</AlertDialogTitle>
                <AlertDialogDescription>结束后会保存本节课的时长、能力配置和学生学习记录。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>继续上课</AlertDialogCancel>
                <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={finishClass}>
                  确认结束课堂
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.65fr)]">
        <div className="space-y-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">学生在线情况</h2>
                <p className="mt-1 text-xs text-slate-500">24 人已加入，课堂连接正常</p>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                <Wifi className="h-3.5 w-3.5" /> 24 / 24 在线
              </div>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {activeStudents.map((student, index) => (
                <div
                  key={student.name}
                  className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3"
                >
                  <div
                    className={`grid h-10 w-10 place-items-center rounded-full text-xs font-black ${index % 2 ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}
                  >
                    {student.name.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-800">{student.name}</p>
                    <p className="mt-0.5 truncate text-[10px] text-slate-500">{student.status}</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">
                    {student.points} 点
                  </span>
                </div>
              ))}
            </div>
            <Button asChild variant="outline" className="mt-4 w-full rounded-xl border-dashed text-xs text-[#3268b5]">
              <Link to={`/teacher/students?classId=${session.classId}`}>查看全部学生状态</Link>
            </Button>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">课堂任务进度</h2>
              <span className="text-sm font-black text-[#3268b5]">63%</span>
            </div>
            <Progress value={63} className="mt-4 h-2.5" />
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              {[
                { label: '已完成', value: '8 人', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-50' },
                { label: '创作中', value: '15 人', icon: MonitorUp, color: 'text-blue-600 bg-blue-50' },
                { label: '需要帮助', value: '1 人', icon: UsersRound, color: 'text-orange-600 bg-orange-50' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-slate-100 p-4">
                  <item.icon className={`h-5 w-5 rounded-lg p-0.5 ${item.color}`} />
                  <p className="mt-3 text-xs text-slate-500">{item.label}</p>
                  <p className="mt-1 text-lg font-black">{item.value}</p>
                </div>
              ))}
            </div>
          </article>
        </div>

        <aside className="space-y-6">
          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-black">本节课 AI 能力</h2>
              <Button variant="ghost" size="icon" aria-label="调整课堂能力" onClick={() => setSettingsOpen(true)}>
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-4 space-y-2">
              {session.capabilities.map((capability) => (
                <div key={capability} className="flex items-center gap-3 rounded-2xl bg-blue-50/70 p-3">
                  <div className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#3268b5]">
                    <Bot className="h-4 w-4" />
                  </div>
                  <span className="flex-1 text-xs font-bold text-slate-700">{capabilityLabels[capability]}</span>
                  <span className="text-[10px] font-black text-emerald-600">已开启</span>
                </div>
              ))}
            </div>
          </article>

          <article className="overflow-hidden rounded-3xl bg-gradient-to-br from-[#f4f7ff] to-[#fff8ed] p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-3">
              <XiaoBao outfit="academy" mood="happy" action="wave" size={78} ariaLabel="小宝课堂助手" />
              <div>
                <p className="text-sm font-black text-[#23477f]">小宝课堂助手</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-600">
                  目前课堂运行顺畅，有 1 位学生可能需要老师关注。
                </p>
              </div>
            </div>
            <Button asChild className="mt-4 w-full rounded-xl bg-[#3268b5] hover:bg-[#28589b]">
              <Link to={`/teacher/students?classId=${session.classId}&status=needs_attention`}>查看需要帮助的学生</Link>
            </Button>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-black">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              课堂安全额度
            </div>
            <div className="mt-4 flex items-end justify-between">
              <div>
                <span className="text-2xl font-black">{session.pointLimit}</span>
                <span className="ml-1 text-xs text-slate-400">点 / 人</span>
              </div>
              <Clock3 className="h-5 w-5 text-slate-300" />
            </div>
          </article>
        </aside>
      </section>
      <ActiveClassSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        value={{ pointLimit: session.pointLimit, capabilities: session.capabilities }}
        onSave={(value) => {
          updateActiveSettings(value)
          setSettingsOpen(false)
          toast.success('课堂设置已更新')
        }}
      />
    </main>
  )
}
