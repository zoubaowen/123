import { useCallback } from 'react'
import { getXiaoBaoOutfit } from './xiaobao-types'
import type { XiaoBaoAction, XiaoBaoMood, XiaoBaoOutfit } from './xiaobao-types'
import './xiaobao-character.css'

export interface XiaoBaoProps {
  outfit?: XiaoBaoOutfit
  mood?: XiaoBaoMood
  action?: XiaoBaoAction
  size?: number
  interactive?: boolean
  speaking?: boolean
  onClick?: () => void
  className?: string
  ariaLabel?: string
}

const OUTFIT_ASSETS: Record<XiaoBaoOutfit, string> = {
  academy: '/xiaobao/xiaobao-academy.png',
  coding: '/xiaobao/xiaobao-coding.png',
  ai: '/xiaobao/xiaobao-ai.png',
  art: '/xiaobao/xiaobao-art.png',
  music: '/xiaobao/xiaobao-music.png',
  science: '/xiaobao/xiaobao-science.png',
  robotics: '/xiaobao/xiaobao-robotics.png',
  reading: '/xiaobao/xiaobao-reading.png',
  adventure: '/xiaobao/xiaobao-adventure.png',
}

export function XiaoBao({
  outfit = 'academy',
  mood = 'idle',
  action = 'breathe',
  size = 120,
  interactive = false,
  speaking = false,
  onClick,
  className = '',
  ariaLabel,
}: XiaoBaoProps) {
  const definition = getXiaoBaoOutfit(outfit)
  const canInteract = interactive || Boolean(onClick)
  const handleClick = useCallback(() => onClick?.(), [onClick])

  return (
    <span
      className={`xiaobao xiaobao--${action} xiaobao--${mood} ${speaking ? 'xiaobao--speaking' : ''} ${canInteract ? 'xiaobao--interactive' : ''} ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (canInteract && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          handleClick()
        }
      }}
      role={canInteract ? 'button' : 'img'}
      tabIndex={canInteract ? 0 : undefined}
      aria-label={ariaLabel ?? `小宝·${definition.title}，AI小宝学院的星光学习伙伴`}
      title={`小宝·${definition.title}`}
    >
      <img className="xiaobao__image" src={OUTFIT_ASSETS[outfit]} alt="" draggable={false} aria-hidden="true" />
    </span>
  )
}

export type { XiaoBaoAction, XiaoBaoMood, XiaoBaoOutfit } from './xiaobao-types'
