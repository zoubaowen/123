export type XiaoBaoOutfit =
  | 'academy'
  | 'coding'
  | 'ai'
  | 'art'
  | 'music'
  | 'science'
  | 'robotics'
  | 'reading'
  | 'adventure'

export type XiaoBaoMood = 'idle' | 'happy' | 'thinking' | 'working' | 'excited' | 'sleepy' | 'comforting'

export type XiaoBaoAction =
  | 'breathe'
  | 'blink'
  | 'wave'
  | 'look-left'
  | 'cover-eyes'
  | 'write'
  | 'celebrate'
  | 'upgrade'
  | 'sleep'

export interface XiaoBaoState {
  outfit: XiaoBaoOutfit
  mood: XiaoBaoMood
  action: XiaoBaoAction
}

export interface XiaoBaoOutfitDefinition {
  id: XiaoBaoOutfit
  title: string
  description: string
  primary: string
  accent: string
  accessory: 'stylus' | 'terminal' | 'nodes' | 'palette' | 'synth' | 'flask' | 'toolkit' | 'book' | 'backpack'
}

export const XIAOBAO_OUTFITS = [
  {
    id: 'academy',
    title: '星光院长',
    description: '陪你开启每一次创作冒险',
    primary: '#243B80',
    accent: '#FFC857',
    accessory: 'stylus',
  },
  {
    id: 'coding',
    title: '编程魔法师',
    description: '把奇思妙想写成会运行的作品',
    primary: '#3548A8',
    accent: '#62D9FF',
    accessory: 'terminal',
  },
  {
    id: 'ai',
    title: 'AI 探索家',
    description: '发现模型、数据与智能的奥秘',
    primary: '#28367D',
    accent: '#61E5D1',
    accessory: 'nodes',
  },
  {
    id: 'art',
    title: '绘画设计师',
    description: '让颜色和形状讲出你的故事',
    primary: '#5C3C98',
    accent: '#FF86A8',
    accessory: 'palette',
  },
  {
    id: 'music',
    title: '音乐创作家',
    description: '用节拍与旋律表达灵感',
    primary: '#3F3B91',
    accent: '#B68CFF',
    accessory: 'synth',
  },
  {
    id: 'science',
    title: '科学实验员',
    description: '观察、猜想，再亲手验证答案',
    primary: '#176E82',
    accent: '#8EE6B5',
    accessory: 'flask',
  },
  {
    id: 'robotics',
    title: '机器人建造师',
    description: '让机械零件听懂你的指令',
    primary: '#31558C',
    accent: '#FF9E5E',
    accessory: 'toolkit',
  },
  {
    id: 'reading',
    title: '阅读学习官',
    description: '在书页里收集知识星光',
    primary: '#4C4A88',
    accent: '#F5C96A',
    accessory: 'book',
  },
  {
    id: 'adventure',
    title: '冒险成长版',
    description: '记录挑战、徽章与每次进步',
    primary: '#274D78',
    accent: '#FF755F',
    accessory: 'backpack',
  },
] as const satisfies readonly XiaoBaoOutfitDefinition[]

export function getXiaoBaoOutfit(outfit: XiaoBaoOutfit): XiaoBaoOutfitDefinition {
  return XIAOBAO_OUTFITS.find((entry) => entry.id === outfit) ?? XIAOBAO_OUTFITS[0]
}
