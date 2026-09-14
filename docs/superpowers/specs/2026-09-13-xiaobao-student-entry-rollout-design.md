# 小宝 Runtime 学生端六入口灰度接线设计

## 1. 目标与现状

学生端六个创作入口（画图 / 视频 / 音乐 / 小游戏 / 写作 / 学习辅导）目前只完成了"选入口 → 填提示词 → 建任务"的通用链路：六个入口全部落在默认 Runtime（codebuddy）上。小宝 Runtime 侧的生产依赖装配、受控灰度门禁、`waiting_for_student` 交互闭环都已经完成并验证，但**没有任何生产调用方会把 `selectedRuntime='xiaobao'` 与 `xiaobaoCapability` 送到服务端**（全仓 `xiaobaoCapability` 只出现在 server 路由、shared 类型与测试里）。因此小宝 Runtime 在 `XIAOBAO_TEST_TASK_IDS` 之外不可达；即使手工把任务指向 xiaobao，缺少 capability 也会被 fail-closed 拒绝。

本设计把六入口按能力可用性接线到小宝 Runtime：写作 / 学习辅导 / 小游戏三个入口在灰度资格内自动选择小宝 Runtime，并把 capability 持久化到任务上（使"提问 → 作答 → 继续"的恢复轮天然可用）；画图 / 视频 / 音乐保持默认 Runtime 与既有工具提示，不伪造成果。灰度资格由服务端裁决并主动暴露，前端只消费资格，`acp.ts` 的门禁始终保留为权威。

## 2. 关键现状（已核实）

### 2.1 执行链路

```
学生六入口 packages/web/src/features/student-workspace/student-capabilities.ts
  → StudentWorkspace（student-workspace.tsx:18-22）
  → home-page-content.tsx:731-748 的 TaskForm(variant='student-workspace')
  → POST /api/tasks（tasks.ts:314）
  → 任务页 ACP session/prompt（acp.ts:661 handleSessionPrompt）
  → agentRuntimeRegistry.resolve({ explicitRuntime: params.runtime || task.selectedRuntime })（acp.ts:686-689）
  → canAccessXiaobaoRollout（acp.ts:690-699）
  → runtime.chatStream(..., { xiaobaoCapability })（acp.ts:776）
```

### 2.2 已具备（逐条核实）

- `POST /api/tasks` 已支持并持久化 `selectedRuntime`：解构在 `tasks.ts:373`，写入 `tasks.ts:525`；列定义 `db/schema.ts:77`。
- `session/prompt` 已支持 `params.runtime`（`acp.ts:686-687`）与 `params.xiaobaoCapability`（`acp.ts:776`），并已应用灰度门禁 `canAccessXiaobaoRollout`（`acp.ts:690-699`）；协议类型见 `shared/src/types/agent.ts:323`（`SessionPromptParams.xiaobaoCapability`）与 `:334`（`runtime`）。
- 服务端能力枚举 `XIAOBAO_CAPABILITIES = ['image','video','music','game','writing','learning']`（`xiaobao-runtime/domain.ts:3`）；`AgentOptions.xiaobaoCapability` 在 `shared/src/types/agent.ts:650`。
- `resolveProductionXiaobaoCapability`（`runtime.ts:118-128`）只放行 `writing` / `learning` / `game`，`image`/`video`/`music` 抛 `UnsupportedXiaobaoCapabilityError`（`:127`）；**缺 capability 抛 `MissingXiaobaoCapabilityError`（`:124`，fail closed）**。
- `canAccessXiaobaoRollout`（`rollout.ts:13-32`）：runtime 非 xiaobao 直接放行；xiaobao 时要求 active 用户，且（admin 或 `taskId ∈ XIAOBAO_TEST_TASK_IDS` 且任务属于该用户）；异常 catch 后返回 false。
- `agentRuntimeRegistry` 已注册 `xiaobao`（`agent/runtime/registry.ts:18,29`），`resolve` 按 `explicitRuntime → AGENT_RUNTIME → 默认` 选择（`:55-67`）。
- `GET /api/agent/runtimes` 已存在（`acp.ts:1235-1249`），返回 `{ default, runtimes: [{ name, available, models }] }`，前端 `task-form.tsx:147-185` 已消费它构建 runtime 选择器。
- 前端 `student-capabilities.ts` 中 image/game/writing/study 的 `toolState: 'available'`（`:38,82,96,111`），video/music 为 `'planned'` 且带 `toolMessage`（`:52-53,67-68`），由 `student-master-skill-card.tsx:66-70` 渲染。
- 部署镜像副本目录 `packages/server/deploy/` 与源同名 `@ai-xiaobao/server`，是 **Electron 桌面端的服务端源码**（`scripts/build-electron-server.mjs` 与 `scripts/prepare-electron-server.mjs` 都以其为根）。

