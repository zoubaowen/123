# 课包内容管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务逐项执行，用复选框（`- [ ]`）跟踪进度。每个任务都必须先写失败测试。

**Goal:** 让机构管理员在界面上**从零建出课包内容**（课程 → 章节 → 课时 → 资源），
从而不必再靠 SQL 种数据就能走完「建课包 → 关联班级 → 开课」。

**Background（为什么单独排一份计划）:** 上一份计划（`2026-09-15-teacher-admin-ui.md`）把教师端与后台的
管理界面补齐了，但**课包内容只有只读接口**：`courses` / `course_chapters` / `course_lessons` /
`lesson_resources` 四张表与仓储在 Task 9 就建好了，`GET /api/teacher/courses` 也能读，
但**没有任何写接口**，设计文档也把"课程内容生产"列为明确不做。结果是：
机构建好、班级建好、学生加好，**却无课可开**——两次端到端验收都是我用 SQL 种一节课时才跑通的。
这是当前教师端闭环最后一个硬缺口。

**Architecture:** 沿用既有 `/api/teacher` 路由与 `CourseRepository`（`db/types.ts` 里的课程聚合仓储：
章节/课时/资源没有独立生命周期，按聚合边界收在一个仓储里）。写入权限沿用既有口径：
**课包是机构级资源（设计文档 D6），因此只有机构 owner/admin 能改**；lead 老师可以关联已有课包到自己的班，
但不能编辑课包内容（避免不同班的老师互相改同一份课包）。

