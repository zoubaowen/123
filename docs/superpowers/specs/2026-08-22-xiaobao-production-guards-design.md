# 小宝 Runtime 生产安全、用量与 CloudBase 就绪设计

## 1. 目标

为小宝 Runtime 增加三项缺失的生产门禁：腾讯云文本内容安全审核、可重试且不会重复扣费的用量账本，以及 CloudBase 无残留读写就绪检查。三项全部就绪后，管理员和服务端测试任务才能进入现有小宝灰度链路；任一门禁失败时，小宝保持不可用，CodeBuddy 与 OpenCode 不受影响。

本阶段只覆盖写作与学习文本任务，不开放图片、视频、音乐、游戏或编程沙箱。

## 2. 设计原则

- 儿童安全优先：不确定、超时、鉴权失败和响应损坏全部 fail closed。
- 不让生成模型审核自己：安全审核使用独立腾讯云 TMS 服务。
- 不重复扣费：任务重试、断线恢复、服务重启和并发提交必须复用同一用量预留。
- 不制造探活垃圾：数据库可写就绪必须在事务中验证并回滚。
- 不泄露学生内容：不记录审核原文、学生标识、模型密钥、腾讯云密钥或上游原始响应。
- 保持可扩展：未来媒体和沙箱沿用同一用量账本，只扩展计价策略与类别。

## 3. 方案比较与选择

### 方案 A：现有余额函数直接扣费

实现最少，但现有冻结、流水和结算不是一个跨 Provider 原子事务。服务崩溃或重复请求可能产生重复冻结、余额与流水不一致，不满足小宝 UsageProvider 的幂等契约。

### 方案 B：小宝专用幂等预留账本（采用）

新增用量预留记录，以 `taskId + category` 为唯一业务键。预留、余额冻结、实际结算、差额释放与流水写入均由数据库 Provider 的事务能力完成。它能明确表达 `reserved / settled / released` 生命周期，并可在进程重启后继续。

### 方案 C：完全依赖外部中央计费服务

适合未来多地域和多产品统一结算，但当前仓库同时支持本地 Drizzle 与 CloudBase，中央服务也没有提供完整的预留/结算协议。现在引入会扩大部署依赖，留作规模化阶段演进方向。

## 4. 安全审核架构

### 4.1 两层审核

`ProductionSafetyProvider` 按固定顺序执行：

1. 本地确定性规则：检查空文本、长度、明显的个人敏感信息索取、色情、暴力、自伤、违法和绕过安全指令。
2. 腾讯云 TMS `TextModeration`：审核通过本地规则的文本，使用 `Type=TEXT`，内容以 UTF-8 Base64 发送。

本地规则只处理高置信度硬拦截，不尝试替代云端语义判断。规则只返回儿童友好的静态原因，不返回命中词、风险分数或供应商标签。

### 4.2 TMS 结果映射

- 明确通过：`{ allowed: true }`。
- 明确拒绝或建议复审：`{ allowed: false, reason: <静态儿童提示> }`。
- 429、5xx、网络失败、超时、鉴权失败、未知建议或响应损坏：抛出内部 `SafetyProviderUnavailableError`，Agent Loop 映射为静态“安全检查暂时不可用”，不得继续调用模型。

一次请求最多审核 10,000 个 Unicode 字符。超过限制由本地层直接拒绝，不拆段后分别放行，避免失去上下文。

### 4.3 凭证与配置

新增服务器环境变量：

```text
XIAOBAO_TMS_SECRET_ID
XIAOBAO_TMS_SECRET_KEY
XIAOBAO_TMS_TOKEN
XIAOBAO_TMS_REGION
XIAOBAO_TMS_BIZ_TYPE
XIAOBAO_TMS_TIMEOUT_MS
```

Secret ID、Secret Key 与临时 Token 不复用前端配置，不出现在 `.env.example` 的真实值、错误、日志、数据库或响应中。调用优先使用腾讯云官方 Node SDK；若仓库已有兼容的腾讯云签名客户端，则复用其凭证抽象，但 TMS 响应解析仍封装在独立 Provider 内。

## 5. 幂等用量账本

### 5.1 数据模型

新增 `xiaobao_usage_reservations`：

```text
id                    string primary key
taskId                string
userId                string
category              model | tool | sandbox | media
reservedUnits         positive integer
settledUnits          non-negative integer | null
status                reserved | settled | released
creditCostReserved    non-negative integer
creditCostSettled     non-negative integer | null
createdAt             timestamp
updatedAt             timestamp
settledAt             timestamp | null
```

业务唯一约束为 `taskId + category`。重复预留只有在 `userId`、`category` 和 `reservedUnits` 完全一致时返回原 reservation；任一字段冲突都抛静态冲突错误。

信用流水使用稳定 ID `xiaobao:<reservationId>:reserve`、`xiaobao:<reservationId>:settle` 和 `xiaobao:<reservationId>:release`，数据库层必须拒绝重复 ID，以形成第二层幂等保护。

### 5.2 计价

本阶段只为 `model` 类别启用生产结算：

- `reserve()` 使用配置的每任务最大 Token 预算换算为最大积分并冻结。
- `record()` 使用模型返回的实际 `totalTokens` 换算最终积分。
- 最终积分不得超过已预留积分；超过表示配置或调用契约错误，任务进入可恢复错误，不自动追加扣费。
- 最终积分小于预留时释放差额；为零时全部释放。
- 没有精确 Token 时沿用 Agent Loop 已定义的执行轮次回退单位，再通过同一计价器结算。

