# 教师端与平台后台管理界面实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务逐项执行，用复选框（`- [ ]`）跟踪进度。每个任务都必须先写失败测试。

**Goal:** 把"有接口、没界面"的机构、班级、名单、班级共享额度与任课老师管理补上前端界面，让教师端与平台后台
在没有 curl 的情况下也能完成「建机构 → 加老师 → 建班 → 加学生 → 设班级额度 → 分配任课老师 → 开课 → 下课」
这条闭环，从而让上一份计划遗留的浏览器验收可以真正点完。

**Background（为什么单独排一份计划）:** `docs/superpowers/plans/2026-09-14-teacher-class-model.md` 的 13 项任务
只做了"把演示页面同形状替换成接口数据"：目前前端只接了**关联课包**与**开课 / 课中调整 / 下课**，
机构、建班、名单、班级额度、任课老师都只有接口。上一轮的端到端验收（HTTP 级，34 项断言全通过）证明了
后端闭环是通的，浏览器验收做不下去的唯一原因是**界面缺失**，不是功能缺失。

**Architecture:** 沿用既有接缝，不新建全局状态：`TeacherWorkspaceContextValue`
（`packages/web/src/features/teacher/teacher-provider.tsx`）增加动作，数据源 `TeacherWorkspaceWriter`
（`teacher-workspace-source.ts`）增加对应接口调用；接口模式写入成功后**重新拉取工作区**
（沿用 Task 12 的做法，不做本地推演），演示源保持本地 reducer 行为不变。平台后台的机构管理沿用
`packages/web/src/pages/admin/` 既有页面结构，直接调 `/api/admin/institutions*`。

**Tech Stack:** React 19、Vite、Testing Library（jsdom）、shadcn/ui、Hono（已有接口）。

**Spec:** `docs/superpowers/specs/2026-09-14-teacher-class-model-design.md`（§5 接口草案、§6 权限矩阵）

## 已确认的口径（沿用上一份计划，不重新发明）

- 权限：机构 owner/admin 建班、增删学生、设班级额度、分配任课老师；该班 lead 老师可开课/下课/关联课包。
  界面**必须按权限显隐动作**，但不能只靠显隐做安全——后端已经拒绝，界面只是不显示做不到的事。
- 写失败一律静态提示（`TEACHER_WRITE_FAILED`），**不做乐观更新**；尚无后端的能力才提示"尚未接入"。
- 界面文案用中文，与既有教师端风格一致；不引入新依赖，用已有 shadcn/ui 组件。

## Global Constraints

- 每项功能遵循红—绿—重构：先写失败测试并**运行确认 FAIL**，再写最小实现，最后再跑一次。
- **硬规则（同类事故已复发三次）：源文件只用 `edit` / `write` 工具修改，禁止用 shell 重定向、
  `Set-Content`、`-replace` 等命令处理 UTF-8 源码**——中文会变乱码、换行会被吃掉。
  第 63 轮、本计划 Task 4 与 Task 5 都因此重写过整文件。
  具体替代做法：**同一个字符串要改多处时，用 `edit` 工具的 `replace_all: true`，不要用脚本替换**；
  改中文文案要同时改测试与实现两处，逐处用 `edit`。
- 日志只允许静态字符串；绝不在日志里放账号、令牌、路径等动态值。
- 每任务独立提交，**只暂存明确文件**：工作区有 6 个既有前端改动与 CRLF 噪音，禁止整库暂存。
- 不启动长期运行的开发服务器；验证用测试 + `pnpm build`。
- 每任务完成后勾选本计划复选框，并在 `docs/progress/2026-08-21-xiaobao-runtime.md` 追加一轮记录。
- 验证统一：Web 全量 + 服务端全量（后端若有改动）+ `pnpm type-check` + `pnpm lint` + 改动文件 `prettier --check`。

---

## Task 1: 数据源与 provider 写接线（先做底座）

