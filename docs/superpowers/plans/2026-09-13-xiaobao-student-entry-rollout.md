# 小宝 Runtime 学生端六入口灰度接线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把学生端六个创作入口接到小宝 Runtime：写作/学习辅导/小游戏在灰度资格内自动选择 `selectedRuntime='xiaobao'` 并把 capability 持久化到任务，`acp.ts` 从任务行读取 capability（params 优先），画图/视频/音乐保持默认 Runtime 与既有工具提示。

**Architecture:** 复用既有 `canAccessXiaobaoRollout` 门禁与 `xiaobaoCapability` 协议字段，新增用户级白名单 `XIAOBAO_TEST_USER_IDS` 与只读资格端点 `GET /api/agent/xiaobao/eligibility`；任务表新增 nullable 列 `xiaobaoCapability`，capability 由服务端从任务行读取，chat-core 不进任何 params 改动。

**Spec:** `docs/superpowers/specs/2026-09-13-xiaobao-student-entry-rollout-design.md`

## Global Constraints

- 日志只允许静态字符串（AGENTS.md）；不得输出 userId、taskId、白名单内容或 capability 值。
- 测试先行：每个 Task 先写失败测试并观察红灯（RED），再实现转绿（GREEN）。
- 每 Task 独立提交，提交信息格式 `type(scope): description`；**只暂存该 Task 明确列出的文件**（`git add <精确路径>`）。
- **绝不执行 `git add -A` / `git add .` / 按目录暂存**。worktree 里存在 8 个用户既有的前端未提交改动，必须原样保留：`packages/web/src/features/student-workspace/student-course-panel.tsx`、`packages/web/src/features/student-workspace/xiaobao-pet-card.test.tsx`、`packages/web/src/features/teacher/teacher-class-card.tsx`、`packages/web/src/features/teacher/teacher-class-detail-page.tsx`、`packages/web/src/features/teacher/teacher-class-repository.test.ts`、`packages/web/src/features/teacher/teacher-classes-page.tsx`、`packages/web/src/features/teacher/teacher-lesson-progress-list.tsx`、`packages/web/src/features/teacher/teacher-student-roster.tsx`；另有约 590 个仅行尾（LF/CRLF）噪音文件与未跟踪的 `debug-schema.mjs`，一律不暂存。
- 禁止启动 dev server；验证只用 test / type-check / lint / build。
- 不使用 `pnpm type-check -- --incremental false`：当前 pnpm 会把 `--` 原样转发给 tsc 并报 TS5023；统一用 `pnpm.cmd type-check`。
- 所有 `XIAOBAO_TEST_*` 一律 fail-closed：缺省、空串、空白、异常均不授权。
- 不新增/修改 `SessionPromptParams` 与 `AgentOptions` 字段；capability 走 DB 读取，chat-core 不改。
- deploy 镜像同步严格按 Task 3 / Task 4 列出的文件与方式；**禁止把 `agent/xiaobao-runtime/**` 或迁移文件引入 deploy**。
- 每完成一个 Task 更新 `docs/progress/2026-08-21-xiaobao-runtime.md`（Task 9 统一收口）。

---

### Task 1: 灰度资格纯函数与用户级白名单

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/rollout.ts`
- Modify: `.env.example`（在 `XIAOBAO_TEST_TASK_IDS` 注释旁新增 `XIAOBAO_TEST_USER_IDS`）
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/rollout.test.ts`（新增；该目录当前无 rollout 单测）

- [x] Step 1: 失败测试（RED）
  - `isXiaobaoRolloutUser`：active + `userId ∈ XIAOBAO_TEST_USER_IDS` → true；不在 → false；admin → true（无需白名单）；`status='disabled'` → false（admin 亦然）；env 缺省 / 空串 / `','` / `' , '` → false；`environment` 入参优先于 `process.env`；`users.findById` 抛错 → false。
  - `canAccessXiaobaoRollout`：`runtimeName !== 'xiaobao'` → true（不查用户）；admin → true；用户级白名单 + 任务属主 → true；用户级白名单 + 任务不属于该用户 → false；`XIAOBAO_TEST_TASK_IDS` 命中 + 属主 → true（既有语义不变）；两个白名单都不命中 → false；`findByIdAndUserId` 抛错 → false。
