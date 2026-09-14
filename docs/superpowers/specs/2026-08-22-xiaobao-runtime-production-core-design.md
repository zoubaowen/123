# 小宝 Runtime 生产核心设计

## 1. 目标

在已完成的小宝 Runtime 基础内核之上，增加可用于真实环境的检查点持久化和第一个真实模型 Provider，使写作与学习任务能够在不依赖 CodeBuddy、OpenCode 或 OpenAgentKernel 的情况下运行。

本阶段不切换全体学生默认 Runtime，不接入编程沙箱，也不完成图片、视频、音乐或游戏工具。系统先通过管理员显式选择与受控灰度验证真实链路。

## 2. 范围

本阶段包含：

1. 版本化检查点 Repository 契约。
2. Drizzle/SQLite 检查点实现。
3. CloudBase 检查点实现。
4. OpenAI 兼容模型 Provider。
5. 文本回答与结构化工具调用解析。
6. 超时、取消、错误归一化和用量统计。
7. 生产依赖装配与 Runtime 可用性判断。
8. 写作和学习任务的显式灰度链路。

本阶段不包含：

- Docker 或远程沙箱。
- MinIO、S3 或 COS 作品文件 Provider。
- 图片、视频、音乐和游戏真实工具。
- Redis 多节点任务队列。
- 学生默认入口整体切换。
- 300 并发压力测试。

## 3. 方案选择

### 3.1 模型方案

采用通用 OpenAI 兼容 Provider，而不是只实现 DeepSeek 专用适配器。

原因：

- 同一实现可以连接 DeepSeek、豆包及其他兼容服务。
- 模型路由层不泄漏厂商请求和响应类型。
- 未来增加原生混元或其他协议时，只新增 Provider，不修改 Agent 循环。
- 测试可以使用本地 HTTP 模拟服务，不消耗真实 Token。

### 3.2 持久化方案

新增独立 `xiaobao_runtime_checkpoints` 数据实体，而不是把完整快照塞进现有任务记录。

原因：

- 任务元数据与高频 Runtime 快照生命周期不同。
- 独立修订号适合乐观并发控制。
- 后续可增加历史检查点、压缩和归档，不膨胀任务主表。
- CloudBase、SQLite 和未来 PostgreSQL 可以共享相同 Repository 契约。

## 4. 检查点数据模型

每个任务当前只保留一条最新检查点：

```text
xiaobao_runtime_checkpoints
├─ taskId              唯一任务标识 / 主键
├─ schemaVersion       快照结构版本
├─ revision            乐观并发修订号
├─ status              Runtime 任务状态
├─ capability          六种学生能力之一
├─ snapshotJson        完整快照 JSON
├─ createdAt           首次创建时间
└─ updatedAt           最近写入时间
```

Repository 接口：

```ts
interface XiaobaoCheckpointRepository {
  findByTaskId(taskId: string): Promise<XiaobaoCheckpointRecord | null>
  create(record: XiaobaoCheckpointRecord): Promise<void>
  updateIfRevision(input: {
    taskId: string
    expectedRevision: number
    next: XiaobaoCheckpointRecord
  }): Promise<boolean>
}
```

`CheckpointStore.save(snapshot)` 行为：

1. 不存在记录时创建。
2. 已存在时必须满足当前数据库修订号等于待写入快照的前一修订号。
3. 条件更新失败时抛出稳定的 `Xiaobao checkpoint conflict`。
4. 相同修订号和完全相同快照重复写入视为幂等成功。
5. 读取后使用 Zod 校验快照，损坏或未知结构不得交给 Agent 循环执行。

## 5. 数据库实现

### 5.1 Drizzle/SQLite

- 在现有 Drizzle schema 中增加检查点表。
- 通过单条带 `taskId + revision` 条件的更新实现乐观锁。
- 测试使用临时 SQLite 数据库或现有 Repository 测试工厂。
- 新增迁移文件，不修改或清空已有表。

### 5.2 CloudBase

- 使用独立集合 `xiaobao_runtime_checkpoints`。
- `taskId` 建立唯一索引；部署文档中记录索引要求。
- 条件更新使用现有 CloudBase Repository 模式，更新后检查影响数量。
- 错误日志只使用静态文本，不输出 taskId、快照、凭证或数据库响应。

### 5.3 未来 PostgreSQL

正式 PostgreSQL 继续使用 Drizzle Repository 契约。数据库方言差异限制在驱动和迁移层，不进入 `CheckpointStore`、Agent 循环或前端。

## 6. OpenAI 兼容模型 Provider

环境配置：

```text
XIAOBAO_MODEL_BASE_URL
XIAOBAO_MODEL_API_KEY
XIAOBAO_MODEL_ID
XIAOBAO_MODEL_NAME
XIAOBAO_MODEL_TIMEOUT_MS
XIAOBAO_MODEL_CONTEXT_WINDOW
```

