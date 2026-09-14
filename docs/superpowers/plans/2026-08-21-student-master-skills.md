# Student Master Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为学生端六个创作入口建立可解析、可自动装载、可见流程的大师级 Skills，并确保任务创建时显式携带正确的 Skill。

**Architecture:** 以 `student-capabilities.ts` 作为六入口映射的唯一事实来源，每个入口声明固定 `skillName`、大师介绍、七阶段和工具状态。学生选择入口后写入专用 Jotai atom；`TaskForm` 将内置 Skill 与用户手动选择的 Skills 去重合并到现有 `skillList`。根目录 `skills/` 中的六个 `SKILL.md` 遵循统一七阶段契约，并由自动化契约测试验证。第一阶段只实现 Skills、自动绑定和学生可见流程，不伪造尚未接入的火山视频或音乐成品。

**Tech Stack:** React 19、TypeScript、Jotai、Vitest、Testing Library、现有 Hono Skill Loader、Markdown `SKILL.md`

**Spec:** `docs/superpowers/specs/2026-08-21-student-master-skills-design.md`

## Global Constraints

- 修改任何 Skill 前先加载并遵循 `skill-creator` 与 `superpowers:writing-skills`。
- 每项功能遵循红—绿—重构：先写失败测试并运行确认，再写最小实现。
- 六个 Skill 都必须包含 `discover`、`plan`、`produce`、`inspect`、`revise`、`deliver`、`reflect` 七阶段。
- 每个 Skill 默认只问 2–4 个真正影响结果的关键问题，能够安全推断的细节自行决定。
- 视频必须包含角色锁、角色多角度参考、连续性表、九宫格、两次学生确认、逐镜生成、粗剪检查、局部返工和成片门禁。
- 视频与音乐生成服务未接入时必须明确报告工具不可用，不得生成虚假链接、占位文件或宣称已有音视频。
- 日志仅使用静态字符串，禁止将动态值或任何密钥、Token 写入日志和响应。
- 不启动长期运行的开发服务器；浏览器验收使用已有预览或正式构建产物。
- 每完成一个任务，更新本计划复选框；每完成一轮，更新 `docs/progress/2026-08-21-teacher-course-management.md` 并提交一次。

---

## Task 1: 建立六个大师 Skill 的自动化质量契约

**Files:**

- Create: `packages/server/src/util/__tests__/student-master-skills.test.ts`
- Test: `skills/*/SKILL.md`

- [x] **Step 1: 写契约测试并确认失败**

测试必须从仓库根目录定位下列六个 Skill：

```ts
export const STUDENT_MASTER_SKILL_NAMES = [
  'student-image-master',
  'student-video-master',
  'student-music-master',
  'scratch-game-coach',
  'student-writing-coach',
  'student-learning-master',
] as const
```

为每个文件验证：frontmatter 中的 `name` 与目录名一致；`description` 非空；正文包含七个固定阶段标记；包含“最多 4 个关键问题”、真实工具状态、质量检查、适龄安全与隐私规则。视频额外验证 `角色设定锁`、`角色参考`、`故事连续性表`、`九宫格`、`角色参考确认`、`九宫格确认`、`逐镜生成`、`局部返工`；音乐额外验证“未生成音频”的诚实降级规则。

Run: `pnpm.cmd --filter server test -- student-master-skills.test.ts`

Expected: FAIL，因为四个新 Skill 尚不存在，两个旧 Skill 也不满足契约。

- [x] **Step 2: 使用生产 Skill Loader 验证契约**

测试直接调用 `parseSkillFromRaw`，验证真正的加载结果，不另建只为测试服务的生产检查器。阶段标记采用稳定的 Markdown 标题：`## 1. discover — 需求理解` 至 `## 7. reflect — 学习复盘`。

- [x] **Step 3: 运行单测，确认仍只因 Skill 内容缺失而失败**

Run: `pnpm.cmd --filter server test -- student-master-skills.test.ts`

- [x] **Step 4: 提交契约测试**

```text
test(agent): define student master skill contract
```

---

## Task 2: 新建绘画、视频和音乐大师 Skills

**Files:**

- Create: `skills/student-image-master/SKILL.md`
- Create: `skills/student-video-master/SKILL.md`
- Create: `skills/student-music-master/SKILL.md`
- Test: `packages/server/src/util/__tests__/student-master-skills.test.ts`

- [x] **Step 1: 编写绘画大师 Skill**

frontmatter 使用 `name: student-image-master`。正文精确定义：

