# 小宝 Runtime 媒体 Provider 实施计划（图片 / 视频 / 音乐）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `image` / `video` / `music` 提供与沙箱工具同构的 Provider 契约与 fail-closed 生产装配（已实施），并在用户选定外部媒体服务、提供凭据后把三个能力真正接通。

**Architecture:** 复用沙箱工具链路形状（`ToolProvider` + 白名单 + 可注入 HTTP 客户端），新增 `MediaToolClient` / `MediaToolsProvider` / `createMediaToolHttpClient` / `loadMediaToolEnvironment`，并在 `dependencies.ts` 中以与 `sandboxClient` 完全同构的方式装配；能力放行集合与资格端点在本阶段保持不动。

**Spec:** `docs/superpowers/specs/2026-09-13-xiaobao-media-providers-design.md`

## Global Constraints

- 日志只允许静态字符串；**绝不打日志输出媒体 token、上游错误正文或产物 URL 之外的敏感值**。
- 测试注入假客户端，**绝不访问真实媒体服务**。
- 无凭据环境下不得提供任何假 Provider、空实现或"始终允许"分支。
- 本阶段**不修改** `XIAOBAO_PRODUCTION_CAPABILITIES`、资格端点与前端 `xiaobaoCapability` 映射。
- 每 Task 独立提交，只暂存明确文件；绝不整库暂存（工作区存在 8 个用户既有前端改动与 CRLF 噪音）。
- 验证统一用 `pnpm.cmd`；不使用 `pnpm type-check -- --incremental false`（TS5023）。注意根 `tsconfig.json` 的 `exclude` 含 `packages`，包内类型问题需用 `tsc -p packages/server/tsconfig.json` 单独核查。

---

### Task 1: 媒体工具契约与白名单 ✅

**Files:**
- Add: `packages/server/src/agent/xiaobao-runtime/media-tools.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/media-tools.test.ts`

- [x] 白名单只放行 `generate_image` / `generate_video` / `generate_music`，未知工具静态拒绝且不触达客户端
- [x] `MEDIA_TOOL_BY_CAPABILITY` 记录能力 → 必需工具名
- [x] 三个模型可见 schema（`additionalProperties: false`，`prompt` 必填）
- [x] 失败/异常/取消归一化为静态 `errorCode`，不泄露上游文本
- [x] 结果序列化超 20k 截断并标记
- [x] 11 项测试通过

### Task 2: HTTP 客户端与配置 ✅

**Files:**
- Add: `packages/server/src/agent/xiaobao-runtime/media-http-client.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/media-http-client.test.ts`
- Modify: `.env.example`

- [x] `XIAOBAO_MEDIA_URL` / `XIAOBAO_MEDIA_AUTH_TOKEN` / `XIAOBAO_MEDIA_TIMEOUT_MS`（默认 120000）
- [x] 缺省、空白、非法 URL（非 http(s)、含 query/hash、内嵌凭据）、非法超时 → 返回 `null`（fail-closed）
- [x] 生成走 `POST {url}/api/media/{kind}`，Bearer 鉴权，正文为工具入参
- [x] 非 2xx / 非 JSON / 缺 `success` / `success !== true` / 网络异常 → `{ ok: false, error: '' }`
- [x] `healthCheck` 走无生成成本的 `GET {url}/health`
- [x] `.env.example` 增加三个空占位与协议说明
- [x] 13 项测试通过