- [x] Step 2: 实现
  - 抽出共用 `parseIdList(value: string | undefined): Set<string>`（`split(',') → trim → filter(Boolean)`）。
  - 新增导出 `isXiaobaoRolloutUser({ userId, database, environment })`：active → admin 或用户级白名单命中；异常 catch → false。
  - `canAccessXiaobaoRollout` 改为：非 xiaobao 放行；active 校验；admin 放行；`userId ∈ XIAOBAO_TEST_USER_IDS` 或 `taskId ∈ XIAOBAO_TEST_TASK_IDS` 命中后必须再过 `tasks.findByIdAndUserId`；异常 catch → false。
  - 不得新增任何日志（该文件目前无日志，保持无日志）。
  - `.env.example`：新增注释行 `# Comma-separated server-side allowlist for non-admin XiaoBao rollout users (new tasks).` + `# XIAOBAO_TEST_USER_IDS=`。
- [x] Step 3: 绿灯 + 定向 Prettier
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/agent/xiaobao-runtime/__tests__/rollout.test.ts`
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/acp-xiaobao-rollout.test.ts`（既有 25 项不得回归）
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(agent): add user-level xiaobao rollout allowlist`

---

### Task 2: 资格端点 `GET /api/agent/xiaobao/eligibility`

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/domain.ts`（新增 `XIAOBAO_PRODUCTION_CAPABILITIES`）
- Modify: `packages/server/src/agent/xiaobao-runtime/runtime.ts`（`resolveProductionXiaobaoCapability` 改为按该集合放行，行为不变）
- Modify: `packages/server/src/routes/acp.ts`（新增只读路由，置于 `/runtimes`（`:1235-1249`）附近）
- Modify: `packages/shared/src/types/agent.ts`（更正 `:649` 注释为"写入 / 学习 / 游戏"）
- Test: `packages/server/src/routes/__tests__/acp-xiaobao-eligibility.test.ts`（新增）

- [x] Step 1: 失败测试（RED）
  - 普通 active 用户不在白名单 → `200 { eligible: false, runtime: 'xiaobao', capabilities: [] }`。
  - `userId ∈ XIAOBAO_TEST_USER_IDS` → `eligible: true`，`capabilities` 精确等于 `['writing','learning','game']`（顺序稳定）。
  - admin → `eligible: true`（无需白名单）。
  - 白名单用户但 `xiaobao` runtime `isAvailable()` 为 false → `eligible: false` 且 `capabilities: []`。
  - `users.findById` 抛错 → 仍是 `200` 且 `eligible: false`（fail-closed，不 5xx）。
  - 响应 JSON 不含 userId / taskId / 白名单字符串。
- [x] Step 2: 实现
  - `domain.ts`：`export const XIAOBAO_PRODUCTION_CAPABILITIES = ['writing', 'learning', 'game'] as const`；`runtime.ts:118-128` 改为 `if ((XIAOBAO_PRODUCTION_CAPABILITIES as readonly XiaobaoCapability[]).includes(capability)) return capability`，其余抛错分支不变。
  - `acp.ts`：`acp.get('/xiaobao/eligibility', requireUserEnv, async (c) => { ... })`（挂载后即 `GET /api/agent/xiaobao/eligibility`，见 `index.ts:112`）；内部用 `c.get('userEnv')!.userId`、`isXiaobaoRolloutUser({ userId, database: getDb() })` 与 `agentRuntimeRegistry.get('xiaobao')?.isAvailable()`；任何异常 → `eligible: false`。
  - 不改 `acp.use('/*')` 的豁免名单（`/runtimes`、`/health`、`/config` 保持不变），新路径自然落入需登录分支。
