# 教师机构与班级真实数据模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 按任务逐项执行，用复选框（`- [ ]`）跟踪进度。每个任务都必须先写失败测试。

**Goal:** 把教师端从"前端演示数据"升级为真实可持久化的机构/班级/选课/开课闭环，并让班级共享额度接入既有预算装饰器。

**Architecture:** 新增 `/api/teacher` 路由与独立的机构权限中间件（与 `/api/admin` 平行、互不复用）。
数据访问沿用现有双 Provider 结构与 `db/types.ts` 的仓储接口风格；权限**每请求回查数据库**，不写进会话令牌
（与现有 `requireAdmin` 同构）。前端通过既有 `TeacherWorkspaceContextValue` 接缝把演示数据替换为接口调用，
页面、路由与既有中文文案断言保持不变。额度按 **学生个人 → 班级共享 → 环境默认** 组合，
复用 `XiaobaoBudgetCapReader`，拒绝路径与静态文案不改。

**Tech Stack:** Hono、Drizzle（SQLite）+ CloudBase 双 Provider、Vitest、React 19、Testing Library。

**Spec:** `docs/superpowers/specs/2026-09-14-teacher-class-model-design.md`

## 已确认的产品口径

1. 机构由**平台管理员**在运维后台创建；2. 老师账号由机构管理员建号，复用现有 `users` + 成员关系；
3. 学生进班先只做**老师手工添加**（Excel 导入另立一轮）；4. 现有演示班级**丢弃**，不写导入脚本；
5. 允许一人属于多个机构（多对多）；6. 班级共享额度是**整班共用总额度**；
7. 机构角色为 `owner / admin / teacher` 三档。

## Global Constraints

- 每项功能遵循红—绿—重构：**先写失败测试并运行确认**，再写最小实现，最后再跑一次。
- 日志只允许静态字符串；绝不输出账号、令牌、路径等动态值或任何密钥。
- 每任务独立提交，**只暂存明确文件**：工作区存在 8 个既有前端改动与 CRLF 噪音，禁止整库暂存。
- 迁移必须同步：`legacy-migrations.test.ts` 哈希期望 + `packages/server/deploy` 的迁移与 journal。
- **不自动迁移任何现有用户**为机构成员；机构与成员关系一律显式创建。
- 不启动长期运行的开发服务器；验收用正式构建产物。
- 每任务完成后勾选本计划复选框，并在 `docs/progress/2026-08-21-xiaobao-runtime.md` 追加一轮记录。
- 验证统一：服务端/Web 全量测试 + `pnpm type-check` + `pnpm lint` + 改动文件 `prettier --check`。

---

## Task 1: 迁移 0007 与五张核心表

**Files:** `packages/server/src/db/schema.ts`、`db/types.ts`、
`db/migrations/0007_*.sql` + `meta/`、`db/__tests__/teacher-class-schema.test.ts`、deploy 副本

- [x] **Step 1: 写失败测试**：断言 journal 末位标签为 `0007_teacher_class_model`；全新库上
      `institutions` / `institution_members` / `classes` / `class_teachers` / `class_enrollments`
      五张表存在且关键列可空性正确；`users` 表未被改动。Run 后确认 FAIL。
      —— 红灯 4/4 失败（新表尚未导出）。另加两条唯一约束与"退班保留历史"（`left_at` 可空）断言。
- [x] **Step 2: 加 schema 与类型**（仅这五张表；课程表留到 Task 9，保持每轮可验证）。
- [x] **Step 3: 生成迁移**：`pnpm db:generate --name teacher_class_model`，确认 SQL 为新增表语句。
      —— 生成 5 张表 + 6 个索引 + 外键；格式化后重跑 `db:generate` 确认"无 schema 变化"（schema 与 snapshot 一致）。
- [x] **Step 4: 同步期望**：`legacy-migrations.test.ts` 追加第 8 条哈希与 `createdAt`；deploy 复制 SQL + journal + snapshot。
      —— 同时镜像 `deploy` 的 schema.ts / types.ts，并把 deploy `EXPECTED_MIGRATIONS` 7 → 8。
