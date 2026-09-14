# 小宝 Runtime 真实工具接入设计（能力集扩展第一步）

## 1. 目标与现状

小宝 Runtime（`packages/server/src/agent/xiaobao-runtime/`）已完成生产化内核：持久化检查点、OpenAI-compatible 模型、双层安全（本地规则 + 腾讯云 TMS）、双数据库事务用量账本、生产适配器装配与受控灰度。当前生产装配**只放行写作与学习**两种纯文本能力；`image / video / music / game` 在工具未接入前返回明确静态提示，不伪造成果。

本设计解决第一步缺口：**为 Runtime 装配真实工具执行通道**，使至少一种创作能力（以 game 为试点）通过真实工具完成"产出 → 验证 → 交付"，并把其余媒体能力的工具接入结构固定下来。

## 2. 关键现状（已核实）

- Runtime 领域已完整支持工具调用：`XiaobaoAction` / `XiaobaoObservation` / `ToolProvider` / `tool_started` / `tool_finished` / `artifact` 事件，Agent Loop 具备单次重试与观察落盘。
- OpenAI-compatible Provider 已支持 `config.tools` 注入工具 JSON Schema，且保留 `xiaobao_complete` 完成协议名。
- **缺口在装配层**：`dependencies.ts: assembleDependencies()` 中 `tools: new Map()`，生产实例没有任何 ToolProvider。
- 仓库已有真实沙箱工具 HTTP 通道：`POST {sandboxBase}/api/tools/{bash|read|write|edit|glob|grep}`，响应 `{ success, result | error }`；被 git-archive、sandbox-mcp-proxy、tasks 路由真实使用，经 `SandboxInstance.request()` 携带鉴权头。
- 图片生成（ImageGen）在 CodeBuddy SDK 内部（CLI 子进程 imageService），小宝 Runtime 无法复用其 SDK 实例，需要独立 HTTP 图片服务（如 CloudBase AI 或自选端点），属后续媒体 Provider 工作。

## 3. 试点选择：game（Scratch 游戏）

- 前端 `student-capabilities.ts` 已将 `game` 标记 `toolState: 'available'`、`skillName: 'scratch-game-coach'`；技能文件在 `skills/scratch-game-coach/SKILL.md` 且已提交。
- scratch 游戏产物 = 项目目录 + 代码文件 + 运行验证，全部可由沙箱文件/命令工具真实完成，**无需新的外部媒体服务**，是最低外部依赖的真实闭环。
- 沙箱通道尚未装配时保持 fail-closed：`tools` 为空 → 模型请求工具时返回"所需工具不可用"终态（Agent Loop 既有分支），不会伪造。

## 4. 设计

### 4.1 ToolProvider 装配

新增沙箱工具 Provider，把 HTTP 通道适配成 Runtime 的 `ToolProvider` 契约：

```ts
export interface SandboxToolClient {
  execute(tool: string, input: unknown, timeoutMs: number): Promise<{ ok: true; result: unknown } | { ok: false; error: string }>
}

export class SandboxToolsProvider implements ToolProvider {
  readonly name = 'sandbox_tools'
  constructor(private readonly client: SandboxToolClient) {}
  healthCheck(): Promise<boolean>
  execute(input: ToolExecutionRequest, signal: AbortSignal): Promise<XiaobaoObservation>
}
```

执行映射（只允许白名单工具，防止任意工具名穿透）：

| Runtime 工具名 | 沙箱端点 | 输入 |
| --- | --- | --- |
| `write_file` | `write` | path/content |
| `read_file` | `read` | path/offset/limit |
| `edit_file` | `edit` | path/oldString/newString/replaceAll |
| `run_command` | `bash` | command/timeout |

- 401/403、非 2xx、`success:false`、超时、网络错误统一映射为 `XiaobaoObservation { ok:false, errorCode }`，不透传上游正文或响应体到日志。
- 客户端通过构造注入，生产用真实 HTTP 客户端（复用沙箱 URL + 鉴权头），测试用注入假客户端，不访问真实沙箱。
- 工具 schema 经 `config.tools` 注入 OpenAI-compatible Provider；`run_command` 明确提示模型不得输出敏感命令（静态字符串由 Agent 循环选择）。

### 4.2 能力批准扩展

- `resolveProductionXiaobaoCapability` 放行集合由 `['writing','learning']` 扩展为按装配配置决定：无工具能力（writing/learning）直接放行；工具能力（game 试点）仅当 `dependencies.tools` 包含对应 Provider 且健康检查通过时放行。
- `loadApprovedProjectSkills` 增加 game 技能加载（名称 `scratch-game-coach`，质量门禁沿用 SKILL.md）。
- 未装配沙箱时 `game` 维持现有"工具尚未接入"静态提示；装配后经管理员/白名单任务灰度验证，**不切换默认 Runtime**。

### 4.3 用量与安全

- game 的模型用量走既有 `category:'model'` 账本；沙箱执行如需计费，沿用 `category:'sandbox'` 预留（当前账本已支持该枚举，先按 0 计价/仅记账，不引入新计价维度）。
- 学生提示词在进入沙箱工具前仍经 `ProductionSafetyProvider`（本地规则 + TMS），沙箱内命令不受信任、不可读敏感环境。

## 5. 验收与测试

- Provider 单测：白名单拒绝、HTTP 错误归一化、假客户端成功/失败路径、取消传播。
- 受控路径：注入假沙箱客户端 + 确定性模型，完整跑通 game 任务（写文件 → 运行命令 → observation 落盘 → completed），断言一次预留一次结算。
- 装配测试：未配置沙箱 URL/健康检查失败时 `game` 保持不可用、不注入工具 schema；配置健康时 schema 注入且能力放行。
- 真实环境门禁（有沙箱凭据后执行）：生成一个真实 Scratch 项目并运行/预览验证，不作为本轮本地验收项。

## 6. 非目标（本阶段不做）

- video（火山引擎）与 music（待选服务）真实接入。
- image 独立图片服务客户端（ImageGen 不在 Runtime 内核内）。
- 学生前端六入口灰度切换 UI 与浏览器端到端验收（另行计划）。
- 沙箱内 MCP/CloudBase 工具发现（沙箱 mcp-proxy 属旧 Runtime 链路）。

## 7. 配置项

新增服务端环境变量（可选，缺省 = 不装配、fail-closed）：

```text
XIAOBAO_SANDBOX_URL=
XIAOBAO_SANDBOX_SESSION_ID=
XIAOBAO_SANDBOX_AUTH_TOKEN=
```