- [x] Step 3: 绿灯 + 回归
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/acp-xiaobao-eligibility.test.ts src/agent/xiaobao-runtime/__tests__/runtime.test.ts`
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/acp-xiaobao-rollout.test.ts`
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(agent): expose xiaobao rollout eligibility endpoint`

---

### Task 3: 任务 capability 数据模型（Drizzle + CloudBase + 迁移 + deploy DB 层）

**Files:**
- Modify: `packages/server/src/db/schema.ts`（`tasks` 表新增列）
- Modify: `packages/server/src/db/types.ts`（`Task` 字段 + `TaskNullableFields`）
- Modify: `packages/server/src/db/cloudbase/repositories.ts`（`withTaskDefaults` + `create` 默认值）
- Add: `packages/server/src/db/migrations/0005_xiaobao_task_capability.sql`
- Add: `packages/server/src/db/migrations/meta/0005_snapshot.json`（drizzle-kit 生成）
- Modify: `packages/server/src/db/migrations/meta/_journal.json`
- Modify: `packages/server/src/db/drizzle/__tests__/legacy-migrations.test.ts`（`expectedMigrations` 增加 0005 条目）
- Add: `packages/server/src/db/__tests__/xiaobao-task-capability-schema.test.ts`
- Modify（deploy 镜像，定向编辑，禁止整文件覆盖）: `packages/server/deploy/src/db/schema.ts`、`packages/server/deploy/src/db/types.ts`、`packages/server/deploy/src/db/cloudbase/repositories.ts`
- Modify（deploy 镜像）: `packages/server/deploy/src/db/drizzle/client.ts`（启动期列兼容函数）
- 验证（无需改动）: `packages/server/src/db/drizzle/repositories.ts`（`create` 展开 `NewTask`、`select()` 走 schema，列自动生效）

- [x] Step 1: 失败测试（RED）
  - schema 测试：`tasks` 定义含可空的 `xiaobaoCapability` 列；全新库跑迁移后 `PRAGMA table_info(tasks)` 含 `xiaobao_capability`；仅含 `users` 表的旧库经 bootstrap 后同样含该列。
  - 双 Provider 语义一致：写入 `'learning'` 读回 `'learning'`；不传读回 `null`（Drizzle 临时库 + CloudBase fake collection，沿用 `src/db/cloudbase/__tests__/xiaobao-usage-ledger.test.ts` 的 fake collection 手法）。
  - `legacy-migrations.test.ts` 在更新 `expectedMigrations` 之前必须红（哈希/时间不匹配）。
- [x] Step 2: 生成迁移
  - `pnpm.cmd db:generate`（根 `drizzle.config.ts`：`schema=./packages/server/src/db/schema.ts`、`out=./packages/server/src/db/migrations`）。
  - 确认生成的 SQL **恰为** ``ALTER TABLE `tasks` ADD `xiaobao_capability` text;``（`db/drizzle/client.ts:59-80` 只支持 CREATE TABLE / CREATE INDEX / ALTER TABLE ... ADD，本语句属第三种）。
  - 将 SQL 与快照重命名为 `0005_xiaobao_task_capability.sql` / `meta/0005_snapshot.json`，并在 `meta/_journal.json` 追加 `{ "idx": 5, "version": "6", "when": <drizzle-kit 生成的时间戳>, "tag": "0005_xiaobao_task_capability", "breakpoints": true }`。`tag` 必须与文件名主干完全一致（`client.ts:82-99` 按 tag 读文件）。
  - 更新 `legacy-migrations.test.ts` 的 `expectedMigrations`：新增第 6 条 `{ hash: sha256(SQL 文件内容), createdAt: <journal when> }`（严格按 `client.ts:87-98` 的算法取得真实值，不得放宽断言）。
  - 不修改 `client.ts:173,207` 对 `0004` 的 `strictSql` 特判。
- [x] Step 3: 服务端实现
  - `schema.ts`：`xiaobaoCapability: text('xiaobao_capability'), // 'writing' | 'learning' | 'game' | null`，紧邻 `selectedRuntime`（`:77`）。db 层不 import `agent/xiaobao-runtime`（避免分层倒置），列类型为 `string`。
  - `types.ts`：`Task` 增加 `xiaobaoCapability: string | null`（对齐 `:43`）；`TaskNullableFields`（`:292-320`）增加 `'xiaobaoCapability'`。
  - `cloudbase/repositories.ts`：`withTaskDefaults`（`:774-789`）加 `xiaobaoCapability: doc.xiaobaoCapability ?? null`；`create` 默认值区（`:867-888`）加 `xiaobaoCapability: null`。