- [x] **Step 5: 验证并提交**：服务端全量 + type-check + lint 通过。`feat(db): add institution and class tables`
      —— 服务端 67 文件 / 771 项、deploy 12 文件 / 69 项、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 2: 机构与成员仓储（双 Provider）

**Files:** `db/types.ts`（`InstitutionRepository` / `InstitutionMemberRepository`）、
`db/drizzle/repositories.ts`、`db/cloudbase/repositories.ts`、`db/cloudbase/client.ts`（集合白名单）、
两份仓储测试 + 共享的非事务 CloudBase 假数据库

- [x] **Step 1: 写失败测试**：Drizzle 真库集成测试（建机构、加成员、按用户查其机构、唯一约束冲突）；
      CloudBase 假集合测试（同样路径 + 分页截断返回 `null` 而非偏小结果）。确认 FAIL。
      —— 红灯 10/10（`undefined` / `not a constructor`）。
- [x] **Step 2: 实现 Drizzle 版**并跑绿。
      —— 唯一约束冲突返回 `null`（识别 `SQLITE_CONSTRAINT_UNIQUE`）且不覆盖第一条记录；`listForUser` 用一条 join 查询。
- [x] **Step 3: 实现 CloudBase 版**并跑绿（沿用账本仓储的显式翻页与 `budgetPageSize/MaxPages` 注入模式）。
      —— 集合没有唯一索引，唯一性靠显式预检查（已在接口注释中如实标注"并发下为尽力而为"）；
      `listAllPaged` 翻页到上限即返回 `null`；5 个新集合已加入 `client.ts` 白名单。
- [x] **Step 4: 提交**。`feat(db): add institution and member repositories`
      —— 服务端 69 文件 / 781 项、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 3: 班级、任课老师与选课仓储（双 Provider）

**Files:** 同 Task 2 的四个文件

- [x] **Step 1: 写失败测试**：建班/归档班、加任课老师（lead/assistant）、加学生与退班（`leftAt` 保留记录）、
      按机构列班、按老师列其负责的班、按学生列其所在班；越权查询不返回数据。确认 FAIL。
      —— 红灯 17/17（Drizzle 8 + CloudBase 9）。
- [x] **Step 2: 实现 Drizzle 版**并跑绿。
      —— 复合主键冲突返回 `null`（新增识别 `SQLITE_CONSTRAINT_PRIMARYKEY`）；退班/复学复用同一条记录；
      `teacherClassColumns` 被三处列表查询共用，避免列清单漂移。
- [x] **Step 3: 实现 CloudBase 版**并跑绿。
      —— 任课唯一性靠显式预检查；`listByClass` 默认只返回在班学生（`includeLeft` 可取含退班历史）。
- [x] **Step 4: 提交**。`feat(db): add class, teacher and enrollment repositories`
      —— 服务端 71 文件 / 798 项、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 4: 平台管理端创建机构与分配成员

**Files:** `routes/admin.ts`、`routes/__tests__/admin-institutions.test.ts`

- [x] **Step 1: 写失败测试**：创建机构、给用户分配机构角色（`owner/admin/teacher`）、非法角色 400、
      未知用户 404、重复分配幂等或明确冲突、每次变更写 `admin_logs` 审计。确认 FAIL。
      —— 红灯 8/8。**重复分配选择"明确冲突"（409）**而不是静默成功：静默成功会掩盖管理端的误操作。
- [x] **Step 2: 实现接口**（沿用现有 `parseCreditLimit` 式的严格入参校验与静态错误文案）。
      —— 机构名去空白后限 1–80 字符；`GET /institutions` 与成员列表在仓储返回 `null` 时回 503
      （"无法确定"绝不能当成"没有机构/没有成员"）。为此给 `InstitutionRepository` 补了 `listAll()`。
- [x] **Step 3: 提交**。`feat(server): let platform admins create institutions and assign members`
      —— 服务端 72 文件 / 806 项、deploy 12 文件 / 69 项、`pnpm type-check` 全绿、`pnpm lint` 0、
      改动文件 `prettier --check` 通过。

## Task 5: 教师端权限中间件

