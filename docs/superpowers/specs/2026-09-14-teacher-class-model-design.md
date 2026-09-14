# 教师机构与班级真实数据模型设计

> 本文是**设计文档**，不包含代码改动。目的是把已经确认过的教师端产品行为落到真实数据模型、接口与权限上，
> 供确认后再编写实施计划。

## 1. 背景与已核实的事实

教师教学管理后台的产品口径已经在 `2026-08-14-teacher-management-platform-design.md` 中确认（机构管理员/老师角色、
班级管理、仅上课可用与随时可用两种 AI 使用模式、机构隔离、老师只能管自己负责的班级、开课/下课闭环）。
但那一版只覆盖到**界面与交互**，`2026-08-16-teacher-class-management-design.md` 更是把
「真实数据库持久化和机构权限控制」明确排除在范围之外，并说明要等「机构管理后端与权限模型」建立后再做。

当前代码的实际情况（本轮核实）：

| 事实 | 证据 |
| --- | --- |
| 教师端全部是前端演示数据，刷新即丢失 | `packages/web/src/features/teacher/teacher-provider.tsx` 把 `teacherDashboardDemo` 放在 React state 里，`start/end/assignCourse/reviewWork` 只改本地状态 |
| 服务端**完全没有**机构/班级/选课领域 | `packages/server/src` 中 `institution\|organization\|orgId\|classId\|enrollment` 匹配数为 **0** |
| 数据库现有 22 张表，没有一张与教学有关 | `packages/server/src/db/schema.ts` |
| 平台管理员角色与机构角色不是一回事 | `users.role` 只有 `'user' \| 'admin'`（`schema.ts:27`），`requireAdmin` 只认它（`middleware/admin.ts:19`） |
| 会话令牌里没有角色 | `AppSession.user: SessionUser` 只有 `id/username/email/avatar/name`（`middleware/auth.ts:10-22`） |
| 每个学生已可设置个人小宝额度 | `users.xiaobao_credit_limit`（第 64 轮迁移 0006） |
| 额度上限来源已抽象成窄接口 | `XiaobaoBudgetCapReader` / `createCompositeBudgetPolicy`（`agent/xiaobao-runtime/budget-policy.ts`） |

**被本文解锁的两件事**（都是前几轮明确记为"卡在真实班级模型上"的下一步）：

1. 教师端自助设置/查看学生小宝额度；
2. 班级共享额度（此前的 B 方案）。

## 2. 范围

**本文覆盖**：机构与成员、班级与任课老师、学生选课、班级关联课程与课时进度、开课/下课会话记录、
班级层共享额度、教师端接口与权限中间件、演示数据到真实数据的切换方式。

**不在本文范围**（各自需要独立设计，避免本文变成万能文档）：

- 学生作品的提交与教师点评落库：现有 `communityWorks` 是**社区发布**表（含点赞），
  没有班级/课时归属与点评字段，教师点评需要自己的设计。
- 课程内容制作、版本发布与校本课程（产品 §6 列为后续阶段）。
- Excel 批量导入学生、教师席位与计费、家长报告、机构经营数据。

## 3. 关键决策

### D1 机构是一等实体，成员关系独立成表

新增 `institutions` 与 `institution_members`（`userId` + `institutionId` + `role`）。

**为什么不把机构角色塞进 `users.role`**：`users.role` 正被平台运维后台的 `requireAdmin` 依赖，语义是"平台管理员"；
而机构内角色天然是**多对多**的（一位老师可以同时属于两所学校），单列无法表达。两者必须分开，互不覆盖。

### D2 权限每次请求回查数据库，不写进会话令牌

新增 `requireInstitutionMember` 与 `requireClassAccess` 中间件，按 `session.user.id` **回查**成员关系与班级归属。

**理由**：与现有 `requireAdmin` 完全同构（它也是按 id 回查 `users` 判断角色）；改权限立即生效，
不需要用户重新登录，也不会出现"令牌里的旧角色"这种难查的问题。代价是每个教师端请求多一次数据库读，
与现有管理端行为一致，可接受。

