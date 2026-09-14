import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Plus, X, Loader2, ImageIcon } from 'lucide-react'
import { apiUrl } from '@/lib/api'

interface PublishWorkDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPublished: () => void
  initialData?: {
    title?: string
    description?: string
    previewUrl?: string
    tags?: string[]
    fileUrls?: string[]
  }
}

export function PublishWorkDialog({ open, onOpenChange, onPublished, initialData }: PublishWorkDialogProps) {
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [previewUrl, setPreviewUrl] = useState(initialData?.previewUrl || '')
  const [tags, setTags] = useState<string[]>(initialData?.tags || [])
  const [fileUrls, setFileUrls] = useState<string[]>(initialData?.fileUrls || [])
  const [tagInput, setTagInput] = useState('')
  const [fileUrlInput, setFileUrlInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setTitle(initialData?.title || '')
      setDescription(initialData?.description || '')
      setPreviewUrl(initialData?.previewUrl || '')
      setTags(initialData?.tags || [])
      setFileUrls(initialData?.fileUrls || [])
      setTagInput('')
      setFileUrlInput('')
    }
  }, [open, initialData])

  const handleAddTag = () => {
    const value = tagInput.trim()
    if (value && !tags.includes(value)) {
      setTags([...tags, value])
    }
    setTagInput('')
  }

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleAddFileUrl = () => {
    const value = fileUrlInput.trim()
    if (value && !fileUrls.includes(value)) {
      setFileUrls([...fileUrls, value])
    }
    setFileUrlInput('')
  }

  const handleRemoveFileUrl = (url: string) => {
    setFileUrls(fileUrls.filter((u) => u !== url))
  }

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('请输入作品标题')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(apiUrl('/api/community/works'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          previewUrl: previewUrl.trim() || undefined,
          tags,
          fileUrls,
        }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('作品发布成功！')
        setTitle('')
        setDescription('')
        setPreviewUrl('')
        setTags([])
        setFileUrls([])
        onPublished()
      } else {
        toast.error(data.error || '发布失败')
      }
    } catch {
      toast.error('发布失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>发布作品</DialogTitle>
          <DialogDescription>分享你的创意作品到社区，让更多小伙伴看到！</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium">作品标题 *</label>
            <Input
              placeholder="给你的作品起个名字"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1"
              maxLength={100}
            />
          </div>

          <div>
            <label className="text-sm font-medium">作品描述</label>
            <Textarea
              placeholder="描述一下你的作品..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 min-h-[80px]"
              maxLength={500}
            />
          </div>

          <div>
            <label className="text-sm font-medium">预览图片链接</label>
            <Input
              placeholder="输入预览图片的URL地址"
              value={previewUrl}
              onChange={(e) => setPreviewUrl(e.target.value)}
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">标签</label>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder="输入标签后回车添加"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={handleAddTag} type="button">
                添加
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-[#FFD54F]/10 text-[#FFD54F]"
                  >
                    {tag}
                    <button onClick={() => handleRemoveTag(tag)}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">作品文件链接</label>
            <p className="text-xs text-muted-foreground">可添加在线链接（GitHub、网盘等）</p>
            <div className="flex gap-2 mt-1">
              <Input
                placeholder="输入文件链接"
                value={fileUrlInput}
                onChange={(e) => setFileUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddFileUrl()
                  }
                }}
              />
              <Button variant="outline" size="sm" onClick={handleAddFileUrl} type="button">
                添加
              </Button>
            </div>
            {fileUrls.length > 0 && (
              <div className="space-y-1 mt-2">
                {fileUrls.map((url) => (
                  <div key={url} className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className="truncate flex-1">{url}</span>
                    <button onClick={() => handleRemoveFileUrl(url)}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="bg-gradient-to-r from-[#FFD54F] to-[#FF6E40] text-black hover:opacity-90"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                发布中...
              </>
            ) : (
              '发布作品'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
