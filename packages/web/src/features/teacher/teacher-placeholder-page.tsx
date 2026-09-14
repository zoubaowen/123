import { XiaoBao } from '@ai-xiaobao/chat-core'
import { ArrowLeft, Construction } from 'lucide-react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'

export const teacherPlaceholderRoutes: ReadonlyArray<{ path: string; title: string; description: string }> = []

export function TeacherPlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="grid min-h-full place-items-center px-6 py-10">
      <section className="w-full max-w-2xl rounded-[32px] border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#eef4ff]">
          <XiaoBao outfit="academy" mood="happy" action="wave" size={88} ariaLabel={`${title}建设助手小宝`} />
        </div>
        <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700">
          <Construction className="h-4 w-4" /> 正在建设
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-900">{title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-slate-500">{description}</p>
        <p className="mt-3 text-xs text-slate-400">
          当前版本先确保老师“查看今日教学 → 配置并开始课堂 → 结束并保存记录”的核心流程真实可用。
        </p>
        <Button asChild className="mt-7 rounded-xl bg-[#3268b5] hover:bg-[#28589b]">
          <Link to="/teacher/dashboard">
            <ArrowLeft className="h-4 w-4" />
            返回教学首页
          </Link>
        </Button>
      </section>
    </main>
  )
}