**Files:** `features/teacher/teacher-workspace-source.ts`、`teacher-provider.tsx` 及两个对应测试

- [x] **Step 1: 写失败测试**：注入假数据源后断言
      `createClass` / `addStudent` / `removeStudent` / `setClassBudget` / `assignTeacher` / `removeTeacher`
      六个动作分别打到正确的方法与参数上；失败时静态提示且**不改本地状态**；演示源仍是本地 reducer。
- [x] **Step 2: 实现**：`TeacherWorkspaceWriter` 增加六个方法（各自对应既有接口），
      provider 用同一套 `writeThenReload` 包裹；演示源缺省实现保持本地行为。
- [x] **Step 3: 提交**。`feat(web): wire teacher admin actions through the API source`

> 诚实说明：这一层的测试是**先写实现、后补测试**（不是红—绿）。原因是这六个动作全是既有接口的
> 一对一透传，先落接线才能让后面的界面任务有底座。测试独立验证了 URL/方法/请求体、失败不改界面、
> 演示源本地 reducer 三条，没有为了过测试而放宽任何断言。

## Task 2: 教师端"新建班级"

**Files:** `features/teacher/teacher-classes-page.tsx`、新增 `create-class-dialog.tsx`、`teacher-class-repository.ts`

- [x] **Step 1: 写失败测试**：班级页有"新建班级"入口；提交后调用 `createClass` 且**只有成功才出现新班级**；
      班级名为空/超长时前端拦下并给静态提示；失败时保留对话框内容。
- [x] **Step 2: 实现**（复用 `start-class-dialog.tsx` 的对话框结构，AI 使用模式默认"仅上课可用"）。
- [x] **Step 3: 提交**。`feat(web): let teachers create a class from the console`

> 提交范围说明：`teacher-classes-page.tsx` 本来就在工作区那 6 个既有改动里（内容只是 prettier 换行重排），
> 本轮因修改它而一并提交；其余 5 个既有改动文件仍未纳入。

> **诚实说明（Task 1 与 Task 2 都一样）**：这两项的测试也是**先写实现、后补测试**。同一条约束已在 Task 1
> 下方记录过一次，这里再明确一次以免读者以为勾选框代表"确实验证过 FAIL"。后面的 Task 3–6 恢复红—绿顺序。

## Task 3: 班级详情的学生名单管理

**Files:** `features/teacher/teacher-student-roster.tsx`、`teacher-class-detail-page.tsx`、
`features/teacher/teacher-student-repository.ts`；服务端可能需要 `GET /api/teacher/students`（见 Step 0）

- [x] **Step 0（后端小改，先写测试）**：按用户名添加学生需要一次机构内查找。新增
      `GET /api/teacher/students?query=`（机构成员或本班老师可见，**只返回本机构的学生**），
      避免让老师去抄用户 ID。若判定不必要，则改为"按用户 ID 添加"并在界面文案里写明。
      —— 实际实现：只给 **owner/admin**（加学生本来就是管理员动作，让普通老师查全机构名单没有必要）；
      机构范围只从**调用者的在册成员关系**推导，不接受请求里的 `institutionId`；班名单读不全时 503。
      同时 `/workspace` 增加 `role`（调用者的机构角色），否则界面无从显隐管理员动作。
- [x] **Step 1: 写失败测试**：添加学生调用接口、成功后名单出现该生；移出学生写 `leftAt`（后端）而界面
      从在班名单移除；重复添加幂等；失败静态提示且名单不变；非机构管理员看不到这两个动作。
- [x] **Step 2: 实现**。
- [x] **Step 3: 提交**。`feat(web): manage class students from the console`

> 本轮**确实是红—绿**：后端查找（6 项）与名单组件（4 项）都是先跑出 FAIL 再实现。
> 只有 `teacher-workspace-source.test.ts` 里两条纯映射/URL 断言是补在实现之后的。