### 2.3 缺口（本设计要补的）

1. **前端从不发送 `xiaobaoCapability`**：`use-chat-stream.ts` 的四个 `session/prompt` 调用点（`sendInitialPrompt:290-298`、`sendMessage:363-370`、`answerQuestion:420-424`、`confirmTool:477-482`）都不携带它。选了 xiaobao 的任务必然在 `runtime.ts:124` 被 fail-closed。
2. **恢复轮必然拿不到 capability**：`answerQuestion`（`:420-424`）与 `confirmTool`（`:477-482`）的 `prompt` 是空文本块。若不把 capability 落到服务端，则"提问 → 作答 → 继续"在 xiaobao 下直接失败。
3. **`POST /api/tasks` 不接收 capability**：`tasks.ts:367-381` 的解构里没有该字段，无法在创建期持久化。
4. **没有用户级白名单**：`rollout.ts:21-28` 的 `taskId` 白名单**无法授权尚未创建的新任务**，新建学生任务目前只有 admin 能进入 xiaobao。
5. **前端没有资格信息**：`/runtimes` 只报运行时可用性，且该路径在 ACP 中间件里被显式豁免登录（`acp.ts:48-54`），不能承载"当前用户是否有资格"。
6. **入口能力 id 不进表单**：`student-workspace.tsx:18-22` 只写 prompt 与 skillName；`task-form.tsx:128` 读的也是 skillName atom（`lib/atoms/task.ts:5`），capability id 完全没有下游。
7. **命名不一致**：前端入口 id 是 `study`（`student-capabilities.ts:1,99`），服务端能力是 `learning`（`domain.ts:3`），没有显式映射。

## 3. 方案比较与选择（D1–D5）

以下五条为锁定决策，不再另起方案。

### D1：capability 持久化到任务（新增 nullable 列 `xiaobaoCapability`）（采用）

- 备选 A：只靠前端在每次 `session/prompt` 手工携带 capability。缺点：`answerQuestion` / `confirmTool` 的 resume 轮由 chat-core 内部拼装 params（`use-chat-stream.ts:420-424,477-482`），恢复轮必须能拿到 capability 才不会失败；把"这条任务属于哪个能力"交给前端每次补发，任何一次漏发都会让恢复轮 fail-closed，且服务端失去权威。
- 备选 B：从 `prompt` 文本或 `skillSettings.skillList` 反推 capability。缺点：启发式推断不可靠（学生可以自由编辑提示词），并且会让服务端在能力裁决上依赖不可信输入。
- **决策**：任务表新增 nullable 列 `xiaobaoCapability`（SQLite 列名 `xiaobao_capability`），建任务时写入；`acp.ts` 取值表达式固定为 `params.xiaobaoCapability ?? task.xiaobaoCapability`。理由：恢复轮天然可用、服务端保持权威、读取点唯一且可 fail-closed（非法值经 `parseXiaobaoCapabilitySelection` 变成 `undefined`）。
- 连带要求：Drizzle schema + 迁移 + CloudBase 仓储 + deploy 副本同步（见 4.1、4.6）。

### D2：灰度资格由服务端裁决并主动暴露（新增专用端点，采用）

- 备选 A：扩展 `GET /api/agent/runtimes`，在 runtime 条目上增加 `eligible`。缺点：该路径在 ACP 中间件里被显式豁免登录（`acp.ts:48-54`，与 `/health`、`/config` 同级），要承载"当前用户是否有资格"就必须给它加认证并改动一个已被 `task-form.tsx:147-185` 与 `task-details.tsx:2379` 消费的公开契约；若不加认证则会把用户级灰度资格暴露给匿名调用方。
- 备选 B（采用）：新增 `GET /api/agent/xiaobao/eligibility`，走 `requireUserEnv`，只返回静态布尔与静态能力列表。
- **决策**：采用备选 B。`/runtimes` 语义完全不变（继续只报运行时可用性）；资格端点登录后才可访问，响应不含任何用户标识；前端**只依据资格决定是否把 `selectedRuntime` 设为 `xiaobao`**，`acp.ts:690-699` 的门禁保留为权威（前端不可信）。
- 未灰度学生的行为与今天**完全一致**：资格为 false 时前端不覆盖 runtime、不附加 capability，请求字段与当前实现逐字节相同。

