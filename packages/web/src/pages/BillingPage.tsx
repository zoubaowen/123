import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, CreditCard, ArrowUpRight, ArrowDownRight, Clock } from 'lucide-react'
import { useNavigate } from 'react-router'

interface CreditInfo {
  balance: number
  frozenBalance: number
  transactions: Transaction[]
}

interface Transaction {
  id: string
  type: string
  amount: number
  balanceAfter: number
  description: string | null
  metadata: string | null
  createdAt: number
}

interface SubInfo {
  subscription: {
    id: string
    planId: string
    status: string
    currentPeriodStart: number
    currentPeriodEnd: number
    autoRenew: boolean
  } | null
  plan: {
    id: string
    name: string
    type: string
    creditsPerPeriod: number
    periodDays: number
    priceCents: number
  } | null
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BillingPage() {
  const [credits, setCredits] = useState<CreditInfo | null>(null)
  const [subInfo, setSubInfo] = useState<SubInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [creditsData, subData] = await Promise.all([
          api.get<CreditInfo>('/api/billing/credits'),
          api.get<SubInfo>('/api/billing/subscriptions/my'),
        ])
        setCredits(creditsData)
        setSubInfo(subData)
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载失败')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleCancel = async () => {
    setCancelling(true)
    try {
      await api.post('/api/billing/subscriptions/cancel', {})
      setSubInfo((prev) =>
        prev ? { ...prev, subscription: { ...prev.subscription!, status: 'cancelled', autoRenew: false } } : prev,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : '取消失败')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  const typeLabels: Record<string, string> = {
    purchase: '充值',
    consumption: '消费',
    refund: '退款',
    admin_grant: '系统赠送',
    subscription: '套餐赠送',
    free_daily: '每日免费',
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-2xl font-bold">我的账户</h1>

        {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</div>}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CreditCard className="h-4 w-4" />
                可用积分
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{credits?.balance.toLocaleString() ?? 0}</div>
              {credits && credits.frozenBalance > 0 && (
                <p className="text-xs text-muted-foreground mt-1">冻结: {credits.frozenBalance.toLocaleString()}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Clock className="h-4 w-4" />
                当前套餐
              </CardTitle>
            </CardHeader>
            <CardContent>
              {subInfo?.subscription && subInfo?.plan ? (
                <div>
                  <div className="text-xl font-bold">{subInfo.plan.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {subInfo.subscription.status === 'active'
                      ? '生效中'
                      : subInfo.subscription.status === 'cancelled'
                        ? '已取消'
                        : '待付款'}
                    {' · '}
                    到期: {formatDate(subInfo.subscription.currentPeriodEnd)}
                  </div>
                  {subInfo.subscription.status === 'active' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-destructive"
                      onClick={handleCancel}
                      disabled={cancelling}
                    >
                      {cancelling ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      取消续费
                    </Button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="text-muted-foreground">未订阅</div>
                  <Button variant="link" size="sm" className="p-0 h-auto mt-1" onClick={() => navigate('/pricing')}>
                    查看套餐 →
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>积分流水</CardTitle>
          </CardHeader>
          <CardContent>
            {credits?.transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">暂无记录</p>
            ) : (
              <div className="space-y-3">
                {credits?.transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      {tx.amount > 0 ? (
                        <ArrowDownRight className="h-4 w-4 text-green-500" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <div className="text-sm font-medium">{typeLabels[tx.type] || tx.type}</div>
                        <div className="text-xs text-muted-foreground">{tx.description || '-'}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`text-sm font-bold ${tx.amount > 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {tx.amount > 0 ? '+' : ''}
                        {tx.amount}
                      </div>
                      <div className="text-xs text-muted-foreground">{formatDate(tx.createdAt)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
