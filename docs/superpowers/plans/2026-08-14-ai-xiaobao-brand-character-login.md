# AI小宝学院品牌、角色与动态登录实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将产品品牌安全统一为“AI小宝学院”，建立可复用的九装扮动态小宝组件，并完成以小宝为核心的响应式动态登录体验及关键页面接入。

**Architecture:** 保留现有 monorepo 目录结构，把角色类型、视觉 token、装扮配置与状态选择逻辑拆成纯 TypeScript 模块，把 SVG 分层渲染留在单一公共组件中。登录页只负责把表单状态映射为角色状态；首页、启动页和聊天等消费者只传 `outfit`、`mood` 与 `action`，不复制角色绘制逻辑。

**Tech Stack:** React 19、TypeScript 5.9、Vite 6、Tailwind CSS 4、内联 SVG、CSS/SVG 动画、Node `node:test`/TypeScript 类型检查。

## Global Constraints

- 用户可见产品名固定为 `AI小宝学院`，不插入空格。
- 中文产品描述固定为 `青少年 AI 编程创作伙伴`。
- 英文机器标识使用 `ai-xiaobao-academy`；Windows 发布物使用 ASCII 名称 `AI-XiaoBao-Academy`。
- 小宝必须保留星形轮廓、深蓝脸部、金色眉毛、星光/代码披风四个识别锚点。
- 动画必须尊重 `prefers-reduced-motion`，不能阻塞输入、提交或页面导航。
- 所有日志仅允许静态字符串，不新增敏感值或运行时动态值。
- 保留第三方仓库 URL、CloudBase、OpenCode、CodeBuddy 和历史来源说明。
- 当前工作区已有六个未提交的 UI 文件；实施必须在其基础上增量修改，不覆盖或还原用户改动。

---

## 文件结构

- `packages/chat-core/src/components/chat/xiaobao-types.ts`：角色公开类型、装扮目录与状态标签。
- `packages/chat-core/src/components/chat/xiaobao-character.tsx`：唯一分层 SVG 渲染组件。
- `packages/chat-core/src/components/chat/xiaobao-character.css`：动作、特效与减少动画规则。
- `packages/chat-core/src/components/chat/xiaobao-state.ts`：登录/业务状态到角色状态的纯函数映射。
- `packages/chat-core/src/index.ts`：公开组件、类型、装扮目录与状态映射。
- `packages/web/src/pages/LoginPage.tsx`：动态登录场景和表单状态接入。
- `packages/web/src/components/landing-page.tsx`：默认品牌角色与课程装扮展示。
- `packages/web/src/components/splash-screen.tsx`：启动动作接入。
- `packages/web/src/components/shared-header.tsx`：小尺寸品牌角色接入。
- `packages/chat-core/src/components/task-chat.tsx`：聊天工作/思考/完成状态接入。
- `package.json`、`packages/*/package.json`、TypeScript/Vite 配置与源码 import：内部 `@ai-xiaobao/*` 到 `@ai-xiaobao/*` 的原子迁移。
- `README.md`、`README-zh.md` 与主要产品文档：当前产品叙述更新，历史引用保留。

### Task 1: 建立角色类型、装扮目录与状态映射

**Files:**
- Create: `packages/chat-core/src/components/chat/xiaobao-types.ts`
- Create: `packages/chat-core/src/components/chat/xiaobao-state.ts`
- Modify: `packages/chat-core/src/index.ts`
- Test: `packages/chat-core/src/components/chat/xiaobao-state.test.ts`

**Interfaces:**
- Produces: `XiaoBaoOutfit`、`XiaoBaoMood`、`XiaoBaoAction`、`XiaoBaoState`、`XIAOBAO_OUTFITS`、`getLoginXiaoBaoState(input)`。
- `getLoginXiaoBaoState` consumes `{ mode, focus, loading, success, error }` and returns `{ outfit, mood, action }`.

- [ ] **Step 1: 写状态映射测试**

```ts
import { describe, expect, it } from 'vitest'
import { getLoginXiaoBaoState } from './xiaobao-state'

describe('getLoginXiaoBaoState', () => {
  it('uses writing while login is loading', () => {
    expect(getLoginXiaoBaoState({ mode: 'login', focus: null, loading: true, success: false, error: false })).toEqual({
      outfit: 'academy',
      mood: 'working',
      action: 'write',
    })
  })

  it('covers the password field', () => {
    expect(getLoginXiaoBaoState({ mode: 'login', focus: 'password', loading: false, success: false, error: false }).action).toBe('cover-eyes')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm.cmd exec vitest run packages/chat-core/src/components/chat/xiaobao-state.test.ts`