- [x] Step 4: deploy 镜像同步
  - `deploy/src/db/schema.ts`、`deploy/src/db/types.ts`、`deploy/src/db/cloudbase/repositories.ts`：按同样内容做**定向编辑**（这三个文件已是陈旧分叉，禁止整文件覆盖）。
  - `deploy/src/db/drizzle/client.ts`：新增 `ensureTaskCapabilityCompatibility()`——`PRAGMA table_info(tasks)` 无 `xiaobao_capability` 时执行 ``ALTER TABLE tasks ADD `xiaobao_capability` text``——并在现有迁移块之后（镜像 `:68` 之后）无条件调用一次。
  - **不复制** 0004/0005 迁移与 `meta/**` 到 deploy：镜像 bootstrap（`:50-68`）把 journal `tag` 当 hash、`created_at` 记为 `Date.now()`，新迁移不会被应用；只改 schema 不改 bootstrap 会让桌面端 drizzle 查询报 `no such column`。
- [x] Step 5: 绿灯
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/db/__tests__/xiaobao-task-capability-schema.test.ts src/db/drizzle/__tests__/legacy-migrations.test.ts src/db/drizzle/__tests__/client-lifecycle.test.ts`
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/db/cloudbase/__tests__/xiaobao-usage-ledger.test.ts`
  - `pnpm.cmd --filter @ai-xiaobao/server test`
  - `pnpm.cmd type-check`
- [x] Step 6: 提交 `feat(db): persist xiaobao capability on tasks`

---

### Task 4: `POST /api/tasks` 持久化 capability 与创建期资格裁决

**Files:**
- Modify: `packages/server/src/routes/tasks.ts`（解构 `:367-381`、校验、`create` 负载 `:516-552`）
- Modify（deploy 镜像，与源保持逐字节一致）: `packages/server/deploy/src/routes/tasks.ts`
- Test: `packages/server/src/routes/__tests__/tasks-xiaobao-capability.test.ts`（新增）

- [x] Step 1: 失败测试（RED）
  - 白名单用户 + `selectedRuntime:'xiaobao'` + `xiaobaoCapability:'learning'` → 任务创建成功，`tasks.create` 收到 `selectedRuntime:'xiaobao'` 与 `xiaobaoCapability:'learning'`。
  - 非白名单用户 + `selectedRuntime:'xiaobao'` → `403`，且 `tasks.create` 未被调用。
  - `xiaobaoCapability` 非法值（`'study'`、`'image'`、随机串）→ `400`，且未创建任务。
  - `xiaobaoCapability` 合法但 `selectedRuntime` 非 xiaobao → `400`，且未创建任务。
  - 两者都不传 → `xiaobaoCapability: null`，`selectedRuntime` 原样透传（与今天一致）。
  - 用户不存在 / 状态非 active → `403`（fail-closed）。
