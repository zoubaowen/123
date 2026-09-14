import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { XiaoBao } from '@ai-xiaobao/chat-core'

describe('XiaoBao production character', () => {
  it('renders the selected nine-grid raster outfit instead of the old SVG mascot', () => {
    const markup = renderToStaticMarkup(<XiaoBao outfit="adventure" mood="excited" action="celebrate" />)

    expect(markup).toContain('/xiaobao/xiaobao-adventure.png')
    expect(markup).not.toContain('<svg')
  })
})