Expected: FAIL because `xiaobao-state.ts` does not exist.

- [ ] **Step 3: 实现公开类型和九装扮目录**

```ts
export type XiaoBaoOutfit = 'academy' | 'coding' | 'ai' | 'art' | 'music' | 'science' | 'robotics' | 'reading' | 'adventure'
export type XiaoBaoMood = 'idle' | 'happy' | 'thinking' | 'working' | 'excited' | 'sleepy' | 'comforting'
export type XiaoBaoAction = 'breathe' | 'blink' | 'wave' | 'look-left' | 'cover-eyes' | 'write' | 'celebrate' | 'upgrade' | 'sleep'
export interface XiaoBaoState { outfit: XiaoBaoOutfit; mood: XiaoBaoMood; action: XiaoBaoAction }
```

Add nine immutable catalog entries with Chinese title, short description, primary color, accent color and symbolic accessory.

- [ ] **Step 4: 实现登录状态优先级**

Priority: `success → loading → error → password focus → username/phone/code focus → register mode → idle`.

- [ ] **Step 5: 运行测试与类型检查**

Run: `pnpm.cmd exec vitest run packages/chat-core/src/components/chat/xiaobao-state.test.ts`

Run: `pnpm.cmd type-check`

Expected: PASS.

- [ ] **Step 6: 提交**

```bash
git add packages/chat-core/src/components/chat/xiaobao-types.ts packages/chat-core/src/components/chat/xiaobao-state.ts packages/chat-core/src/components/chat/xiaobao-state.test.ts packages/chat-core/src/index.ts
git commit -m "feat(web): add Xiaobao character state model"
```

### Task 2: 重建分层小宝 SVG 与九套装扮

**Files:**
- Modify: `packages/chat-core/src/components/chat/xiaobao-character.tsx`
- Create: `packages/chat-core/src/components/chat/xiaobao-character.css`
- Modify: `packages/chat-core/src/index.ts`

**Interfaces:**
- Consumes: Task 1 的 `XiaoBaoOutfit`、`XiaoBaoMood`、`XiaoBaoAction`。
- Produces: `XiaoBaoProps` with `outfit?`, `mood?`, `action?`, `size?`, `interactive?`, `speaking?`, `onClick?`, `className?`, `ariaLabel?`.

- [ ] **Step 1: 扩展组件调用契约并让类型检查先失败**

Add a temporary compile-time fixture inside the component module:

```ts
const _typeFixture: XiaoBaoProps = { outfit: 'coding', mood: 'working', action: 'write', size: 120 }
void _typeFixture
```

Run: `pnpm.cmd type-check`

Expected: FAIL until the new props and types are connected.

- [ ] **Step 2: 实现固定分层结构**

Render groups in this exact order: `aura → cape → body → outfit → face → prop → particles`. Use unique `useId()` gradient/filter IDs and keep the 160×160 viewBox.

- [ ] **Step 3: 实现九种装扮差异**

Use one base face and body. Each outfit changes only chest emblem, cape lining, accessory and foreground particles. Implement all nine exhaustive switch branches so TypeScript rejects missing outfits.

- [ ] **Step 4: 实现动作 class 和减少动画模式**

```css
.xiaobao--breathe { animation: xb-breathe 3.6s ease-in-out infinite; }
.xiaobao--wave .xiaobao__arm-right { transform-origin: 122px 88px; animation: xb-wave 900ms ease-in-out; }
@media (prefers-reduced-motion: reduce) {
  .xiaobao, .xiaobao * { animation-duration: 1ms !important; animation-iteration-count: 1 !important; }
}
```