- [x] Step 2: 实现
  - 解构追加 `xiaobaoCapability`；用 `parseXiaobaoCapabilitySelection`（`agent/xiaobao-runtime/runtime.ts:113-116`）校验，值非法即 `400 { error: 'Invalid XiaoBao capability' }`。
  - 校验顺序：`xiaobaoCapability` 存在但 `selectedRuntime !== 'xiaobao'` → `400`；`selectedRuntime === 'xiaobao'` → `await isXiaobaoRolloutUser({ userId: session.user.id, database: getDb() })`，false 即 `403 { error: 'Xiaobao runtime is restricted' }`（与 `acp.ts:698` 文案一致）。
  - `tasks.create` 增加 `xiaobaoCapability: <能力 | null>`，紧邻 `selectedRuntime`（`:525`）。
  - 不新增日志；不修改 `PATCH /:taskId`（action 白名单式，`:599-645`）与 `POST /:taskId/continue`（`:752-764`）。
- [x] Step 3: 绿灯 + deploy 一致性
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/tasks-xiaobao-capability.test.ts`
  - `Copy-Item packages/server/src/routes/tasks.ts packages/server/deploy/src/routes/tasks.ts -Force` 后校验：`if ((Compare-Object (Get-Content packages/server/src/routes/tasks.ts) (Get-Content packages/server/deploy/src/routes/tasks.ts) | Measure-Object).Count -ne 0) { throw 'deploy tasks.ts drifted' }`
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(server): persist xiaobao capability when creating tasks`

---

### Task 5: `acp.ts` 从任务行读取 capability（params 优先）

**Files:**
- Modify: `packages/server/src/routes/acp.ts`（`handleSessionPrompt` 的 chatStream options，`:767-779`）
- Test: `packages/server/src/routes/__tests__/acp-xiaobao-task-capability.test.ts`（新增）

- [x] Step 1: 失败测试（RED）
  - 任务行 `selectedRuntime:'xiaobao'`、`xiaobaoCapability:'learning'`，`params.xiaobaoCapability` 缺省 → `chatStream` options 收到 `'learning'`。
  - 同时传 `params.xiaobaoCapability:'writing'` → options 以 `'writing'` 为准。
  - 任务行值是非法值（如 `'study'`）→ options 收到 `undefined`（fail-closed，不透传）。
  - resume 轮（空 prompt + `params.askAnswers`）同样从任务行取到 capability（断言 `options.xiaobaoCapability === 'learning'`）。
  - 门禁回归：非白名单用户仍被 `'Xiaobao runtime is restricted'` 拦下（该断言可复用既有 `acp-xiaobao-rollout.test.ts` 风格）。
- [x] Step 2: 实现
  - `acp.ts:776` 改为 `xiaobaoCapability: parseXiaobaoCapabilitySelection(params.xiaobaoCapability ?? task.xiaobaoCapability)`。
  - 不新增启发式推断，不改 `canAccessXiaobaoRollout` 调用点，不改 chat-core。
- [x] Step 3: 绿灯 + 回归
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/acp-xiaobao-task-capability.test.ts src/routes/__tests__/acp-xiaobao-persistence.test.ts src/routes/__tests__/acp-xiaobao-rollout.test.ts`
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(agent): read xiaobao capability from task on prompt`

---

### Task 6: 前端能力映射与请求字段解析（纯函数 + atom）

**Files:**
- Modify: `packages/web/src/features/student-workspace/student-capabilities.ts`（每个入口新增 `xiaobaoCapability`）
- Add: `packages/web/src/features/student-workspace/student-runtime-selection.ts`
- Modify: `packages/web/src/lib/atoms/task.ts`（新增 `studentCapabilityIdAtom`）
- Test: `packages/web/src/features/student-workspace/student-capabilities.test.ts`（扩展）
- Test: `packages/web/src/features/student-workspace/student-runtime-selection.test.ts`（新增）

