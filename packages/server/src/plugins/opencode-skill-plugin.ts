/**
 * OpenCode Sandbox Skill Loader Plugin
 *
 * 扫描远端 SCF 沙箱内的 skill 目录，将 SKILL.md 加载为 opencode 的 embedded skill。
 *
 * 环境变量（由 opencode-acp-runtime.ts 在 spawn 时注入）：
 *   SANDBOX_BASE_URL            — 沙箱 HTTP 端点
 *   SANDBOX_AUTH_HEADERS_JSON   — 认证头 JSON 字符串
 *   SANDBOX_WORKSPACE_ROOT      — 沙箱工作目录（默认 /home/user）
 *
 * 扫描的 4 个沙箱目录：
 *   skills/, .skills/, .codebuddy/skills/, .agents/skills/
 *
 * 共享逻辑在 skill-loader-shared.ts 中，仅沙箱配置获取方式不同
 * （通过 SANDBOX_BASE_URL 而非 CODEBUDDY_TOOL_OVERRIDE_CONFIG）。
 */

import { define } from '@opencode-ai/plugin/v2/promise'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  SkillDefinition,
  SandboxConfig,
  scanAllSandboxSkillsDirs,
  parseSkillFromRaw,
} from '../util/skill-loader-shared.js'

function getSandboxConfig(): SandboxConfig | null {
  const baseUrl = process.env.SANDBOX_BASE_URL
  if (!baseUrl) return null
  try {
    const headers = JSON.parse(process.env.SANDBOX_AUTH_HEADERS_JSON || '{}') as Record<string, string>
    return { url: baseUrl.replace(/\/mcp$/, ''), headers }
  } catch {
    return null
  }
}

/**
 * 桌面本地模式（无沙箱）下扫描本地 skills 目录。
 * 与 skill-loader-override.ts 的 scanLocalSkillsDirectory 等价（避免跨模块耦合，就地实现）。
 */
function scanLocalSkillsDirectory(dir: string, source: 'project' | 'user'): SkillDefinition[] {
  const skills: SkillDefinition[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          const skillFile = join(fullPath, 'SKILL.md')
          if (existsSync(skillFile)) {
            const raw = readFileSync(skillFile, 'utf-8')
            const skill = parseSkillFromRaw(raw, skillFile, dir, source)
            if (skill) skills.push(skill)
          }
        } else if (entry === 'SKILL.md') {
          const raw = readFileSync(fullPath, 'utf-8')
          const skill = parseSkillFromRaw(raw, fullPath, dir, source)
          if (skill) skills.push(skill)
        }
      } catch {
        // skip individual entries on error
      }
    }
  } catch {
    // directory unreadable
  }
  return skills
}

export default define({
  id: 'opencode-sandbox-skill-loader',
  setup: async (ctx) => {
    const sandbox = getSandboxConfig()
    let allSkills: SkillDefinition[] = []
    if (sandbox) {
      const sandboxCwd = process.env.SANDBOX_WORKSPACE_ROOT || '/home/user'
      console.error('[SandboxSkillLoader] Scanning sandbox skills')
      allSkills = await scanAllSandboxSkillsDirs(sandbox, sandboxCwd, 'project').catch(() => [] as SkillDefinition[])
      if (allSkills.length === 0) {
        console.error('[SandboxSkillLoader] No sandbox skills found')
        return
      }
    } else {
      // 桌面本地模式（无沙箱）：扫描 server 工作目录下的 skills/
      const localSkillsDir = process.env.OPENCODE_LOCAL_SKILLS_DIR || join(process.cwd(), 'skills')
      console.error('[SandboxSkillLoader] No sandbox, scanning local skills dir')
      allSkills = scanLocalSkillsDirectory(localSkillsDir, 'project')
      if (allSkills.length === 0) {
        console.error('[SandboxSkillLoader] No local skills found')
        return
      }
    }

    console.error('[SandboxSkillLoader] Loading skills')

    await ctx.skill.transform((draft) => {
      for (const skill of allSkills) {
        draft.source({
          type: 'embedded',
          skill: {
            name: skill.name,
            description: skill.description,
            location: skill.location,
            content: skill.instructions,
          },
        })
      }
    })
    console.error('[SandboxSkillLoader] Skills loaded')
  },
})