### D3：新增用户级白名单 `XIAOBAO_TEST_USER_IDS`（采用）

- 备选 A：只保留 `XIAOBAO_TEST_TASK_IDS`。缺点：Task id 在任务创建前不存在，无法授权新建的学生任务。
- **决策**：新增 `XIAOBAO_TEST_USER_IDS`（逗号分隔），admin 仍自动放行；`XIAOBAO_TEST_TASK_IDS` 语义不变。
- fail-closed 语义（锁定）：
  - 两个白名单都从 `input.environment ?? process.env` 读取，`split(',') → trim → filter(Boolean)`；缺省、空串、只有逗号、只有空白 → 空集合 → 不授权。
  - 用户不存在、`status !== 'active'` → 不授权（即使该 id 在白名单里）。
  - 用户级白名单**只用于"新任务资格"**；在 `session/prompt` 路径上，用户级白名单命中的用户仍必须通过任务属主校验（`tasks.findByIdAndUserId`）。
  - 任何数据库异常 → false。
  - 白名单只影响是否允许进入 xiaobao，不影响其余 runtime 的既有行为（runtime 非 xiaobao 一律放行）。

### D4：只有 writing/learning/game 请求小宝 Runtime（采用）

- **决策**：`image` / `video` / `music` 三个入口**保持默认 Runtime**（不覆盖 `selectedRuntime`、不附加 capability），并沿用现有 `toolState` / `toolMessage` 提示，不伪造成果。
- 与 `runtime.ts:118-128` 的放行集合严格对齐，前端不请求服务端必定拒绝的能力。
- `image` 的 `toolState` 仍为 `'available'`，因为它在默认 Runtime 上走既有 imagegen 工具链（前端已有 `tool-renderers/imagegen.tsx`）；该字段描述入口在默认路径上的可用性，本轮不改，也不得据此把 image 接到小宝 Runtime。

### D5：前端 `study` → 服务端 `learning` 显式映射（采用）

- **决策**：能力→服务端 capability 的映射作为单一事实来源写在 `student-capabilities.ts` 的入口定义上（`writing → 'writing'`、`study → 'learning'`、`game → 'game'`；`image`/`video`/`music` 为 `null`），并由相邻的纯函数模块解析。未知 id、`null`、`undefined`、未映射入口一律返回 `null` 并**不请求 xiaobao**（fail-closed），解析函数不抛异常。

## 4. 详细设计

### 4.1 数据模型与迁移

- `db/schema.ts`：`tasks` 表新增 `xiaobaoCapability: text('xiaobao_capability')`，与 `selectedRuntime`（`:77`）同规格。**列类型保持 `string`，不在 db 层引入 `agent/xiaobao-runtime` 依赖**；枚举校验只在 HTTP 边界做。
- `db/types.ts`：`Task` 增加 `xiaobaoCapability: string | null`（对齐 `selectedRuntime`，`:43`），并加入 `TaskNullableFields`（`:292-320`），使 `NewTask` 可省略。
- 迁移：新增 `0005_xiaobao_task_capability`，内容恰为 `ALTER TABLE \`tasks\` ADD \`xiaobao_capability\` text;`，并同步 `meta/0005_snapshot.json` 与 `meta/_journal.json`。
- 双 Provider 语义一致：Drizzle 走真实迁移；CloudBase 在 `withTaskDefaults` 里 `doc.xiaobaoCapability ?? null`、在 `create` 默认值里补 `xiaobaoCapability: null`。两条路径读回语义相同（写入 `'learning'` 读回 `'learning'`，未写入读回 `null`）。
- 兼容性：`db/drizzle/client.ts` 的迁移语句解析器只支持 `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE ... ADD`（`:59-80`），本迁移属第三种；`strictSql` 目前只对 `0004` 生效（`:173,207`），**不修改该特判**。
- 旧数据：迁移前创建的任务该列为 `NULL`，此时 xiaobao 提示轮会用 `undefined` 走 `MissingXiaobaoCapabilityError`（fail-closed）。本设计**不引入任何推断式回退**；处理办法是重建任务（或由部署方在库中显式补列值），见 7。