- [x] Step 1: 失败测试（RED）
  - 映射：`writing → 'writing'`、`study → 'learning'`、`game → 'game'`；`image`/`video`/`music → null`。
  - `resolveStudentXiaobaoCapability`：未知 id、`null`、`undefined` → `null`，**不抛异常**。
  - `resolveStudentRuntimeSelection({ capabilityId:'study', xiaobaoEligible:true })` → `{ selectedRuntime:'xiaobao', xiaobaoCapability:'learning' }`。
  - `resolveStudentRuntimeSelection({ capabilityId:'study', xiaobaoEligible:false })` → `{}`（不产生任何覆盖）。
  - `resolveStudentRuntimeSelection({ capabilityId:'image', xiaobaoEligible:true })` → `{}`。
  - `parseXiaobaoEligibility`：`{ eligible: true }` → true；`{ eligible: false }`、缺字段、非布尔、`null`、字符串、异常对象 → false。
  - `student-capabilities.test.ts` 断言六个入口的 `xiaobaoCapability` 映射，且 video/music 的 `toolState: 'planned'` 与 `toolMessage` 不变。
- [x] Step 2: 实现
  - `StudentCapability` 接口新增 `readonly xiaobaoCapability: 'writing' | 'learning' | 'game' | null`；六个条目逐一赋值（单一事实来源）。
  - `student-runtime-selection.ts` 不依赖 React/jotai；capability 解析用查表 + 类型收窄，**不调用会抛错的 `getStudentCapability`**。
  - `lib/atoms/task.ts` 新增 `export const studentCapabilityIdAtom = atom<StudentCapabilityId | null>(null)`（与 `:5` 的 `studentMasterSkillNameAtom` 对称）。
- [x] Step 3: 绿灯
  - `pnpm.cmd --filter @ai-xiaobao/web exec vitest run src/features/student-workspace/student-capabilities.test.ts src/features/student-workspace/student-runtime-selection.test.ts`
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(web): map student entries to xiaobao capabilities`

---

### Task 7: 六入口接线（资格 hook + 组件与表单消费）

**Files:**
- Add: `packages/web/src/features/student-workspace/use-xiaobao-eligibility.ts`
- Add: `packages/web/src/features/student-workspace/use-xiaobao-eligibility.test.tsx`（`// @vitest-environment jsdom`；`packages/web` 已装 `jsdom` 与 `@testing-library/react`）
- Modify: `packages/web/src/features/student-workspace/student-workspace.tsx`（新增 `onCapabilityChange`）
- Modify: `packages/web/src/features/student-workspace/student-workspace.test.tsx`
- Modify: `packages/web/src/components/home-page-content.tsx`（写入 capability atom）
- Modify: `packages/web/src/components/task-form.tsx`（读 atom + 资格 + 两处 onSubmit 负载 `:490-505`、`:555-570`）
- 注意：**不要修改** `packages/web/src/features/student-workspace/student-course-panel.tsx` 与 `xiaobao-pet-card.test.tsx`（用户既有未提交改动）。

- [x] Step 1: 失败测试（RED）
  - hook：`enabled=false` → 不调用 `fetch`，返回 false；`enabled=true` 且响应 `{ eligible: true }` → true；HTTP 非 200 → false；`fetch` reject → false；响应不可解析（非 JSON）→ false；响应 `{ eligible: 'yes' }` → false。
  - `StudentWorkspace`：`onCapabilitySelect('study')` 时同时调用 `onPromptChange`、`onMasterSkillChange('student-learning-master')`、新增 `onCapabilityChange('study')`（既有两条断言保留）。
  - 表单消费：`resolveStudentRuntimeSelection` 结果按 `variant==='student-workspace'` 展开到 onSubmit 负载——由 Task 6 的纯函数测试覆盖，本 Task 只补 hook 与组件透传断言。