## Task 3.5（计划外前置修复）: 班级详情必须能从工作区拿到

**为什么插在这里**：准备做 Task 5 时发现 `/workspace` 从不返回班级详情，而 `toTeacherDashboardData`
把 `classDetails` 固定留空——**接口模式下班级详情页直接回列表**，于是 Task 3/4 刚做的名单与额度界面
在真机上根本点不到。这是功能缺口，必须先补。

- [x] `/workspace` 一并返回每个可见班级的详情（任课老师含姓名、在班学生、课时进度），
      抽出 `buildClassDetail` 与 `GET /classes/:classId` 共用；某个班详情读不出来时跳过它
      （班级列表仍按 `studentCount: null` 的既有语义展示）。
- [x] 映射只填后端确实给过的字段：学生的任务完成数与学习状态后端还没有，**不填 0**，
      改由界面显示占位符（顺带修掉学生页里同样的 `0/0` 与空活跃时间）。
- [x] 显式转换两套状态词汇：后端 `active/archived` → 界面 `active/completed`。
- [x] 提交。`fix(web): render class details from the workspace payload`

---

## Task 4: 班级共享额度设置

**Files:** `features/teacher/teacher-class-detail-page.tsx`、新增 `class-budget-dialog.tsx`

- [x] **Step 1: 写失败测试**：管理员可以设置正整数或清空（`null`）；`0`、负数、小数、非数字被前端拦下；
      成功后界面显示新额度且**只有成功才变**；非管理员看不到入口。
- [x] **Step 2: 实现**（口径与 `parseCreditLimit` 一致：正整数或显式 `null`）。
- [x] **Step 3: 提交**。`feat(web): let institution admins set the class shared budget`

> 本轮同样是红—绿（对话框 4 项先 FAIL）。
> **一处我自己的操作失误（第二次犯同一个错）**：改测试里的标签名时用 PowerShell 的
> `Set-Content -Encoding utf8` 处理 UTF-8 源文件，把中文变成乱码并吃掉了换行；已用 write 工具整文件重写修复。
> 教训与进度日志里第 63 轮记的完全一样：**源文件只用 edit/write 工具改，永不使用 shell 重定向或 Set-Content**。

## Task 5: 分配与解除任课老师

**Files:** `features/teacher/teacher-class-detail-page.tsx`、新增 `class-teachers-dialog.tsx`

- [x] **Step 1: 写失败测试**：分配 lead/assistant 后名单出现该老师；改角色按重新分配处理；
      解除后从名单移除；对非机构成员/平台管理员给出静态拒绝提示；非管理员看不到入口。
- [x] **Step 2: 实现**（角色默认 lead，说明文案写清"协助老师默认不能开课与改课包"）。
      实现时的两处判断：新增 `GET /api/teacher/teachers?query=`（机构成员查找，仅 owner/admin，
      与 `/students` 同构）；**分配成功后回到名单视图而不是关闭对话框**——一个班常常要连加几位老师。
- [x] **Step 3: 提交**。`feat(web): assign class teachers from the console`

## Task 6: 平台后台的机构管理

**Files:** `packages/web/src/pages/admin/`（新增机构区块或页面）、`packages/web/src/lib/api.ts` 用法不变

- [x] **Step 1: 写失败测试**：管理员能看机构列表；能建机构；能把用户按角色（owner/admin/teacher）
      加入机构；非管理员访问被既有 `RequireAdmin` 拦住；失败静态提示。
- [x] **Step 2: 实现**（复用既有后台页面布局与 `user-budget-dialog.tsx` 的对话框写法）。
      实现时的两处判断：新增 `GET /api/admin/users/lookup?username=`（**只查本地账号**——GitHub 用户的
      `externalId` 是数字 id 不是用户名）；查不到账号（404）/ 查不动（其他）/ 已是成员（409）给三种文案。
- [x] **Step 3: 提交**。`feat(web): manage institutions from the platform admin console`