### 4.2 建任务：`POST /api/tasks`

- 请求体接受可选 `xiaobaoCapability`（服务端枚举值）。
- 校验（fail-closed）：
  - 传了非法值（如 `study`、`image`、任意字符串）→ `400`，不创建任务；
  - 传了合法值但 `selectedRuntime !== 'xiaobao'` → `400`（能力只能随小宝 Runtime 提交，避免产生"挂着能力却不是小宝"的脏行）；
  - `selectedRuntime === 'xiaobao'` 时先做**创建期资格裁决**（用户级白名单 / admin / active），不通过 → `403`；
  - 两者都没传 → 与今天逐字节一致（`selectedRuntime` 原样透传，`xiaobaoCapability` 存 `null`）。
- 持久化：`tasks.create` 增加 `xiaobaoCapability: <能力或 null>`，与 `selectedRuntime`（`:525`）相邻。
- 不新增/修改任何 PATCH 字段：`PATCH /:taskId` 是 action 白名单式（`:599-645`），不受影响。

### 4.3 会话：`acp.ts` 读取与门禁

- `handleSessionPrompt`（`:661`）中把 `xiaobaoCapability` 改为
  `parseXiaobaoCapabilitySelection(params.xiaobaoCapability ?? task.xiaobaoCapability)`。
- 优先级：显式 `params.xiaobaoCapability` > 任务列 > `undefined`（fail-closed）。非法任务列值不会透传。
- `canAccessXiaobaoRollout`（`:690-699`）**必须保留**，作为与前端资格无关的权威门禁；前端资格仅用于 UX 决策。
- **不改 chat-core**：`use-chat-stream.ts` 的四个调用点保持现状，capability 全部由服务端从任务行读取。这样恢复轮（空 prompt + `askAnswers`，`:420-424`）与工具确认轮（`:477-482`）无需任何前端改动即可工作。
- `shared/src/types/agent.ts:649` 的注释"仅 writing / learning 已接入生产依赖"与 `runtime.ts:126`（game 同样放行）不一致，本设计一并更正为写入 / 学习 / 游戏。

### 4.4 灰度资格服务端裁决与端点

- `rollout.ts` 抽出可复用裁决：
  - `isXiaobaoRolloutUser({ userId, database, environment })`：active 且（admin 或 `userId ∈ XIAOBAO_TEST_USER_IDS`）。**不参考 taskId 白名单**——taskId 白名单只授权既有任务。
  - `canAccessXiaobaoRollout(...)`：runtime 非 xiaobao → true；否则 active 且（admin 或（`userId ∈ XIAOBAO_TEST_USER_IDS` 或 `taskId ∈ XIAOBAO_TEST_TASK_IDS`）且任务属主校验通过）。
- 新端点 `GET /api/agent/xiaobao/eligibility`（`acp` 路由挂载在 `/api/agent`，见 `index.ts:112`），走 `requireUserEnv`：
  - 有资格且运行时健康：`{ eligible: true, runtime: 'xiaobao', capabilities: ['writing','learning','game'] }`
  - 无资格或不健康：`{ eligible: false, runtime: 'xiaobao', capabilities: [] }`
  - 内部异常（用户查询失败等）一律降级为 `eligible: false`，不返回 5xx、不泄露用户标识、不写含动态值的日志。
- `capabilities` 的值来自放行集合的单一事实来源：在 `domain.ts` 增加 `XIAOBAO_PRODUCTION_CAPABILITIES = ['writing','learning','game']`，`resolveProductionXiaobaoCapability` 改为按该集合放行，端点直接读取它，避免两处漂移。

### 4.5 前端：映射、状态与消费

- `student-capabilities.ts`：每个入口新增 `xiaobaoCapability: 'writing' | 'learning' | 'game' | null`（D5）。
- 新增纯函数模块 `student-runtime-selection.ts`（不依赖 React/jotai，便于单测）：
  - `resolveStudentXiaobaoCapability(id)`：查表，未知/缺失 → `null`；
  - `resolveStudentRuntimeSelection({ capabilityId, xiaobaoEligible })`：仅当"入口已映射 + 资格为 true"时返回 `{ selectedRuntime: 'xiaobao', xiaobaoCapability }`，否则返回 `{}`；
  - `parseXiaobaoEligibility(payload)`：`eligible` 严格等于 `true` 才为 true，其余（含异常形状、fetch 失败）为 false。
