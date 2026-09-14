import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useAtomValue, useSetAtom } from 'jotai'
import { sessionAtom } from '@/lib/atoms/session'
import { taskPromptAtom } from '@/lib/atoms/task'
import { XiaoBao, XIAOBAO_OUTFITS } from '@ai-xiaobao/chat-core'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiUrl } from '@/lib/api'
import { getRegistrationTarget } from '@/lib/auth/local-auth-navigation'
import {
  MessageCircle,
  Eye,
  Mic,
  Globe,
  ArrowRight,
  Gamepad2,
  Palette,
  Music,
  Film,
  Sparkles,
  Star,
  ChevronRight,
} from 'lucide-react'

interface BgStar {
  top: string
  left: string
  size: number
  delay: number
  duration: number
  color: string
}

const bgStars: BgStar[] = [
  { top: '8%', left: '10%', size: 5, delay: 0, duration: 2.6, color: '#FFB3A7' },
  { top: '18%', left: '86%', size: 4, delay: 0.8, duration: 3.2, color: '#C4B5FD' },
  { top: '30%', left: '4%', size: 6, delay: 1.4, duration: 2.8, color: '#FFD98A' },
  { top: '12%', left: '52%', size: 3, delay: 0.4, duration: 2.4, color: '#B8E6A9' },
  { top: '46%', left: '92%', size: 5, delay: 2.0, duration: 3.4, color: '#FFB3A7' },
  { top: '60%', left: '8%', size: 4, delay: 1.1, duration: 3.0, color: '#B8E6A9' },
  { top: '72%', left: '80%', size: 6, delay: 0.2, duration: 2.7, color: '#FFD98A' },
  { top: '40%', left: '96%', size: 3, delay: 1.7, duration: 2.5, color: '#C4B5FD' },
  { top: '55%', left: '30%', size: 3, delay: 2.3, duration: 3.1, color: '#8FD3FF' },
  { top: '80%', left: '16%', size: 4, delay: 0.9, duration: 2.9, color: '#FFC1E3' },
  { top: '6%', left: '74%', size: 4, delay: 1.9, duration: 3.3, color: '#FFD98A' },
  { top: '88%', left: '70%', size: 5, delay: 0.5, duration: 2.6, color: '#8FD3FF' },
]

const blobs: { top: string; left: string; size: string; color: string; opacity: number }[] = [
  { top: '-4%', left: '-8%', size: '480px', color: '#FFE3B3', opacity: 0.55 },
  { top: '26%', left: '82%', size: '520px', color: '#D6ECFF', opacity: 0.45 },
  { top: '58%', left: '-8%', size: '440px', color: '#FFE1D6', opacity: 0.5 },
  { top: '82%', left: '78%', size: '460px', color: '#E4F0D8', opacity: 0.5 },
]

const FEATURES = [
  {
    icon: MessageCircle,
    color: '#FF9F45',
    title: 'AI 对话创作',
    desc: '用中文描述想法，小宝帮你写代码、改效果，零基础也能做游戏和动画',
  },
  {
    icon: Eye,
    color: '#8FD3FF',
    title: '分屏即时预览',
    desc: '左边聊天右边看效果，代码生成后实时预览，每步创作都看得见',
  },
  {
    icon: Mic,
    color: '#C4A5F5',
    title: '语音互动',
    desc: '支持语音输入，低年级同学也能轻松表达创意，说出你的想法',
  },
  {
    icon: Globe,
    color: '#B8E6A9',
    title: '作品社区',
    desc: '作品发布到社区展厅，和同学互相点赞、分享，学习成果看得见',
  },
]

const SAMPLE_WORKS = [
  {
    icon: Gamepad2,
    color: 'from-[#8FE38F] to-[#5FCB71]',
    title: '贪吃蛇',
    desc: '经典小游戏',
  },
  {
    icon: Palette,
    color: 'from-[#C4A5F5] to-[#F29BD4]',
    title: '会动的彩色小猫',
    desc: '动画创意',
  },
  {
    icon: Music,
    color: 'from-[#7FC8F8] to-[#5A9EF8]',
    title: '音乐播放器',
    desc: '交互应用',
  },
  {
    icon: Film,
    color: 'from-[#FFBE72] to-[#FF9F45]',
    title: '交互式故事书',
    desc: '多结局剧情',
  },
]