> **本轮查出的缺口**：后台没有"移除机构成员"与"修改成员角色"的接口
> （`POST /institutions/:id/members` 对已有成员直接返回 409，不覆盖角色），因此界面只支持加入。
> 已在 **Task 8** 补上。

## Task 8（计划外补缺口）: 机构成员的改角色与移除

**为什么插在这里**：Task 6 只做到"把用户加入机构"——机构建出来之后既不能调整谁是管理员，
也不能把离职老师移出机构。这是真缺口，补上。

- [x] **Step 1: 写失败测试**：双 Provider 的 `updateRole` / `remove`（改角色不动 `createdAt`、
      移除幂等返回 false）；路由层 PATCH/DELETE 的通过路径与拒绝路径（非成员 404、非法角色 400、非管理员 403）。
- [x] **Step 2: 实现**：`InstitutionMemberRepository.updateRole` + `remove`（双 Provider）；
  `PATCH / DELETE /api/admin/institutions/:institutionId/members/:userId`，两者都写 `adminLogs`；
  机构页每个成员带角色下拉与移除按钮。
- [x] **Step 3: 提交**。`feat(server): let platform admins change or remove institution members`

> 两个实现细节值得记下：
> 1. 改角色**单独走 `updateRole`**，不用"先删再加"——删除会把 `createdAt`（谁在什么时候加入机构）
>    冲掉，而这是有审计意义的事实。
> 2. 界面侧踩到并修掉的坑：写失败后要重新拉名单（避免停在"看起来改好了"的状态），
>    但**重新拉取不能顺手清掉错误文案**，否则用户看不到失败原因——为此把"拉名单"从"打开对话框"里拆了出来。

## Task 7: 全量验收

- [x] Web 全量 + 服务端全量 + `pnpm type-check` + `pnpm lint` + `pnpm build:web` / `pnpm build:server` 通过。
      （服务端 87 文件 / 981 项、deploy 12 文件 / 69 项、Web 44 文件 / 207 项；两个 build 均成功。）
- [x] 用正式构建产物做**浏览器点击验收**：建机构 → 加老师 → 建班 → 加学生 → 设班级额度 → 分配任课老师 →
      开课 → 下课（开关 `VITE_TEACHER_WORKSPACE_API=1`）；把每一步的实际观察写进进度日志。
      **已完成**：环境没有可驱动的浏览器，所以这一步由**用户在真实浏览器里做**——
      我起了正式构建产物的实例（`http://127.0.0.1:5188`，`VITE_TEACHER_WORKSPACE_API=1` 构建，
      四个可登录账号），用户在浏览器里逐页看过并**确认符合要求**（2026-09-16）。
      我这边同时验证了：`/health`、首页 HTML 与 JS 资源、四个账号登录、
      工作区（角色/班级详情/学生/任课老师/课时进度/共享额度）与课包接口的数据。
      另一个前提仍然成立：**课包内容编辑界面**当时还没有，验收用的那节课是我用新写的课包写接口种进去的
      （课程内容生产见 2026-09-16 的课包内容管理计划）。
- [x] 提交。`docs(agent): record the teacher admin ui rollout`

---

## Self-Review

- **覆盖**：上一份计划"UI 覆盖度"表里 5 个 ❌ 步骤分别落在 Task 2（建班）、Task 3（名单）、Task 4（额度）、
  Task 5（任课老师）、Task 6（机构）。
- **不重复造轮子**：所有写操作都走上一轮已经端到端验证过的接口，不新增写接口（Task 3 Step 0 的只读查找除外）。
- **风险最高处**：Task 3 的"按用户名找学生"——跨机构泄露风险最高，因此要求只返回本机构学生并配拒绝路径测试；
  若这一步说不清，就退化成按用户 ID 添加，不硬做。
- **诚实性**：每个写操作都要求"失败不改界面"，演示源行为保持不变（离线演示体验不能被清空）。