- [x] Step 2: 实现
  - `useXiaobaoEligibility(enabled: boolean): boolean`：`enabled` 为 false 时直接返回 false 且不发请求；请求 `GET /api/agent/xiaobao/eligibility`（`credentials: 'include'`），用 `parseXiaobaoEligibility` 解析；任何异常 → false（fail-closed）；组件卸载后不 setState。
  - `StudentWorkspace`：props 增加 `onCapabilityChange: (id: StudentCapabilityId) => void`，`handleCapabilitySelect` 中在既有两行之后追加调用。
  - `home-page-content.tsx`：新增 `const setStudentCapabilityId = useSetAtom(studentCapabilityIdAtom)`，传给 `<StudentWorkspace onCapabilityChange={setStudentCapabilityId} />`（`TaskForm` 调用点不变）。
  - `task-form.tsx`：`const studentCapabilityId = useAtomValue(studentCapabilityIdAtom)`；`const xiaobaoEligible = useXiaobaoEligibility(variant === 'student-workspace')`；在两处 `onSubmit` 负载内展开 `...resolveStudentRuntimeSelection({ capabilityId: studentCapabilityId, xiaobaoEligible, })`，并让 `selectedRuntime` 由该结果优先覆盖（命中 xiaobao 时覆盖，否则保持既有 `selectedRuntime || undefined`）。
  - `variant !== 'student-workspace'` 时行为必须与今天逐字节一致（不发资格请求、不覆盖 runtime、不附加 capability）。
- [x] Step 3: 绿灯
  - `pnpm.cmd --filter @ai-xiaobao/web exec vitest run src/features/student-workspace/use-xiaobao-eligibility.test.tsx src/features/student-workspace/student-workspace.test.tsx src/features/student-workspace/student-capabilities.test.ts src/features/student-workspace/student-runtime-selection.test.ts`
  - `pnpm.cmd --filter @ai-xiaobao/web test`
  - `pnpm.cmd type-check`
- [x] Step 4: 提交 `feat(web): route student entries to xiaobao runtime when eligible`

---

### Task 8: 任务级闭环集成测试（提问 → 作答 → 完成）

**Files:**
- Add: `packages/server/src/routes/__tests__/acp-xiaobao-student-closure.test.ts`（沿用 `acp-xiaobao-persistence.test.ts` 的 `vi.mock` 手法：auth 中间件、`db/index.js`、`persistence.service.js`、`agent-registry.js`、`agent/runtime/index.js` 与可注入的 fake xiaobao runtime）

- [x] Step 1: 失败测试（RED）
  - 预置任务行 `selectedRuntime:'xiaobao'`、`xiaobaoCapability:'learning'`，用户为 `XIAOBAO_TEST_USER_IDS` 命中者。
  - 第一轮 `session/prompt`（不带 `params.xiaobaoCapability`，普通文本）：fake runtime 断言 `options.xiaobaoCapability === 'learning'`，返回 `waiting_for_student`（提问轮不结算）。
  - 第二轮 `session/prompt`（`prompt: [{ type:'text', text:'' }]` + `askAnswers`）：绕开 "A prompt turn is already in progress"（`acp.ts:704-736`），fake runtime 再次断言 `options.xiaobaoCapability === 'learning'`，返回完成。
  - 断言两轮都未被灰度门禁拦截；断言未携带 capability 的任务行（`xiaobaoCapability: null`）在同一 harness 下被 fail-closed 拒绝。
- [x] Step 2: 实现
  - 本 Task 预期**不需要产品代码改动**；若测试暴露缺口，缺口修复必须落在已完成的对应 Task 范围内，并回到该 Task 的提交语义（必要时追加修复提交 `fix(agent): ...`）。
- [x] Step 3: 绿灯
  - `pnpm.cmd --filter @ai-xiaobao/server exec vitest run src/routes/__tests__/acp-xiaobao-student-closure.test.ts`
- [x] Step 4: 提交 `test(agent): cover xiaobao student entry closed loop`

---

### Task 9: 完整验收与文档收口

