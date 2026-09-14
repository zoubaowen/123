import { XiaoBao } from '@ai-xiaobao/chat-core'
import type { XiaoBaoMood } from '@ai-xiaobao/chat-core'
import { useEffect, useState } from 'react'

interface SplashScreenProps {
  message?: string
  progress?: number
  mood?: XiaoBaoMood
}

const tips = [
  '小宝正在启动星光创作空间...',
  '正在连接 AI 学习伙伴...',
  '正在准备代码、动画、音乐和游戏工具...',
  '准备好一起把好点子变成作品啦...',
  '小宝正在点亮今天的第一颗创意星星...',
  '正在唤醒超时空绘图引擎...',
  '正在接入创意灵感星云...',
]

const CANDY = ['#FFB3A7', '#FFD98A', '#8FD3FF', '#B8E6A9', '#FFC1E3', '#C4B5FD']

interface Star {
  top: string
  left: string
  size: number
  delay: number
  duration: number
  color: string
}

const stars: Star[] = [
  { top: '10%', left: '14%', size: 5, delay: 0, duration: 2.6, color: '#FFB3A7' },
  { top: '22%', left: '80%', size: 4, delay: 0.8, duration: 3.2, color: '#C4B5FD' },
  { top: '38%', left: '7%', size: 6, delay: 1.4, duration: 2.8, color: '#FFD98A' },
  { top: '12%', left: '55%', size: 3, delay: 0.4, duration: 2.4, color: '#B8E6A9' },
  { top: '62%', left: '88%', size: 5, delay: 2.0, duration: 3.4, color: '#FFB3A7' },
  { top: '78%', left: '12%', size: 4, delay: 1.1, duration: 3.0, color: '#B8E6A9' },
  { top: '86%', left: '62%', size: 6, delay: 0.2, duration: 2.7, color: '#FFD98A' },
  { top: '48%', left: '92%', size: 3, delay: 1.7, duration: 2.5, color: '#C4B5FD' },
  { top: '28%', left: '30%', size: 3, delay: 2.3, duration: 3.1, color: '#8FD3FF' },
  { top: '72%', left: '40%', size: 4, delay: 0.9, duration: 2.9, color: '#FFC1E3' },
  { top: '8%', left: '68%', size: 4, delay: 1.9, duration: 3.3, color: '#FFD98A' },
  { top: '90%', left: '30%', size: 5, delay: 0.5, duration: 2.6, color: '#8FD3FF' },
]

const blobs: { top: string; left: string; size: string; color: string; opacity: number }[] = [
  { top: '8%', left: '-6%', size: '360px', color: '#FFE3B3', opacity: 0.5 },
  { top: '55%', left: '82%', size: '420px', color: '#D6ECFF', opacity: 0.45 },
  { top: '70%', left: '-8%', size: '300px', color: '#FFE1D6', opacity: 0.5 },
]

export function SplashScreen({ message, progress, mood = 'excited' }: SplashScreenProps) {
  const [tipIndex, setTipIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTipIndex((i) => (i + 1) % tips.length)
    }, 2600)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-b from-[#FFF9EE] via-[#FFF4E4] to-[#FFEBD6] text-[#5B3A29]">
      {/* 柔和彩色光斑 */}
      {blobs.map((b, i) => (
        <div
          key={i}
          className="pointer-events-none absolute rounded-full blur-3xl"
          style={{
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            backgroundColor: b.color,
            opacity: b.opacity,
          }}
        />
      ))}

      {/* 浮动小星星 */}
      {stars.map((s, i) => (
        <span
          key={i}
          className="pointer-events-none absolute select-none"
          style={{
            top: s.top,
            left: s.left,
            fontSize: s.size + 8,
            color: s.color,
            animation: `xb-twinkle ${s.duration}s ease-in-out ${s.delay}s infinite, xb-floaty 4.6s ease-in-out ${i % 3}s infinite`,
            textShadow: `0 0 12px ${s.color}`,
          }}
        >
          ✦
        </span>
      ))}

      {/* 内容 */}
      <div className="relative flex w-full max-w-md flex-col items-center px-8 text-center">
        <div className="relative">
          <div
            className="absolute -inset-14 rounded-full bg-white/70 blur-3xl"
            style={{ animation: 'xb-glow-breath 4.2s ease-in-out infinite' }}
          />
          <div
            className="absolute -left-10 top-6 text-2xl text-[#FFC53D]"
            style={{ textShadow: '0 0 16px rgba(255,197,61,0.6)' }}
          >
            ★
          </div>
          <div
            className="absolute -right-9 top-14 text-xl text-[#8FD3FF]"
            style={{ textShadow: '0 0 14px rgba(143,211,255,0.6)' }}
          >
            ◇
          </div>
          <div
            className="absolute -bottom-1 left-6 text-lg text-[#FFB3A7]"
            style={{ textShadow: '0 0 12px rgba(255,179,167,0.6)' }}
          >
            ♥
          </div>
          <div
            className="absolute -right-10 bottom-3 text-lg text-[#B8E6A9]"
            style={{ textShadow: '0 0 12px rgba(184,230,169,0.6)' }}
          >
            ✿
          </div>
          <div className="animate-[xb-floaty_4.5s_ease-in-out_infinite]">
            <XiaoBao
              outfit="academy"
              mood={mood}
              action={mood === 'excited' ? 'wave' : 'breathe'}
              size={188}
              speaking
            />
          </div>
        </div>

        <h1 className="mt-6 text-3xl font-bold tracking-tight text-[#E07A3F]">AI小宝学院</h1>
        <p className="mt-2 text-sm text-[#A97A5A]">和小宝一起，把灵感变成会发光的作品 ✨</p>

        {progress !== undefined ? (
          <div className="relative mt-7 w-80">
            <div className="relative h-3 overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-[#F0CFA0]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#FFB56B] via-[#FF9F45] to-[#FF8C42] shadow-[0_0_16px_rgba(255,143,66,0.5)] transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="absolute -bottom-5 right-0 font-mono text-[11px] text-[#D98A5F]">
              {Math.round(progress)}%
            </span>
          </div>
        ) : (
          <div className="mt-7 flex items-center gap-3">
            <div className="h-2.5 w-10 animate-pulse rounded-full bg-[#FF9F45] shadow-[0_0_14px_rgba(255,159,69,0.55)]" />
            {CANDY.map((c, i) => (
              <div
                key={i}
                className="h-2.5 w-2.5 animate-bounce rounded-full [animation-delay:120ms]"
                style={{ backgroundColor: c, boxShadow: `0 0 10px ${c}` }}
              />
            ))}
          </div>
        )}

        <p className="mt-8 min-h-5 font-mono text-xs text-[#A97A5A] transition-opacity duration-500">
          {message || tips[tipIndex]}
          <span
            className="ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 bg-[#FF9F45]"
            style={{ animation: 'xb-blink 1.1s step-end infinite' }}
          />
        </p>
      </div>
    </div>
  )
}
