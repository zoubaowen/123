import type { ToolRenderer, ToolRenderContext } from './index'
import { FileCode } from 'lucide-react'

function detectPythonCode(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    if (
      trimmed.startsWith('python ') ||
      trimmed.startsWith('python3 ') ||
      trimmed.startsWith('py ') ||
      trimmed.startsWith('pip ')
    ) {
      return trimmed
    }
    if (trimmed.startsWith('#!/usr/bin/env python') || trimmed.startsWith('#!python')) {
      return trimmed
    }
  }
  if (typeof input === 'object' && input !== null) {
    const obj = input as Record<string, unknown>
    if (typeof obj.code === 'string') return obj.code
    if (typeof obj.command === 'string') {
      const cmd = obj.command as string
      if (cmd.includes('python') || cmd.includes('.py')) return cmd
    }
    if (typeof obj.script === 'string') return obj.script
    if (typeof obj.file_path === 'string' && (obj.file_path as string).endsWith('.py')) return obj.file_path as string
  }
  return null
}

export const pythonRenderer: ToolRenderer = {
  Icon({ className }) {
    return <FileCode className={className} />
  },
  getSummary(ctx: ToolRenderContext) {
    const code = detectPythonCode(ctx.input)
    if (code) {
      const truncated = code.length > 60 ? code.slice(0, 60) + '...' : code
      return `Python: ${truncated}`
    }
    if (typeof ctx.input === 'object' && ctx.input !== null) {
      const obj = ctx.input as Record<string, unknown>
      if (typeof obj.file_path === 'string' && (obj.file_path as string).endsWith('.py')) {
        return `Python: ${obj.file_path}`
      }
      if (typeof obj.package === 'string') {
        return `pip install ${obj.package}`
      }
    }
    return undefined
  },
  renderInput(ctx: ToolRenderContext) {
    const code = detectPythonCode(ctx.input)
    if (!code) {
      return (
        <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground">
          {JSON.stringify(ctx.input, null, 2)}
        </pre>
      )
    }
    return (
      <div className="rounded-md border border-border overflow-hidden">
        <div className="bg-muted/50 px-3 py-1.5 border-b border-border text-xs font-medium text-muted-foreground">
          Python
        </div>
        <pre className="p-3 text-xs overflow-x-auto font-mono">
          <code>{code}</code>
        </pre>
      </div>
    )
  },
  renderOutput(ctx: ToolRenderContext) {
    if (!ctx.result && ctx.isPending) return null
    const result = ctx.result ?? ''
    const isError = ctx.isError || result.toLowerCase().includes('traceback') || result.toLowerCase().includes('error')
    return (
      <pre
        className={`text-xs whitespace-pre-wrap break-words font-mono p-2 rounded ${
          isError ? 'bg-destructive/10 text-destructive' : 'bg-muted/30 text-muted-foreground'
        }`}
      >
        {result}
      </pre>
    )
  },
}