- 新增 hook `use-xiaobao-eligibility.ts`：`useXiaobaoEligibility(enabled)`，仅在 `variant === 'student-workspace'` 时请求资格端点，默认 false（fail-closed），任何失败保持 false 且不改变既有行为。
- `lib/atoms/task.ts`：新增 `studentCapabilityIdAtom`，与既有 `studentMasterSkillNameAtom` 对称。
- `student-workspace.tsx`：`onCapabilitySelect` 除现有两个回调外，再调用新增的 `onCapabilityChange(capability.id)`。
- `home-page-content.tsx`：把 capability id 写入 atom；`TaskForm` 的 `variant='student-workspace'` 调用点不变。
- `task-form.tsx`：`variant === 'student-workspace'` 时读取 capability atom 与资格，把 `resolveStudentRuntimeSelection(...)` 的结果展开到两处 `onSubmit` 负载（`:490-505`、`:555-570`）——只有命中时才出现 `selectedRuntime: 'xiaobao'` 与 `xiaobaoCapability`。`selectedRuntime` 的其余取值逻辑保持原样。

### 4.6 部署镜像（deploy）同步范围

`packages/server/deploy/` 是 Electron 桌面端的服务端源码，但它的 DB 层已经明显落后于源：迁移目录缺 `0004_xiaobao_usage_ledger`（源有 SQL、快照与 journal 条目，镜像三者皆无），`db/drizzle/client.ts` 仍是旧 bootstrap（把 journal `tag` 当 hash、`created_at` 用 `Date.now()`，见镜像 `:50-68`），且镜像**完全没有 `agent/xiaobao-runtime/**`**（`deploy/src/routes/acp.ts` 里没有任何 xiaobao 门禁）。因此本轮的镜像同步严格限定为"不会破坏桌面端"的部分：

- **同步（定向编辑，禁止整文件覆盖陈旧文件）**：
  - `deploy/src/db/schema.ts`（列声明）、`deploy/src/db/types.ts`（字段 + nullable 集合）、`deploy/src/db/cloudbase/repositories.ts`（`withTaskDefaults` 归一 + `create` 默认 null）——与源同内容；
  - `deploy/src/routes/tasks.ts`——该文件当前与源**逐字节一致**，直接复制即可；
  - `deploy/src/db/drizzle/client.ts`——追加一个启动期列兼容函数（`PRAGMA table_info(tasks)` 缺列时 `ALTER TABLE tasks ADD \`xiaobao_capability\` text`），并在现有迁移块**之后**无条件调用。**不复制迁移文件、不改镜像的迁移 bootstrap**：镜像现有 bootstrap 会把 journal 条目按 `Date.now()` 记为已应用，新迁移不会被执行，只改 schema 会让桌面端 drizzle 查询直接报"no such column"。
- **不同步（有明确理由）**：
  - `deploy/src/routes/acp.ts` 的 capability 读取与灰度门禁：镜像未注册 xiaobao runtime（`deploy/src/agent/runtime/index.ts` 无 xiaobao），同步会引入镜像中不存在的 `agent/xiaobao-runtime/**` 模块（编译失败），或退化为永不生效的死代码；
  - `agent/xiaobao-runtime/**`（含 `rollout.ts`、资格端点依赖）：桌面端小宝 Runtime 的端到端接入沿用既有开放决策（进度日志 R43 起"deploy/Electron 是否同步小宝 Runtime"），单独推进；
  - 迁移 0004/0005 文件：见上，镜像的迁移 bootstrap 无法正确应用它们，补齐属于独立的镜像 DB 层收敛任务。
- 桌面端行为影响：镜像没有资格端点，前端请求会失败 → `eligible: false` → 永远走默认 Runtime；新列在桌面端保持 `NULL`。这与今天的行为一致，桌面端不存在回归。

### 4.7 死代码 `packages/web/src/hooks/use-acp.ts` 的处理结论

- **本轮不动**。已用全仓检索确认它没有任何引用方（除自身外零个 import），是确认的死代码；但删除它与灰度接线无关，会引入无关 diff 与额外审查面（该文件仍 import `@ai-xiaobao/shared` 类型）。
- 本设计将其登记为"已确认无引用、保留不动"，清理留给独立的 `chore(web)` 提交；在此之前不得在它上面继续添加逻辑。