**Files:**
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`（新增第 52 轮）

- [x] Step 1: 全量验证
  - `pnpm.cmd --filter @ai-xiaobao/server test`
  - `pnpm.cmd --filter @ai-xiaobao/web test`
  - `pnpm.cmd type-check`
  - `pnpm.cmd lint`
  - `pnpm.cmd build:server`
  - `git diff --check`（只允许既有 LF/CRLF 提示）
- [x] Step 2: 安全扫描
  - 本计划触及文件内所有 `console.*` 均为静态字符串（无 `${...}` 模板）；
  - 资格端点响应不含 userId / taskId / 白名单内容；
  - `XIAOBAO_TEST_USER_IDS` / `XIAOBAO_TEST_TASK_IDS` 缺省与异常路径均 fail-closed 且不出现在日志；
  - `git status --porcelain` 复核：8 个用户既有前端改动与 CRLF 噪音文件仍未被暂存。
- [x] Step 3: deploy 镜像复核
  - `packages/server/deploy/src/db/{schema.ts,types.ts,cloudbase/repositories.ts,drizzle/client.ts}` 含列定义与启动期兼容；
  - `deploy/src/routes/tasks.ts` **有意不与源保持逐字节一致**：镜像完全没有 `agent/xiaobao-runtime/**`，同步会让桌面端构建失败；需确认该文件保持未修改，且 deploy 内不存在任何 xiaobao-runtime 引用；
  - deploy 中**不存在** `src/agent/xiaobao-runtime/**` 与 0004/0005 迁移文件（确认未误引入）。
- [x] Step 4: 进度文档
  - 新增"第 52 轮：学生端六入口灰度接线"，记录：D1–D5 落地、`XIAOBAO_TEST_USER_IDS`、资格端点、迁移 0005、deploy 最小同步范围与未同步项、验证数字（测试文件数/用例数）、下一步（真实模型 + 浏览器六入口验证、媒体 Provider、镜像整体收敛）。
- [x] Step 5: 提交 `docs(agent): verify xiaobao student entry rollout`

---

## Self-Review

- **Spec 覆盖**：D1 → Task 3/4/5；D2 → Task 2 + Task 5（门禁保留）；D3 → Task 1；D4 → Task 6/7（image/video/music 不覆盖 runtime）；D5 → Task 6；部署镜像决策 → Task 3/4 的 deploy 文件与 Task 9 Step 3；恢复轮要求 → Task 5 的 resume 断言 + Task 8 闭环；非目标六项在计划中均无对应任务，未越界。
- **范围**：只改 server 的 rollout / acp / tasks / db 与 web 的 student-workspace + task-form + atom，以及 shared 注释；不触碰 chat-core、教师端、Electron 构建、媒体 Provider。`student-course-panel.tsx`、`xiaobao-pet-card.test.tsx` 明确列为禁止修改。
- **类型一致性**：db 层 `xiaobaoCapability: string | null`（与 `selectedRuntime` 同规格，避免 db→agent 分层依赖）；HTTP 边界用 `parseXiaobaoCapabilitySelection` 收敛为 `XiaobaoCapability`；web 侧用 shared 的 `XiaobaoCapabilitySelection`，前端 `study` 只存在于 `StudentCapabilityId` 并在 Task 6 显式映射为 `learning`；服务端放行集合 `XIAOBAO_PRODUCTION_CAPABILITIES` 与前端映射集合各自有测试锁定。
- **安全**：新增日志零动态值；资格端点要求登录且只返回布尔与静态能力列表；`XIAOBAO_TEST_*` 全部 fail-closed（缺省/空白/异常均不授权）；创建期与提示期双门禁；前端资格仅作 UX 决策，服务端门禁权威；迁移与代码提交只暂存计划列出的文件，不污染用户既有改动。
- **验证命令**：全部使用 `pnpm.cmd`，未出现 `pnpm type-check -- --incremental false`（TS5023 已知坑）；服务端定向测试使用 `--filter @ai-xiaobao/server exec vitest run <path>`，全量使用 `--filter @ai-xiaobao/server test`。