### D3 学生归属用选课关系表，不是"学生属于某个班"的单列

`class_enrollments(classId, studentUserId, status, joinedAt, leftAt)`，同一学生在同一机构内可同时在多个班；
退班保留历史（`status='left'` + `leftAt`），不物理删除，否则课堂记录与作品会失去归属。

学生就是现有 `users` 行（`role='user'`），**不新建学生表**：登录、额度、作品都已经挂在 `users` 上，
另起一张表会让这套体系分叉。

### D4 班级 AI 使用模式落在班级上；课堂临时权限由会话记录承载

- `classes.ai_usage_mode`：`class_only`（仅上课可用）/ `anytime`（随时可用），对应产品 §5.3。
- `class_sessions` 记录每次开课的能力、额度上限、起止时间与人数；结束时写记录并收回 `class_only` 班级的临时权限（§5.5）。
- 课堂记录是**既成事实的快照**：科目/额度当时是什么就存什么，不随后续配置修改而回填。

### D5 额度做成两层，班级共享额度仍由现有预算装饰器执行

顺序：**学生个人上限（`users.xiaobao_credit_limit`）→ 班级共享上限（新增 `classes.xiaobao_credit_limit`）→ 环境默认上限**。

**为什么可以复用**：第 63/64 轮已经把所有上限来源收敛到 `XiaobaoBudgetCapReader` 窄接口，
`createCompositeBudgetPolicy` 负责"谁能给出上限"的组合。新增班级层只需再实现一个读取器并插入组合顺序，
**拒绝路径、静态文案与 fail-closed 语义一行都不用改**——这正是当时刻意留出窄接口的目的。

### D6 课程（课包）与课时是机构级资源，班级通过关联表引用

`courses` / `course_chapters` / `course_lessons` / `lesson_resources` 属于机构；`class_courses` 关联班级与课包；
课时进度按 `(classId, lessonId)` 记录。

字段直接采用前端 `packages/web/src/features/teacher/types.ts` 已定义的形状
（`TeacherCourseSummary` / `TeacherCourseChapter` / `TeacherCourseLessonDetail` / `TeacherLessonProgress`），
避免前后端两套命名互相翻译。数组字段（目标、步骤、提示、capabilities、skills、mcp）以 JSON 字符串列存储，
与现有 `tasks.skillSettings`、`communityWorks.tags` 的做法一致。

### D7 演示数据到真实数据用"同形状替换"，不重写页面

前端接缝已经存在：`TeacherWorkspaceContextValue`（`teacher-provider.tsx:15-24`）。
把 `data` 改为从接口加载、把 `start/end/assignCourse/reviewWork/updateStudentStatus` 改为调用接口即可，
**页面、路由与现有中文文案断言全部不动**。这样每一轮都能用既有测试证明"页面没有被改坏"。

## 4. 数据模型

新增 12 张表（迁移编号 **0007**，双 Provider 与 deploy 副本处理见 §7）：

