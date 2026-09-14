import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Share2 } from 'lucide-react'
import { PublishWorkDialog } from '@/components/community/publish-work-dialog'
import { useNavigate } from 'react-router'
import type { Task } from '@ai-xiaobao/shared'

interface TaskActionsProps {
  task: Task
}

export function TaskActions({ task }: TaskActionsProps) {
  const [showPublish, setShowPublish] = useState(false)
  const navigate = useNavigate()

  const hasContent = task.prompt && task.prompt.trim().length > 0

  const initialData = {
    title: task.title || task.prompt?.slice(0, 50) || '',
    description: task.prompt ? `通过 AI 小宝创作的"${task.title || task.prompt.slice(0, 30)}"项目` : '',
    tags: task.mode === 'coding' ? ['网页'] : [],
    fileUrls: task.previewUrl ? [task.previewUrl] : [],
  }

  if (!hasContent && task.status !== 'completed') return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setShowPublish(true)} className="gap-1.5 text-xs">
        <Share2 className="h-3.5 w-3.5" />
        发布到社区
      </Button>

      <PublishWorkDialog
        open={showPublish}
        onOpenChange={setShowPublish}
        onPublished={() => {
          setShowPublish(false)
          navigate('/community')
        }}
        initialData={initialData}
      />
    </>
  )
}