**Files:** `middleware/teacher.ts`、`middleware/__tests__/teacher-access.test.ts`

- [x] **Step 1: 写失败测试（重点在拒绝路径）**：未登录 401；非机构成员 403；跨机构 403；
      学生（`role='user'` 且非成员）403；跨班访问 403；被禁用账号 403。确认 FAIL。
      —— 红灯（模块不存在）。最终 **18 项测试里 14 项是拒绝路径**，另加：账号行已不存在 403、
      成员关系 `left` 403、角色不匹配 403、机构不存在 404、成员列表无法确定 503、
      一人多机构未指定 400、班级不存在 404、协助老师缺 `lead` 403。
- [x] **Step 2: 实现** `requireInstitutionMember` 与 `requireClassAccess`（按 `session.user.id` 回查数据库，不信任令牌内容）。
      —— 机构 id 解析顺序：路由参数 → 查询参数 → 该用户唯一的在册机构（一人多机构必须显式指定）。
      `leadOnly` 用于开课/下课等写操作；机构 owner/admin 不受教师角色限制。`AppEnv` 增加三个只读上下文变量。
- [x] **Step 3: 提交**。`feat(server): add institution and class access middleware`
      —— 服务端 73 文件 / 824 项、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 6: 教师端只读接口

**Files:** `routes/teacher.ts`、`index.ts`（挂载 `/api/teacher`）、`routes/__tests__/teacher-workspace.test.ts`

- [x] **Step 1: 写失败测试**：`GET /workspace` 返回的负载形状与前端 `TeacherDashboardData` 的只读子集一致
      （机构名、老师名、班级列表、班级详情）；`GET /classes/:classId` 含成员与课时进度；
      无数据机构返回空数组而不是报错。确认 FAIL。
      —— 红灯（模块不存在），最终 12 项测试通过。测试**不 mock 权限中间件**，走真实中间件 + 假 db，
      因此权限与负载是一次性集成覆盖。
- [x] **Step 2: 实现**（严格按前端既有字段命名，避免二次翻译）。
      —— 挂载 `/api/teacher`；`/workspace`、`/classes`、`/classes/:classId` 三个只读接口。
      **课时进度不在本任务伪造**：课程/课时数据来源是 Task 9，因此本轮不返回
      `courseTitle` / `progress` / `completionRate`——宁可缺字段，也不返回看着像"进度 0%"的假值；
      Task 9 只会**新增**字段，不改变已有字段含义。另：`studentCount` 无法确定时为 `null`（≠0）；
      学生用户行缺失时该行仍保留、`name` 为 `null`（不静默缩短名单）。
- [x] **Step 3: 提交**。`feat(server): add read-only teacher workspace endpoints`
      —— 服务端 74 文件 / 836 项、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 7: 教师端写接口

**Files:** `routes/teacher.ts`、`routes/__tests__/teacher-class-writes.test.ts`

- [x] **Step 1: 写失败测试**：新建班级（仅机构管理员）、加/移出学生（移出写 `leftAt` 且历史记录仍可读）、
      关联课包、跨机构与跨班写入被拒。确认 FAIL。
      —— 红灯 14/14。**"关联课包"移到 Task 9**：它依赖 `class_courses` 表，而该表属于课程/课时模型；
      本轮不偷偷建表、也不给一个没有存储的假接口。测试同样不 mock 权限中间件。
- [x] **Step 2: 实现**并保留既有"防止重复提交"的幂等语义。
      —— `POST /classes`（`requireInstitutionMember(['owner','admin'])`）、
      `POST|DELETE /classes/:classId/students[/:studentId]`（新增 `requireClassAccess({ institutionAdminOnly: true })`）。
      幂等由仓储保证：重复提交返回同一条记录；退班学生复学时复用原记录。
      **两种拒绝文案刻意区分**：不满足"够得着这个班"回 `Class access required`，
      够得着但该操作仅限机构管理员回 `Institution role required`——否则排查时分不清原因。
      另加守卫：平台运维管理员（`users.role !== 'user'`）不得被加进班级名单。