- [ ] **Step 5: 校验所有现有调用兼容**

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd format:check`

Expected: PASS; existing `<XiaoBao mood size speaking />` calls remain valid.

- [ ] **Step 6: 提交**

```bash
git add packages/chat-core/src/components/chat/xiaobao-character.tsx packages/chat-core/src/components/chat/xiaobao-character.css packages/chat-core/src/index.ts
git commit -m "feat(web): rebuild Xiaobao as layered mascot"
```

### Task 3: 打磨动态登录页

**Files:**
- Modify: `packages/web/src/pages/LoginPage.tsx`
- Modify: `packages/web/src/index.css`

**Interfaces:**
- Consumes: `XiaoBao` and `getLoginXiaoBaoState` from `@ai-xiaobao/chat-core` before the package rename task.
- Produces: local `LoginFocus = 'username' | 'password' | 'phone' | 'code' | null` and deterministic UI state mapping.

- [ ] **Step 1: 建立登录视觉状态变量**

Add `focus`, `loginSucceeded` and derive `xiaobaoState` from `getLoginXiaoBaoState`.

- [ ] **Step 2: 绑定表单事件**

Every input sets its focus name on `onFocus` and clears it on `onBlur`. Successful local and GitHub authentication sets success before navigation. Errors continue to render as text and set the comforting animation.

- [ ] **Step 3: 重排响应式布局**

Use a two-column academy scene at `lg`, and a single-column form on narrow screens. The character panel contains the 220–280px mascot, contextual line, orbiting stylus and subtle course badges; the form stays at max width 440px.

- [ ] **Step 4: 修复登录页乱码文案**

Replace mojibake with valid UTF-8 Chinese for labels, placeholders, errors and descriptions. Keep `CENTRAL_AUTH_BASE_URL` literal unchanged.

- [ ] **Step 5: 验证登录状态与构建**

Run: `pnpm.cmd --filter @ai-xiaobao/web build`

Run: `pnpm.cmd type-check`

Expected: PASS with no inaccessible unlabeled inputs.

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/pages/LoginPage.tsx packages/web/src/index.css
git commit -m "feat(web): create animated Xiaobao login experience"
```

### Task 4: 将九套课程装扮铺入关键入口

**Files:**
- Modify: `packages/web/src/components/landing-page.tsx`
- Modify: `packages/web/src/components/splash-screen.tsx`
- Modify: `packages/web/src/components/shared-header.tsx`
- Modify: `packages/web/src/components/task-form.tsx`
- Modify: `packages/chat-core/src/components/task-chat.tsx`

**Interfaces:**
- Consumes: `XiaoBao` props defined by Task 2 and `XIAOBAO_OUTFITS` from Task 1.
- Produces: course cards keyed by `XiaoBaoOutfit` and consistent app-wide state usage.

- [ ] **Step 1: 首页展示九种课程身份**

Map the nine catalog entries to course cards; each card renders its outfit at 72–96px and uses the catalog title/description rather than duplicated copy.

- [ ] **Step 2: 设置关键页面动作**

- Splash: `academy + wave` then `breathe`.
- Header: `academy + idle + breathe` at 40px.
- Task creation: chosen course outfit + `excited`.
- Chat thinking: `thinking + look-left`.
- Chat tool execution: `working + write`.
- Chat completion: `happy + celebrate`.

- [ ] **Step 3: 修复触达文件中的品牌乱码**

Only fix corrupted Chinese in the five touched files; do not mechanically rewrite unrelated historical files.

- [ ] **Step 4: 构建验证**

Run: `pnpm.cmd build:web`

Expected: PASS; the large-bundle warning may remain but no new warning class is introduced.

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/components/landing-page.tsx packages/web/src/components/splash-screen.tsx packages/web/src/components/shared-header.tsx packages/web/src/components/task-form.tsx packages/chat-core/src/components/task-chat.tsx
git commit -m "feat(web): bring Xiaobao outfits across core flows"
```

### Task 5: 原子迁移内部包命名空间

**Files:**
- Modify: `package.json`
- Modify: `packages/chat-core/package.json`
- Modify: `packages/chat-playground/package.json`
- Modify: `packages/dashboard/package.json`
- Modify: `packages/server/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/web/package.json`
- Modify: all source imports and TS/Vite aliases containing `@ai-xiaobao/`
- Modify: `scripts/prepare-electron-server.mjs`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces exact mapping: `@ai-xiaobao/shared → @ai-xiaobao/shared`, `@ai-xiaobao/chat-core → @ai-xiaobao/chat-core`, `@ai-xiaobao/dashboard → @ai-xiaobao/dashboard`, `@ai-xiaobao/web → @ai-xiaobao/web`, `@ai-xiaobao/server → @ai-xiaobao/server`, `@ai-xiaobao/chat-playground → @ai-xiaobao/chat-playground`.

- [ ] **Step 1: 记录迁移前引用数**

Run: `rg -l "@ai-xiaobao/" package.json packages scripts | Measure-Object`

Expected: count greater than zero.

- [ ] **Step 2: 一次性替换 package names、dependencies、imports、aliases and scripts**

Use exact string mapping only. Do not rename directories or third-party identifiers.

- [ ] **Step 3: 更新 lockfile**

Run: `pnpm.cmd install --lockfile-only --offline`

Expected: succeeds using installed workspace dependencies and writes only lock metadata needed for package names.

- [ ] **Step 4: 验证旧命名空间已清零**

Run: `rg -n "@ai-xiaobao/" package.json packages scripts`

Expected: no matches except explicitly quoted migration history documents, which are outside this task's target.

- [ ] **Step 5: 全量构建验证**

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd build`

