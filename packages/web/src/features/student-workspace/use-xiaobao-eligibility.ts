import { useEffect, useState } from 'react'
import { apiUrl } from '@/lib/api'
import type { StudentXiaobaoCapability } from './student-capabilities'
import { parseXiaobaoCapabilities } from './student-runtime-selection'

const NO_CAPABILITIES: readonly StudentXiaobaoCapability[] = Object.freeze([])

/**
 * 读取服务端当前**已放行的小宝能力清单**（空数组表示无资格或该能力未配置）。
 *
 * - `enabled` 为 false（非学生创作区）时**不发任何请求**且恒为空；
 * - 只认 `eligible: true` 且 `capabilities` 为数组（`parseXiaobaoCapabilities`）；
 * - 非 200、网络失败、响应不是 JSON、组件卸载后的迟到响应一律 fail-closed 为空清单。
 */
export function useXiaobaoEligibility(enabled: boolean): readonly StudentXiaobaoCapability[] {
  const [capabilities, setCapabilities] = useState<readonly StudentXiaobaoCapability[]>(NO_CAPABILITIES)

  useEffect(() => {
    if (!enabled) {
      setCapabilities(NO_CAPABILITIES)
      return
    }

    let active = true

    const load = async () => {
      try {
        const response = await fetch(apiUrl('/api/agent/xiaobao/eligibility'), { credentials: 'include' })
        if (!active) return
        if (!response.ok) {
          setCapabilities(NO_CAPABILITIES)
          return
        }
        const payload: unknown = await response.json()
        if (!active) return
        setCapabilities(parseXiaobaoCapabilities(payload))
      } catch {
        if (active) setCapabilities(NO_CAPABILITIES)
      }
    }

    void load()

    return () => {
      active = false
    }
  }, [enabled])

  return capabilities
}
