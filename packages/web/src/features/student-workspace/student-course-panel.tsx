import { ArrowRight, Gamepad2, Image, PenLine } from 'lucide-react'

export interface StudentCourse {
  id: string
  title: string
  type: string
  lessons: number
  difficulty: string
  progress: number
  nextTask: string
  nextPrompt: string
  accent: 'violet' | 'emerald' | 'rose'
}

export const STUDENT_COURSES: StudentCourse[] = [
  {
    id: 'ai-art',
    title: 'AI 绘画入门',
    type: '图片创作',
    lessons: 6,
    difficulty: '入门',
    progress: 32,
    nextTask: '设计一张太空校园海报',
    nextPrompt: '小宝，请陪我设计一张太空校园主题海报，先帮我确定主体、配色和画面布局。',
    accent: 'violet',
  },
  {
    id: 'game-maker',
    title: '小游戏制作',
    type: '编程创作',
    lessons: 8,
    difficulty: '进阶',
    progress: 18,
    nextTask: '制作弹跳球的第一关',
    nextPrompt: '小宝，请陪我制作一个弹跳球小游戏，先设计第一关的玩法、得分规则和失败条件。',
    accent: 'emerald',
  },
  {
    id: 'story-writing',
    title: '故事写作',
    type: '表达创作',
    lessons: 5,
    difficulty: '入门',
    progress: 60,
    nextTask: '写出故事的转折情节',
    nextPrompt: '小宝，请陪我写一个校园冒险故事，先帮我设计一个有惊喜的转折情节。',
    accent: 'rose',
  },
]

const icons = { violet: Image, emerald: Gamepad2, rose: PenLine }
const accents = {
  violet: 'bg-violet-50 text-violet-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  rose: 'bg-rose-50 text-rose-700',
}

export function StudentCoursePanel({ onContinue }: { onContinue: (course: StudentCourse) => void }) {
  return (
    <section className="space-y-2" aria-label="我的课程列表">
      <div className="px-1">
        <p className="text-xs font-semibold text-slate-700">正在学习</p>
        <p className="mt-0.5 text-[10px] text-slate-400">选择课程，让小宝带你继续创作</p>
      </div>
      {STUDENT_COURSES.map((course) => {
        const Icon = icons[course.accent]
        return (
          <article key={course.id} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${accents[course.accent]}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-slate-800">{course.title}</h3>
                <p className="mt-0.5 text-[9px] text-slate-400">
                  {course.type} · {course.lessons} 课时 · {course.difficulty}
                </p>
              </div>
              <span className="text-[10px] font-semibold text-blue-600">{course.progress}%</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`学习进度 ${course.progress}%`}>
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${course.progress}%` }} />
            </div>
            <p className="mt-2 text-[10px] leading-4 text-slate-500">
              <span className="font-medium text-slate-600">下一步：</span>
              {course.nextTask}
            </p>
            <button
              type="button"
              onClick={() => onContinue(course)}
              className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-lg bg-blue-50 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
            >
              继续学习 <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </article>
        )
      })}
    </section>
  )
}