| 表 | 关键列 | 约束/索引 |
| --- | --- | --- |
| `institutions` | `id`, `name`, `status`('active'\|'archived') | — |
| `institution_members` | `id`, `institutionId`, `userId`, `role`('owner'\|'admin'\|'teacher'), `status` | unique(`institutionId`,`userId`)；index(`userId`) |
| `classes` | `id`, `institutionId`, `name`, `aiUsageMode`, `xiaobaoCreditLimit`(可空), `status`, `archivedAt` | index(`institutionId`,`status`) |
| `class_teachers` | `classId`, `userId`, `role`('lead'\|'assistant') | pk(`classId`,`userId`)；index(`userId`) |
| `class_enrollments` | `id`, `classId`, `studentUserId`, `status`('active'\|'left'), `joinedAt`, `leftAt` | unique(`classId`,`studentUserId`)；index(`studentUserId`,`status`) |
| `courses` | `id`, `institutionId`, `title`, `description`, `stage`, `topic`, `status`, `coverAsset`, `ageRange`, `goals`, `expectedOutcome` | index(`institutionId`,`status`) |
| `course_chapters` | `id`, `courseId`, `title`, `order` | index(`courseId`) |
| `course_lessons` | `id`, `chapterId`, `title`, `order`, `durationMinutes`, `objectives`, `steps`, `teacherTips`, `assignment`, `capabilities`, `skills`, `mcpServers` | index(`chapterId`) |
| `lesson_resources` | `id`, `lessonId`, `title`, `type`, `status` | index(`lessonId`) |
| `class_courses` | `classId`, `courseId`, `assignedAt` | pk(`classId`,`courseId`) |
| `lesson_progress` | `id`, `classId`, `lessonId`, `status`('completed'\|'next'\|'locked'), `completedAt` | unique(`classId`,`lessonId`) |
| `class_sessions` | `id`, `classId`, `lessonId`, `startedByUserId`, `startedAt`, `endedAt`, `durationMinutes`, `pointLimit`, `capabilities`, `skills`, `mcpServers`, `studentCount` | index(`classId`,`startedAt`) |

设计取舍说明：

- **任课老师用关联表**而不是 `classes.leadTeacherUserId` 单列：产品 §4.3 说"老师默认只能管理自己负责的班级，
  跨班管理需要额外权限"，关联表能表达"主班老师 + 协助老师"，且以后加权限不必再改表。
- **班级共享额度放 `classes`**而不是新建额度表：与 `users.xiaobao_credit_limit` 对称，读取器实现最简单。
- **不引入软删除**：班级/课程用 `status`/`archivedAt` 归档，学生退班用 `leftAt`；其余保持现有代码风格。

## 5. 接口草案