- `discover`：最多询问主题/用途、主体、风格、画幅四类关键问题；缺省值必须向学生说明。
- `plan`：先给出构图、色彩、光线、主体完整显示和负面约束。
- `produce`：新作品调用真实 `ImageGen`，修改调用 `ImageEdit`；没有工具结果时不得宣称已出图。
- `inspect`：检查构图、主体完整性、肢体与文字、角色一致性、可读性、适龄安全。
- `revise`：优先局部编辑，只在整体方向错误时重生成。
- `deliver`：展示真实图片、用途说明、修改入口和采用的画幅。
- `reflect`：用儿童语言解释一个本次使用的视觉知识点。

- [x] **Step 2: 编写视频大师 Skill**

frontmatter 使用 `name: student-video-master`。除统一七阶段外，必须把以下产物写成不可跳过的顺序门禁：

1. 角色设定锁：姓名、年龄、脸型、发型、服装、配色、道具、性格、不可变化特征。
2. 多角度/多表情角色参考图；展示后进入“角色参考确认”，未确认不得继续。
3. 故事连续性表：镜头号、时间、地点、人物状态、道具位置、动作承接、情绪、光线。
4. 每页严格 3×3 九宫格；超过 9 镜头使用多页，每格含景别、构图、动作、台词/旁白、时长、运镜、转场。
5. 展示九宫格后进入“九宫格确认”，未确认不得生成镜头。
6. 每镜继承角色参考、风格锚点和连续性记录；逐镜保存真实工具结果。
7. 粗剪检查角色漂移、动作跳跃、场景突变、叙事断裂、节奏和字幕。
8. 只返工问题镜头，更新连续性表后再复检。

`produce` 明确声明：当前仓库尚未接入火山引擎视频工具时，只能交付角色设定、参考图、连续性表和九宫格，不得声称生成视频；工具就绪后通过服务端适配工具执行，Skill 不读取凭证。

- [x] **Step 3: 编写音乐大师 Skill**

frontmatter 使用 `name: student-music-master`。定义情绪、用途、风格、时长/速度、人声五类输入但最多追问四题；策划包含曲式时间轴、调性/速度、配器、旋律动机、歌词与负面约束。质量量表覆盖结构、旋律、节奏、歌词安全、音质、时长和用途适配。工具不可用时交付“制作方案 + 生成参数”，醒目标记“尚未生成音频”；只有拿到真实可播放工具结果后才可进入 `deliver` 的成品状态。

- [ ] **Step 4: 运行三项契约测试**

Run: `pnpm.cmd --filter server test -- student-master-skill-contract.test.ts`

Expected: 新增三项通过；旧游戏、写作和缺失的学习 Skill 仍失败。

- [ ] **Step 5: 提交三项创作 Skill**

```text
feat(agent): add image video and music master skills
```

---

## Task 3: 升级游戏、写作并新增学习大师 Skill

**Files:**

- Modify: `skills/scratch-game-coach/SKILL.md`
- Modify: `skills/student-writing-coach/SKILL.md`
- Create: `skills/student-learning-master/SKILL.md`
- Test: `packages/server/src/util/student-master-skill-contract.test.ts`

- [x] **Step 1: 将游戏 Skill 升级为完整可玩闭环**

保留目录与 `name: scratch-game-coach`。七阶段中必须先做最小可玩版本，再检查启动、操作、碰撞、计分、胜负、重开和异常路径；核心玩法通过后才添加关卡、美术、音效。`deliver` 只接受实际运行/预览验证过的项目，并提供玩法说明与继续修改入口。

- [x] **Step 2: 将写作 Skill 升级为学生参与式闭环**

保留目录与 `name: student-writing-coach`。Skill 通过提问、结构、示例和逐段反馈保留学生观点与措辞，不直接代写作业。量表检查主题、结构、逻辑、语言、事实、年龄适配和原创参与度；事实不确定时明确标记待核实。

- [x] **Step 3: 新建学习大师 Skill**

使用 `name: student-learning-master`。先诊断年级、知识点、已会内容和卡点；一次只推进一个提示或例题并等待学生回答；回答后判断理解、纠正误区，再提供变式练习。可建议数学、英语、科学或编程专科 Skill，但本 Skill 始终维护诊断—引导—检查—练习—复盘的统一流程。不得代做测验或直接输出整份作业答案。

- [x] **Step 4: 运行完整 Skill 契约测试**

Run: `pnpm.cmd --filter server test -- student-master-skill-contract.test.ts`

Expected: 六个 Skill 全部通过。

- [ ] **Step 5: 运行现有 Skill Loader 测试**

Run: `pnpm.cmd --filter server test -- skill-loader`

Expected: PASS，确认 frontmatter 可被现有 Loader 解析。

- [ ] **Step 6: 提交第二组三项 Skill**

