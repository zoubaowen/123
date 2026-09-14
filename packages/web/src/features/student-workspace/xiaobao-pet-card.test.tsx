import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { XiaobaoPetCard } from './xiaobao-pet-card'

describe('XiaobaoPetCard', () => {
  it('shows honest demo progress and a real greeting action', () => {
    const markup = renderToStaticMarkup(
      <XiaobaoPetCard
        growth={{ starlight: 45, greeted: false, rewardedCourseIds: [] }}
        onGreet={() => undefined}
      />,
    )

    expect(markup).toContain('小宝伙伴')
    expect(markup).toContain('星光成长记录')
    expect(markup).toContain('和小宝打招呼')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('45')
    expect(markup).toContain('45%')
    expect(markup).toContain('距离新装扮还差 55 星光')
  })
})