**Tech Stack:** Hono、Drizzle（SQLite）+ CloudBase 双 Provider、Vitest、React 19、Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-14-teacher-class-model-design.md`（D6 课程与课时、§10 明确不做）

## 已确认的口径

- 课包（课程）属于机构；章节、课时、资源属于课程，只能通过课程聚合读写。
- 数组字段（目标、步骤、提示、capabilities、skills、mcpServers）沿用 JSON 字符串列存储（与 `tasks.skillSettings` 一致）。
- **新建课包默认 `draft`**：新课程一节课都没有，直接置成 `ready` 会让班级关联到一份"看起来能上、其实没内容"的课包。
- 排序（`sortOrder`）由服务端在**追加时取当前最大值 + 1** 决定，不接受客户端传序号：
  让客户端传序号，两个管理员同时加章节就会撞号。

## Global Constraints

- 每项功能遵循红—绿—重构：先写失败测试并**运行确认 FAIL**，再写最小实现，最后再跑一次。
- 日志只允许静态字符串；绝不输出账号、令牌、路径等动态值或任何密钥。
- 每任务独立提交，**只暂存明确文件**：工作区还有 4 个既有前端改动与 CRLF 噪音，禁止整库暂存。
- **硬规则：源文件只用 `edit` / `write` 工具修改，禁止 shell 重定向 / `Set-Content` / `-replace` 处理 UTF-8 源码**
  （已因此重写整文件三次）。同一字符串改多处时用 `edit` 的 `replace_all: true`。
- 迁移：本轮**不需要新表**——四张表在 0008 已存在。若确需加列，必须同步 `legacy-migrations` 哈希期望与 deploy 副本。
- 不启动长期运行的开发服务器；验收用正式构建产物。
- 验证统一：服务端 + Web 全量 + `pnpm type-check` + `pnpm lint` + 改动文件 `prettier --check`。

---

## Task 1: 课包本身的写接口（新建 / 编辑 / 发布）

**Files:** `packages/server/src/routes/teacher.ts`、`db/types.ts`（`CourseRepository.update`）、
双 Provider 仓储与测试、`routes/__tests__/teacher-course-writes.test.ts`

- [x] **Step 1: 写失败测试**：`CourseRepository.update`（改字段刷新 `updatedAt`、课程不存在返回 null，双 Provider）；
      `POST /api/teacher/courses` 的通过路径与拒绝路径（未登录 401、普通老师 403、课程名空白/超长 400、
      非法 stage 400、新建默认 `draft`）；`PATCH /api/teacher/courses/:courseId` 同上，
      外加**跨机构课程返回 404**（不能靠猜 id 改别人机构的课包）。
- [x] **Step 2: 实现**（严格入参校验 + 静态错误文案，沿用班级接口的写法）。
      `institutionId` **一律取自调用者的成员关系**，请求体里传了也忽略（有测试锁住这条）。
- [x] **Step 3: 提交**。`feat(server): let institution admins create and edit courses`

## Task 2: 章节与课时的写接口

**Files:** 同上 + `PUT /courses/:courseId/chapters`、`PUT /courses/:courseId/lessons` 等

- [x] **Step 1: 写失败测试**：追加章节/课时的 `sortOrder` 为当前最大值 + 1；
      课时内容字段（目标/步骤/提示/任务/capabilities/skills/mcpServers）原样回读；
      `durationMinutes` 非法 400；章节不属于该课包时 404；跨机构 404。
- [x] **Step 2: 实现**。
- [x] **Step 3: 提交**。`feat(server): let institution admins author chapters and lessons`

> 本轮只做**追加**，编辑与删除留到后续：界面要先把"从零建出内容"这条路走通，
> 编辑/删除是独立的一小步（还需要仓储侧的 `updateLesson` / `remove`）。
> 另：课时数组字段缺省存 `[]` 而不是 `null`，与既有 JSON 列约定一致（有测试锁住）。

## Task 3: 课时资源的写接口

- [x] **Step 1: 写失败测试**：追加资源（type/status 枚举校验）；跨机构 404；非法枚举 400。
- [x] **Step 2: 实现**。缺省 `status='planned'`——没做好的资源不该被当成"就绪"；
      课时必须属于该课包（章节或课时对不上都 404）。
- [x] **Step 3: 提交**。`feat(server): let institution admins attach lesson resources`

## Task 3.5（计划外前置修复）: 课包列表必须能从工作区拿到

**为什么插在这里**：动手做 Task 4 时发现 `/workspace` 不返回课包，而 `toTeacherDashboardData`
把 `courses` 固定留空——**接口模式下"课程中心"是空的**。与 Task 3.5（班级详情）同一类缺口。

- [x] `/workspace` 一并返回机构课包列表（`TeacherCourseView[]`）。
- [x] **读不出大纲的课包直接跳过**：给一份课时数不完整的课包，会让老师以为课都排好了；
      班级列表不受影响（有测试用"只让指定课包读不出大纲"的方式锁住这条）。
- [x] Web 侧映射 `courses`，并修掉 `teacher-course-card.tsx` 里直接渲染 `course.completion` 的问题
      （后端不提供内容完善度 → 显示占位符而不是 `undefined%`）。

## Task 4: 教师端"新建课包"

**Files:** `features/teacher/teacher-workspace-source.ts`（writer）、`teacher-provider.tsx`、
`teacher-courses-page.tsx`、新增 `create-course-dialog.tsx`

- [x] **Step 1: 写失败测试**：新建课包只有成功才出现在列表；名称/学段校验；失败保留对话框内容；
      非机构管理员看不到入口。
- [x] **Step 2: 实现**（复用 Task 1–3 的接口；演示源保持本地 reducer）。
- [x] **Step 3: 提交**。`feat(web): let institution admins create a course from the console`

> 诚实说明：对话框这一项的测试与实现是**一起写完才跑**的（没有先观察 FAIL），
> 与 Task 1/2 那两次情况相同；Task 3、3.5 都是红—绿。记录在此，不掩饰。

## Task 5: 课包详情页的章节/课时/资源编辑

- [ ] **Step 1: 写失败测试**：加章节、加课时、加资源各自调用接口且成功后才出现；
      发布（`draft` → `ready`）入口只在课时数 > 0 时可用，否则置灰并说明原因。
- [ ] **Step 2: 实现**。
- [ ] **Step 3: 提交**。`feat(web): author chapters and lessons from the console`

## Task 6: 全量验收

- [ ] 服务端 + Web 全量、`pnpm type-check`、`pnpm lint`、`pnpm build:server` / `pnpm build:web` 通过。
- [ ] 用正式构建产物做一次**不再用 SQL 种课时**的端到端验收：建机构 → 加老师 → **建课包 → 加章节 →
      加课时 → 加资源 → 发布** → 建班 → 加学生 → 关联课包 → 设额度 → 分配老师 → 开课 → 下课。
- [ ] 提交。`docs(agent): record the course authoring rollout`

---

## Self-Review

- **覆盖**：本计划补的是"无课可开"这个硬缺口；上一份计划的 UI 与权限口径全部复用，不重新发明。
- **不新增存储**：四张表与聚合仓储在 0008 已存在；本轮只加写接口与界面（仓储仅补 `update`）。
- **风险最高处**：`sortOrder` 的并发追加与"跨机构改课包"——前者用"服务端取最大值 + 1"缓解（并发下仍可能撞号，
  这是已知的、可接受的取舍，因为课包编辑是机构内的低频操作）；后者用"课程不属于本机构一律 404"硬拦。
- **诚实性**：新建课包默认 `draft`、发布要求至少一节课时，都是为了不让人关联到空课包；
  删除与拖动排序本轮不做，会显式记录为后续项。
