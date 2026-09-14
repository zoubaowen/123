import { XiaoBao } from '@ai-xiaobao/chat-core'
import {
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  History,
  LayoutDashboard,
  LogOut,
  Presentation,
  UsersRound,
} from 'lucide-react'
import { NavLink, Outlet, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const teacherNavigation = [
  { to: '/teacher/dashboard', label: '教学首页', icon: LayoutDashboard },
  { to: '/teacher/classes', label: '班级管理', icon: UsersRound },
  { to: '/teacher/courses', label: '课程中心', icon: BookOpen },
  { to: '/teacher/works', label: '作业与作品', icon: ClipboardCheck },
  { to: '/teacher/students', label: '学生管理', icon: GraduationCap },
  { to: '/teacher/records', label: '课堂记录', icon: History },
] as const

export function TeacherLayout() {
  const navigate = useNavigate()

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f4f7fb] text-slate-900">
      <aside className="flex w-[248px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-[#eef4ff]">
              <XiaoBao outfit="academy" mood="happy" action="breathe" size={44} ariaLabel="教师端小宝助手" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-black text-[#1f3b75]">AI小宝学院</p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">教师教学管理后台</p>
            </div>
          </div>
        </div>

        <div className="mx-4 mt-4 rounded-2xl border border-[#dbe7ff] bg-[#f5f8ff] p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#315997]">
            <Presentation className="h-4 w-4" />
            当前机构
          </div>
          <p className="mt-2 text-sm font-bold text-slate-800">星河青少年创新中心</p>
          <span className="mt-2 inline-flex rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#4067a9] shadow-sm">
            授课老师
          </span>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="教师后台导航">
          {teacherNavigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-[#e9f1ff] text-[#2456a6]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                )
              }
            >
              <item.icon className="h-[18px] w-[18px]" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <div className="mb-3 flex items-center gap-3 rounded-xl bg-slate-50 p-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[#315997] text-xs font-black text-white">
              林
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">林老师</p>
              <p className="truncate text-[11px] text-slate-500">今日有 2 节课</p>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-slate-500" onClick={() => navigate('/')}>
            <LogOut className="h-4 w-4" />
            返回平台入口
          </Button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  )
}