Expected: PASS.

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml packages scripts/prepare-electron-server.mjs
git commit -m "refactor: rename workspace packages for AI小宝学院"
```

### Task 6: 统一产品文案、发布标识与主要文档

**Files:**
- Modify: `README.md`
- Modify: `README-zh.md`
- Modify: `docs/architecture.md`
- Modify: `docs/skill-management.md`
- Modify: `packages/web/index.html`
- Modify: `electron/main.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: consistent public brand string and current-project description without altering upstream source links.

- [ ] **Step 1: 更新当前产品叙述**

Top headings and introductions describe “AI小宝学院 — 青少年 AI 编程创作伙伴”. Preserve upstream clone URLs in a clearly labeled “上游来源/Upstream” section.

- [ ] **Step 2: 检查发布标识**

Ensure Electron title/productName/publisher use `AI小宝学院`; executable and artifact names use `AI-XiaoBao-Academy`.

- [ ] **Step 3: 扫描用户可见旧品牌**

Run: `rg -n "CloudBase VibeCoding Platform|OpenVibeCoding 平台" README.md README-zh.md docs packages/web electron package.json`

Expected: matches only in upstream/history sections.

- [ ] **Step 4: 验证格式与构建**

Run: `pnpm.cmd format:check`

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd build`

Expected: PASS.

- [ ] **Step 5: 提交**

```bash
git add README.md README-zh.md docs/architecture.md docs/skill-management.md packages/web/index.html electron/main.cjs package.json
git commit -m "docs: unify AI小宝学院 product branding"
```

### Task 7: 阶段一回归与宠物系统接口交接

**Files:**
- Create: `docs/manual-tests/xiaobao-character-login.md`
- Modify: `docs/superpowers/specs/2026-08-14-ai-xiaobao-brand-character-system-design.md` only if implementation revealed a concrete contradiction.

**Interfaces:**
- Produces: manual test checklist and the stable inputs required by the separate pet-system plan.

- [ ] **Step 1: 编写手工验收清单**

Include desktop/web widths, nine outfits, login/register/GitHub states, reduced motion, keyboard focus, chat working/completion states and Windows title checks with explicit expected outcomes.

- [ ] **Step 2: 运行仓库门禁**

Run: `pnpm.cmd format`

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd lint`

Run: `pnpm.cmd build`

Run: `pnpm.cmd --filter @ai-xiaobao/server test`

Expected: formatting/type/build pass; any existing timeout or environment failure is documented separately and is not silently ignored.

- [ ] **Step 3: 检查动态日志和敏感信息**

Run: `rg -n 'console\.(log|error|warn)\(`[^`]*\$\{' packages --glob '!**/deploy/**'`

Expected: no newly introduced dynamic template logs.

- [ ] **Step 4: 提交验收文档**

```bash
git add docs/manual-tests/xiaobao-character-login.md
git commit -m "docs(web): add Xiaobao experience regression checklist"
```

## 第二份计划边界

宠物成长与持久化单独建立实施计划，消费本计划稳定下来的 `XiaoBaoOutfit`、`XiaoBaoMood`、`XiaoBaoAction` 和 `XIAOBAO_OUTFITS`。第二份计划负责 CloudBase/Drizzle 双 provider、经验与亲密度规则、衣橱、课程解锁、节日/昼夜解析和个人中心，不回头重写角色 SVG。
