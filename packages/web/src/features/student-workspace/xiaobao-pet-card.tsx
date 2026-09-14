import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { XiaoBao } from '@ai-xiaobao/chat-core'
import { getGrowthLevel, type StudentGrowthState } from './student-growth'

const greetings = ['我准备好陪你创作啦！', '今天也要把灵感变成作品！', '遇到难题时，我们一起慢慢想。'] as const

interface XiaobaoPetCardProps {
  growth: StudentGrowthState
  onGreet: () => void
}

export function XiaobaoPetCard({ growth, onGreet }: XiaobaoPetCardProps) {
  const [greetingIndex, setGreetingIndex] = useState(0)
  const level = getGrowthLevel(growth.starlight)

  return (
    <section className="rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50 to-white p-3 shadow-sm">
      <div className="flex items-center gap-2.5">
        <XiaoBao outfit="academy" mood="happy" action="wave" size={68} ariaLabel="小宝伙伴正在向你挥手" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-slate-800">小宝伙伴</p>
            <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">星光成长记录</p>
          <p className="mt-1 text-xs leading-5 text-slate-600" aria-live="polite">
            {greetings[greetingIndex]}
          </p>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        {[
          ['等级', `Lv.${level.level}`],
          ['星光值', String(growth.starlight)],
          ['陪伴', '第 1 天'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-white/80 px-1 py-1.5">
            <dt className="text-[9px] text-slate-400">{label}</dt>
            <dd className="mt-0.5 text-[11px] font-semibold text-slate-700">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-2.5">
        <div className="flex items-center justify-between text-[9px] text-slate-400">
          <span>本级成长</span>
          <span>{level.progress}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-blue-100" aria-label={`等级进度 ${level.progress}%`}>
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${level.progress}%` }} />
        </div>
        <p className="mt-1 text-center text-[9px] text-amber-600">距离新装扮还差 {level.next - level.current} 星光</p>
      </div>

      <button
        type="button"
        onClick={() => {
          setGreetingIndex((current) => (current + 1) % greetings.length)
          onGreet()
        }}
        className="mt-2.5 h-8 w-full rounded-xl bg-blue-600 text-xs font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
      >
        和小宝打招呼
      </button>
    </section>
  )
}