```text
feat(agent): complete student master skill suite
```

---

## Task 4: 建立六入口显式映射与选择状态

**Files:**

- Modify: `packages/web/src/features/student-workspace/student-capabilities.ts`
- Modify: `packages/web/src/features/student-workspace/student-capabilities.test.ts`
- Modify: `packages/web/src/lib/atoms/task.ts`
- Modify: `packages/web/src/features/student-workspace/student-workspace.tsx`
- Modify: `packages/web/src/features/student-workspace/student-workspace.test.tsx`
- Modify: `packages/web/src/components/home-page-content.tsx`

- [x] **Step 1: 先补映射失败测试**

断言六个入口分别唯一映射为：

```ts
{
  image: 'student-image-master',
  video: 'student-video-master',
  music: 'student-music-master',
  game: 'scratch-game-coach',
  writing: 'student-writing-coach',
  study: 'student-learning-master',
}
```

同时断言每项含大师名称、能力说明、固定七阶段；视频工具状态为 `planned` 且提示“火山引擎待接入”，音乐为 `planned` 且提示“音乐服务待选择”，其余为 `available`。

Run: `pnpm.cmd --filter web test -- student-capabilities.test.ts student-workspace.test.tsx`

Expected: FAIL，当前类型没有上述字段，工作区也不会回传 Skill。

- [x] **Step 2: 扩展能力类型**

为 `StudentCapability` 增加：

```ts
readonly skillName: string
readonly masterTitle: string
readonly masterDescription: string
readonly stages: readonly ['discover', 'plan', 'produce', 'inspect', 'revise', 'deliver', 'reflect']
readonly toolState: 'available' | 'planned'
readonly toolMessage?: string
```

导出冻结的 `STUDENT_MASTER_STAGES`，六项复用同一顺序。

- [x] **Step 3: 新增专用 atom 并接通选择回调**

在 `task.ts` 新增：

```ts
export const studentMasterSkillNameAtom = atom<string | null>(null)
```

`StudentWorkspaceProps` 增加 `onMasterSkillChange: (skillName: string) => void`。点击入口时同一次处理内调用 `onPromptChange(capability.prompt)` 和 `onMasterSkillChange(capability.skillName)`。`HomePageContent` 使用 `useSetAtom` 传入回调。

- [x] **Step 4: 运行聚焦测试**

Run: `pnpm.cmd --filter web test -- student-capabilities.test.ts student-workspace.test.tsx`

Expected: PASS。

- [x] **Step 5: 提交入口映射**

```text
feat(web): map student capabilities to master skills
```

---

## Task 5: 创建任务时自动注入且去重合并内置 Skill

**Files:**

- Modify: `packages/web/src/components/task-form.tsx`
- Create: `packages/web/src/components/task-form-skills.test.ts`
- Test: `packages/web/src/components/task-form.test.tsx`（如已存在则补集成断言）

- [x] **Step 1: 为纯合并函数写失败测试**

导出并测试：

```ts
export function mergeTaskSkillNames(
  selectedSkills: ReadonlySet<string>,
  studentMasterSkillName: string | null,
): string[] | undefined
```

覆盖：两者为空返回 `undefined`；仅大师 Skill；仅手选 Skills；二者合并；同名只保留一次且保留稳定顺序。

Run: `pnpm.cmd --filter web test -- task-form-skills.test.ts`

Expected: FAIL，因为函数不存在。

- [x] **Step 2: 在任务表单读取大师 Skill atom**

`TaskForm` 读取 `studentMasterSkillNameAtom`，两个现有提交分支都使用 `mergeTaskSkillNames(selectedSkills, studentMasterSkillName)` 生成 `skillList`，禁止遗漏任一分支。学生不需要在高级设置里手动勾选内置 Skill。

- [ ] **Step 3: 增加提交集成测试**

选择“画一张图”后提交，断言任务创建参数包含 `student-image-master`；选择已有手动 Skill 时断言两者均存在且不重复。普通非学生入口、未选择大师 Skill 时保持当前行为。

- [x] **Step 4: 运行聚焦测试**

Run: `pnpm.cmd --filter web test -- task-form-skills.test.ts student-workspace.test.tsx`

Expected: PASS。

- [ ] **Step 5: 提交自动注入逻辑**

```text
feat(web): inject student master skill into tasks
```

---

## Task 6: 增加学生可见的大师流程卡

**Files:**

- Create: `packages/web/src/features/student-workspace/student-master-skill-card.tsx`
- Create: `packages/web/src/features/student-workspace/student-master-skill-card.test.tsx`
- Modify: `packages/web/src/features/student-workspace/student-workspace.tsx`
- Modify: `packages/web/src/features/student-workspace/student-workspace.test.tsx`