计价配置使用正整数，避免浮点误差：

```text
XIAOBAO_MODEL_TOKENS_PER_CREDIT
XIAOBAO_MODEL_MAX_CREDITS_PER_TASK
```

积分计算为 `ceil(units / tokensPerCredit)`，并受最大任务积分约束。

### 5.3 原子事务

新增数据库端口 `XiaobaoUsageLedgerRepository`，暴露：

```ts
reserve(input: UsageReservationLedgerInput): Promise<UsageReservationLedgerResult>
settle(input: UsageSettlementLedgerInput): Promise<void>
release(reservationId: string, reason: 'safety_denied' | 'runtime_failed'): Promise<void>
healthCheck(): Promise<boolean>
```

Drizzle 与 CloudBase 分别在单个事务内完成余额、冻结余额、预留记录和信用流水更新。任何一步失败必须整体回滚。业务服务不得用现有 `freezeCredits()` 与 `unfreezeCredits()` 拼接事务。

### 5.4 失败恢复

- 安全审核拒绝发生在额度预留前，不产生用量记录。
- 预留成功后服务崩溃，任务恢复时复用原 reservation。
- 模型失败时保留 reservation 供可恢复任务继续；任务进入不可恢复终态时释放 reservation。
- `record()` 成功后重复执行只核对相同结算内容，不再次修改余额或流水。

## 6. CloudBase 无残留读写就绪

CloudBase Provider 使用服务端事务：

1. `startTransaction()`。
2. 在 `xiaobao_runtime_checkpoints` 中写入随机且带固定探活前缀的临时文档。
3. 在同一事务读取并验证该文档。
4. `rollback()`。
5. 在事务外按临时 ID 查询，确认文档不存在。

只有写入、事务内读取、回滚和事务外无残留四步全部成功，才返回 `{ readable: true, writable: true }`。任何异常都尽力回滚并返回不可用；不记录临时 ID、环境 ID或原始错误。

探活结果包含成功和失败短 TTL，并共享 in-flight Promise，防止未认证的 Runtime 列表接口放大数据库费用。探活不得创建集合或修改 ACL；所需集合必须由部署迁移预先创建。

## 7. 生产装配与可用性

新增 `createXiaobaoProductionAdapters()`，只在以下条件完整时返回适配器：

- TMS 配置完整。
- 用量计价配置完整。
- `XiaobaoUsageLedgerRepository.healthCheck()` 成功。
- Checkpoint Repository 读写就绪成功。

服务器启动时把生产 SafetyProvider 与 UsageProvider 注册到现有 `configureXiaobaoProductionAdapters()`。不得注册 noop、测试 Provider、无限额度或永远允许实现。

`xiaobaoRuntime.isAvailable()` 仍同时要求模型健康、数据库、两个大师 Skill 和生产适配器全部成功。默认 Runtime 保持 CodeBuddy，现有管理员/测试任务灰度策略不改变。

## 8. 安全、隐私与日志

- 日志只允许静态字符串。
- 不记录审核原文、TMS 标签/分数、学生 ID、任务 ID、reservation ID、余额、Token 数或任何动态错误正文。
- TMS 上游错误只映射为内部稳定错误码。
- 数据库记录只保存用量与结算元数据，不保存学生 prompt。
- API Key、Secret、Token 只从服务端环境读取，禁止返回前端。

## 9. 测试与验收

### 自动化测试

- 本地安全规则的允许、拒绝、长度和隐私边界。
- TMS 允许、拒绝、复审、429、5xx、超时、鉴权失败、损坏响应与取消。
- 捕获日志和序列化错误，证明凭证、原文和上游正文不泄露。
- Drizzle/CloudBase 用量预留的首次、完全相同重放、冲突重放、余额不足、并发预留、精确结算、差额释放和重复结算。
- 事务任一步失败时余额、冻结余额、预留和流水全部回滚。
- CloudBase 可写探活成功、写失败、读失败、回滚失败和事务外残留检测。
- 成功/失败 TTL 与并发 in-flight 去重。
- 生产装配在任何配置或门禁缺失时不可用，完整依赖下仅管理员/测试任务灰度可用。

### 完整验证

- 服务端完整测试。
- `pnpm type-check -- --incremental false`。
- `pnpm lint`。
- `pnpm build:server`。
- 变更日志、密钥和动态日志扫描。

### 真实灰度验收

- 使用腾讯云测试策略审核一条适龄文本和一条明确不适龄文本。
- 使用测试学生余额执行一次最小写作任务，确认只生成一条 reservation 和一组结算流水。
- 中途断开并刷新，确认恢复后不重复冻结或扣费。
- 所有验收记录只保存静态结论与内部测试编号，不保存学生原文或密钥。

## 10. 已知边界

- 腾讯云 TMS 是外部付费依赖；不可用时小宝 fail closed，但 CodeBuddy/OpenCode 保持原行为。
- 本阶段不统一改造现有全站积分函数，只新增小宝事务账本；后续验证成熟后再评估迁移其他媒体和沙箱消费。
- 本阶段不开放普通学生班级灰度，也不实现教师端开关。
