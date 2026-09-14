# AI小宝学院学生创作工作区 Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把已登录首页打磨成参考图风格的三栏学生创作工作区，同时完整保留现有任务创建、模型选择、附件、语音、Skills、MCP 与任务历史能力。

**Architecture:** `AppLayout` 继续负责全局任务数据和可收起左栏，`HomePageContent` 继续负责真实任务提交，只把首页展示层拆成学生导航、创作舞台和项目素材栏。创作能力入口由独立配置文件驱动，点击后写入现有 `taskPromptAtom`，再由原有 `TaskForm` 提交；暂未接通的课程和宠物入口明确显示“即将开放”，不伪造数据。

**Tech Stack:** React 19、TypeScript、Tailwind CSS 4、Jotai、Lucide React、Motion、Vitest、现有 shadcn/ui 组件。

---

## 实施边界

- 仅改学生创作工具首页，不在本轮开发机构管理后台和完整课程系统。
- 不修改或覆盖用户当前未提交的 `packages/web/src/index.css` 与 `packages/web/src/main.tsx`。
- 不复制参考产品的品牌和素材，只借鉴三栏信息架构与交互密度。
- 不新增假的项目文件、课程进度或素材数量；无数据时展示真实空状态。
- 学生界面使用“创作能力”“小宝帮手”等自然语言，不直接暴露 MCP、runtime 等工程术语。
- 作业和解题入口默认使用启发式提示词，要求分步引导，不直接代写答案。

### Task 1: 建立前端测试入口与学生能力目录

**Files:**
- Modify: `packages/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/web/src/features/student-workspace/student-capabilities.ts`
- Test: `packages/web/src/features/student-workspace/student-capabilities.test.ts`

- [ ] **Step 1: 写失败测试**

  覆盖六个首发入口：图片、视频、音乐、游戏、写作、学习；断言每项具有稳定 `id`、中文标题、学生可读说明、提示词模板、色彩主题和可用状态。另断言“学习辅导”提示词包含“先提问/分步引导/不直接给答案”的安全约束。

- [ ] **Step 2: 运行测试并确认失败**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-capabilities.test.ts`
  Expected: FAIL，原因是测试脚本或能力目录尚不存在。

- [ ] **Step 3: 添加最小测试配置与能力目录**

  给 web 包添加 `test: "vitest run"` 和 `vitest` 开发依赖；实现只读的 `STUDENT_CAPABILITIES`、`StudentCapabilityId` 与 `getStudentCapability()`。图标只保存 Lucide 图标名或组件映射，不使用 emoji 充当产品素材。

- [ ] **Step 4: 再次运行并确认通过**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-capabilities.test.ts`
  Expected: PASS。

- [ ] **Step 5: 提交**

  `git add packages/web/package.json pnpm-lock.yaml packages/web/src/features/student-workspace/student-capabilities.ts packages/web/src/features/student-workspace/student-capabilities.test.ts`

  `git commit -m "feat(web): add student creation capability catalog"`

### Task 2: 构建学生创作舞台

**Files:**
- Create: `packages/web/src/features/student-workspace/student-creation-stage.tsx`
- Test: `packages/web/src/features/student-workspace/student-creation-stage.test.tsx`
- Modify: `packages/web/src/components/task-form.tsx`

- [ ] **Step 1: 写失败测试**

  使用 `react-dom/server` 渲染舞台，断言包含“小宝”欢迎语、六个能力入口、适合学生的创作提示，以及可访问的按钮名称；断言点击契约通过 `onCapabilitySelect(id)` 暴露，不把提交逻辑复制进新组件。

- [ ] **Step 2: 运行测试并确认失败**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-creation-stage.test.tsx`
  Expected: FAIL，组件不存在。

- [ ] **Step 3: 实现舞台与 TaskForm 展示变体**

  新舞台包含小宝形象、随时间变化但可预测的问候、六个彩色创作入口和原有 `TaskForm`。给 `TaskForm` 增加可选 `variant="student-workspace"`，只改变容器尺寸、输入区文案和高级设置的视觉层级；`onSubmit`、模型、语音、图片、Skills、MCP 数据结构保持原样。

- [ ] **Step 4: 运行测试与类型检查**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-creation-stage.test.tsx`
  Expected: PASS。

  Run: `pnpm --filter @ai-xiaobao/web build`
  Expected: PASS。

