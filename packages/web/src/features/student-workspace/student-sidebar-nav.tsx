import { useEffect, useState } from 'react'
import { BookOpen, GraduationCap, Library, PawPrint, Plus, Search, Sparkles } from 'lucide-react'
import { XiaobaoPetCard } from './xiaobao-pet-card'
import { StudentCoursePanel, type StudentCourse } from './student-course-panel'
import {
  awardCourse,
  awardGreeting,
  INITIAL_STUDENT_GROWTH,
  loadStudentGrowth,
  saveStudentGrowth,
  type StudentGrowthState,
} from './student-growth'

interface StudentSidebarNavProps {
  recentCreationCount: number
  onNewCreation: () => void
  onCoursePrompt?: (prompt: string) => void
  searchQuery?: string
  onSearchQueryChange?: (query: string) => void
}

export function filterStudentCreations<T extends { title: string | null; prompt: string }>(items: T[], keyword: string) {
  const normalizedKeyword = keyword.trim().toLocaleLowerCase()
  if (!normalizedKeyword) return items

  return items.filter((item) =>
    `${item.title ?? ''} ${item.prompt}`.toLocaleLowerCase().includes(normalizedKeyword),
  )
}

export function StudentSidebarNav({
  recentCreationCount,
  onNewCreation,
  onCoursePrompt = () => undefined,
  searchQuery = '',
  onSearchQueryChange = () => undefined,
}: StudentSidebarNavProps) {
  const [activeSection, setActiveSection] = useState<'creations' | 'courses' | 'pet'>('creations')
  const [growth, setGrowth] = useState<StudentGrowthState>(() =>
    typeof window === 'undefined' ? INITIAL_STUDENT_GROWTH : loadStudentGrowth(window.localStorage),
  )

  useEffect(() => {
    if (typeof window !== 'undefined') saveStudentGrowth(window.localStorage, growth)
  }, [growth])

  const handleCourseContinue = (course: StudentCourse) => {
    setGrowth((current) => awardCourse(current, course.id))
    onCoursePrompt(course.nextPrompt)
    setActiveSection('creations')
  }

  return (
    <nav aria-label="学生工作区导航" className="space-y-4">
      <div className="px-1">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">AI小宝学院</p>
            <p className="text-[11px] text-slate-500">和小宝一起创造新世界</p>
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <button
          type="button"
          onClick={onNewCreation}
          className="flex h-10 w-full items-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          新建创作
        </button>
        <a
          href="#/community"
          className="flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-slate-700 hover:bg-slate-100"
        >
          <Library className="h-4 w-4 text-slate-500" aria-hidden="true" />
          作品广场
        </a>
        <button
          type="button"
          aria-pressed={activeSection === 'courses'}
          onClick={() => setActiveSection(activeSection === 'courses' ? 'creations' : 'courses')}
          className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
            activeSection === 'courses' ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <BookOpen className="h-4 w-4" aria-hidden="true" />
          <span>我的课程</span>
        </button>
        <button
          type="button"
          aria-pressed={activeSection === 'pet'}
          onClick={() => setActiveSection(activeSection === 'pet' ? 'creations' : 'pet')}
          className={`flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm transition-colors ${
            activeSection === 'pet' ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-700 hover:bg-slate-100'
          }`}
        >
          <PawPrint className="h-4 w-4" aria-hidden="true" />
          <span>小宝伙伴</span>
        </button>
        <button
          type="button"
          disabled
          className="flex h-9 w-full items-center gap-2 rounded-lg px-3 text-sm text-slate-400"
        >
          <GraduationCap className="h-4 w-4" aria-hidden="true" />
          <span>成长中心</span>
          <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px]">即将开放</span>
        </button>
      </div>

      <section hidden={activeSection !== 'courses'}>
        <StudentCoursePanel onContinue={handleCourseContinue} />
      </section>
      <div hidden={activeSection !== 'pet'}>
        <XiaobaoPetCard growth={growth} onGreet={() => setGrowth((current) => awardGreeting(current))} />
      </div>

      <div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            aria-label="搜索创作"
            placeholder="搜索创作"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </label>
      </div>

      <div className="flex items-center justify-between px-1 text-xs font-medium text-slate-500">
        <span>{searchQuery.trim() ? '搜索结果' : '最近创作'}</span>
        <span aria-label={`${recentCreationCount} 个${searchQuery.trim() ? '搜索结果' : '最近创作'}`}>
          {recentCreationCount}
        </span>
      </div>
    </nav>
  )
}