## 5. 验收与测试

- 服务端单测：`rollout` 用户级白名单与 fail-closed；资格端点（有资格 / admin / 无资格 / 运行时不可用 / 异常降级）；任务 capability 列与双 Provider 往返；`POST /api/tasks` 的四类校验与持久化；`acp` 从任务行读取 capability（params 优先、非法值 fail-closed、resume 轮生效）。
- 数据层：迁移在全新库与仅 users 表的旧库上都能得到 `xiaobao_capability` 列；`legacy-migrations.test.ts` 的迁移记录与预期一致。
- 前端单测：映射（study→learning，image/video/music→null，未知 id fail-closed）；请求字段解析（未灰度不产生任何覆盖）；资格 hook（未启用不发请求、失败保持 false）；`StudentWorkspace` 回调透传。
- 集成：任务级闭环——`selectedRuntime='xiaobao'` + `xiaobaoCapability='learning'` 的任务在"提问 → 作答（空 prompt + askAnswers）→ 完成"整条链路上，两轮都拿到 capability，不受门禁误拦。
- 全量：`pnpm.cmd --filter @ai-xiaobao/server test`、`pnpm.cmd --filter @ai-xiaobao/web test`、`pnpm.cmd type-check`、`pnpm.cmd lint`、`pnpm.cmd build:server`、`git diff --check`。
- 安全：新增日志全部静态字符串；资格端点不返回用户标识；`XIAOBAO_TEST_*` 全部 fail-closed；deploy 镜像不引入小宝 Runtime 代码。

## 6. 非目标（本阶段不做）

- 画图 / 视频 / 音乐的真实媒体 Provider 接入（火山引擎视频、音乐生成服务选型、图片生成链路改造），以及它们在 xiaobao 下的能力放行。
- 默认 Runtime 切换：`AGENT_RUNTIME_DEFAULT` 保持 codebuddy，xiaobao 永不作为默认 Runtime。
- 教师端（teacher-course-management）任何改动。
- Electron / deploy 桌面版同步小宝 Runtime 的决策与实施（本轮只做 4.6 列出的最小 DB 形状同步）。
- 从提示词或 `skillSettings.skillList` 反推 capability 的启发式回退。
- `use-acp.ts` 死代码清理，以及任何与学生入口无关的前端重构。
- 交互式长对话编排（自由追问循环）与自动超时策略。

## 7. 边界与风险

- **迁移哈希与测试期望值耦合**：`db/drizzle/__tests__/legacy-migrations.test.ts:8-29` 硬编码了每个迁移的 `hash`（SQL 文件内容的 sha256）与 `createdAt`（journal `when`）。新增 0005 必须同步更新该期望数组，否则测试红；这是有意为之的防漂移设计，不得放宽断言。
- **迁移命名与 journal 必须一致**：`readMigrationFiles`（`client.ts:82-99`）按 journal `tag` 读取 `<tag>.sql`；重命名 SQL/快照文件时必须同步改 journal 的 `tag`，否则启动即抛错。
- **旧任务 capability 为空**：迁移前创建的任务会 fail-closed（这是设计意图）。修复手段只有"重建任务"或"部署方显式补列值"，不提供自动推断。
- **前端资格是提示、服务端是权威**：资格端点不可用、被篡改或过期时，最坏结果是前端请求了 xiaobao 而被 `acp.ts` 门禁拒绝（fail-closed），不会越权。
- **`/runtimes` 契约冻结**：本设计不改它的响应形状与免登录状态；任何后续"把资格塞进 /runtimes"的改动都需要重新评估 4.4 的备选 A 缺点。
- **镜像漂移是既有事实**：deploy 镜像缺少 0004、缺少小宝 Runtime、bootstrap 陈旧。本轮只做 4.6 的最小同步，并在进度日志中记录未同步项；镜像整体收敛需要独立任务，不能靠本轮的列同步顺带完成。
- **`missingCapabilityMessage` 的用户可见性**：capability 缺失时用户看到的是 `runtime.ts:82` 的静态提示；在灰度过程中若出现该提示，优先怀疑任务列是否写入（而非模型问题）。
- **契约一致性**：`XIAOBAO_PRODUCTION_CAPABILITIES` 一经引入即为放行集合的唯一事实来源，前端映射与服务端放行集合必须同时覆盖 `writing`/`learning`/`game`，计划中的双端测试各自锁定这一点。
