# 小宝 Runtime 媒体 Provider 设计（图片 / 视频 / 音乐）

**Spec 状态**：已按**火山方舟（Ark）**落地并通过测试——图片生成、视频生成（异步任务 + 轮询）、视觉理解、技能装载、能力放行、运行期守卫、前端入口映射全部完成；仅剩真实密钥下的端到端验收。

## 1. 目标与现状

**目标**：为 `image` / `video` / `music` 三个能力提供与沙箱工具**同构**的 Provider 契约与 fail-closed 生产装配。在外部媒体服务选定并配置之前，三个能力必须保持不可用，且不得出现任何假产物或空实现顶替。

**现状（已核实）**：

- 三个入口已在学生端接线，但映射为 `xiaobaoCapability: null`，因此保持默认 Runtime（设计 D4 的既定行为）。
- `XIAOBAO_PRODUCTION_CAPABILITIES` 只放行 `writing` / `learning` / `game`；资格端点据此上报能力列表。
- 三个媒体大师技能**已存在**于 `skills/`：`student-image-master`、`student-video-master`、`student-music-master`，但 `loadApprovedProjectSkills` 目前只装载 `writing` / `learning`（`game` 由 `includeGame` 开关）。
- 图片生成目前在 CodeBuddy SDK 的 CLI 子进程内部（`sandbox/tool-override.ts` patch `ImageGen.imageService` 做托管/上传），小宝 Runtime **无法复用**该 SDK 实例，需要一个独立的 HTTP 媒体服务。
- 视频（火山引擎）与音乐生成服务**尚未选型**。

## 2. 关键决策（D1–D5，均已锁定）

### D1：契约与沙箱工具同构

- `MediaToolClient`：`generate(kind, input, timeoutMs)` 与 `healthCheck()`；测试注入假客户端，**绝不访问真实媒体服务**。
- `MediaToolsProvider implements ToolProvider`，只放行白名单：`generate_image → image`、`generate_video → video`、`generate_music → music`；未知工具名在执行前静态拒绝，且不触达客户端。
- `MEDIA_TOOL_BY_CAPABILITY` 记录"能力 → 该能力必需的工具名"，供运行期守卫使用。

理由：沙箱工具链路已经过完整验收（白名单、失败脱敏、取消、健康转发），媒体走同一形状可复用全部已验证语义与测试手法。

### D2：媒体服务协议

**已选定火山方舟（Ark）**，实现见 `volcengine-media-client.ts`；通用自建服务协议保留为备选实现。

- 图片生成：`POST {baseUrl}/images/generations`（默认 `https://ark.cn-beijing.volces.com/api/v3`），
  请求体 `{ model, prompt, response_format: 'url', watermark: false, size? }`，响应 `{ data: [{ url | b64_json }] }`。
  同步接口，典型 10~15 秒；`seedream-5-0-pro` 约 2 分钟，故默认超时给到 240 秒。
- 视频生成：`POST {baseUrl}/contents/generations/tasks` 建任务，`GET {baseUrl}/contents/generations/tasks/{id}`
  轮询到 `succeeded`，取 `content.video_url`（附 `last_frame_url`）；`failed` / `expired` / `cancelled` 与轮询超时都归一化为失败。
- 视觉理解：走**对话模型**而不是媒体服务——受 `XIAOBAO_VISION_ENABLED=true` 控制，
  图片以内联 data URL 组成 `{ type: 'image_url' }` 内容块（见 §4）。
- **Ark 没有健康端点**，因此 `healthCheck` 只表示"配置完整"；密钥无效时工具仍会装配，但每次生成都会以脱敏失败结束，不会产生假产物。
- 备选通用服务协议（`XIAOBAO_MEDIA_URL` + `POST /api/media/{kind}` + `GET /health`）保留并已测试，作为自建/第三方 OpenAI 兼容服务入口；两者同时配置时**火山方舟优先**。

### D3：fail-closed（三层）

1. 配置缺失或非法 → `loadMediaToolEnvironment` 返回 `null` → **不创建客户端、不装配工具**；
2. 健康检查失败或抛错 → **不装配工具**；
3. 客户端失败（非 2xx、非 JSON、缺 `success`、`success !== true`、网络异常）→ 统一归一化为 `{ ok: false, error: '' }`，观察里只出现静态 `errorCode`（`unknown_tool` / `tool_failed` / `tool_unavailable` / `cancelled`），**不透传上游状态行、正文或异常消息**。

### D4：不改能力放行集合

真实媒体服务配置与端到端验收完成之前，`XIAOBAO_PRODUCTION_CAPABILITIES` 与资格端点**保持不变**。因此前端仍不会把三个媒体入口路由到小宝 Runtime，学生行为与今天逐字节一致。这条由测试直接锁定。

### D5：URL 校验拒绝 query / hash / userinfo

`XIAOBAO_MEDIA_URL` 只接受无 query、无 hash、且**不含用户名密码**的 http(s) 地址；把凭据塞进 baseUrl 会在日志与错误中泄露，直接在配置层拒绝。

## 3. 详细设计