- [ ] **Step 5: 提交**

  `git add packages/web/src/features/student-workspace/student-creation-stage.tsx packages/web/src/features/student-workspace/student-creation-stage.test.tsx packages/web/src/components/task-form.tsx`

  `git commit -m "feat(web): build Xiaobao student creation stage"`

### Task 3: 打磨左侧学生导航和创作历史

**Files:**
- Create: `packages/web/src/features/student-workspace/student-sidebar-nav.tsx`
- Test: `packages/web/src/features/student-workspace/student-sidebar-nav.test.tsx`
- Modify: `packages/web/src/components/task-sidebar.tsx`

- [ ] **Step 1: 写失败测试**

  断言侧栏出现 AI小宝学院、新建创作、作品广场、我的课程、成长中心、搜索创作和最近创作；课程与成长入口携带“即将开放”状态；最近创作仍由传入的真实 tasks 生成。

- [ ] **Step 2: 运行测试并确认失败**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-sidebar-nav.test.tsx`
  Expected: FAIL。

- [ ] **Step 3: 实现导航并接入现有 TaskSidebar**

  将学生首页导航抽为独立组件，由 `TaskSidebar` 复用；保留任务跳转、删除、处理中状态、移动端关闭和现有任务列表。把乱码或工程化英文文案替换为清晰中文；课程和成长入口使用禁用/占位交互，不导航到不存在页面。

- [ ] **Step 4: 运行测试与构建**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-sidebar-nav.test.tsx`
  Expected: PASS。

  Run: `pnpm --filter @ai-xiaobao/web build`
  Expected: PASS。

- [ ] **Step 5: 提交**

  `git add packages/web/src/features/student-workspace/student-sidebar-nav.tsx packages/web/src/features/student-workspace/student-sidebar-nav.test.tsx packages/web/src/components/task-sidebar.tsx`

  `git commit -m "feat(web): reshape sidebar for student creators"`

### Task 4: 增加右侧项目与素材面板

**Files:**
- Create: `packages/web/src/features/student-workspace/student-resource-panel.tsx`
- Test: `packages/web/src/features/student-workspace/student-resource-panel.test.tsx`

- [ ] **Step 1: 写失败测试**

  覆盖“项目文件/创作素材”两个页签、真实空状态、上传/整理能力的占位说明和可访问按钮；断言组件在没有资源时不生成虚假文件名。

- [ ] **Step 2: 运行测试并确认失败**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-resource-panel.test.tsx`
  Expected: FAIL。

- [ ] **Step 3: 实现响应式资源面板**

  桌面宽屏固定为右栏，中等屏幕折叠成抽屉按钮，小屏不占用创作输入空间。第一阶段只显示空状态和能力说明；后续任务详情页可把 `FileBrowser` 数据接入同一接口。

- [ ] **Step 4: 运行测试与构建**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-resource-panel.test.tsx`
  Expected: PASS。

  Run: `pnpm --filter @ai-xiaobao/web build`
  Expected: PASS。

- [ ] **Step 5: 提交**

  `git add packages/web/src/features/student-workspace/student-resource-panel.tsx packages/web/src/features/student-workspace/student-resource-panel.test.tsx`

  `git commit -m "feat(web): add student project resource panel"`

### Task 5: 集成三栏首页并保留真实提交流程

**Files:**
- Create: `packages/web/src/features/student-workspace/student-workspace.tsx`
- Test: `packages/web/src/features/student-workspace/student-workspace.test.tsx`
- Modify: `packages/web/src/components/home-page-content.tsx`
- Modify: `packages/web/src/components/app-layout.tsx`

