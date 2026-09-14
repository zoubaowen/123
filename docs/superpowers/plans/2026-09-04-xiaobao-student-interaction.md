# 小宝 Runtime 学生交互实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为小宝 Runtime 补齐学生交互闭环：模型经 `xiaobao_ask` 表达提问 → Agent Loop 暂停为 `waiting_for_student` 并持久化待答 → 学生答案经 `askAnswers` 恢复注入 → 继续推进到完成。

**Architecture:** 复用既有 `xiaobao_complete` 对称协议、`ask_user` 事件桥与 `AgentOptions.askAnswers`。OpenAI 兼容层新增保留工具 `xiaobao_ask`；Agent Loop 新增 waiting 暂停与恢复分支；快照新增可选 `pendingQuestion`。

**Spec:** `docs/superpowers/specs/2026-09-04-xiaobao-student-interaction-design.md`

## Global Constraints

- 日志只允许静态字符串；不得输出学生答案、提问原文或敏感标识。
- schemaVersion 保持 1：`pendingQuestion` 可选、旧快照缺省 null。
- `ask` 轮不结算用量；未完成前保留预算预留。
- 保持 CodeBuddy 默认 Runtime 与受控灰度不变。
- 每任务测试先行、独立审查、更新 `docs/progress/2026-08-21-xiaobao-runtime.md`、独立提交。

---

### Task 1: Provider 解析 xiaobao_ask

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/openai-compatible-provider.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/ports.ts`（ModelResponse 加 `kind:'ask'`）
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/openai-compatible-provider.test.ts`

- [x] Step 1: 失败测试：`xiaobao_ask` tool call → kind 'ask'；非法结构拒绝；保留名冲突构造拒绝。
- [x] Step 2: ports 加 `ask` kind；provider 加保留工具与解析。
- [x] Step 3: 绿灯 + 定向 Prettier + type-check。
- [x] Step 4: 提交 `feat(agent): parse xiaobao ask tool calls`

### Task 2: Agent Loop waiting 暂停与恢复

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/domain.ts`（pendingQuestion 可选字段）
- Modify: `packages/server/src/agent/xiaobao-runtime/agent-loop.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/state-machine.ts`（如需）
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts`

- [x] Step 1: 失败测试：ask 轮置 waiting + pendingQuestion + 事件且不结算；无答案恢复幂等；有答案恢复注入观察继续。
- [x] Step 2: loop 实现 ask 分支与恢复（答案经 run 参数传入——需在 run 接口增加可选 askAnswers 或经 request 携带）。
- [x] Step 3: 绿灯 + 回归。
- [x] Step 4: 提交 `feat(agent): wait and resume for student answers`

### Task 3: runtime askAnswers 接线与受控路径

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/runtime.ts`
- Test: `packages/server/src/agent/xiaobao-runtime/__tests__/runtime.test.ts`、`sandbox-controlled-path.test.ts`

- [x] Step 1: 失败测试：chatStream 携带 askAnswers 恢复 waiting 任务；缺答案不调模型。
- [x] Step 2: runtime 从 options.askAnswers 取答案传给 loop。
- [x] Step 3: 受控路径：writing/learning 完整"提问→作答→完成"一次预留一次结算。
- [x] Step 4: 全量验证 + 提交 `feat(agent): resume xiaobao turns with student answers`

### Task 4: 完整验收与文档

- [x] Step 1: 全量 server test / type-check / lint / build:server。
- [x] Step 2: 安全扫描（日志静态、无答案泄出）。
- [x] Step 3: 更新进度日志并提交 `docs(agent): verify xiaobao student interaction`
