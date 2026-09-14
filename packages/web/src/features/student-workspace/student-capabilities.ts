export type StudentCapabilityId = 'image' | 'video' | 'music' | 'game' | 'writing' | 'study'

/** 服务端小宝 Runtime 的能力名（前端入口 id 与服务端并不总是一致，例如 study → learning）。 */
export type StudentXiaobaoCapability = 'writing' | 'learning' | 'game' | 'image' | 'video'

export type StudentCapabilityAccent = 'violet' | 'sky' | 'amber' | 'emerald' | 'rose' | 'indigo'

export const STUDENT_MASTER_STAGES = ['discover', 'plan', 'produce', 'inspect', 'revise', 'deliver', 'reflect'] as const

export type StudentMasterStage = (typeof STUDENT_MASTER_STAGES)[number]

export interface StudentCapability {
  readonly id: StudentCapabilityId
  readonly title: string
  readonly description: string
  readonly prompt: string
  readonly icon: string
  readonly accent: StudentCapabilityAccent
  readonly status: 'available'
  readonly skillName: string
  /** 该入口在灰度通过时可向服务端请求的小宝能力；null 表示不接入小宝 Runtime。 */
  readonly xiaobaoCapability: StudentXiaobaoCapability | null
  readonly masterTitle: string
  readonly masterDescription: string
  readonly stages: readonly StudentMasterStage[]
  readonly toolState: 'available' | 'planned'
  readonly toolMessage?: string
}

export const STUDENT_CAPABILITIES: readonly StudentCapability[] = [
  {
    id: 'image',
    title: '画一张图',
    description: '海报、插画、角色和故事场景',
    prompt: '我想画一张图。请先问我主题、画面风格、主要角色和使用场景，再和我一起完善创意。',
    icon: 'Image',
    accent: 'violet',
    status: 'available',
    skillName: 'student-image-master',
    xiaobaoCapability: 'image',
    masterTitle: '小宝绘画大师',
    masterDescription: '从视觉方案到成图检查和局部修改，陪你完成一张真正的作品。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'available',
  },
  {
    id: 'video',
    title: '做一段视频',
    description: '从故事脚本到分镜和成片',
    prompt: '我想做一段视频。请先问我主题、时长、观众和想表达的内容，再带我完成脚本与分镜。',
    icon: 'Clapperboard',
    accent: 'sky',
    status: 'available',
    skillName: 'student-video-master',
    xiaobaoCapability: 'video',
    masterTitle: '小宝视频大师',
    masterDescription: '先锁定角色和九宫格，再逐镜制作角色一致、故事连贯的视频。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'planned',
    toolMessage: '火山引擎视频生成待接入，当前可以先完成角色参考与九宫格。',
  },
  {
    id: 'music',
    title: '创作音乐',
    description: '歌曲、配乐、节奏和声音故事',
    prompt: '我想创作一段音乐。请先问我想要的情绪、风格、速度和用途，再帮我设计旋律与结构。',
    icon: 'Music',
    accent: 'amber',
    status: 'available',
    skillName: 'student-music-master',
    xiaobaoCapability: null,
    masterTitle: '小宝音乐大师',
    masterDescription: '把情绪和故事变成曲式、歌词、配器，并在工具就绪后生成真实音频。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'planned',
    toolMessage: '音乐生成服务待选择，当前可以先完成完整音乐蓝图。',
  },
  {
    id: 'game',
    title: '做小游戏',
    description: '设计玩法、角色、关卡和规则',
    prompt: '我想做一个适合学生的小游戏。请先问我游戏主题、玩法、角色和难度，再带我一步步完成。',
    icon: 'Gamepad',
    accent: 'emerald',
    status: 'available',
    skillName: 'scratch-game-coach',
    xiaobaoCapability: 'game',
    masterTitle: '小宝游戏大师',
    masterDescription: '先做最小可玩版本，再实际试玩、修正并逐步增加乐趣。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'available',
  },
  {
    id: 'writing',
    title: '写作表达',
    description: '故事、作文、演讲和创意写作',
    prompt: '我想完成一次写作创作。请先问我文体、主题、读者和已有想法，再通过提问帮我组织自己的表达。',
    icon: 'PenLine',
    accent: 'rose',
    status: 'available',
    skillName: 'student-writing-coach',
    xiaobaoCapability: 'writing',
    masterTitle: '小宝写作大师',
    masterDescription: '保留你的想法和声音，用结构与逐段反馈陪你完成作品。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'available',
  },
  {
    id: 'study',
    title: '学习辅导',
    description: '理解知识、拆解难题和制定计划',
    prompt:
      '我有一个学习问题。请先提问了解我已经掌握到哪里，再分步引导我自己思考；不要直接给出答案，要在每一步等我回答后再继续。',
    icon: 'BookOpen',
    accent: 'indigo',
    status: 'available',
    skillName: 'student-learning-master',
    xiaobaoCapability: 'learning',
    masterTitle: '小宝学习大师',
    masterDescription: '先找到卡点，再一次解决一小步，直到你能自己讲明白。',
    stages: STUDENT_MASTER_STAGES,
    toolState: 'available',
  },
] as const

export function getStudentCapability(id: StudentCapabilityId): StudentCapability {
  const capability = STUDENT_CAPABILITIES.find((item) => item.id === id)

  if (!capability) {
    throw new Error('Unknown student capability')
  }

  return capability
}
