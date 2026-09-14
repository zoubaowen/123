import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSetAtom } from 'jotai'
import { XiaoBao, getLoginXiaoBaoState } from '@ai-xiaobao/chat-core'
import type { LoginFocus } from '@ai-xiaobao/chat-core'
import { api, apiUrl } from '../lib/api'
import { sessionAtom } from '../lib/atoms/session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2, Lock, User, Smartphone, KeyRound } from 'lucide-react'
import { GitHubIcon } from '@/components/icons/github-icon'
import { getDesktopCloudAuthState, getEnabledAuthProviders, getGitHubAuthMode, getTcbEnvId } from '@/lib/auth/providers'
import { resolveInitialLoginMode } from '@/lib/auth/local-auth-navigation'

interface SplashStar {
  top: string
  left: string
  size: number
  delay: number
  duration: number
  color: string
}

const stars: SplashStar[] = [
  { top: '10%', left: '14%', size: 5, delay: 0, duration: 2.6, color: '#FFB3A7' },
  { top: '20%', left: '82%', size: 4, delay: 0.8, duration: 3.2, color: '#C4B5FD' },
  { top: '36%', left: '6%', size: 6, delay: 1.4, duration: 2.8, color: '#FFD98A' },
  { top: '12%', left: '52%', size: 3, delay: 0.4, duration: 2.4, color: '#B8E6A9' },
  { top: '58%', left: '90%', size: 5, delay: 2.0, duration: 3.4, color: '#FFB3A7' },
  { top: '76%', left: '10%', size: 4, delay: 1.1, duration: 3.0, color: '#B8E6A9' },
  { top: '86%', left: '66%', size: 6, delay: 0.2, duration: 2.7, color: '#FFD98A' },
  { top: '46%', left: '94%', size: 3, delay: 1.7, duration: 2.5, color: '#C4B5FD' },
  { top: '66%', left: '32%', size: 3, delay: 2.3, duration: 3.1, color: '#8FD3FF' },
  { top: '30%', left: '36%', size: 4, delay: 0.9, duration: 2.9, color: '#FFC1E3' },
  { top: '7%', left: '74%', size: 4, delay: 1.9, duration: 3.3, color: '#FFD98A' },
  { top: '90%', left: '24%', size: 5, delay: 0.5, duration: 2.6, color: '#8FD3FF' },
]

