# 小宝 Runtime 学生交互（waiting_for_student）设计

## 1. 目标与现状

写作与学习大师技能的核心是**交互式辅导**：先向学生提问（discover 阶段 2–4 个关键问题；学习辅导"一次一个问题、等待作答后再继续"），再据回答推进。当前小宝 Runtime 的 Agent Loop 一次跑到终态（completed/failed/cancelled），从不进入 `waiting_for_student`——模型只能把提问当普通文字输出后直接结束或自行续答，无法真正"等学生回答再继续"。domain、状态机与事件桥已定义 `waiting_for_student`，但 Agent Loop 未实现该路径。

本设计补齐学生交互闭环，使写作/学习任务可"提问 → 暂停等待 → 学生作答 → 恢复推进"。

## 2. 关键现状（已核实）

- 状态机已支持：`requirements → waiting_for_student`、`waiting_for_student → requirements | running`，以及 `created → safety_check → requirements → planned → running → waiting_for_student → quality_check → …` 主流程。
- 事件桥已支持：`waiting_for_student` 事件 → `ask_user` 回调（`events.ts: case 'waiting_for_student'`）。
- 协议已支持：`AgentOptions.askAnswers?: { [assistantMessageId]: { toolCallId, answers } }`（shared agent.ts）；`AgentCallbackMessage` 含 `ask_user`；ACP `AskUserUpdate` 已存在。CodeBuddy 运行时已用同一套 AskUserQuestion 链路。
- **缺口**：Agent Loop 无"发出提问并暂停"的分支；runtime 无"注入学生回答并恢复"的逻辑；快照无提问/待答上下文。

## 3. 方案比较与选择

### 方案 A：模型输出 kind 'ask'（采用）

给模型响应类型增加 `{ kind: 'ask'; question: { header, questions, toolCallId } }`（OpenAI 兼容层用保留工具名 `xiaobao_ask` 表达，与 `xiaobao_complete` 对称）。Agent Loop 收到 `ask`：
- 把快照置 `waiting_for_student`，保存 `pendingQuestion`（header/questions/toolCallId），持久化检查点；
- 发出 `waiting_for_student` 事件（桥接为 `ask_user` 回调），**暂停本轮**，返回非终态。

优点：模型显式表达提问意图，与现有完成协议完全对称；确定性高；前端复用既有 ask_user 渲染与 askAnswers 提交。

### 方案 B：requirements 阶段规则化提问

由 skill 元数据驱动 loop 在 requirements 阶段强制先问固定问题。缺点：问题不可由模型按学生描述动态生成，交互生硬；且无法表达"追问"。

### 方案 C：普通文字 + 前端启发式

模型用普通 text 提问，前端启发式判断后展示输入框。缺点：不可靠、无法结构化恢复。

采用**方案 A**。

## 4. 设计

### 4.1 模型协议（OpenAI 兼容层）

保留工具名 `xiaobao_ask`（与 `xiaobao_complete` 并列保留）：

```jsonc
// tool schema
{ "name": "xiaobao_ask", "parameters": {
    "type": "object",
    "properties": {
      "header": { "type": "string" },          // 提问主题（如 "游戏主题"）
      "questions": { "type": "array", "items": { "type": "string" } } // 本次要问的 1–N 个问题
    },
    "required": ["header", "questions"], "additionalProperties": false
} }
```

Provider 解析 `tool_call` 名为 `xiaobao_ask` 时产出 `{ kind: 'ask', header, questions, toolCallId }`。`xiaobao_ask` 同样禁止出现在外部注入工具中。

### 4.2 Agent Loop

- 快照新增可选字段 `pendingQuestion?: { toolCallId, header, questions } | null`（schemaVersion 维持 1，旧快照缺省 null）。
- 主循环遇到 `response.kind === 'ask'`：
  1. 快照置 `waiting_for_student` 并写入 `pendingQuestion`；保存检查点。
  2. 发出 `waiting_for_student` 事件（含 header/questions/toolCallId），返回非终态（不结算用量）。
- 恢复（下一轮 `run` 时快照处于 `waiting_for_student`）：
  1. 从 `options.askAnswers` 按 `assistantMessageId`（= turnId）与 `toolCallId` 取出 answers。
  2. 无答案 → 停留在 waiting（幂等重发事件），不消耗模型。
  3. 有答案 → 清 `pendingQuestion`，把答案作为一条 observation（toolName `xiaobao_ask`）加入观察历史，状态转 `requirements`（或 `running`）继续；随后模型请求带该观察。

### 4.3 用量与安全

- `ask` 轮不调用 `usage.record`（无最终结算）；已预留 budget 保留到真正完成。
- 提问文本在发出前仍处于受控生成（模型经安全审核的对话中），恢复后学生答案作为观察进入下一轮上下文——与工具观察同路径，不需额外安全门禁（学生答案来自本端）。

### 4.4 事件与前端

- 事件桥 `waiting_for_student` → `ask_user` 回调（已实现，补 `answers`/toolCallId 字段透传）。
- 恢复请求由前端 session/prompt 携带 `askAnswers`（既有协议）。

## 5. 验收与测试

- Provider：解析 `xiaobao_ask` tool call → kind 'ask'；拒绝保留名冲突；非法结构拒绝。
- Agent Loop：ask 轮把快照置 waiting_for_student + pendingQuestion 持久化 + 发事件且不结算；无答案恢复幂等重发；有答案恢复注入观察并继续到完成。
- runtime：chatStream 携带 askAnswers 时恢复；缺 answers 不调模型。
- 受控路径：writing/learning 任务完整走"提问→暂停→作答→完成"，一次预留一次结算。
- 全量回归 + type-check + lint + build。

## 6. 非目标（本阶段不做）

- 多轮自由对话式的长期教学会话编排（如"讲解后学生自由追问"的无限循环状态机）。
- 前端 ask_user 卡片 UI 改动（复用既有 CodeBuddy ask_user 渲染）。
- 视频/音乐等其他能力的交互式门禁。

## 7. 边界与风险

- schemaVersion 不升级：`pendingQuestion` 为可选字段，旧快照解析兼容；但恢复逻辑需处理"旧快照在 running 但语义上在等待"的边界（不引入新版本）。
- `waiting_for_student` 长时间无应答：任务保持 waiting 状态；由外部（教师/超时策略）决定，本阶段不引入自动超时。
