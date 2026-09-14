import { Music, Video, ImageIcon, Gamepad2, Sparkles } from 'lucide-react'

export interface QuickAction {
  id: string
  label: string
  icon: 'music' | 'video' | 'image' | 'game'
  prompt: string
  color: string
  gradient: string
}

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'generate-music',
    label: '生成音乐',
    icon: 'music',
    prompt:
      '请帮我创作一首音乐作品。你可以使用 HTML+CSS+JavaScript 创建一个完整的音乐播放器或音乐生成器页面，包含可视化效果、播放控制、多种音效选择，界面要好看有趣。',
    color: '#8b5cf6',
    gradient: 'from-purple-500 to-violet-600',
  },
  {
    id: 'generate-video',
    label: '生成视频',
    icon: 'video',
    prompt:
      '请帮我制作一个短视频或动画作品。你可以使用 HTML+CSS+JavaScript 创建一个动画故事、MV、或者好玩的视频特效页面，要有完整的剧情或创意展示，界面精美。',
    color: '#f43f5e',
    gradient: 'from-rose-500 to-pink-600',
  },
  {
    id: 'generate-image',
    label: '生成图片',
    icon: 'image',
    prompt:
      '请帮我创作一幅艺术作品。你可以使用 HTML+CSS 创建精美的插画、海报、或视觉设计，也可以使用 SVG 画图，要有创意和美感，适合展示。',
    color: '#f59e0b',
    gradient: 'from-amber-500 to-orange-600',
  },
  {
    id: 'generate-game',
    label: '生成游戏',
    icon: 'game',
    prompt:
      '请帮我制作一个有趣的小游戏。使用 HTML+CSS+JavaScript 创建一个完整的可玩游戏，要有计分系统、关卡设计、好看的画面，操作简单容易上手，适合中小学生玩。',
    color: '#10b981',
    gradient: 'from-emerald-500 to-teal-600',
  },
]

const iconMap = {
  music: Music,
  video: Video,
  image: ImageIcon,
  game: Gamepad2,
}

interface QuickActionsProps {
  onAction: (action: QuickAction) => void
  disabled?: boolean
  className?: string
}

export function QuickActions({ onAction, disabled = false, className = '' }: QuickActionsProps) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {QUICK_ACTIONS.map((action) => {
        const Icon = iconMap[action.icon]
        return (
          <button
            key={action.id}
            onClick={() => onAction(action)}
            disabled={disabled}
            className={`
              inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium
              rounded-full border border-border/50
              bg-gradient-to-r ${action.gradient} bg-clip-text
              hover:shadow-md hover:scale-105 hover:border-transparent
              active:scale-95
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100
              text-white
            `}
            style={{
              background: `linear-gradient(135deg, ${action.color}20, ${action.color}10)`,
              borderColor: `${action.color}40`,
              color: action.color,
            }}
            title={`点击快速${action.label}`}
          >
            <Sparkles className="h-3 w-3" style={{ color: action.color }} />
            <Icon className="h-3.5 w-3.5" />
            <span>{action.label}</span>
          </button>
        )
      })}
    </div>
  )
}