- [ ] **Step 1: 写失败测试**

  断言工作区组合创作舞台和资源面板；选择能力会调用 `onPromptChange` 写入对应模板；三栏在桌面出现、右栏在窄屏可折叠。测试只验证组合契约，不模拟网络提交。

- [ ] **Step 2: 运行测试并确认失败**

  Run: `pnpm --filter @ai-xiaobao/web test -- student-workspace.test.tsx`
  Expected: FAIL。

- [ ] **Step 3: 接入 HomePageContent**

  用 `StudentWorkspace` 替换当前“顶部栏 + 居中 TaskForm”的展示结构。`HomePageContent.handleTaskSubmit`、登录弹窗、仓库选择、多仓库和任务乐观更新逻辑保持不变；能力卡仅通过 `setTaskPrompt()` 预填提示词。`AppLayout` 只补充首页需要的宽度和溢出行为，不改变任务页面布局。

- [ ] **Step 4: 运行全部 web 测试**

  Run: `pnpm --filter @ai-xiaobao/web test`
  Expected: PASS。

- [ ] **Step 5: 构建验证**

  Run: `pnpm --filter @ai-xiaobao/web build`
  Expected: PASS，且没有覆盖 `packages/web/src/main.tsx` 与 `packages/web/src/index.css`。

- [ ] **Step 6: 提交**

  `git add packages/web/src/features/student-workspace/student-workspace.tsx packages/web/src/features/student-workspace/student-workspace.test.tsx packages/web/src/components/home-page-content.tsx packages/web/src/components/app-layout.tsx`

  `git commit -m "feat(web): integrate student creation workspace"`

### Task 6: 视觉核对、日志记录与整体验证

**Files:**
- Create: `docs/progress/2026-08-14-student-creation-workspace.md`
- Modify: only files identified by the visual review, excluding the two protected user files

- [ ] **Step 1: 按参考图做设计核对**

  对照 `C:\Users\49781\Desktop\新建文件夹 (2)\学生创作工具界面.jpg` 检查：左侧导航密度、中央视觉焦点、底部输入框、右侧资源区、1440px/1024px/移动端布局、键盘焦点、颜色对比度和中文换行。若无法运行浏览器预览，则记录为未完成验收项，不声称视觉验收通过。

- [ ] **Step 2: 写进度日志**

  记录本阶段已完成、保留的真实能力、暂为占位的课程/宠物/素材功能、下一阶段机构后台入口，以及 Skills/MCP 后续接入顺序。

- [ ] **Step 3: 执行仓库规定检查**

  Run: `pnpm format`
  Expected: PASS；随后确认格式化没有改动受保护的 `packages/web/src/index.css` 与 `packages/web/src/main.tsx`。

  Run: `pnpm type-check`
  Expected: PASS。

  Run: `pnpm lint`
  Expected: PASS，日志中没有新增动态值。

  Run: `pnpm --filter @ai-xiaobao/web test`
  Expected: PASS。

  Run: `pnpm --filter @ai-xiaobao/web build`
  Expected: PASS。

- [ ] **Step 4: 检查最终差异**

  Run: `git status --short`
  Expected: 仅包含本阶段预期文件，以及用户原有的 `packages/web/src/index.css`、`packages/web/src/main.tsx` 两处未提交修改。

  Run: `git diff --check`
  Expected: 无空白错误。

- [ ] **Step 5: 提交日志和最后修正**

  精确暂存本阶段文件，不暂存两个受保护文件。

  `git commit -m "docs(web): record student workspace progress"`

## 完成标准

- 已登录学生进入首页即可看到 AI小宝学院三栏创作工作区。
- 六类入口能把安全、学生化的创作模板填入原输入框，并沿用真实任务提交链路。
- 模型、附件、语音、Skills、MCP、任务历史与登录检查没有回归。
- 课程、宠物和资源尚未接通的部分明确标记为占位，不制造假数据。
- 桌面、平板、手机都有可用布局，键盘操作和按钮名称可理解。
- web 测试、构建及仓库 format/type-check/lint 全部通过。