function LocalLoginForm({ onSuccess }: { onSuccess: () => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setSession = useSetAtom(sessionAtom)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const registrationTarget = getRegistrationTarget(mode)
    if (registrationTarget) {
      window.location.href = registrationTarget
      return
    }
    setError('')
    setLoading(true)
    try {
      const endpoint = mode === 'login' ? apiUrl('/api/auth/login') : apiUrl('/api/auth/register')
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'An error occurred')
      } else {
        setSession({ user: data.user, envId: data.envId })
        onSuccess()
      }
    } catch {
      setError('Network error, please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex gap-2 text-sm">
        <button
          type="button"
          className={`font-medium ${mode === 'login' ? 'text-[#E07A3F] underline underline-offset-4' : 'text-[#B08A68]'}`}
          onClick={() => {
            setMode('login')
            setError('')
          }}
        >
          登录
        </button>
        <span className="text-[#C9A685]">/</span>
        <button
          type="button"
          className={`font-medium ${mode === 'register' ? 'text-[#E07A3F] underline underline-offset-4' : 'text-[#B08A68]'}`}
          onClick={() => {
            setMode('register')
            setError('')
          }}
        >
          注册
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="landing-username" className="text-[#7A5A44]">
          用户名
        </Label>
        <Input
          id="landing-username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="请输入用户名"
          autoComplete="username"
          required
          minLength={3}
          className="rounded-xl border-[#EFD9BB] bg-white text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="landing-password" className="text-[#7A5A44]">
          密码
        </Label>
        <Input
          id="landing-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="请输入密码"
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minLength={6}
          className="rounded-xl border-[#EFD9BB] bg-white text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
        />
      </div>
      {error && <p className="text-sm text-[#C2473A]">{error}</p>}
      <Button
        type="submit"
        disabled={loading}
        size="lg"
        className="w-full rounded-xl border-0 bg-gradient-to-r from-[#FF9F45] to-[#FF7A59] text-white shadow-lg shadow-[#FF9F45]/35 hover:from-[#F78F3F] hover:to-[#F46E4E]"
      >
        {loading ? '请稍候...' : mode === 'login' ? '登录' : '注册'}
      </Button>
    </form>
  )
}

function TechBackground({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-b from-[#FFF9EE] via-[#FFF4E4] to-[#FFEBD6] text-[#5B3A29]">
      {/* 柔和彩色光斑 */}
      {blobs.map((b, i) => (
        <div
          key={i}
          className="pointer-events-none fixed rounded-full blur-3xl"
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
      {/* 浮动星星 */}
      {bgStars.map((s, i) => (
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
      {children}
    </div>
  )
}

export function LandingPage() {
  const navigate = useNavigate()
  const setTaskPrompt = useSetAtom(taskPromptAtom)
  const session = useAtomValue(sessionAtom)
  const [showLogin, setShowLogin] = useState(false)

  const handleStartCreate = () => {
    if (session.user) {
      navigate('/')
    } else {
      setShowLogin(true)
    }
  }

  const quickActions = [
    { label: '小游戏', prompt: '帮我做一个好玩的贪吃蛇小游戏' },
    { label: '动画', prompt: '帮我做一个五彩缤纷的粒子动画' },
    { label: '画画', prompt: '帮我画一幅美丽的风景画' },
  ]

  const handleQuickAction = (prompt: string) => {
    setTaskPrompt(prompt)
    if (session.user) {
      navigate('/')
    } else {
      setShowLogin(true)
    }
  }

  return (
    <TechBackground>
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#FFE3C2] bg-white/75 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XiaoBao outfit="academy" mood="idle" action="breathe" size={32} />
            <span className="text-base font-bold bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
              AI小宝学院
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/community')}
              className="text-sm text-[#A97A5A] hover:text-[#5B3A29] transition-colors"
            >
              作品社区
            </button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-[#FF9F45] to-[#FF7A59] text-white hover:from-[#F78F3F] hover:to-[#F46E4E] border-0 rounded-full shadow-sm shadow-[#FF9F45]/30"
              onClick={handleStartCreate}
            >
              {session.user ? '开始创作' : '登录 / 注册'}
            </Button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 px-4">
        <div className="relative max-w-4xl mx-auto text-center">
          {/* 小宝光环 */}
          <div className="relative flex justify-center mb-8">
            <div className="pointer-events-none relative">
              <div
                className="absolute -inset-20 rounded-full bg-white/70 blur-3xl"
                style={{ animation: 'xb-glow-breath 4.2s ease-in-out infinite' }}
              />
              <div className="absolute -inset-14 animate-[xb-orbit_24s_linear_infinite] rounded-full border-2 border-dashed border-[#FFD98A]/70" />
              <div className="absolute -inset-9 animate-[xb-orbit-rev_16s_linear_infinite] rounded-full border-2 border-dotted border-[#8FD3FF]/60" />
              <span className="absolute -left-6 top-1/4 h-2.5 w-2.5 rounded-full bg-[#FFC53D] shadow-[0_0_14px_rgba(255,197,61,0.8)]" />
              <span className="absolute -right-7 top-1/2 h-2 w-2 rounded-full bg-[#8FD3FF] shadow-[0_0_10px_rgba(143,211,255,0.8)]" />
              <div className="animate-[xb-floaty_4.5s_ease-in-out_infinite]">
                <XiaoBao outfit="academy" mood="excited" action="wave" size={150} />
              </div>
            </div>
          </div>

          <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold mb-4 tracking-tight">
            <span className="bg-gradient-to-r from-[#E07A3F] via-[#FF9F45] to-[#E07A3F] bg-clip-text text-transparent">
              让每个孩子
            </span>
            <br />
            <span className="text-[#5B3A29]">用 AI 做出自己的作品</span>
          </h1>

          <p className="text-base md:text-lg text-[#8A6A50]/90 mb-8 max-w-2xl mx-auto leading-relaxed">
            嘿，我是小宝！✨ 我是陪着你创作的星光学习伙伴。
            <br className="hidden sm:block" />
            用中文和我对话，就能一步步做出游戏、动画和互动故事——不会写代码也能创造属于自己的世界。
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-8">
            <Button
              size="lg"
              className="h-12 px-8 text-base bg-gradient-to-r from-[#FF9F45] to-[#FF7A59] text-white hover:from-[#F78F3F] hover:to-[#F46E4E] border-0 rounded-full shadow-lg shadow-[#FF9F45]/35"
              onClick={handleStartCreate}
            >
              免费开始创作
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-8 text-base rounded-full border-[#F0C89A] bg-white/70 text-[#7A5A44] hover:bg-white hover:text-[#5B3A29]"
              onClick={() => navigate('/community')}
            >
              看看同学们的作品
            </Button>
          </div>

          {/* Quick start chips */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-[#B08A68] mr-1">试试说：</span>
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => handleQuickAction(action.prompt)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border border-[#F0C89A] hover:border-[#FF9F45]/60 hover:text-[#E07A3F] transition-colors bg-white/70 backdrop-blur"
              >
                <Sparkles className="h-3 w-3 text-[#FF9F45]/90" />
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* XiaoBao course outfits */}
      <section className="px-4 py-16 md:py-24" aria-labelledby="xiaobao-course-title">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <p className="mb-2 text-sm font-bold tracking-[0.24em] text-[#5A72BD]">九种课程伙伴 · 同一个小宝</p>
            <h2 id="xiaobao-course-title" className="text-2xl font-black text-[#243B80] md:text-4xl">
              每探索一个方向，小宝都会换上新装备
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-[#6F7899]">
              星形轮廓、深蓝脸庞和星光披风始终不变，让每一门课程都有熟悉的陪伴。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {XIAOBAO_OUTFITS.map((course, index) => (
              <button
                type="button"
                key={course.id}
                onClick={() => handleQuickAction(`小宝，请带我体验${course.title}课程`)}
                className={`group rounded-[1.75rem] border border-white/80 bg-white/80 p-4 text-center shadow-[0_14px_40px_rgba(46,56,118,0.09)] transition hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(46,56,118,0.16)] ${index === 0 ? 'col-span-2 sm:col-span-1' : ''}`}
              >
                <XiaoBao outfit={course.id} mood={index % 3 === 0 ? 'excited' : 'happy'} action="breathe" size={96} />
                <h3 className="mt-2 font-bold text-[#293B79]">{course.title}</h3>
                <p className="mt-1 text-xs leading-5 text-[#78809B]">{course.description}</p>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              <span className="bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
                小宝会陪你做这些事
              </span>
            </h2>
            <p className="text-[#B08A68]">为 8-16 岁青少年场景深度优化，让你专注创作</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="group relative p-6 rounded-3xl border border-[#FFE3C2] bg-white/85 backdrop-blur shadow-sm hover:border-[#FFBE72] hover:shadow-lg hover:shadow-[#FFE3C2]/60 transition-all duration-300"
              >
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                  style={{ backgroundColor: `${feature.color}33` }}
                >
                  <feature.icon className="h-6 w-6" style={{ color: feature.color }} />
                </div>
                <h3 className="font-semibold mb-2 text-[#5B3A29]">{feature.title}</h3>
                <p className="text-sm text-[#A97A5A] leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample Works */}
      <section className="py-16 md:py-24 px-4 bg-white/40">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              <span className="bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
                用 AI 做出好玩的项目
              </span>
            </h2>
            <p className="text-[#B08A68]">来自同学的真实创作，点击开始体验</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {SAMPLE_WORKS.map((work) => (
              <button
                key={work.title}
                onClick={() => handleQuickAction(`帮我做一个${work.title}`)}
                className="group relative p-6 rounded-3xl border border-[#FFE3C2] bg-white/85 shadow-sm backdrop-blur hover:border-[#FFBE72] hover:shadow-lg hover:shadow-[#FFE3C2]/60 transition-all duration-300 text-left"
              >
                <div
                  className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${work.color} flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}
                >
                  <work.icon className="h-7 w-7 text-white" />
                </div>
                <h3 className="font-semibold mb-1 text-[#5B3A29]">{work.title}</h3>
                <p className="text-sm text-[#A97A5A]">{work.desc}</p>
                <div className="mt-3 flex items-center gap-1 text-xs text-[#E07A3F] opacity-0 group-hover:opacity-100 transition-opacity">
                  试试创建 <ChevronRight className="h-3 w-3" />
                </div>
              </button>
            ))}
          </div>
          <div className="text-center mt-8">
            <Button
              variant="outline"
              onClick={() => navigate('/community')}
              className="rounded-full border-[#F0C89A] bg-white/70 text-[#7A5A44] hover:bg-white hover:text-[#5B3A29]"
            >
              查看全部作品
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      {/* Download */}
      <section id="download" className="py-16 md:py-24 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFF0D6] text-[#E07A3F] text-xs font-medium mb-6 border border-[#FFD98A]">
            <Star className="h-3 w-3 fill-current" />
            桌面客户端
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-3">
            <span className="bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
              把小宝装进你的电脑
            </span>
          </h2>
          <p className="text-[#B08A68] mb-8">
            支持 Windows 64 位与 macOS（Apple 芯片）。
            <br />
            安装后跟着小宝完成引擎初始化，登录就能开始创作啦！
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Button
              size="lg"
              className="h-12 px-8 rounded-full bg-gradient-to-r from-[#FF9F45] to-[#FF7A59] text-white hover:from-[#F78F3F] hover:to-[#F46E4E] border-0 shadow-lg shadow-[#FF9F45]/35"
              asChild
            >
              <a href="/api/download/win" target="_blank" rel="noopener noreferrer">
                下载 Windows 版
              </a>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-12 px-8 rounded-full border-[#F0C89A] bg-white/70 text-[#7A5A44] hover:bg-white hover:text-[#5B3A29]"
              asChild
            >
              <a href="/api/download/mac" target="_blank" rel="noopener noreferrer">
                下载 macOS 版
              </a>
            </Button>
          </div>
          <p className="text-xs text-[#C9A685] mt-4">支持自动更新</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-[#FFE3C2] bg-white/50">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <XiaoBao outfit="academy" mood="idle" action="breathe" size={24} />
            <span className="text-sm font-bold bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
              AI小宝学院
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-[#A97A5A]">
            <button onClick={() => navigate('/community')} className="hover:text-[#5B3A29] transition-colors">
              作品社区
            </button>
            <button onClick={() => setShowLogin(true)} className="hover:text-[#5B3A29] transition-colors">
              管理后台
            </button>
          </div>
          <p className="text-xs text-[#C9A685]">AI小宝学院 — 青少年 AI 编程创作平台</p>
        </div>
      </footer>

      {/* Login Dialog */}
      <Dialog open={showLogin} onOpenChange={setShowLogin}>
        <DialogContent className="sm:max-w-md rounded-3xl border-[#FFE3C2] bg-white text-[#5B3A29] shadow-2xl shadow-[#F0CFA0]/50">
          <DialogHeader>
            <DialogTitle className="text-[#5B3A29]">
              <span className="bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-transparent">
                欢迎加入 AI小宝学院
              </span>
            </DialogTitle>
            <DialogDescription className="text-[#A97A5A]">登录或注册你的账号，开始 AI 创作之旅</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <LocalLoginForm onSuccess={() => setShowLogin(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </TechBackground>
  )
}
