import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Check } from 'lucide-react'
import { useSetAtom } from 'jotai'
import { sessionAtom } from '../lib/atoms/session'

interface Plan {
  id: string
  name: string
  description: string | null
  type: string
  creditsPerPeriod: number
  periodDays: number
  priceCents: number
  maxTasksPerDay: number | null
  maxSandboxDuration: number | null
  features: string | null
  active: boolean
  sortOrder: number
}

function formatPrice(cents: number): string {
  return cents === 0 ? '免费' : `¥${(cents / 100).toFixed(0)}`
}

export function PricingPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [subscribing, setSubscribing] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [mySubscription, setMySubscription] = useState<{ planId: string; status: string } | null>(null)
  const navigate = useNavigate()
  const setSession = useSetAtom(sessionAtom)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [plansData] = await Promise.all([api.get<Plan[]>('/api/billing/subscriptions/plans')])
        setPlans(plansData)
        try {
          const subData = await api.get<{ subscription: { planId: string; status: string } | null }>(
            '/api/billing/subscriptions/my',
          )
          if (subData.subscription) {
            setMySubscription(subData.subscription)
          }
        } catch {
          // not logged in — fine
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleSubscribe = async (planId: string) => {
    setSubscribing(planId)
    setError('')
    try {
      const result = await api.post<{
        success: boolean
        subscription: { id: string; status: string; planId: string; currentPeriodEnd: number }
        paymentRequired?: boolean
        amount?: number
      }>('/api/billing/subscriptions/subscribe', { planId })

      if (result.paymentRequired) {
        alert(`需要支付 ¥${(result.amount! / 100).toFixed(0)}，支付功能即将上线`)
      }

      setMySubscription({ planId: result.subscription.planId, status: result.subscription.status })
      setError('订阅成功！')
    } catch (err) {
      setError(err instanceof Error ? err.message : '订阅失败')
    } finally {
      setSubscribing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold mb-4">选择适合你的套餐</h1>
          <p className="text-muted-foreground">所有套餐均包含 AI 编程助手全部功能</p>
        </div>

        {error && (
          <div
            className={`text-sm rounded-md px-3 py-2 mb-6 text-center ${error.includes('成功') ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}`}
          >
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-4">
          {plans
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((plan) => {
              const features = plan.features ? JSON.parse(plan.features) : []
              const isCurrent = mySubscription?.planId === plan.id && mySubscription?.status === 'active'
              return (
                <Card
                  key={plan.id}
                  className={`flex flex-col ${plan.type === 'pro' ? 'border-primary shadow-lg' : ''}`}
                >
                  <CardHeader>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>{plan.description || `${plan.type.toUpperCase()} 套餐`}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col">
                    <div className="text-center mb-6">
                      <span className="text-4xl font-bold">{formatPrice(plan.priceCents)}</span>
                      {plan.priceCents > 0 && (
                        <span className="text-muted-foreground text-sm">/{plan.periodDays}天</span>
                      )}
                    </div>
                    <ul className="space-y-2 mb-6 flex-1">
                      <li className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500" />
                        {plan.creditsPerPeriod.toLocaleString()} 积分/周期
                      </li>
                      {plan.maxTasksPerDay !== null && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-500" />
                          每日 {plan.maxTasksPerDay} 个任务
                        </li>
                      )}
                      {plan.maxSandboxDuration !== null && (
                        <li className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-500" />
                          沙箱最长 {Math.round(plan.maxSandboxDuration / 60)} 分钟
                        </li>
                      )}
                      {features.map((f: string, i: number) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <Check className="h-4 w-4 text-green-500" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="w-full"
                      variant={isCurrent ? 'outline' : plan.type === 'pro' ? 'default' : 'outline'}
                      disabled={isCurrent || subscribing !== null}
                      onClick={() => handleSubscribe(plan.id)}
                    >
                      {subscribing === plan.id ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {isCurrent ? '当前套餐' : plan.priceCents === 0 ? '免费使用' : '立即订阅'}
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
        </div>
      </div>
    </div>
  )
}