全部挂在 `/api/teacher`（与 `/api/admin` 平行，独立权限中间件），仅列第一批：

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/teacher/workspace` | 一次返回教师首页所需的机构、班级、今日安排、待点评数（对应现有 `TeacherDashboardData`） | 机构成员 |
| GET | `/api/teacher/classes` | 班级列表（含学生数、关联课程、进度） | 机构成员 |
| POST | `/api/teacher/classes` | 新建班级 | 机构管理员 |
| GET | `/api/teacher/classes/:classId` | 班级详情（成员、课时进度、课堂记录） | 该班老师或机构管理员 |
| POST | `/api/teacher/classes/:classId/students` | 添加学生（按用户 id 或账号） | 机构管理员 |
| DELETE | `/api/teacher/classes/:classId/students/:studentId` | 移出学生（写 `leftAt`，不删除） | 机构管理员 |
| PUT | `/api/teacher/classes/:classId/courses` | 关联课包 | 该班老师或机构管理员 |
| PUT | `/api/teacher/classes/:classId/budget` | 设置班级共享额度（正整数或 `null`） | 机构管理员 |
| GET | `/api/teacher/students/:studentId/budget` | 读取学生个人额度与已用量（复用第 65/66 轮的管理端逻辑） | 该生所在班老师或机构管理员 |
| POST | `/api/teacher/sessions` | 开课（班级 + 课时 + 额度 + 能力 + Skills + MCP） | 该班老师 |
| PUT | `/api/teacher/sessions/:sessionId` | 课中调整能力与额度 | 该班老师 |
| POST | `/api/teacher/sessions/:sessionId/end` | 下课：写记录、收回 `class_only` 临时权限 | 该班老师 |

额度写入沿用第 65 轮已经验证过的口径：**只接受正整数或显式 `null`**，非法值返回 400，
避免写进一个会被运行时读取器判为配置错误、从而锁死学生的值。

## 6. 权限矩阵

| 动作 | 机构 owner/admin | 该班 lead 老师 | 该班 assistant 老师 | 其他老师 | 学生 |
| --- | --- | --- | --- | --- | --- |
| 查看班级与进度 | ✅ | ✅ | ✅ | ❌ | ❌ |
| 开课 / 课中调整 / 下课 | ✅ | ✅ | ❌（默认） | ❌ | ❌ |
| 增删班级学生 | ✅ | ❌（默认） | ❌ | ❌ | ❌ |
| 关联课包 | ✅ | ✅ | ❌ | ❌ | ❌ |
| 设置班级共享额度 | ✅ | ❌ | ❌ | ❌ | ❌ |
| 查看学生个人额度与用量 | ✅ | ✅（本班） | ✅（本班） | ❌ | ❌ |
| 平台运维后台（`/admin`） | ❌（除非 `users.role='admin'`） | ❌ | ❌ | ❌ | ❌ |

跨机构一律拒绝；`class_only` 班级的学生在非上课时间不获得任何 AI 能力。

## 7. 迁移、兼容与 deploy

- 迁移 **0007** 新增上述表；`legacy-migrations.test.ts` 的哈希期望、deploy 侧迁移与 journal 同步（沿用第 64 轮的做法）。
- **不自动迁移任何现有用户**：不会把谁自动变成机构管理员，机构与成员关系由平台管理员显式创建。
- 现有 `users.role='admin'` 的含义不变，仍是平台运维后台管理员。
- **deploy 副本需要单独决定**：第 66 轮发现 `packages/server/deploy/src/db` **连用量账本层都没有**
  （只有 checkpoint），但迁移 SQL 却包含账本表。教师端是 Web 端功能，桌面副本是否需要机构/班级层
  取决于桌面端是否提供教师后台——建议**先进主服务端**，并在实施计划里显式记录 deploy 保持现状。
- 前端切换顺序：先接"只读"（`GET workspace/classes`），确认演示数据与真实数据形状一致后再接写操作，
  这样页面在没有真实数据的机构下仍能渲染空状态而不是报错。

## 8. 验收标准

- 迁移 0007 在全新库与既有库上都能应用；双 Provider 与 deploy 迁移测试通过。
- 机构隔离与班级归属有**拒绝路径**测试（跨机构、跨班、非成员、学生访问全部被拒），不只测通过路径。
- 一位老师属于两个机构时，两个机构的数据互不可见。
- 学生退班后：班级人数下降，但历史课堂记录仍能正确显示当时的班级与人数。
- 班级共享额度达到上限时，学生开始新任务被拒且文案为既有静态提示；学生个人上限仍然优先。
- 前端页面在无真实数据时渲染空状态；现有教师端测试（文案与路由断言）全部保持通过。
- `pnpm type-check`、`pnpm lint`、服务端与 Web 全量测试通过。

## 9. 待确认的产品口径（需要你拍板）

以下问题我不打算自行发明，它们会直接改变表结构与接口：

1. **机构从哪来**：平台管理员在运维后台创建？还是允许自助注册机构？
2. **老师账号怎么产生**：机构管理员建号？邀请邮件？直接复用现有 `users` 并赋成员关系？
3. **学生怎么进班**：老师手工添加 / Excel 批量导入（§5.6 提到）/ 学生用邀请码自加入？三种都做还是先做一种？
4. **现有演示班级怎么处理**：丢弃，还是提供一次性导入脚本变成真实数据？
5. **一个老师能否属于多个机构**：本文按"可以"设计（多对多），如果确定"一人一机构"可以简化。
6. **班级共享额度语义**：整班共用总额度，还是"每人配额 × 人数"的动态上限？
7. **是否需要第三个机构角色**（如教研组长/校区管理员），还是 `owner/admin/teacher` 三档就够？

## 10. 明确不做

- 不在本文实现任何代码，也不改前端页面。
- 不做作品点评落库、课程内容生产、Excel 导入、席位计费、家长报告。
- 不重构现有学生创作平台、技术运维后台与小宝 Runtime。
- 不把机构/班级概念引入小宝 Runtime 的预算之外的其他部分（例如沙箱、任务队列）。
