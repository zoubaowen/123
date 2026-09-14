import { useState, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { sessionAtom } from '@/lib/atoms/session'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  Heart,
  Eye,
  Plus,
  Trash2,
  Search,
  X,
  Loader2,
  RefreshCw,
  ExternalLink,
  Tag,
  Calendar,
  User,
  MessageCircle,
  FileCode,
  ImageIcon,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { PublishWorkDialog } from '@/components/community/publish-work-dialog'
import { XiaoBao } from '@ai-xiaobao/chat-core'

interface CommunityWork {
  id: string
  userId: string
  userName: string
  title: string
  description: string
  previewUrl: string | null
  tags: string
  fileUrls: string
  likeCount: number
  likedBy: string
  createdAt: number
  updatedAt: number
}

function parseTags(raw: string): string[] {
  try {
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
}

function parseFileUrls(raw: string): string[] {
  try {
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
}

function parseLikedBy(raw: string): string[] {
  try {
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  if (days < 30) return `${Math.floor(days / 7)}周前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function CommunityCard({
  work,
  onLike,
  onDelete,
  onClick,
  currentUserId,
}: {
  work: CommunityWork
  onLike: (id: string) => void
  onDelete: (id: string) => void
  onClick: (work: CommunityWork) => void
  currentUserId: string | undefined
}) {
  const tags = parseTags(work.tags)
  const fileUrls = parseFileUrls(work.fileUrls)
  const likedBy = parseLikedBy(work.likedBy)
  const isLiked = currentUserId ? likedBy.includes(currentUserId) : false
  const isOwner = currentUserId === work.userId

  return (
    <Card
      className="overflow-hidden border-border hover:border-[#FFD54F]/40 transition-all group cursor-pointer"
      onClick={() => onClick(work)}
    >
      <div className="aspect-video bg-muted relative overflow-hidden">
        {work.previewUrl ? (
          <img
            src={work.previewUrl}
            alt={work.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-400/10 to-orange-500/10">
            <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
        {isOwner && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(work.id)
            }}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
            title="删除作品"
          >
            <Trash2 className="h-3.5 w-3.5 text-white" />
          </button>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-sm truncate">{work.title}</h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{work.description}</p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {tags.slice(0, 3).map((tag) => (
              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#FFD54F]/10 text-[#FFD54F]">
                {tag}
              </span>
            ))}
            {tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{tags.length - 3}</span>}
          </div>
        )}
        <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
          <span className="truncate max-w-[100px]">{work.userName}</span>
          <div className="flex items-center gap-3">
            {fileUrls.length > 0 && (
              <span className="flex items-center gap-0.5">
                <FileCode className="h-3 w-3" />
                {fileUrls.length}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onLike(work.id)
              }}
              className={`flex items-center gap-0.5 transition-colors ${isLiked ? 'text-red-500' : 'hover:text-red-400'}`}
            >
              <Heart className={`h-3.5 w-3.5 ${isLiked ? 'fill-current' : ''}`} />
              {work.likeCount}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function WorkDetailDialog({
  work,
  open,
  onOpenChange,
  onLike,
  currentUserId,
}: {
  work: CommunityWork | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onLike: (id: string) => void
  currentUserId: string | undefined
}) {
  if (!work) return null

  const tags = parseTags(work.tags)
  const fileUrls = parseFileUrls(work.fileUrls)
  const likedBy = parseLikedBy(work.likedBy)
  const isLiked = currentUserId ? likedBy.includes(currentUserId) : false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="text-lg">{work.title}</DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {work.userName}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formatDate(work.createdAt)}
            </span>
            <span className="flex items-center gap-1">
              <Heart className="h-3 w-3" />
              {work.likeCount} 赞
            </span>
          </DialogDescription>
        </DialogHeader>

        {work.previewUrl && (
          <div className="rounded-lg overflow-hidden border border-border">
            <img src={work.previewUrl} alt={work.title} className="w-full object-contain max-h-80 bg-muted/30" />
          </div>
        )}

        <div className="space-y-4">
          {work.description && (
            <div>
              <h4 className="text-sm font-medium mb-1">作品描述</h4>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{work.description}</p>
            </div>
          )}

          {tags.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">标签</h4>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-1 rounded-full bg-[#FFD54F]/10 text-[#FFD54F]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {fileUrls.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">作品文件</h4>
              <div className="space-y-1">
                {fileUrls.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-primary hover:underline truncate"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{url}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onLike(work.id)}
              className={isLiked ? 'text-red-500 border-red-500/30' : ''}
            >
              <Heart className={`h-4 w-4 mr-1 ${isLiked ? 'fill-current' : ''}`} />
              {isLiked ? '已赞' : '点赞'} ({work.likeCount})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CommunitySkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="overflow-hidden border-border">
          <div className="aspect-video bg-muted animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
            <div className="h-3 bg-muted rounded animate-pulse w-full" />
            <div className="h-3 bg-muted rounded animate-pulse w-1/2" />
          </div>
        </Card>
      ))}
    </div>
  )
}

const ALL_TAGS = ['小游戏', '动画', '音乐', '画画', '互动故事', '3D', 'Python', '网页']

export function CommunityPage() {
  const session = useAtomValue(sessionAtom)
  const [works, setWorks] = useState<CommunityWork[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [showPublish, setShowPublish] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [sort, setSort] = useState<'newest' | 'likes'>('newest')
  const [selectedWork, setSelectedWork] = useState<CommunityWork | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const pageSize = 20

  const fetchWorks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort })
      if (activeTag) params.set('tag', activeTag)
      const res = await fetch(`/api/community/works?${params}`)
      const data = await res.json()
      if (data.success) {
        setWorks(data.works)
        setTotal(data.total)
      }
    } catch {
      toast.error('加载社区作品失败')
    } finally {
      setLoading(false)
    }
  }, [page, activeTag, sort])

  useEffect(() => {
    fetchWorks()
  }, [fetchWorks])

  const handleLike = async (id: string) => {
    if (!session?.user) {
      toast.error('请先登录')
      return
    }
    try {
      const res = await fetch(`/api/community/works/${id}/like`, { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        const update = {
          likeCount: data.likeCount,
          likedBy: data.likedBy,
        }
        setWorks((prev) => prev.map((w) => (w.id === id ? { ...w, ...update } : w)))
        if (selectedWork?.id === id) {
          setSelectedWork((prev) => (prev ? { ...prev, ...update } : null))
        }
      }
    } catch {
      toast.error('操作失败')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个作品吗？')) return
    try {
      const res = await fetch(`/api/community/works/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.success) {
        setWorks((prev) => prev.filter((w) => w.id !== id))
        if (selectedWork?.id === id) setShowDetail(false)
        toast.success('作品已删除')
      }
    } catch {
      toast.error('删除失败')
    }
  }

  const handlePublished = () => {
    setShowPublish(false)
    setPage(1)
    fetchWorks()
  }

  const handleTagClick = (tag: string) => {
    setActiveTag(activeTag === tag ? '' : tag)
    setPage(1)
  }

  const filtered = search
    ? works.filter(
        (w) =>
          w.title.toLowerCase().includes(search.toLowerCase()) ||
          w.description.toLowerCase().includes(search.toLowerCase()),
      )
    : works

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">作品社区</h1>
            <p className="text-sm text-muted-foreground mt-1">浏览小伙伴们分享的创意作品，也可以上传你自己的作品哦~</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索作品..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 w-44"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={fetchWorks} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              onClick={() => {
                if (!session?.user) {
                  toast.error('请先登录')
                  return
                }
                setShowPublish(true)
              }}
              className="bg-gradient-to-r from-[#FFD54F] to-[#FF6E40] text-black hover:opacity-90"
              size="sm"
            >
              <Plus className="h-4 w-4 mr-1" />
              发布作品
            </Button>
          </div>
        </div>

        {/* Tag filters + Sort */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex flex-wrap gap-1.5">
            {ALL_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => handleTagClick(tag)}
                className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                  activeTag === tag
                    ? 'bg-[#FFD54F]/20 text-[#FFC107] border border-[#FFD54F]/40'
                    : 'bg-muted/50 text-muted-foreground border border-transparent hover:border-[#FFD54F]/30'
                }`}
              >
                <Tag className="h-3 w-3 inline mr-0.5" />
                {tag}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 text-xs">
            <button
              onClick={() => {
                setSort('newest')
                setPage(1)
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${sort === 'newest' ? 'text-[#FFC107] bg-[#FFD54F]/10' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Clock className="h-3 w-3" />
              最新
            </button>
            <button
              onClick={() => {
                setSort('likes')
                setPage(1)
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded transition-colors ${sort === 'likes' ? 'text-[#FFC107] bg-[#FFD54F]/10' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <TrendingUp className="h-3 w-3" />
              最热
            </button>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <CommunitySkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <XiaoBao mood="thinking" size={80} />
            <p className="text-lg mt-4">还没有作品</p>
            <p className="text-sm mt-1">快来成为第一个分享作品的小伙伴吧！</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((work) => (
                <CommunityCard
                  key={work.id}
                  work={work}
                  onLike={handleLike}
                  onDelete={handleDelete}
                  onClick={(w) => {
                    setSelectedWork(w)
                    setShowDetail(true)
                  }}
                  currentUserId={session?.user?.id}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  上一页
                </Button>
                <span className="text-sm text-muted-foreground">
                  {page} / {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  下一页
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <PublishWorkDialog open={showPublish} onOpenChange={setShowPublish} onPublished={handlePublished} />

      <WorkDetailDialog
        work={selectedWork}
        open={showDetail}
        onOpenChange={setShowDetail}
        onLike={handleLike}
        currentUserId={session?.user?.id}
      />
    </div>
  )
}
