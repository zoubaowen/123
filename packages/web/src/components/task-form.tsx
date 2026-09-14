import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Loader2, ArrowUp, Settings, X, Cable, Globe, Code2, ImageIcon, Zap, RefreshCw, FolderUp } from 'lucide-react'
import { CodeBuddy, MiMo, OpenCode, ProviderLogos, type ProviderKey } from '@/components/logos'
import { VoiceInput } from '@ai-xiaobao/chat-core'
import { QuickActions } from '@ai-xiaobao/chat-core'
import type { QuickAction } from '@ai-xiaobao/chat-core'
import { XiaoBao } from '@ai-xiaobao/chat-core'
// import { Claude, Codex, Copilot, Cursor, Gemini } from '@/components/logos'
import { setInstallDependencies, setMaxDuration, setKeepAlive, setEnableBrowser } from '@/lib/utils/cookies'
import { useConnectors } from '@/components/connectors-provider'
import { ConnectorDialog } from '@/components/connectors/manage-connectors'
import type { Connector } from '@/lib/session/types'
import { toast } from 'sonner'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { sessionAtom } from '@/lib/atoms/session'
import { StorageAPI } from '@ai-xiaobao/dashboard/storage'
import { studentCapabilityIdAtom, studentMasterSkillNameAtom, taskPromptAtom } from '@/lib/atoms/task'
import { resolveStudentRuntimeSelection } from '@/features/student-workspace/student-runtime-selection'
import { useXiaobaoEligibility } from '@/features/student-workspace/use-xiaobao-eligibility'
import { lastSelectedModelAtomFamily, githubReposAtomFamily } from '@/lib/atoms/github'
import type { ModelInfo } from '@ai-xiaobao/shared'
import { apiUrl } from '@/lib/api'
import { mergeTaskSkillNames } from './task-form-skills'

interface GitHubRepo {
  name: string
  full_name: string
  description: string
  private: boolean
  clone_url: string
  language: string
}

interface TaskFormProps {
  onSubmit: (data: {
    prompt: string
    repoUrl: string
    selectedAgent: string
    selectedModel: string
    selectedModels?: string[]
    selectedRuntime?: string
    xiaobaoCapability?: string
    mode: 'default' | 'coding'
    installDependencies: boolean
    maxDuration: number
    keepAlive: boolean
    enableBrowser: boolean
    mcpServerList?: Connector[]
    imageBlocks?: Array<{ data: string; mimeType: string }>
    skillList?: string[]
  }) => void
  isSubmitting: boolean
  selectedOwner: string
  selectedRepo: string
  initialInstallDependencies?: boolean
  initialMaxDuration?: number
  initialKeepAlive?: boolean
  initialEnableBrowser?: boolean
  maxSandboxDuration?: number
  variant?: 'default' | 'student-workspace'
}

/** runtime name → agent value 的映射（让 CODING_AGENTS 与后端 runtime name 对齐） */
const SHOW_ADVANCED_DEVELOPER_TOOLS = false

const RUNTIME_TO_AGENT: Record<string, string> = {
  codebuddy: 'codebuddy',
  'opencode-acp': 'opencode',
}

const CODING_AGENTS = [
  { value: 'codebuddy', label: 'CodeBuddy', icon: CodeBuddy, isLogo: true, runtime: 'codebuddy' },
  { value: 'opencode', label: 'OpenCode', icon: OpenCode, isLogo: true, runtime: 'opencode-acp' },
  // --- Other agents (commented out, kept for reference) ---
  // { value: 'claude', label: 'Claude', icon: Claude, isLogo: true, runtime: 'claude' },
  // { value: 'codex', label: 'Codex', icon: Codex, isLogo: true, runtime: 'codex' },
  // { value: 'copilot', label: 'Copilot', icon: Copilot, isLogo: true, runtime: 'copilot' },
  // { value: 'cursor', label: 'Cursor', icon: Cursor, isLogo: true, runtime: 'cursor' },
  // { value: 'gemini', label: 'Gemini', icon: Gemini, isLogo: true, runtime: 'gemini' },
] as const

