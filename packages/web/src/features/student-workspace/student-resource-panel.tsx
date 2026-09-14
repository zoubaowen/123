import { useState } from 'react'
import { BookOpen, FileBox, FolderOpen, Library, PanelRightOpen, Sparkles, X } from 'lucide-react'

type ResourceTab = 'files' | 'assets' | 'courses'

const emptyStates: Record<ResourceTab, { title: string; description: string }> = {
  files: { title: '作品还没有文件', description: '开始创作后，小宝生成的项目文件会自动出现在这里。' },
  assets: { title: '还没有创作素材', description: '你上传和生成的图片、声音、视频会集中放在这里。' },
  courses: { title: '课程资料正在准备中', description: '老师发布的课程资料和练习素材以后会出现在这里。' },
}

function ResourcePanelContent({
  activeTab,
  onTabChange,
}: {
  activeTab: ResourceTab
  onTabChange: (tab: ResourceTab) => void
}) {
  const state = emptyStates[activeTab]
  const EmptyIcon = activeTab === 'files' ? FileBox : activeTab === 'assets' ? Sparkles : BookOpen

  return (
    <>
      <div className="flex h-14 items-center justify-between border-b border-slate-100 px-4">
        <div>
          <p className="text-sm font-semibold text-slate-800">我的创作空间</p>
          <p className="text-[11px] text-slate-400">文件、素材和课程都在这里</p>
        </div>
        <span className="rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-400">
          整理素材 · 即将开放
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 border-b border-slate-100 p-2" role="tablist" aria-label="资源类型">
        {(
          [
            ['files', '项目文件', FolderOpen],
            ['assets', '创作素材', Library],
            ['courses', '课程资料', BookOpen],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            title={emptyStates[id].title}
            onClick={() => onTabChange(id)}
            className={`flex h-9 items-center justify-center gap-1 rounded-lg text-[11px] font-medium ${
              activeTab === id ? 'bg-blue-50 text-blue-700' : 'text-slate-500 hover:bg-slate-50'
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center">
        <div className="max-w-52">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400">
            <EmptyIcon className="h-7 w-7" aria-hidden="true" />
          </span>
          <p className="mt-4 text-sm font-semibold text-slate-700">{state.title}</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-400">{state.description}</p>
          <span className="mt-3 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-400">
            即将开放
          </span>
        </div>
      </div>
    </>
  )
}

export function StudentResourcePanel() {
  const [activeTab, setActiveTab] = useState<ResourceTab>('files')
  const [isMobileOpen, setIsMobileOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        aria-label="打开项目与素材面板"
        aria-expanded={isMobileOpen}
        onClick={() => setIsMobileOpen(true)}
        className="fixed bottom-5 right-5 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-lg xl:hidden"
      >
        <PanelRightOpen className="h-5 w-5" aria-hidden="true" />
      </button>

      <div className={`fixed inset-0 z-30 xl:hidden ${isMobileOpen ? '' : 'pointer-events-none invisible'}`}>
        <button
          className="absolute inset-0 bg-slate-950/20"
          aria-label="关闭项目与素材面板"
          onClick={() => setIsMobileOpen(false)}
        />
        <aside
          className="absolute inset-y-0 right-0 flex w-80 max-w-[88vw] flex-col bg-white shadow-2xl"
          aria-label="项目与素材"
        >
          <button
            type="button"
            aria-label="关闭项目与素材面板"
            onClick={() => setIsMobileOpen(false)}
            className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
          <ResourcePanelContent activeTab={activeTab} onTabChange={setActiveTab} />
        </aside>
      </div>

      <aside
        aria-label="项目与素材"
        className="hidden h-full w-72 shrink-0 flex-col border-l border-slate-200 bg-white xl:flex 2xl:w-80"
      >
        <ResourcePanelContent activeTab={activeTab} onTabChange={setActiveTab} />
      </aside>
    </>
  )
}