const blobs: { top: string; left: string; size: string; color: string; opacity: number }[] = [
  { top: '6%', left: '-8%', size: '400px', color: '#FFE3B3', opacity: 0.5 },
  { top: '50%', left: '86%', size: '440px', color: '#D6ECFF', opacity: 0.45 },
  { top: '78%', left: '-6%', size: '340px', color: '#FFE1D6', opacity: 0.5 },
]

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>(() =>
    resolveInitialLoginMode(window.location.search, window.location.hash),
  )
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [sendingSms, setSendingSms] = useState(false)
  const [smsCountdown, setSmsCountdown] = useState(0)
  const [smsHint, setSmsHint] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [focus, setFocus] = useState<LoginFocus>(null)
  const [loginSucceeded, setLoginSucceeded] = useState(false)
  const navigate = useNavigate()
  const setSession = useSetAtom(sessionAtom)

  const { github: hasGitHub, local: hasLocal } = getEnabledAuthProviders()
  const desktopCloudAuth = getDesktopCloudAuthState()
  const desktopCloudAuthBlocked = desktopCloudAuth.required && !desktopCloudAuth.configured
  const xiaobaoState = getLoginXiaoBaoState({
    mode,
    focus,
    loading: isLoading || sendingSms,
    success: loginSucceeded,
    error: Boolean(error),
  })

  const finishLogin = () => {
    setLoginSucceeded(true)
    window.setTimeout(() => navigate('/'), 650)
  }

  const handleSendSms = async () => {
    if (smsCountdown > 0) return
    if (!phone || phone.length !== 11) {
      setError('请输入正确的 11 位手机号')
      return
    }
    setError('')
    setSmsHint('')
    setSendingSms(true)
    try {
      const data = await api.post<{ message?: string }>('/api/auth/send-sms-code', { phone })
      if (data?.message) setSmsHint(data.message)
      setSmsCountdown(60)
      const timer = setInterval(() => {
        setSmsCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSendingSms(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (desktopCloudAuthBlocked) {
      setError('桌面版尚未连接 AI小宝学院云端账号服务，请检查 CENTRAL_AUTH_BASE_URL 配置。')
      return
    }
    if (mode === 'register' && (!/^1\d{10}$/.test(phone) || smsCode.length !== 6)) {
      setError('注册必须填写 11 位手机号，并输入 6 位短信验证码')
      return
    }

    setIsLoading(true)
    try {
      const body: Record<string, string> = { username, password }
      if (mode === 'register') {
        body.phone = phone
        body.code = smsCode
      }
      const data = await api.post<{
        user: { id: string; username: string; name?: string; email?: string; avatar?: string; role: 'user' | 'admin' }
        envId?: string
      }>(`/api/auth/${mode}`, body)
      setSession({ user: data.user, envId: data.envId })
      finishLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请稍后再试')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGitHubLogin = async () => {
    setError('')
    if (getGitHubAuthMode() === 'cloudbase') {
      setIsLoading(true)
      try {
        const { default: cloudbase } = await import('@cloudbase/js-sdk')
        const app = cloudbase.init({
          env: getTcbEnvId(),
          auth: { detectSessionInUrl: true },
        })
        const auth = app.auth({ persistence: 'local' })

        await auth.signInWithOAuth({ provider: 'github' })

        const loginState = await auth.getLoginState()
        if (!loginState) {
          setError('GitHub 登录失败')
          return
        }

        const userInfo = loginState.user
        await api.post('/api/auth/cloudbase/login', {
          uid: userInfo?.uid,
          customUserId: userInfo?.customUserId,
          nickName: userInfo?.name,
          email: userInfo?.email,
          avatarUrl: undefined,
        })

        const meData = await api.get<{
          user: {
            id: string
            username: string
            name?: string
            email?: string
            avatar?: string
            role: 'user' | 'admin'
          }
          envId?: string
        }>('/api/auth/me')
        setSession({ user: meData.user, envId: meData.envId })
        finishLogin()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'GitHub 登录失败')
      } finally {
        setIsLoading(false)
      }
    } else {
      window.location.href = apiUrl('/api/auth/github/login')
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center gap-10 overflow-hidden bg-gradient-to-br from-[#F8F7FF] via-[#FFF9EE] to-[#FFEBD6] p-4 text-[#263466] lg:px-12">
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

      {/* 左侧小装饰 */}
      <div className="pointer-events-none absolute left-[8%] top-1/2 hidden -translate-y-1/2 lg:block">
        <div className="relative flex h-40 w-40 items-center justify-center">
          <div
            className="absolute inset-0 rounded-full border-2 border-dashed border-[#FFD98A]"
            style={{ animation: 'xb-orbit 22s linear infinite' }}
          >
            <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FFC53D]" />
          </div>
          <div className="text-5xl" style={{ animation: 'xb-floaty 4.5s ease-in-out infinite' }}>
            🎨
          </div>
        </div>
      </div>
      {/* 右侧小装饰 */}
      <div className="pointer-events-none absolute right-[6%] top-[24%] hidden lg:block">
        <div className="relative flex h-36 w-36 items-center justify-center">
          <div
            className="absolute inset-0 rounded-full border-2 border-dotted border-[#8FD3FF]"
            style={{ animation: 'xb-orbit-rev 18s linear infinite' }}
          >
            <span className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-[#8FD3FF]" />
          </div>
          <div className="text-4xl" style={{ animation: 'xb-floaty 5s ease-in-out infinite' }}>
            🚀
          </div>
        </div>
      </div>

      <section
        className="relative z-10 hidden w-full max-w-xl flex-col items-center text-center lg:flex"
        aria-label="小宝欢迎区"
      >
        <div className="absolute inset-x-12 top-10 h-72 rounded-full bg-gradient-to-r from-[#8FD3FF]/30 via-[#FFE09A]/45 to-[#BFA7FF]/30 blur-3xl" />
        <div className="relative rounded-[4rem] border border-white/70 bg-white/45 px-14 pb-7 pt-9 shadow-[0_28px_80px_rgba(49,57,126,0.16)] backdrop-blur-xl">
          <div className="absolute -left-5 top-16 rounded-2xl border border-white/80 bg-white/80 px-3 py-2 text-xs font-semibold text-[#4E62A6] shadow-lg">
            ✦ 今天也要闪闪发光
          </div>
          <div className="absolute -right-8 top-32 rounded-2xl border border-white/80 bg-white/80 px-3 py-2 text-xs font-semibold text-[#DF7A46] shadow-lg">
            {'</>'} 创意正在加载
          </div>
          <XiaoBao {...xiaobaoState} size={280} ariaLabel="欢迎你的小宝" />
          <h1 className="mt-2 text-4xl font-black tracking-tight text-[#243B80]">和小宝一起，把想法变成作品</h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-7 text-[#64709A]">
            编程、AI、绘画、音乐与科学探索，都从你今天的一个小点子开始。
          </p>
          <div className="mt-6 flex justify-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-[#EAF7FF] px-3 py-1.5 text-[#28779B]">安全学习空间</span>
            <span className="rounded-full bg-[#FFF2D5] px-3 py-1.5 text-[#A86724]">九种课程伙伴</span>
            <span className="rounded-full bg-[#F1EBFF] px-3 py-1.5 text-[#6C54A5]">作品持续成长</span>
          </div>
        </div>
      </section>

      <Card className="relative z-10 w-full max-w-md rounded-[2rem] border-white/80 bg-white/90 text-[#5B3A29] shadow-[0_30px_90px_rgba(77,64,118,0.18)] backdrop-blur-xl">
        <CardHeader className="items-center text-center">
          <div className="relative lg:hidden">
            <div className="absolute -inset-10 rounded-full bg-[#FFF0D6] blur-2xl" />
            <div className="animate-[xb-floaty_4.5s_ease-in-out_infinite]">
              <XiaoBao {...xiaobaoState} size={132} ariaLabel="登录页小宝" />
            </div>
          </div>
          <CardTitle className="bg-gradient-to-r from-[#E07A3F] to-[#FF9F45] bg-clip-text text-2xl font-bold text-transparent">
            AI小宝学院
          </CardTitle>
          <CardDescription className="text-[#A97A5A]">
            {mode === 'login' ? '欢迎回来，和小宝一起做游戏和动画！' : '创建账号，和小宝一起创作更多作品'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {desktopCloudAuthBlocked && (
            <div className="mb-4 flex gap-2 rounded-md border border-[#F6C177]/40 bg-[#FFF3DE] px-3 py-2 text-sm text-[#B2622E]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>桌面版必须连接云端账号服务。请为发布版配置 CENTRAL_AUTH_BASE_URL。</span>
            </div>
          )}

          {hasLocal && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md border border-[#F4A9A1]/50 bg-[#FFE8E4] px-3 py-2 text-sm text-[#C2473A]">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="username" className="text-[#7A5A44]">
                  账号
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#D9B48F]" />
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setFocus('username')}
                    onBlur={() => setFocus(null)}
                    placeholder="请输入账号"
                    disabled={isLoading || desktopCloudAuthBlocked}
                    required
                    className="rounded-xl border-[#EFD9BB] bg-white pl-9 text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[#7A5A44]">
                  密码
                </Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#D9B48F]" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocus('password')}
                    onBlur={() => setFocus(null)}
                    placeholder="至少 8 位，包含大小写字母和数字"
                    disabled={isLoading || desktopCloudAuthBlocked}
                    required
                    className="rounded-xl border-[#EFD9BB] bg-white pl-9 text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
                  />
                </div>
              </div>
              {mode === 'register' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="phone" className="text-[#7A5A44]">
                      手机号
                    </Label>
                    <div className="relative">
                      <Smartphone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#D9B48F]" />
                      <Input
                        id="phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                        onFocus={() => setFocus('phone')}
                        onBlur={() => setFocus(null)}
                        placeholder="请输入 11 位手机号"
                        disabled={isLoading || desktopCloudAuthBlocked}
                        maxLength={11}
                        required
                        className="rounded-xl border-[#EFD9BB] bg-white pl-9 text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smsCode" className="text-[#7A5A44]">
                      短信验证码
                    </Label>
                    {smsHint && (
                      <div className="rounded-md border border-[#9ED9F5]/50 bg-[#E8F6FF] px-3 py-2 text-sm text-[#2E7FA8]">
                        {smsHint}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#D9B48F]" />
                        <Input
                          id="smsCode"
                          type="text"
                          value={smsCode}
                          onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                          onFocus={() => setFocus('code')}
                          onBlur={() => setFocus(null)}
                          placeholder="6 位验证码"
                          disabled={isLoading || desktopCloudAuthBlocked}
                          maxLength={6}
                          required
                          className="rounded-xl border-[#EFD9BB] bg-white pl-9 text-[#5B3A29] placeholder:text-[#C9A685] focus-visible:ring-[#FF9F45]/60"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          sendingSms || smsCountdown > 0 || !phone || phone.length !== 11 || desktopCloudAuthBlocked
                        }
                        onClick={handleSendSms}
                        className="whitespace-nowrap rounded-xl border-[#EFD9BB] bg-white text-[#7A5A44] hover:bg-[#FFF6E8] hover:text-[#5B3A29]"
                      >
                        {sendingSms ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : smsCountdown > 0 ? (
                          `${smsCountdown}s`
                        ) : (
                          '获取验证码'
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              )}
              <Button
                type="submit"
                className="w-full rounded-xl border-0 bg-gradient-to-r from-[#FF9F45] to-[#FF7A59] text-white shadow-lg shadow-[#FF9F45]/35 hover:from-[#F78F3F] hover:to-[#F46E4E]"
                disabled={isLoading || desktopCloudAuthBlocked}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {mode === 'login' ? '正在登录...' : '正在创建账号...'}
                  </>
                ) : mode === 'login' ? (
                  '登录'
                ) : (
                  '注册'
                )}
              </Button>
              <p className="text-center text-sm text-[#A97A5A]">
                {mode === 'login' ? '还没有账号？' : '已经有账号？'}
                <button
                  type="button"
                  onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                  className="font-medium text-[#E07A3F] hover:underline"
                  disabled={isLoading}
                >
                  {mode === 'login' ? '立即注册' : '去登录'}
                </button>
              </p>
            </form>
          )}

          {hasGitHub && (
            <>
              {hasLocal && (
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-[#EFD9BB]" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-[#B08A68]">或</span>
                  </div>
                </div>
              )}
              {!hasLocal && error && (
                <div className="mb-4 rounded-md border border-[#F4A9A1]/50 bg-[#FFE8E4] px-3 py-2 text-sm text-[#C2473A]">
                  {error}
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl border-[#EFD9BB] bg-white text-[#7A5A44] hover:bg-[#FFF6E8] hover:text-[#5B3A29]"
                disabled={isLoading}
                onClick={handleGitHubLogin}
              >
                {isLoading && !hasLocal ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <GitHubIcon className="mr-2 h-4 w-4" />
                )}
                使用 GitHub 登录
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