// Map model name prefix to provider logo key
const MODEL_PROVIDER_MAP: [string[], ProviderKey][] = [
  [['gpt', 'openai'], 'openai'],
  [['claude', 'anthropic'], 'anthropic'],
  [['gemini', 'google'], 'google'],
  [['glm', 'chatglm'], 'zhipu'],
  [['deepseek'], 'deepseek'],
  [['hunyuan'], 'tencent'],
  [['kimi', 'moonshot'], 'kimi'],
  [['qwen', 'tongyi'], 'alibaba'],
  [['doubao', 'bytedance'], 'bytedance'],
  [['ernie', 'wenxin', 'baidu'], 'baidu'],
  [['llama', 'meta'], 'generic'],
  [['minimax'], 'minimax'],
  [['mimo'], 'mimo'],
]

function getModelProviderKey(modelId: string): ProviderKey {
  const lower = modelId.toLowerCase()
  for (const [prefixes, key] of MODEL_PROVIDER_MAP) {
    if (prefixes.some((p) => lower.includes(p))) return key
  }
  return 'generic'
}

export function TaskForm({
  onSubmit,
  isSubmitting,
  selectedOwner,
  selectedRepo,
  initialInstallDependencies = false,
  initialMaxDuration = 300,
  initialKeepAlive = false,
  initialEnableBrowser = false,
  maxSandboxDuration = 300,
  variant = 'default',
}: TaskFormProps) {
  const session = useAtomValue(sessionAtom)
  const userId = session?.user?.id || ''
  const sessionEnvId = session?.envId || ''
  const [prompt, setPrompt] = useAtom(taskPromptAtom)
  const studentMasterSkillName = useAtomValue(studentMasterSkillNameAtom)
  const studentCapabilityId = useAtomValue(studentCapabilityIdAtom)
  // 只有学生创作区才查询服务端放行的能力清单：其他变体不发请求，行为与今天一致。
  const xiaobaoCapabilities = useXiaobaoEligibility(variant === 'student-workspace')
  const [selectedAgent, setSelectedAgent] = useState<string>('codebuddy')
  const [selectedModel, setSelectedModel] = useState<string>('deepseek-v3-2-volc')
  // Default to 'coding' mode — tasks without a git repo are always coding/sandbox tasks
  const [taskMode, setTaskMode] = useState<'default' | 'coding'>('coding')
  const [repos, setRepos] = useAtom(githubReposAtomFamily(selectedOwner))
  const [, setLoadingRepos] = useState(false)
  const [pendingImages, setPendingImages] = useState<
    Array<{ id: string; url: string; data: string; mimeType: string }>
  >([])
  const imageInputRef = useRef<HTMLInputElement>(null)

  // Per-agent model lists and availability, loaded from /api/agent/runtimes
  const [agentModels, setAgentModels] = useState<Record<string, ModelInfo[]>>({
    codebuddy: [{ id: 'deepseek-v3-2-volc', name: 'DeepSeek V3.2（CodeBuddy 当前可用）' }],
  })
  const [unavailableAgents, setUnavailableAgents] = useState<Set<string>>(new Set())
  const [selectedRuntime, setSelectedRuntime] = useState<string>('codebuddy')

  useEffect(() => {
    fetch(apiUrl('/api/agent/runtimes'))
      .then((r) => r.json())
      .then((data: { default: string; runtimes: Array<{ name: string; available: boolean; models: ModelInfo[] }> }) => {
        const newAgentModels: Record<string, ModelInfo[]> = {}
        const unavailable = new Set<string>()

        for (const rt of data.runtimes) {
          if (!rt.available) {
            // mark all agents that use this runtime as unavailable
            for (const agent of CODING_AGENTS) {
              if (agent.runtime === rt.name) unavailable.add(agent.value)
            }
          } else if (rt.models.length > 0) {
            // assign models to every agent that maps to this runtime
            for (const agent of CODING_AGENTS) {
              if (agent.runtime === rt.name) newAgentModels[agent.value] = rt.models
            }
          }
        }

        setAgentModels((prev) => ({ ...prev, ...newAgentModels }))
        setUnavailableAgents(unavailable)

        // Set default agent/runtime from server
        const defaultAgentValue = RUNTIME_TO_AGENT[data.default]
        if (defaultAgentValue) {
          setSelectedAgent(defaultAgentValue)
          setSelectedRuntime(data.default)
          const defaultModels = newAgentModels[defaultAgentValue]
          if (defaultModels && defaultModels.length > 0) {
            setSelectedModel(defaultModels[0].id)
          }
        }
      })
      .catch(() => {
        /* silently ignore */
      })
  }, [])

  // Options state - initialize with server values
  const [installDependencies, setInstallDependenciesState] = useState(initialInstallDependencies)
  const [maxDuration, setMaxDurationState] = useState(initialMaxDuration)
  const [keepAlive, setKeepAliveState] = useState(initialKeepAlive)
  const [enableBrowser, setEnableBrowserState] = useState(initialEnableBrowser)
  const [showMcpServersDialog, setShowMcpServersDialog] = useState(false)

  // Connectors state
  const { connectors, clearConnectors } = useConnectors()

  // Skills state
  const [userSkills, setUserSkills] = useState<Array<{ name: string; description: string }>>([])
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set())
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [showSkillsPopover, setShowSkillsPopover] = useState(false)
  const skillsFetchedRef = useRef(false)

  const fetchUserSkills = useCallback(async (force = false) => {
    if (!force && skillsFetchedRef.current) return
    setLoadingSkills(true)
    try {
      const params = new URLSearchParams({ prefix: `${userId}/skills/`, bucketType: 'storage' })
      const res = await fetch(`/api/storage/files?${params}`, { credentials: 'include' })
      if (res.ok) {
        const files: Array<{ name: string; isDir: boolean }> = await res.json()
        const skills = files.filter((f) => f.isDir).map((f) => ({ name: f.name, description: '' }))
        setUserSkills(skills)
        skillsFetchedRef.current = true
      }
    } catch {
      // ignore
    } finally {
      setLoadingSkills(false)
    }
  }, [])

  const refreshSkills = useCallback(() => {
    fetchUserSkills(true)
  }, [fetchUserSkills])

  // Upload skill folder state
  const [uploadingSkill, setUploadingSkill] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const skillFolderInputRef = useRef<HTMLInputElement>(null)

  const handleUploadSkillFolder = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.target
      const inputFiles = input.files ? [...input.files] : []
      if (!inputFiles.length) return

      const firstRelPath = inputFiles[0].webkitRelativePath || inputFiles[0].name
      const skillName = firstRelPath.split('/')[0]
      if (!skillName) {
        toast.error('无法识别文件夹名称')
        input.value = ''
        return
      }

      const hasSkillMd = inputFiles.some((f) => {
        const rel = f.webkitRelativePath || f.name
        const parts = rel.split('/')
        return parts.length === 2 && parts[1] === 'SKILL.md'
      })
      if (!hasSkillMd) {
        toast.error(`文件夹 "${skillName}" 中缺少 SKILL.md 文件`)
        input.value = ''
        return
      }

      setUploadingSkill(true)
      setUploadProgress({ current: 0, total: inputFiles.length })

      try {
        const filesToUpload = inputFiles.filter((f) => {
          const rel = f.webkitRelativePath || f.name
          const parts = rel.split('/')
          return !parts.some((p) => p.startsWith('.') && p !== '.' && p !== '..')
        })

        setUploadProgress({ current: 0, total: filesToUpload.length })

        // 使用 dashboard StorageAPI 上传
        const storageAPI = new StorageAPI({ envId: sessionEnvId })
        const buckets = await storageAPI.getBuckets()
        const storageBucket = buckets.find((b) => b.type === 'storage')
        if (!storageBucket) {
          toast.error('未找到云存储桶')
          return
        }

        const { errors } = await storageAPI.uploadFiles({
          files: filesToUpload,
          bucket: storageBucket,
          prefix: `${userId}/skills/`,
          onProgress: (completed, total) => {
            setUploadProgress({ current: completed, total })
          },
        })

        if (errors.length > 0) {
          toast.error(`${errors.length} 个文件上传失败`)
        } else {
          toast.success(`Skill "${skillName}" 上传成功`)
        }
        refreshSkills()
      } catch {
        toast.error('上传失败')
      } finally {
        setUploadingSkill(false)
        setUploadProgress(null)
        input.value = ''
      }
    },
    [refreshSkills, sessionEnvId],
  )

  // Ref for the textarea to focus it programmatically
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Wrapper functions to update both state and cookies
  const updateInstallDependencies = (value: boolean) => {
    setInstallDependenciesState(value)
    setInstallDependencies(value)
  }

  const updateMaxDuration = (value: number) => {
    setMaxDurationState(value)
    setMaxDuration(value)
  }

  const updateKeepAlive = (value: boolean) => {
    setKeepAliveState(value)
    setKeepAlive(value)
  }

  const updateEnableBrowser = (value: boolean) => {
    setEnableBrowserState(value)
    setEnableBrowser(value)
  }

  // Handle keyboard events in textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      // On desktop: Enter submits, Shift+Enter creates new line
      // On mobile: Enter creates new line, must use submit button
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
      if (!isMobile && !e.shiftKey) {
        e.preventDefault()
        if (prompt.trim()) {
          // Find the form and submit it
          const form = e.currentTarget.closest('form')
          if (form) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
          }
        }
      }
      // For all other cases (mobile Enter, desktop Shift+Enter), let default behavior create new line
    }
  }

  // Focus the prompt input when the component mounts
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  // When agent changes: switch runtime + reset model if current selection not in new list
  const handleAgentChange = (agentValue: string) => {
    setSelectedAgent(agentValue)
    const agentDef = CODING_AGENTS.find((a) => a.value === agentValue)
    if (agentDef) setSelectedRuntime(agentDef.runtime)
    // TODO: OpenCode 运行时暂不支持 skill 管理，切换时清空已选 skills，等待 OpenCode 的升级
    if (agentValue === 'opencode') {
      setSelectedSkills(new Set())
    }
    const models = agentModels[agentValue] ?? []
    if (models.length === 0) return
    if (!models.some((m) => m.id === selectedModel)) {
      setSelectedModel(models[0].id)
    }
  }

  // Validate selectedModel whenever agent or its models change.
  // Catches races where agentModels arrives after selectedAgent update.
  useEffect(() => {
    const models = agentModels[selectedAgent] ?? []
    if (models.length === 0) return
    if (!models.some((m) => m.id === selectedModel)) {
      setSelectedModel(models[0].id)
    }
  }, [selectedAgent, agentModels, selectedModel])

  // Get saved model atom for current agent (persists selection across page loads)
  const savedModelAtom = lastSelectedModelAtomFamily(selectedAgent)
  const setSavedModel = useSetAtom(savedModelAtom)

  // Fetch repositories when owner changes
  useEffect(() => {
    if (!selectedOwner) {
      setRepos(null)
      return
    }

    const fetchRepos = async () => {
      setLoadingRepos(true)
      try {
        // Check cache first (repos is from the atom)
        if (repos && repos.length > 0) {
          setLoadingRepos(false)
          return
        }

        const response = await fetch(`/api/github/repos?owner=${selectedOwner}`)
        if (response.ok) {
          const reposList = await response.json()
          setRepos(reposList)
        }
      } catch (error) {
        console.error('Error fetching repositories:', error)
      } finally {
        setLoadingRepos(false)
      }
    }

    fetchRepos()
  }, [selectedOwner, repos, setRepos])

  const processImageFile = (file: File) => {
    if (!file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const base64 = dataUrl.split(',')[1]
      const url = URL.createObjectURL(file)
      setPendingImages((prev) => [
        ...prev,
        { id: `img-${Date.now()}-${Math.random()}`, url, data: base64, mimeType: file.type },
      ])
    }
    reader.readAsDataURL(file)
  }

  const handlePasteImage = (e: React.ClipboardEvent) => {
    Array.from(e.clipboardData.items).forEach((item) => {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) processImageFile(file)
      }
    })
  }

  const handleImageFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files ?? []).forEach(processImageFile)
    e.target.value = ''
  }

  const removeImage = (id: string) => {
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id)
      if (img) URL.revokeObjectURL(img.url)
      return prev.filter((i) => i.id !== id)
    })
  }

  const handleQuickAction = useCallback(
    (action: QuickAction) => {
      setPrompt(action.prompt)
      // Focus the textarea after state update
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
      })
    },
    [setPrompt],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    console.log('[TaskForm] handleSubmit called, prompt:', prompt?.slice(0, 20), 'isSubmitting:', isSubmitting)
    if (!prompt.trim()) {
      console.log('[TaskForm] empty prompt, returning')
      return
    }

    // 学生六入口：只有"入口已映射 + 该能力已被服务端放行"时才覆盖 Runtime；
    // 其余情况结果为空，请求字段与今天完全一致（fail-closed）。
    const xiaobaoSelection = resolveStudentRuntimeSelection({
      capabilityId: studentCapabilityId,
      xiaobaoCapabilities,
    })

    // Clear connectors from localStorage and memory on new task creation
    clearConnectors()

    // If owner/repo not selected, let parent handle it (will show sign-in if needed)
    // Don't clear localStorage here - user might need to sign in and come back
    if (!selectedOwner || !selectedRepo) {
      console.log('[TaskForm] no repo selected, calling onSubmit directly')
      const connectedMcps = connectors
        .filter((c) => c.status === 'connected')
        .map((c) => ({
          name: c.name,
          description: c.description,
          type: c.type,
          baseUrl: c.baseUrl,
          command: c.command,
          args: c.args,
          headers: c.headers,
        }))
      onSubmit({
        prompt: prompt.trim(),
        repoUrl: '',
        selectedAgent,
        selectedModel,
        selectedRuntime: xiaobaoSelection.selectedRuntime ?? (selectedRuntime || undefined),
        xiaobaoCapability: xiaobaoSelection.xiaobaoCapability,
        mode: taskMode,
        installDependencies,
        maxDuration,
        keepAlive,
        enableBrowser,
        mcpServerList: connectedMcps.length > 0 ? (connectedMcps as any) : undefined,
        imageBlocks:
          pendingImages.length > 0 ? pendingImages.map(({ data, mimeType }) => ({ data, mimeType })) : undefined,
        skillList: mergeTaskSkillNames(selectedSkills, variant === 'student-workspace' ? studentMasterSkillName : null),
      })
      setPendingImages([])
      return
    }

    // Check if API key is required and available for the selected agent and model
    // Skip this check if we don't have repo data (likely not signed in)
    const selectedRepoData = repos?.find((repo) => repo.name === selectedRepo)

    if (selectedRepoData) {
      try {
        console.log('[TaskForm] checking API key for agent:', selectedAgent, 'model:', selectedModel)
        const response = await fetch(`/api/api-keys/check?agent=${selectedAgent}&model=${selectedModel}`)
        const data = await response.json()
        console.log('[TaskForm] API key check result:', data)

        if (!data.hasKey) {
          // Show error message with provider name
          const providerNames: Record<string, string> = {
            anthropic: 'Anthropic',
            openai: 'OpenAI',
            cursor: 'Cursor',
            gemini: 'Gemini',
            aigateway: 'AI Gateway',
          }
          const providerName = providerNames[data.provider] || data.provider

          toast.error(`${providerName} API key required`, {
            description: `Please add your ${providerName} API key in the user menu to use the ${data.agentName} agent with this model.`,
          })
          return
        }
      } catch (error) {
        console.error('Error checking API key:', error)
        // Don't show error toast - might just be not authenticated, let parent handle it
      }
    }

    console.log('[TaskForm] repo selected, calling onSubmit with repoUrl:', selectedRepoData?.clone_url)
    const connectedMcps = connectors
      .filter((c) => c.status === 'connected')
      .map((c) => ({
        name: c.name,
        description: c.description,
        type: c.type,
        baseUrl: c.baseUrl,
        command: c.command,
        args: c.args,
        headers: c.headers,
      }))
    onSubmit({
      prompt: prompt.trim(),
      repoUrl: selectedRepoData?.clone_url || '',
      selectedAgent,
      selectedModel,
      selectedRuntime: selectedRuntime || undefined,
      mode: taskMode,
      installDependencies,
      maxDuration,
      keepAlive,
      enableBrowser,
      mcpServerList: connectedMcps.length > 0 ? (connectedMcps as any) : undefined,
      imageBlocks:
        pendingImages.length > 0 ? pendingImages.map(({ data, mimeType }) => ({ data, mimeType })) : undefined,
      skillList: mergeTaskSkillNames(selectedSkills, variant === 'student-workspace' ? studentMasterSkillName : null),
    })
    setPendingImages([])
  }

  return (
    <div className={variant === 'student-workspace' ? 'w-full' : 'w-full max-w-2xl'}>
      {variant === 'default' && (
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <XiaoBao outfit="coding" mood="excited" action="celebrate" size={132} />
          </div>
          <h1 className="text-4xl font-bold mb-3 text-foreground">嗨，同学！一起创作吧！</h1>
          <p className="text-lg text-muted-foreground mb-2">告诉小宝你的想法，我们一起把它变成有趣的作品。</p>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className={`relative overflow-hidden border cursor-text ${
            variant === 'student-workspace'
              ? 'rounded-2xl border-slate-200 bg-background shadow-[0_12px_36px_rgba(30,64,175,0.10)]'
              : 'rounded-2xl bg-muted/30 shadow-sm'
          }`}
        >
          {/* Quick action buttons */}
          <div className="px-4 pt-3">
            <QuickActions onAction={handleQuickAction} disabled={isSubmitting} />
          </div>
          {/* Pending images preview */}
          {pendingImages.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {pendingImages.map((img) => (
                <div key={img.id} className="relative group">
                  <img src={img.url} alt="" className="h-16 w-16 rounded-lg object-cover border border-border" />
                  <button
                    type="button"
                    onClick={() => removeImage(img.id)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-background border border-border rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* Prompt Input */}
          <div className="relative bg-transparent">
            <Textarea
              ref={textareaRef}
              id="prompt"
              placeholder="和小宝说说你想做什么，比如：帮我做一个弹跳球小游戏、写一篇周记、画一张太空海报... (Ctrl+V 可粘贴图片)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              onPaste={handlePasteImage}
              disabled={isSubmitting}
              required
              rows={4}
              className="w-full border-0 resize-none focus-visible:ring-0 focus-visible:ring-offset-0 p-4 text-base !bg-transparent shadow-none!"
            />
          </div>
          {/* Hidden file input */}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            className="hidden"
            onChange={handleImageFiles}
          />

          {/* Mode + Agent/Model selector */}
          <div className="p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {/* Mode toggle */}
                <button
                  type="button"
                  onClick={() => setTaskMode(taskMode === 'default' ? 'coding' : 'default')}
                  className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full border transition-colors ${
                    taskMode === 'coding'
                      ? 'bg-primary/10 text-primary border-primary/30'
                      : 'text-muted-foreground border-border hover:border-primary/30'
                  }`}
                >
                  <Code2 className="h-3 w-3" />
                  {taskMode === 'coding' ? 'Coding' : 'Default'}
                </button>
                <span className="text-muted-foreground/50">·</span>
                <div className="flex items-center gap-2 text-sm text-muted-foreground px-2 h-8">
                  {/* Agent selector */}
                  <Select value={selectedAgent} onValueChange={handleAgentChange}>
                    <SelectTrigger className="h-7 border-0 shadow-none px-1 py-0 text-sm text-muted-foreground hover:text-foreground bg-transparent focus:ring-0 gap-1 w-auto min-w-[90px]">
                      {(() => {
                        const agent = CODING_AGENTS.find((a) => a.value === selectedAgent)
                        return agent ? (
                          <>
                            <agent.icon className="w-4 h-4" />
                            <span className="truncate">{agent.label}</span>
                          </>
                        ) : null
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      {CODING_AGENTS.map((agent) => {
                        const disabled = unavailableAgents.has(agent.value)
                        return (
                          <SelectItem key={agent.value} value={agent.value} disabled={disabled}>
                            <span className={`flex items-center gap-2 ${disabled ? 'opacity-40' : ''}`}>
                              <agent.icon className="w-4 h-4" />
                              <span>{agent.label}</span>
                              {disabled && <span className="text-xs">（不可用）</span>}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground/50">·</span>
                  {/* Model selector — options change per agent */}
                  <Select
                    value={selectedModel}
                    onValueChange={(v) => {
                      setSelectedModel(v)
                      setSavedModel(v)
                    }}
                  >
                    <SelectTrigger className="h-7 border-0 shadow-none px-1 py-0 text-sm text-muted-foreground hover:text-foreground bg-transparent focus:ring-0 gap-1 w-auto min-w-[120px]">
                      {(() => {
                        const models = agentModels[selectedAgent] ?? []
                        const current = models.find((m) => m.id === selectedModel)
                        const ProviderIcon = ProviderLogos[getModelProviderKey(selectedModel)]
                        return (
                          <>
                            <ProviderIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                            <span className="truncate">{current?.name || selectedModel}</span>
                          </>
                        )
                      })()}
                    </SelectTrigger>
                    <SelectContent>
                      {(agentModels[selectedAgent] ?? []).map((m) => {
                        const ProviderIcon = ProviderLogos[getModelProviderKey(m.id)]
                        return (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-2">
                              <ProviderIcon className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              <span>{m.name}</span>
                            </span>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Option Chips - Only visible on desktop */}
                {/* {(!installDependencies || maxDuration !== maxSandboxDuration || keepAlive) && (
                  <div className="hidden sm:flex items-center gap-2 flex-wrap">
                    {!installDependencies && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        Skip Install
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateInstallDependencies(true)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                    {maxDuration !== maxSandboxDuration && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        {maxDuration}m
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateMaxDuration(maxSandboxDuration)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                    {keepAlive && (
                      <Badge variant="secondary" className="text-xs h-6 px-2 gap-1 bg-transparent border-0">
                        Keep Alive
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-3 w-3 p-0 hover:bg-transparent"
                          onClick={(e) => {
                            e.stopPropagation()
                            updateKeepAlive(false)
                          }}
                        >
                          <X className="h-2 w-2" />
                        </Button>
                      </Badge>
                    )}
                  </div>
                )} */}
              </div>

              {/* Right side: Action Icons and Submit Button */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Buttons */}
                <div className="flex items-center gap-2">
                  <TooltipProvider delayDuration={1500} skipDelayDuration={1500}>
                    {/* <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="rounded-full h-8 w-8 p-0 relative"
                          onClick={() => updateEnableBrowser(!enableBrowser)}
                        >
                          <Globe className="h-4 w-4" />
                          {enableBrowser && (
                            <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-green-500" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Agent Browser</p>
                      </TooltipContent>
                    </Tooltip> */}

                    {SHOW_ADVANCED_DEVELOPER_TOOLS && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-full h-8 w-8 p-0 relative"
                            onClick={() => setShowMcpServersDialog(true)}
                          >
                            <Cable className="h-4 w-4" />
                            {connectors.filter((c) => c.status === 'connected').length > 0 && (
                              <Badge
                                variant="secondary"
                                className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
                              >
                                {connectors.filter((c) => c.status === 'connected').length}
                              </Badge>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>MCP</p>
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* TODO: OpenCode 运行时暂不支持 skill 管理，等待 OpenCode 的升级 */}
                    {SHOW_ADVANCED_DEVELOPER_TOOLS && selectedAgent !== 'opencode' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="rounded-full h-8 w-8 p-0 relative"
                            onClick={() => {
                              setShowSkillsPopover(true)
                              fetchUserSkills()
                            }}
                          >
                            <Zap className="h-4 w-4" />
                            {selectedSkills.size > 0 && (
                              <Badge
                                variant="secondary"
                                className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] rounded-full"
                              >
                                {selectedSkills.size}
                              </Badge>
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Skills</p>
                        </TooltipContent>
                      </Tooltip>
                    )}

                    {/* Task Options — 暂不支持，已隐藏
                    <DropdownMenu>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="rounded-full h-8 w-8 p-0 relative"
                            >
                              <Settings className="h-4 w-4" />
                              {(() => {
                                const customOptionsCount = [
                                  !installDependencies,
                                  maxDuration !== maxSandboxDuration,
                                  keepAlive,
                                ].filter(Boolean).length
                                return customOptionsCount > 0 ? (
                                  <Badge
                                    variant="secondary"
                                    className="absolute -top-1 -right-1 h-4 min-w-4 p-0 flex items-center justify-center text-[10px] rounded-full sm:hidden"
                                  >
                                    {customOptionsCount}
                                  </Badge>
                                ) : null
                              })()}
                            </Button>
                          </DropdownMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Task Options</p>
                        </TooltipContent>
                      </Tooltip>
                      <DropdownMenuContent className="w-72" align="end">
                        <DropdownMenuLabel>Task Options</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <div className="p-2 space-y-4">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="install-deps"
                              checked={installDependencies}
                              onCheckedChange={(checked) => updateInstallDependencies(checked === true)}
                            />
                            <Label
                              htmlFor="install-deps"
                              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                            >
                              Install Dependencies?
                            </Label>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="max-duration" className="text-sm font-medium">
                              Maximum Duration
                            </Label>
                            <Select
                              value={maxDuration.toString()}
                              onValueChange={(value) => updateMaxDuration(parseInt(value))}
                            >
                              <SelectTrigger id="max-duration" className="w-full h-8">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="5">5 minutes</SelectItem>
                                <SelectItem value="10">10 minutes</SelectItem>
                                <SelectItem value="15">15 minutes</SelectItem>
                                <SelectItem value="30">30 minutes</SelectItem>
                                <SelectItem value="45">45 minutes</SelectItem>
                                <SelectItem value="60">1 hour</SelectItem>
                                <SelectItem value="120">2 hours</SelectItem>
                                <SelectItem value="180">3 hours</SelectItem>
                                <SelectItem value="240">4 hours</SelectItem>
                                <SelectItem value="300">5 hours</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <Checkbox
                                id="keep-alive"
                                checked={keepAlive}
                                onCheckedChange={(checked) => updateKeepAlive(checked === true)}
                              />
                              <Label
                                htmlFor="keep-alive"
                                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                              >
                                Keep Alive ({maxSandboxDuration}m max)
                              </Label>
                            </div>
                            <p className="text-xs text-muted-foreground pl-6">Keep sandbox running after completion.</p>
                          </div>
                        </div>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    */}
                  </TooltipProvider>

                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center justify-center h-8 w-8 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                    title="添加图片"
                  >
                    <ImageIcon className="h-4 w-4" />
                  </button>

                  <VoiceInput
                    onTranscript={(text) => setPrompt((prev) => (prev ? prev + ' ' + text : text))}
                    disabled={isSubmitting}
                    className="!h-8 !w-8"
                  />

                  <Button
                    type="submit"
                    disabled={isSubmitting || (!prompt.trim() && pendingImages.length === 0)}
                    size="sm"
                    className="rounded-full h-8 w-8 p-0"
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </form>

      {SHOW_ADVANCED_DEVELOPER_TOOLS && (
        <ConnectorDialog open={showMcpServersDialog} onOpenChange={setShowMcpServersDialog} />
      )}

      {SHOW_ADVANCED_DEVELOPER_TOOLS && (
        <Dialog open={showSkillsPopover} onOpenChange={setShowSkillsPopover}>
          <DialogContent className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <DialogTitle>Skills Manager</DialogTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={refreshSkills}
                  disabled={loadingSkills}
                  title="刷新 Skills"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </DialogHeader>

            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="space-y-1 overflow-y-auto flex-1">
                {loadingSkills ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : userSkills.length === 0 ? (
                  <div className="p-6 text-center">
                    <p className="text-sm text-muted-foreground">暂无可用 Skills</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="rounded border-border"
                          checked={selectedSkills.size === userSkills.length && userSkills.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSkills(new Set(userSkills.map((s) => s.name)))
                            } else {
                              setSelectedSkills(new Set())
                            }
                          }}
                        />
                        全选
                      </label>
                      <span className="text-xs text-muted-foreground ml-auto">
                        已选 {selectedSkills.size}/{userSkills.length}
                      </span>
                    </div>
                    {userSkills.map((skill) => (
                      <label
                        key={skill.name}
                        className="flex items-center gap-2 px-3 py-3 border-b border-border last:border-b-0 rounded transition-colors hover:bg-accent/50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          className="rounded border-border shrink-0"
                          checked={selectedSkills.has(skill.name)}
                          onChange={(e) => {
                            const next = new Set(selectedSkills)
                            if (e.target.checked) {
                              next.add(skill.name)
                            } else {
                              next.delete(skill.name)
                            }
                            setSelectedSkills(next)
                          }}
                        />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-semibold text-sm">{skill.name}</span>
                          {skill.description && (
                            <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                          )}
                        </div>
                      </label>
                    ))}
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-border">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => skillFolderInputRef.current?.click()}
                  disabled={uploadingSkill}
                  title="上传 Skill 文件夹到云存储"
                >
                  {uploadingSkill ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="ml-1.5">
                        {uploadProgress ? `${uploadProgress.current}/${uploadProgress.total}` : '上传中...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <FolderUp className="h-3.5 w-3.5" />
                      <span className="ml-1.5">上传 Skill</span>
                    </>
                  )}
                </Button>
                <input
                  ref={skillFolderInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleUploadSkillFolder}
                  // @ts-expect-error webkitdirectory is a non-standard attribute
                  webkitdirectory=""
                  directory=""
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
