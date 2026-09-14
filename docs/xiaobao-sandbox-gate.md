# 小宝 Runtime 真实沙箱门禁流程（受控验收，需真实凭据）

> 状态：代码装配与受控路径测试已完成（46 文件 / 513 测试全绿）。本文档定义在真实沙箱环境下的**管理员受控验收步骤**。执行前必须确认已获得真实沙箱凭据与显式授权；缺少任一项时小宝 game 能力维持不可用（fail-closed），写作与学习不受影响。

## 前置条件

- 已部署小宝 Runtime 生产装配（`codex/teacher-course-management` 分支，含 Task 1/2）。
- 服务端环境已配置：

```text
XIAOBAO_SANDBOX_URL=https://<scf-sandbox-host>     # 沙箱 /api/tools 基址
XIAOBAO_SANDBOX_SESSION_ID=<scf-session-id>
XIAOBAO_SANDBOX_AUTH_TOKEN=<scf-access-token>
```

- 模型与生产守卫配置齐全（`XIAOBAO_MODEL_*`、`XIAOBAO_TMS_*`、账本 Pricing）。
- 有管理员账号（role=admin）可显式选择 `xiaobao` runtime。

## 验收用例

### 1. 装配健康检查（无学生流量）

- 触发一次小宝依赖装配（例如管理员发送任意 writing 任务），观察服务端日志静态确认沙箱 healthCheck 通过。
- 期望：`dependencies.tools` 含 `write_file / read_file / edit_file / run_command` 四项；`skills` 可解析 `game -> scratch-game-coach`。

### 2. game 最小可玩闭环（管理员白名单任务）

1. 管理员新建任务，显式选择 `xiaobao` runtime 与 `game` capability，提示词如"做一个接星星的小游戏"。
2. 期望链路（仅核对真实产物，不核对模型具体输出）：
   - 模型至少一次请求 `write_file` 写入项目文件 → 沙箱真实落盘。
   - 模型至少一次请求 `run_command`（安装/启动/校验）→ 返回真实退出码与输出。
   - 任务最终 `completed`，账本恰好 1 条 model 预留 + 1 条结算。
3. 产物可访问性：沙箱内项目目录出现学生任务隔离目录；文件可读回。

### 3. 安全与 fail-closed 复验

- 未配置 `XIAOBAO_SANDBOX_*` 时：game 请求返回"游戏创作需要连接创作沙箱"，不进入 Agent Loop、不产生账本预留。
- 沙箱 URL 故意填错时：装配 health 失败 → 依赖不注入工具 → 同上静态提示（不伪造可用）。

### 4. 回归

- 写作、学习任务在沙箱装配后行为不变（纯文本，不触发沙箱）。
- 服务端全量测试 46 文件 / 513 测试通过；type-check / lint / build:server 通过。

## 记录与回滚

- 每次门禁执行后把真实结果（用例、通过/失败、异常文本不含凭据）记录到 `docs/progress/2026-08-21-xiaobao-runtime.md`。
- 若真实沙箱暴露问题：修复走独立提交；回滚只需移除 `XIAOBAO_SANDBOX_*` 环境变量即可让 game 回到不可用。