- [x] **Step 3: 提交**。`feat(server): add teacher class and roster write endpoints`
      —— 服务端 75 文件 / 851 项、`pnpm type-check` 全绿（**抓到并修掉一处 `c.req.param` 可能为 undefined 的真实缺陷**）、
      `pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 8: 班级共享额度

**Files:** `agent/xiaobao-runtime/budget-policy.ts`、`dependencies.ts`、`routes/teacher.ts`、`db/*` 双 Provider、相关测试

> **本任务拆成两半交付**：班级共享额度不仅要"决定用哪个上限"，还必须"用同一口径的已用额度去比"。
> 现有装饰器把上限与学生个人用量配对，所以口径问题必须先解决，否则班级上限会被错当成个人上限。

- [x] **Step 1（策略层与写入口）: 写失败测试**：组合顺序为 学生个人 → 班级共享 → 环境默认；班级上限为 `null` 时回退环境；
      学生上限优先于班级上限；班级查询失败 fail-closed；写入只接受正整数或显式 `null`。确认 FAIL。
      —— 先红灯 8 项（策略层）+ 仓储/路由断言。
- [x] **Step 2（策略层与写入口）: 实现**。
      —— `XiaobaoClassBudgetReader` 窄接口 + `createLayeredBudgetPolicy`（三层，每层带自己的用量口径）；
      `XiaobaoBudgetPolicy` 增加**可选**的 `settledCreditsFor`，装饰器在它存在时改用它取用量——
      **拒绝路径、比较逻辑与静态文案逐字节未变**（有回归测试锁定）。
      `parseCreditLimit` 上移到 `budget-policy.ts`，让**写入口与运行时读取器共用同一份口径**
      （`admin.ts` 的本地副本已删除，避免两处规则漂移）。
      `TeacherClassRepository.update` + `PUT /classes/:classId/budget`（仅机构 admin）。
- [x] **Step 3（数据库侧读取器 + 生产装配）**：新增账本聚合 `sumSettledCreditsByUsers`（双 Provider、显式翻页、
  截断返回 `null`），实现 `createDatabaseClassBudgetReader`（按学生取在班班级 → 取最严格的班级上限 →
  用**全班合计**作为已用额度），并接入 `dependencies.ts`。完成后重跑服务端全量，证明既有拒绝路径未变。
      —— 账本按用户分批（每批 50）查询 + 批内翻页；**任何一批读不完即返回 `null`**，绝不给偏小的全班合计。
      CloudBase 侧把翻页求和抽成 `sumPagedSettledCredits`，两处求和共用，避免分页逻辑出现第二份实现。
      `XiaobaoProductionGuardDatabase` 扩展为 `'xiaobaoUsageLedger' | 'users' | 'classes' | 'classEnrollments'`。
      顺带修掉一个**测试替身缺陷**：账本那套 CloudBase 假数据库的 `command` 是空对象，`_.in` / `_.gte` 从未被覆盖；
      现已复用共享假数据库的 `FakeCommand` 与 `matchesCriteria`，两套假实现不再各自理解 `command`。
- [x] **Step 4: 提交**。`feat(agent): enforce the class-shared xiaobao credit budget`
      —— Step 1/2 为 `feat(agent): add the class-shared xiaobao budget policy layer`，Step 3 完成生产装配后，
      班级共享额度**才真正生效**。服务端 **76 文件 / 878 项**、deploy 12 文件 / 69 项、
      `pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。
      `BudgetedUsageProvider` 的拒绝路径、比较逻辑与静态文案仍然逐字节未变（有回归测试锁定）。

## Task 9: 课程与课时

**Files:** `db/schema.ts`、`db/types.ts`、双 Provider 仓储、`routes/teacher.ts`、迁移 `0008`

> **本任务同样分两半交付**：六张表 + 迁移（本轮）→ 双 Provider 仓储 + 接口 + 承接 Task 7/6 的欠账（下一轮）。

- [x] **Step 1: 写失败测试**：`courses` / `course_chapters` / `course_lessons` / `lesson_resources` /
      `class_courses` / `lesson_progress` 的读写与 `(classId, lessonId)` 唯一约束；按班查进度。确认 FAIL。
      —— 红灯 4/4。断言含：JSON 数组列默认 `'[]'`、`courses.status` 默认 `'draft'`、
      `lesson_progress.completed_at` **可空**（不用 0 冒充时间戳）、`class_courses` 复合主键与
      `(classId, lessonId)` 唯一约束各自拒绝重复插入。
- [x] **Step 2: 加表 + 迁移 0008**（含哈希期望与 deploy 同步）。
      —— `0008_teacher_course_model`：6 张表 + 7 个索引；`legacy-migrations.test.ts` 期望同步（9 条哈希）、
      deploy 复制 SQL/journal/snapshot 并镜像 schema/types，`EXPECTED_MIGRATIONS` 8 → 9。
      生成后再跑 `db:generate` 确认"无 schema 变化"（格式化前后各一次）。
      顺带修掉 `teacher-class-schema.test.ts` 的"末位"断言（0008 会打破它）——沿用 Task 1 立的规矩：
      **末位只由最新迁移自己的测试负责**。
- [x] **Step 3a: 实现双 Provider 仓储**，字段与前端 `TeacherCourseChapter/TeacherCourseLessonDetail` 对齐。
      —— **按聚合边界收成三个仓储**（`courses` / `classCourses` / `lessonProgress`）而不是为六张表各起一个：
      章节/课时/资源没有独立生命周期、也没有跨课程查询需求，拆开只会让双 Provider 的实现与装配面积翻倍。
      `loadOutline` 的语义刻意区分：**课程不存在 ⇒ `null`（端点回 404）；大纲读取被截断 ⇒ 抛错（端点回 503）**——
      两者混用一个 `null` 会让端点分不清"没有这门课"和"读不出来"，而后者绝不能当成完整课程展示。
      `assign` 与 `setStatus` 都是幂等 upsert；`setStatus` 在状态不是 `completed` 时**清空** `completedAt`，
      不留下过期的完成时间。
- [x] **Step 3b: 课程只读接口**（`GET /api/teacher/courses`、`GET /api/teacher/courses/:courseId`）。
      —— 列表带 `lessonCount` 与 `assignedClassIds`；详情返回章节/课时/资源，并把 JSON 列解析成数组。
      跨机构的课程按"不存在"处理（404），不泄露别的机构有什么课。
      前端另有两个字段**仍然刻意不返回**，因为来源不同：`completionRate`（完成率）是学生的**任务完成率**，
      需要按班级聚合 `tasks`；`completion`（完善进度）是课程/课时的**内容完善度**，目前没有任何存储承载。
- [x] **Step 4: 承接 Task 7 移来的工作**：
      (a) 新增"班级关联课包"端点（`class_courses` 到这一步才存在）；
      (b) 给 Task 6 的班级视图补上 `courseTitle` / `progress` / `completionRate`，
      并给班级详情补上 `lessonProgress`——Task 6 当时**刻意没有伪造**这些字段，此处只新增、不改含义。
      —— (a) `POST /classes/:classId/courses`（lead 老师或机构管理员；跨机构课包 400；幂等）。
      (b) 班级视图新增 `course` 对象：`{ id, title, lessonCount, completedLessonCount, progress }`，
      **`course: null` 表示尚未关联课包**（与"进度 0%"不同）；班级详情新增 `lessonProgress`，
      有进度行以行为准，没有行的课时按线性课程推导（第一个非完成为 `next`，其余 `locked`，视图层推导不落库）。
      `completionRate` 与 `completion` 按上述原因继续不返回，注释里写明了它们各自的来源。
- [x] **Step 5: 提交**。`feat(server): add institution course and lesson model`
      —— 已分三次提交：`feat(db): add institution course and lesson tables`、
      `feat(db): add course, class-course and lesson-progress repositories`、
      `feat(server): add teacher course endpoints and class course progress`。

## Task 10: 前端只读接线

**Files:** `features/teacher/teacher-provider.tsx` 及新增数据源模块、测试

- [x] **Step 1: 写失败测试**：注入假 API 时，provider 使用接口数据；**未配置机构时渲染空状态而不是演示数据**；
      既有页面文案与路由断言保持不变。确认 FAIL。
      —— 新增 14 项测试：映射与开关 10 项（`toTeacherDashboardData` 只填后端真实提供的数据、
      未知值不变成 0、403/400 → 空状态、500 → 可重试错误、开关默认演示源），
      provider 4 项（接口数据渲染且**演示班级不出现**、无机构 → 空状态、错误 → 可重试、默认演示数据同步渲染）。
- [x] **Step 2: 实现**"同形状替换"，保留 `TeacherDashboardData` 类型作为接口边界。
      —— 新增数据源接缝 `TeacherWorkspaceSource`（演示源提供同步 `initial`，接口源不提供 → provider 先显示加载中）；
      provider 增加 `loading` / `no-institution` / `error` 三个状态，**没有机构时不退回演示数据**。
      `main.tsx` 按 `VITE_TEACHER_WORKSPACE_API=1` 切换，**默认仍是演示源**——接口还不提供今日安排、
      待点评、作品与课堂记录，直接切换会把教育现场演示清空；Task 13 的浏览器验收用这个开关。
      **同时把接口拿不到的字段改成可空**（`completionRate` / `progress` / `studentCount`）并显示占位符 `—`：
      否则接口路径会显示"完成率 0%"，与本仓库一贯拒绝的假数据是同一类问题。`/api` 客户端补上错误状态码，
      让"无机构/无权限"与"真正失败"可区分。
- [x] **Step 3: 提交**。`feat(web): load the teacher workspace from the API`
      —— Web **38 文件 / 154 项**（+2 文件 / +14 项）、`pnpm type-check` 全绿、`pnpm lint` 0、
      改动文件 `prettier --check` 通过。
      **注意**：`teacher-class-card.tsx` 与 `teacher-class-detail-page.tsx` 原本就带着未提交的
      prettier 风格重排（属于工作区 8 个既有改动之列），本轮因修改这两处而一并提交；
      其余 6 个既有改动文件未纳入本次提交。

## Task 11: 前端写接线

**Files:** 同 Task 10

- [x] **Step 1: 写失败测试**：`start/end/assignCourse/updateStudentStatus` 调用接口且在失败时给出静态提示、
      不乐观地伪造成功。确认 FAIL。
      —— 新增 4 项 jsdom 测试：后端成功后才反映到界面、**失败时不做乐观更新**（界面保持原样且无成功提示）、
      尚无后端的操作明确报"尚未接入"且不改本地状态、演示源保持本地行为。
- [x] **Step 2: 实现**并保证加载中/失败状态可见。
      —— 数据源新增 `persistsWrites` 与 `writer`：演示源 `false`（写操作只改本地状态），
      接口源的 `assignCourse` 真正调用 `POST /classes/:classId/courses`，**全部班级都成功后才反映到界面**。
      其余操作（开课/下课/课中调整、作品点评、优秀推荐、学生关注标记）后端目前没有存储，
      接口模式下**明确 toast 报"该操作尚未接入后端"且不改本地状态**——静默改内存会让人以为保存成功、
      刷新后又消失，比报错更糟。开课/下课由 Task 12 补上会话模型后接线。
- [x] **Step 3: 提交**。`feat(web): persist teacher class actions through the API`
      —— Web **39 文件 / 158 项**、`pnpm type-check` 全绿、`pnpm lint` 0、改动文件 `prettier --check` 通过。

## Task 12: 开课、下课与临时权限

**Files:** `db/schema.ts`（`class_sessions`）、迁移 `0009`、`routes/teacher.ts`、`agent/xiaobao-runtime` 能力门禁

- [x] **Step 1: 写失败测试**：开课写入会话记录；课中调整能力与额度立即生效；下课写记录并**收回 `class_only` 班级的临时能力**；
      `anytime` 班级不受影响；重复下课幂等。确认 FAIL。
- [x] **Step 2: 加表与迁移 0009**（含哈希期望与 deploy 同步）。
- [x] **Step 3: 实现**并与现有小宝能力放行集合对接（只在该班上课期间放行其配置的能力）。
      **对设计草案的一处调整**：接口从 `/api/teacher/sessions` 改为挂在班级下的
      `/classes/:classId/sessions`（开课）、`/classes/:classId/sessions/:sessionId`（课中调整）、
      `.../:sessionId/end`（下课）、`GET .../sessions`（历史记录）。理由是班级才是权限判定主体，
      复用同一套 `requireClassAccess({ leadOnly: true })`，不必再写一份"从请求体取 classId"的权限逻辑。
      **课堂能力的两套词汇尚未拍板**：课堂记录存运行时能力 id，教师端界面用 `chat/image/music/video/code`，
      只展示两边都认得的能力，开课请求不带 `capabilities`（取课时配置），映射留给产品确认。
- [x] **Step 4: 提交**。`feat(agent): add class sessions with temporary capability grants`

## Task 13: 全量验收

- [x] 服务端与 Web 全量测试、`pnpm type-check`、`pnpm lint`、`pnpm build:server`、`pnpm build:web` 全部通过。
      （服务端 85 文件 / 963 项、deploy 12 文件 / 69 项、Web 39 文件 / 167 项；两个 build 均成功。）
- [x] 用正式构建产物做一次浏览器验收：建机构 → 加老师 → 建班 → 加学生 → 设班级额度 → 开课 → 下课。
      **已用正式构建产物跑完整 HTTP 端到端（34 项断言全通过，见进度日志 2026-09-14 计划外补齐一节）。
      渲染层的人工点击验收当时做不了**（环境没有可驱动的浏览器），**后在 2026-09-16 由用户在浏览器里完成并确认
      符合要求**——前提是 2026-09-15 的教师管理界面计划把机构/班级/名单/额度/任课老师这些入口补齐
      （补做开关 `VITE_TEACHER_WORKSPACE_API=1`）。
      这一步同时暴露出并补上了一个真实缺口：分配任课老师原先没有 HTTP 接口，普通老师永远看不到班级，
      现已新增 `PUT/DELETE /api/teacher/classes/:classId/teachers`。
- [x] 记录 deploy 决定：教师端是 Web 功能，**deploy 副本保持现状**（第 66 轮已发现其连用量账本层都没有），
      并在进度日志中显式说明该选择。
- [x] 提交。`docs(agent): record the teacher class model rollout`

---

## 后续独立计划（不在本计划内）

| 主题 | 为什么独立 |
| --- | --- |
| **机构 / 班级 / 名单 / 额度 / 任课老师的教师端界面** | 本次 13 项任务只做了"把已有演示页面同形状替换成接口数据"，机构后台、建班、加学生、班级共享额度、分配任课老师目前**有接口没界面**；这是 Task 13 浏览器验收做不下去的直接原因，需要单独排前端任务 |
| 学生作品提交与教师点评落库 | 需要先定学生端作品持久化模型；现有 `communityWorks` 是社区发布表，无班级归属与点评字段 |
| Excel 批量导入学生 | 依赖真实班级模型完成后才有意义，且有文件解析与错误回执的独立复杂度 |
| 教师席位、细粒度权限与计费 | 产品 §6 明确列为后续阶段 |
| deploy 副本补齐（账本层 + 机构/班级层） | 取决于桌面端是否提供教师后台与预算核算，需要单独决定 |

## Self-Review

- **Spec 覆盖**：D1/D2 → Task 4/5；D3 → Task 3；D4 → Task 12；D5 → Task 8；D6 → Task 9；D7 → Task 10/11；
  迁移与 deploy → Task 1/9/12/13。
- **测试策略**：每个任务都包含**拒绝路径**测试（跨机构、跨班、非成员、学生访问），不只测通过路径。
- **风险最高处**：Task 12（临时能力放行）与 Task 8（组合顺序）会碰到小宝 Runtime 的既有语义，
  因此都要求"不修改既有拒绝路径与静态文案"，并在改动后重跑服务端全量。
- **诚实性**：不伪造成功、不在接口失败时做乐观更新；无法本地验证的部分（真实媒体服务、Redis 多节点、
  300 并发压测）不在本计划内，继续在各轮进度日志中标注为待凭据或待基础设施。
