# 小宝 Runtime 真实工具接入实施计划（game 试点）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为小宝 Runtime 装配第一个真实工具 Provider（沙箱文件/命令工具），以 game（Scratch 游戏）为试点打通"模型请求工具 → 沙箱执行 → observation → 完成"链路，保持未装配时 fail-closed。

**Architecture:** 保持 `ToolProvider` 端口稳定。新增窄范围 `SandboxToolClient`（构造注入）与 `SandboxToolsProvider`，工具名白名单映射到沙箱 `/api/tools/*`；game 技能与能力批准仅在装配健康时放行。模型工具 schema 经既有 `config.tools` 注入。

**Spec:** `docs/superpowers/specs/2026-08-30-xiaobao-real-tools-design.md`

## Global Constraints

- 日志只允许静态字符串；不得输出任务 ID、学生标识、沙箱 URL、鉴权头、命令原文或上游正文。
- 沙箱凭据只存在于服务端环境；测试使用注入假客户端，不访问真实沙箱。
- 未配置沙箱或健康检查失败时保持 fail-closed：不注入工具 schema、game 不可用、静态提示不伪造成果。
- 保持 CodeBuddy 默认 Runtime 与受控灰度不变。
- 每任务严格测试先行（红灯→绿灯）、独立审查、更新 `docs/progress/2026-08-21-xiaobao-runtime.md`、独立 Git 提交。

---

### Task 1: 定义沙箱工具端口与 Provider 契约

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/sandbox-tools.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/__tests__/sandbox-tools.test.ts`

**Interfaces:**
- Produces `SandboxToolClient`（execute 契约）、`SandboxToolsProvider implements ToolProvider`、工具名白名单常量。

- [x] **Step 1: 编写失败的契约测试**
  - 白名单工具映射（write_file/read_file/edit_file/run_command → write/read/edit/bash）与未知工具拒绝。
  - 客户端 `{ok:true,result}` 映射为 `XiaobaoObservation {actionId, ok:true, output}`。
  - 客户端 `{ok:false,error}`、HTTP 失败、网络异常映射为 `{ok:false, errorCode}`，不把上游正文放进观察。
  - 取消信号传播；healthCheck 转发客户端健康。
- [x] **Step 2: 运行测试并确认模块缺失（红灯）**
- [x] **Step 3: 实现最小 Provider 与白名单**
- [x] **Step 4: 绿灯 + 定向 Prettier + type-check**
- [x] **Step 5: 提交**
```bash
git commit -m "feat(agent): add sandbox tool provider"
```

---

### Task 2: 生产装配 game 工具与能力批准

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/dependencies.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/runtime.ts`
- Modify: `.env.example`

**Interfaces:**
- `createXiaobaoProductionDependenciesFactory` 根据 `XIAOBAO_SANDBOX_URL` 等配置创建/注入沙箱 Provider；无配置或健康失败 → 不注入。
- Approved skills 增加 `game: 'scratch-game-coach'`（工具可用时）。
- `resolveProductionXiaobaoCapability` 放行 `game` 仅当依赖装配含沙箱工具。

- [x] **Step 1: 写失败装配测试（红灯）**：无沙箱配置 → 不注入工具、game 拒绝；有健康假沙箱 → 注入 4 个工具 schema 且 game 放行。
- [x] **Step 2: 实现装配与批准扩展（绿灯）**
- [x] **Step 3: 受控路径集成**：注入假沙箱 + 确定性模型跑 game 任务，断言 write→run→observation→completed 且一次预留一次结算。
- [x] **Step 4: 全量验证（server test / type-check / lint / build:server）+ 提交**
```bash
git commit -m "feat(agent): enable sandbox tools for game"
```

---

### Task 3: 完整验收与文档

**Files:**
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`
- Modify: `.env.example` only if placeholders missing
- Modify: deployment docs enumerating env vars (if any)

- [x] **Step 1: 全仓相关格式化检查**
- [x] **Step 2: 全量自动化验证**
- [x] **Step 3: 安全扫描（日志静态、无凭据、无学生内容序列化）**
- [x] **Step 4: 真实沙箱门禁流程文档化（管理员步骤，不在本轮执行）**
- [x] **Step 5: 更新日志并提交**
```bash
git commit -m "docs(agent): verify xiaobao sandbox tools"
```

## Self-Review

- 范围：game 试点 + 结构固定；不含 image/video/music 外部服务、不含前端灰度切换、不含沙箱 MCP 发现。
- 一致：工具名映射、observation/errorCode、能力批准、schema 注入在任务间一致。
- 安全：沙箱凭据只在服务端；日志静态；未知工具拒绝；未装配 fail-closed。