### Task 3: 生产装配与 fail-closed 验证 ✅

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/dependencies.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/media-assembly.test.ts`

- [x] 新增 `mediaClient?` 注入点（显式注入优先，否则从 `XIAOBAO_MEDIA_*` 自动创建）
- [x] `DependencyIdentity` 与缓存对象字面量纳入 `mediaClient`（漏写会导致缓存永不命中）
- [x] 健康才注册三个工具并把 schema 并入模型工具列表
- [x] 未配置 / 不健康 → 0 个媒体工具
- [x] 与沙箱工具相互独立：7 / 3 / 4
- [x] **锁定 D4**：能力放行集合仍为 `['writing','learning','game']`，`image` 仍被运行期门禁拒绝
- [x] 7 项测试通过；服务端全量 56 文件 / 636 项通过；包内 tsc 无新增错误

**提交**：`feat(agent): add fail-closed media provider contracts and assembly`

---

### Task 4: 装载媒体技能（待凭据）

**Files:** Modify `packages/server/src/agent/xiaobao-runtime/dependencies.ts`（`loadApprovedProjectSkills` 的装载开关）
**Test:** 扩展 `__tests__/dependencies.test.ts` 或新增装配测试

- [x] 为 `image` / `video` / `music` 增加装载开关（技能文件已存在，勿新增内容）
- [x] 未开关时 `getByCapability('image' | 'video' | 'music')` 必须为 `null`
- [x] 开关打开且技能文件缺失时装配整体失败（保持现有 fail-closed 语义）

### Task 5: 能力放行与运行期守卫（待凭据）

**Files:** Modify `domain.ts`（`XIAOBAO_PRODUCTION_CAPABILITIES`）、`runtime.ts`（进入 Agent Loop 前的守卫）
**Test:** 扩展 `__tests__/runtime.test.ts`、`__tests__/media-assembly.test.ts`

- [x] 仅在媒体服务配置健康时才把对应能力加入放行集合（避免资格端点误报）
- [x] 守卫：该能力所需媒体工具不在 `dependencies.tools` 时返回静态提示，不进入 Agent Loop、不创建 run
- [x] 资格端点返回的能力列表与放行集合保持一致

### Task 6: 前端入口映射切换（待凭据）

**Files:** Modify `packages/web/src/features/student-workspace/student-capabilities.ts`
**Test:** `student-capabilities.test.ts`、`student-runtime-selection.test.ts`

- [x] 把已启用的入口 `xiaobaoCapability` 由 `null` 改为对应值（未启用的保持 `null`）
- [x] `video` / `music` 的 `toolState: 'planned'` 与 `toolMessage` 在真正接入前保持不变

### Task 7: 真实服务端到端验收（待凭据）

- [ ] 真实产物（图片/视频/音频）可播放可下载，且经内容安全双层审核
- [ ] 超时、上游错误、余额不足、断线恢复四条路径均不产生假产物、不重复结算
- [x] 服务端全量测试 + web 全量测试 + `pnpm lint` + `pnpm build:server`
      —— 已在第 66 轮本地复验：服务端 66 文件 / 767 项、web 36 文件 / 140 项、`pnpm lint` 0、
      `pnpm build:server` 与 `pnpm build:web` 均成功（仅既有的大包体积提示）。前两项仍需真实媒体服务与凭据。

---

## Self-Review

- **Spec 覆盖**：D1 → Task 1；D2 → Task 2；D3 → Task 1/2/3（三层 fail-closed 各有测试）；D4 → Task 3 的显式锁定；D5 → Task 2 的 URL 校验用例。启用步骤 §4 的 7 步对应 Task 4–7。
- **范围**：本计划只碰 `xiaobao-runtime` 的媒体模块、`dependencies.ts`、`.env.example`，以及启用阶段才触及的 `domain.ts` / `runtime.ts` / 前端映射；不触碰 chat-core、教师端与桌面镜像。
- **类型一致性**：`MediaToolClient` 与 `SandboxToolClient` 形状同构；`MEDIA_TOOL_BY_CAPABILITY` 的键是 `XiaobaoCapability` 的子集，值与白名单键一一对应（有测试）。
- **安全**：无新增日志；token 只进入请求头且 URL 校验拒绝内嵌凭据；所有失败路径只暴露静态 errorCode。
- **诚实性**：在无凭据环境下不伪造任何媒体 Provider；Task 4–7 明确标注为待凭据。