### 3.1 工具与 schema

三个模型可见工具（`additionalProperties: false`，`prompt` 必填）：`generate_image`（prompt / aspectRatio / style）、`generate_video`（prompt / durationSeconds / aspectRatio）、`generate_music`（prompt / durationSeconds / lyrics）。仅当媒体服务健康时才随模型请求下发。

### 3.2 结果归一化

正常结果原样返回（模型需要地址与元信息）；序列化超过 20k 字符时降级为 `{ value, truncated: true }`，避免巨型结构进入观察、模型回放与前端渲染。

### 3.3 生产装配

`createXiaobaoProductionDependenciesFactory` 新增 `mediaClient?` 注入点，与 `sandboxClient` 完全同构：

- 显式注入优先；否则从 `XIAOBAO_MEDIA_*` 自动创建（缺配置即 `null`）；
- `DependencyIdentity` 纳入 `mediaClient`，保证缓存身份正确（**实现时踩过的坑**：缓存对象字面量若漏写该字段，`undefined !== null` 会让缓存永不命中并反复探测）；
- 健康时才把三个工具注册进 `dependencies.tools` 并把 schema 加进模型工具列表；
- 与沙箱工具相互独立：两者都健康 → 7 个工具；仅媒体 → 3；仅沙箱 → 4。

### 3.4 配置

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `XIAOBAO_MEDIA_URL` | 是 | — | 媒体服务基址，无 query/hash/userinfo |
| `XIAOBAO_MEDIA_AUTH_TOKEN` | 是 | — | Bearer 鉴权，只进入请求头 |
| `XIAOBAO_MEDIA_TIMEOUT_MS` | 否 | 120000 | 生成超时（媒体远慢于文件操作） |

## 4. 启用步骤（已全部落地）

1. ✅ 媒体服务：**火山方舟 Ark**（无需自建；通用自建协议保留为备选）。
2. ✅ 配置：`ARK_API_KEY`（必填）+ 可选的 `XIAOBAO_VOLC_BASE_URL` / `XIAOBAO_VOLC_IMAGE_MODEL` / `XIAOBAO_VOLC_VIDEO_MODEL` / 三个超时项。
3. ✅ 技能装载：`loadApprovedProjectSkills(..., { includeMedia })` 装载 `student-image-master` / `student-video-master`（技能文件本就存在）。
4. ✅ 能力放行：`xiaobaoProductionCapabilities()` 是**唯一来源**——基础能力始终放行，`image` / `video` **只在 `ARK_API_KEY` 存在时**加入；资格端点与运行期门禁共用它。
5. ✅ 运行期守卫：进入 Agent Loop 前校验该能力所需媒体工具是否存在，缺失则以静态提示拒绝（与 `game` 的技能守卫同构）。
6. ✅ 前端：`image` / `video` 入口已映射，但前端**以资格端点返回的能力清单为准**（不是只看 `eligible`），因此未配置媒体服务时这两个入口仍走默认通道，不会出现"被路由到小宝然后报错"的回归。
7. ⏳ 真实密钥下的端到端验收：真实产物、超时与失败路径、用量结算与内容安全。

**视觉理解**需要 `XIAOBAO_MODEL_*` 指向火山方舟的视觉模型，并显式设置 `XIAOBAO_VISION_ENABLED=true`；未开启时图片输入保持与今天一致的拒绝行为。

## 5. 验收与测试（已实施）

- `media-tools.test.ts`：白名单精确性、每个能力对应工具、schema 形状、逐工具路由到正确 kind、未知工具不触达客户端、失败与异常脱敏、取消、健康转发、归一化与截断。
- `media-http-client.test.ts`：env 缺省/空白/非法 URL（含 query 与内嵌凭据）/非法超时的 fail-closed、请求形状（URL、Bearer、body）、非 200 / `success:false` / 缺 `success` / 非 JSON / 网络异常的归一化、`/health` 探针（而非生成探针）、探针失败与抛错的降级。
- `media-assembly.test.ts`：未配置 → 0 个媒体工具；不健康 → 0 个；健康 → 恰好 3 个；env 自动装配并探测 `/health`；schema 随请求下发；**能力仍不可选**（锁定 D4）；沙箱与媒体相互独立（7 / 4 / 3）。

## 6. 非目标

真实媒体服务选型与实现、前端三个媒体入口的接线（属启用步骤 6）、图片编辑与视频合成等高级能力、媒体产物的存储/CDN 治理、异步长任务编排。

## 7. 风险与边界

- **同步 HTTP 的时效性**：媒体生成可能远超 120 秒。本设计的 `timeoutMs` 是注入点，若选定的服务是异步任务式（提交 + 轮询），需要在 Provider 内扩展为轮询，属启用阶段工作。
- **服务协议自定**：`/api/media/{kind}` 是本设计的约定，选定的外部服务大概率需要一层薄适配。
- **中间态风险**：见 §4 末段，这是启用时最容易出错的地方。
- **不做假 Provider**：在无凭据环境下不提供任何"永远返回空结果"或"始终允许"的实现，符合仓库既有规则。