- [x] **Step 1: 写流程卡失败测试**

覆盖：未选择入口不显示；选择入口后显示大师名称、介绍和七个中文阶段；首阶段显示“准备理解你的想法”；视频显示角色参考与九宫格两个确认点和火山引擎待接入；音乐显示供应商待选择且不会出现“已生成音频”；切换入口时卡片同步更新。

Run: `pnpm.cmd --filter web test -- student-master-skill-card.test.tsx student-workspace.test.tsx`

Expected: FAIL，因为组件不存在。

- [x] **Step 2: 实现无技术术语的流程卡**

卡片面向儿童显示中文阶段：理解想法、制定方案、开始创作、作品体检、认真修改、交付作品、学习复盘。初版状态为“准备开始”，不伪造 Agent 已执行的阶段。视频卡额外展示：

- `确认 1：角色参考图`
- `确认 2：九宫格分镜`

工具为 `planned` 时显示可理解的真实状态，并说明本轮仍可先完成策划和中间成果。

- [x] **Step 3: 在工作区保存当前能力并渲染卡片**

`StudentWorkspace` 使用本地 `selectedCapabilityId` 只管理展示；点击入口先更新选择，再触发 prompt 与 Skill 回调。卡片放在快捷入口与现有 composer 之间，移动端保持单列且不遮挡输入框。

- [x] **Step 4: 运行聚焦测试**

Run: `pnpm.cmd --filter web test -- student-master-skill-card.test.tsx student-workspace.test.tsx`

Expected: PASS。

- [x] **Step 5: 提交流程卡**

```text
feat(web): show student master skill workflow
```

---

## Task 7: 全量验证、浏览器验收与本轮日志

**Files:**

- Modify: `docs/progress/2026-08-21-teacher-course-management.md`
- Modify: `docs/superpowers/plans/2026-08-21-student-master-skills.md`

- [ ] **Step 1: 扫描占位和不诚实状态**

Run:

```powershell
rg -n "TODO|TBD|假装|模拟链接|已生成音频|已生成视频" skills/student-image-master skills/student-video-master skills/student-music-master skills/student-learning-master skills/scratch-game-coach skills/student-writing-coach packages/web/src/features/student-workspace
```

逐条确认没有待实现占位或在工具未接入时误报成品。允许在否定规则中出现“已生成音频/视频”，但文义必须明确为禁止。

- [ ] **Step 2: 运行全量质量检查**

```powershell
pnpm.cmd format
pnpm.cmd type-check
pnpm.cmd lint --ignore-pattern ".worktrees/**" --ignore-pattern "**/dist/**"
pnpm.cmd --filter web test
pnpm.cmd --filter server test
pnpm.cmd --filter web build
```

Expected: 全部通过；若存在仓库既有失败，记录精确命令和失败范围，不将其误报为本轮通过。

- [ ] **Step 3: 使用正式构建产物进行浏览器验收**

按 `browser:control-in-app-browser` Skill 操作已有本地预览：

1. 打开学生编程工具首页。
2. 依次点击六个入口，核对起始请求、大师名称、七阶段和工具状态同步切换。
3. 重点检查视频卡完整展示角色参考确认、九宫格确认和火山引擎待接入。
4. 重点检查音乐卡不会宣称音频已经生成。
5. 至少提交一个使用可用 Skill 的测试任务，通过请求或 UI 状态确认 `skillList` 自动包含正确名称。
6. 检查桌面和窄屏布局；确认浏览器控制台没有本轮新增错误或警告。

- [ ] **Step 4: 更新进度日志**

记录六个 Skill、自动映射、流程卡、全部测试数字和浏览器验收结果；明确下一轮为“火山引擎视频适配”，音乐等待供应商选择。

- [ ] **Step 5: 最终自检设计覆盖**

逐项对照 Spec 的统一契约、六领域规则、视频九宫格硬门禁、工具诚实降级、数据流、错误处理与验收清单。确认本计划所有复选框完成后再声称第一阶段完成。

- [ ] **Step 6: 提交本轮成果**

```text
feat(student): complete master skill workflows
```

---

## 后续独立计划（不属于本轮完成声明）

1. 火山引擎视频工具适配：服务端凭证、请求/轮询、角色参考与九宫格资产传递、逐镜结果、受控重试、真实端到端验收。
2. 音乐适配器：供应商选型后定义统一请求/结果类型、真实音频生成、播放、修改和失败恢复。
3. 结构化实时阶段事件：仅当验证表明消息阶段标记不足以稳定驱动运行中进度卡时再扩展共享协议。