除 `XIAOBAO_MODEL_API_KEY` 外均提供安全默认或显式不可用状态。密钥不得返回前端、写入数据库、错误消息或日志。

请求使用 `POST {baseUrl}/chat/completions`，包含：

- system：小宝儿童安全约束与大师 Skill 指令。
- user：学生当前要求。
- assistant/tool：已完成观察的压缩表示。
- model：配置的模型 ID。
- tools：本轮可用工具的 JSON Schema。
- tool_choice：`auto`。

响应归一化为基础内核已有的三种结果：

```ts
type ModelResponse =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; action: XiaobaoAction }
  | { kind: 'complete'; text: string }
```

判定规则：

- 存在合法 `tool_calls[0]` 时返回 `tool`。
- 纯文本且模型显式给出完成标志时返回 `complete`。
- 普通过程文字返回 `text`。
- 第一版通过结构化响应字段而非关键词猜测完成状态。
- 非法 JSON 参数、空响应或未知结束原因返回归一化错误，不调用工具。

## 7. 完成状态协议

为避免用自然语言猜测“是否完成”，Provider向模型暴露内部工具 `xiaobao_complete`：

```text
xiaobao_complete({ text: string })
```

该工具不执行外部操作。Provider把它转换为 `{ kind: 'complete', text }`。其他工具调用转换为 `{ kind: 'tool', action }`。

写作和学习任务如果没有外部工具，也必须最终调用 `xiaobao_complete`，从而让Agent循环可靠结束。

## 8. 超时、取消与错误

- 每次模型请求使用组合 `AbortSignal`，同时响应用户取消和 Provider 超时。
- HTTP 401/403 → `Xiaobao model authentication failed`。
- HTTP 429 → `Xiaobao model rate limited`，标记可重试。
- HTTP 5xx → `Xiaobao model unavailable`，标记可重试。
- 超时 → `Xiaobao model timeout`，标记可重试。
- 响应格式错误 → `Xiaobao model response invalid`，默认不可盲目重试。
- 对学生展示适龄中文提示；内部错误代码保持稳定，日志不包含响应正文。

基础内核当前只对工具做单次重试。本阶段增加模型错误分类，但模型重试策略保留给后续模型路由计划，避免本阶段扩大范围。

## 9. 用量统计

Provider从兼容响应的 `usage` 读取：

- `prompt_tokens`
- `completion_tokens`
- `total_tokens`

缺失时记录“未知”，不得伪造为零。Provider返回用量元数据，Agent循环通过 `UsageProvider.record` 记录真实值。本阶段只统计 Token，不实现货币换算；价格路由属于后续成本计划。

## 10. 生产依赖装配

新增小宝 Runtime 生产依赖工厂：

```text
环境配置
  → 数据库 CheckpointStore
  → OpenAICompatibleModelProvider
  → 生产 SkillProvider
  → 现有安全与用量适配
  → XiaobaoRuntime
```

可用性要求：

- 模型配置完整。
- 模型健康检查成功或最近一次缓存结果仍在有效期。
- 数据库可读写。
- 六个大师 Skill 中至少写作与学习可加载。

任何一项失败时，`xiaobao` 保持不可用，不影响 CodeBuddy 或 OpenCode。

## 11. 灰度策略

第一步只允许管理员或测试任务显式选择 `xiaobao`。写作与学习能力可运行真实文本闭环；其他四种能力返回“工具尚未接入”的明确状态，不回传伪造作品。

通过以下门禁后，才允许逐班开启：

1. 连续真实任务无检查点损坏。
2. 服务重启后任务可恢复。
3. 401、429、超时和格式错误均有正确提示。
4. Token 用量能够写入且不泄漏密钥。
5. 写作与学习大师 Skill 行为符合既有防代写要求。

## 12. 测试与验收

自动化测试：

- Drizzle创建、读取、条件更新、冲突和幂等。
- CloudBase Repository 使用完整响应形状的边界测试。
- 快照Zod校验与损坏数据拒绝。
- 模型请求头、URL、消息、工具Schema和取消信号。
- 文本、完成工具、普通工具、空响应、非法参数和HTTP错误映射。
- API密钥不出现在错误对象、日志捕获或序列化快照中。
- Runtime可用性与旧Runtime默认保护。

集成验收：

- 使用本地模拟HTTP模型服务完成真实网络请求，不消耗Token。
- 使用测试数据库执行保存、进程级重建、读取和继续任务。
- 有真实API密钥时执行一次最小写作或学习任务，记录模型、Token和结果，不记录密钥。
- 学生入口灰度接线完成前没有新增浏览器行为；灰度完成后必须在浏览器提交、观察流式过程、刷新、恢复并查看结果。

## 13. 日志与提交

继续更新 `docs/progress/2026-08-21-xiaobao-runtime.md`。每个独立任务完成后记录红灯、绿灯、文件、验证、已知限制、提交编号和下一步，并创建独立Git提交。

