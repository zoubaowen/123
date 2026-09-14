# 教师端班级管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/teacher/classes` 建成可筛选的班级总览与班级详情，并把下一课节接入现有开课流程。

**Architecture:** 扩展现有教师领域演示仓库，以纯查询函数提供班级筛选和详情查找；列表、详情、学生名单与课节进度拆为小型组件。课堂状态继续由 `TeacherWorkspaceProvider` 管理，详情页复用 `StartClassDialog`，不建立第二套课堂状态。

**Tech Stack:** React 19、TypeScript 5.7、React Router 7、Tailwind CSS 4、现有 shadcn/ui、Vitest、Lucide React、`@ai-xiaobao/chat-core`。

## Global Constraints

- 教师端仅使用 `/teacher/*`，不得加入学生 `AppLayout` 或 `/admin` 平台管理导航。
- 本阶段只使用类型明确的演示数据，不新增后端接口。
- 不展示新增、编辑、删除、导入等无法持久化的操作。
- 所有小宝形象必须通过 `@ai-xiaobao/chat-core` 使用生产九宫格角色资产。
- 日志只能使用静态字符串，不得输出动态标识、路径、密钥或令牌。
- 复用 `packages/web/src/components/ui/` 中已有组件，不手写已有 shadcn 组件的替代品。
- 不启动开发服务器；验证使用测试、类型检查、代码规范检查和正式构建。
- 保留用户对 `packages/web/src/index.css` 与 `packages/web/src/main.tsx` 的未提交主题修改。

---

## File Map

- `packages/web/src/features/teacher/types.ts`：扩展班级状态、学生摘要、课节进度和班级详情类型。
- `packages/web/src/features/teacher/demo-data.ts`：增加学生名单、课节进度和第二个班级的详情数据。
- `packages/web/src/features/teacher/teacher-class-repository.ts`：班级筛选、状态汇总和详情查找纯函数。
- `packages/web/src/features/teacher/teacher-class-repository.test.ts`：查询函数单元测试。
- `packages/web/src/features/teacher/teacher-class-card.tsx`：班级摘要卡片。
- `packages/web/src/features/teacher/teacher-classes-page.tsx`：班级总览、指标、搜索和状态筛选。
- `packages/web/src/features/teacher/teacher-classes-page.test.tsx`：总览内容与空结果测试。
- `packages/web/src/features/teacher/teacher-student-roster.tsx`：学生名单表格。
- `packages/web/src/features/teacher/teacher-lesson-progress-list.tsx`：课节进度列表。
- `packages/web/src/features/teacher/teacher-class-detail-page.tsx`：班级详情和开课连接。
- `packages/web/src/features/teacher/teacher-class-detail-page.test.tsx`：详情内容与无效班级测试。
- `packages/web/src/features/teacher/teacher-placeholder-page.tsx`：移除班级管理占位配置，保留其余四个模块。
- `packages/web/src/features/teacher/teacher-placeholder-page.test.tsx`：更新占位路由断言。
- `packages/web/src/main.tsx`：注册班级列表和详情路由。

### Task 1: 扩展班级领域数据与查询仓库

**Files:**
- Modify: `packages/web/src/features/teacher/types.ts`
- Modify: `packages/web/src/features/teacher/demo-data.ts`
- Create: `packages/web/src/features/teacher/teacher-class-repository.ts`
- Test: `packages/web/src/features/teacher/teacher-class-repository.test.ts`

**Interfaces:**
- Consumes: `TeacherDashboardData`、`TeacherClassSummary`、`ClassSessionRecord`。
- Produces: `TeacherClassDetail`、`TeacherClassFilter`、`filterTeacherClasses(data, filter)`、`getTeacherClassDetail(data, classId)`、`getTeacherClassMetrics(data)`。

- [ ] **Step 1: 编写失败的仓库测试**

```ts
import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { filterTeacherClasses, getTeacherClassDetail, getTeacherClassMetrics } from './teacher-class-repository'

describe('teacher class repository', () => {
  it('按课程关键词和状态筛选班级', () => {
    expect(filterTeacherClasses(teacherDashboardDemo, { query: '太空', status: 'active' }).map((item) => item.id))
      .toEqual(['creative-2a'])
  })

  it('返回班级详情及下一课节', () => {
    const detail = getTeacherClassDetail(teacherDashboardDemo, 'creative-2a')
    expect(detail?.students).toHaveLength(6)
    expect(detail?.lessonProgress.find((item) => item.status === 'next')?.lessonId).toBe('space-poster-03')
  })

  it('汇总教师负责班级指标', () => {
    expect(getTeacherClassMetrics(teacherDashboardDemo)).toEqual({
      classCount: 2,
      studentCount: 44,
      averageProgress: 50,
      pendingReviewCount: 2,
    })
  })
})
```

- [ ] **Step 2: 运行测试并确认缺少查询模块**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-repository.test.ts`

Expected: FAIL，提示无法加载 `teacher-class-repository`。

- [ ] **Step 3: 添加班级详情类型**

在 `types.ts` 增加：

```ts
export type TeacherClassStatus = 'active' | 'completed'
export type TeacherStudentLearningStatus = 'creating' | 'completed' | 'needs_attention'

export interface TeacherStudentSummary {
  id: string
  name: string
  status: TeacherStudentLearningStatus
  completedTasks: number
  totalTasks: number
  lastActiveAt: string
}

export interface TeacherLessonProgress {
  lessonId: string
  title: string
  order: number
  status: 'completed' | 'next' | 'locked'
  completedAt?: string
}

export interface TeacherClassDetail {
  summary: TeacherClassSummary & { status: TeacherClassStatus; nextLessonId?: string }
  students: TeacherStudentSummary[]
  lessonProgress: TeacherLessonProgress[]
  recentSessions: ClassSessionRecord[]
}
```

同时为 `TeacherDashboardData` 增加 `classDetails: TeacherClassDetail[]`。

- [ ] **Step 4: 填充两套可复用演示详情**

在 `demo-data.ts` 为 `creative-2a` 和 `game-4b` 增加详情。每班提供 6 名代表学生；`creative-2a` 的 `nextLessonId` 为 `space-poster-03`，`game-4b` 的 `nextLessonId` 为 `bounce-game-02`。课节状态必须同时覆盖 `completed`、`next` 和 `locked`。

- [ ] **Step 5: 实现纯查询函数**

```ts
export type TeacherClassFilter = {
  query: string
  status: 'all' | TeacherClassStatus
}

export function filterTeacherClasses(data: TeacherDashboardData, filter: TeacherClassFilter) {
  const query = filter.query.trim().toLocaleLowerCase('zh-CN')
  return data.classDetails
    .map((item) => item.summary)
    .filter((item) => filter.status === 'all' || item.status === filter.status)
    .filter((item) => !query || `${item.name} ${item.courseTitle}`.toLocaleLowerCase('zh-CN').includes(query))
}

export function getTeacherClassDetail(data: TeacherDashboardData, classId: string) {
  return data.classDetails.find((item) => item.summary.id === classId)
}

export function getTeacherClassMetrics(data: TeacherDashboardData) {
  return {
    classCount: data.classes.length,
    studentCount: data.classes.reduce((sum, item) => sum + item.studentCount, 0),
    averageProgress: Math.round(data.classes.reduce((sum, item) => sum + item.progress, 0) / data.classes.length),
    pendingReviewCount: data.pendingReviews.length,
  }
}
```

- [ ] **Step 6: 运行仓库测试和类型检查**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-repository.test.ts`

Run: `pnpm.cmd type-check`

Expected: 仓库测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 7: 提交领域与仓库**

```powershell
git add packages/web/src/features/teacher/types.ts packages/web/src/features/teacher/demo-data.ts packages/web/src/features/teacher/teacher-class-repository.ts packages/web/src/features/teacher/teacher-class-repository.test.ts
git commit -m "feat(web): add teacher class repository"
```

### Task 2: 实现班级总览和筛选

**Files:**
- Create: `packages/web/src/features/teacher/teacher-class-card.tsx`
- Create: `packages/web/src/features/teacher/teacher-classes-page.tsx`
- Test: `packages/web/src/features/teacher/teacher-classes-page.test.tsx`

**Interfaces:**
- Consumes: `useTeacherWorkspace()`、`filterTeacherClasses`、`getTeacherClassMetrics`、`TeacherClassDetail['summary']`。
- Produces: `TeacherClassesPage`、`TeacherClassCard`。

- [ ] **Step 1: 编写失败的总览测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherClassesPage } from './teacher-classes-page'

describe('TeacherClassesPage', () => {
  it('展示班级指标和全部负责班级', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><TeacherClassesPage /></MemoryRouter>)
    expect(markup).toContain('班级管理')
    expect(markup).toContain('44')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('四年级游戏 B 班')
    expect(markup).toContain('查看班级')
  })
})
```

- [ ] **Step 2: 运行测试并确认页面缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-classes-page.test.tsx`

Expected: FAIL，提示无法加载 `teacher-classes-page`。

- [ ] **Step 3: 实现班级卡片**

`TeacherClassCard` 接收：

```ts
interface TeacherClassCardProps {
  classInfo: TeacherClassDetail['summary']
}
```

卡片展示班级名称、课程名称、学生数、进度条、完成率和下一课节状态。主按钮使用 `<Link to={`/teacher/classes/${classInfo.id}`}>查看班级</Link>`；已结课班级显示“课程已完成”，不显示准备上课按钮。

- [ ] **Step 4: 实现总览页面**

页面使用 `useState` 保存：

```ts
const [query, setQuery] = useState('')
const [status, setStatus] = useState<TeacherClassFilter['status']>('all')
```

复用 `Input`、`Button`、`Progress`。状态按钮文案为“全部班级”“进行中”“已结课”。无结果状态包含“没有找到班级”和可点击的“清除筛选”，清除后恢复全部班级。

- [ ] **Step 5: 增加筛选行为的纯组件入口**

为可测试性允许页面接收初始筛选：

```ts
interface TeacherClassesPageProps {
  initialQuery?: string
  initialStatus?: TeacherClassFilter['status']
}
```

测试 `initialQuery="不存在"` 的静态输出包含“没有找到班级”，且不包含班级卡片标题。

- [ ] **Step 6: 运行总览测试和完整 Web 测试**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-classes-page.test.tsx`

Run: `pnpm.cmd --filter @ai-xiaobao/web test`

Expected: 总览测试和现有 Web 测试全部 PASS。

- [ ] **Step 7: 提交班级总览**

```powershell
git add packages/web/src/features/teacher/teacher-class-card.tsx packages/web/src/features/teacher/teacher-classes-page.tsx packages/web/src/features/teacher/teacher-classes-page.test.tsx
git commit -m "feat(web): add teacher class overview"
```

### Task 3: 实现学生名单与课节进度组件

**Files:**
- Create: `packages/web/src/features/teacher/teacher-student-roster.tsx`
- Create: `packages/web/src/features/teacher/teacher-lesson-progress-list.tsx`
- Test: `packages/web/src/features/teacher/teacher-class-detail-sections.test.tsx`

**Interfaces:**
- Consumes: `TeacherStudentSummary[]`、`TeacherLessonProgress[]`。
- Produces: `TeacherStudentRoster`、`TeacherLessonProgressList`。

- [ ] **Step 1: 编写失败的详情区块测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { TeacherLessonProgressList } from './teacher-lesson-progress-list'
import { TeacherStudentRoster } from './teacher-student-roster'

describe('teacher class detail sections', () => {
  const detail = teacherDashboardDemo.classDetails[0]

  it('展示学生学习状态和任务进度', () => {
    const markup = renderToStaticMarkup(<TeacherStudentRoster students={detail.students} />)
    expect(markup).toContain('学生名单')
    expect(markup).toContain('需要关注')
    expect(markup).toContain('任务完成')
  })

  it('展示已完成、下一节和未开始课节', () => {
    const markup = renderToStaticMarkup(<TeacherLessonProgressList lessons={detail.lessonProgress} />)
    expect(markup).toContain('课程进度')
    expect(markup).toContain('已完成')
    expect(markup).toContain('下一节')
    expect(markup).toContain('未开始')
  })
})
```

- [ ] **Step 2: 运行测试并确认两个组件缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-detail-sections.test.tsx`

Expected: FAIL，提示无法加载名单或进度组件。

- [ ] **Step 3: 实现学生名单**

使用语义化 `<table>`，列为“学生”“学习状态”“任务完成”“最近活跃”。状态映射固定为：

```ts
const studentStatusLabel = {
  creating: '创作中',
  completed: '本周任务完成',
  needs_attention: '需要关注',
} as const
```

表格外层使用 `overflow-x-auto`；`needs_attention` 使用橙色状态标签，其余状态使用蓝色或绿色标签。

- [ ] **Step 4: 实现课节进度列表**

每项显示顺序、课节标题和状态。状态映射固定为：

```ts
const lessonStatusLabel = {
  completed: '已完成',
  next: '下一节',
  locked: '未开始',
} as const
```

使用 Lucide 的 `CheckCircle2`、`PlayCircle` 和 `LockKeyhole`，不使用字符图标或自制 SVG。

- [ ] **Step 5: 运行区块测试和类型检查**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-detail-sections.test.tsx`

Run: `pnpm.cmd type-check`

Expected: 区块测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 6: 提交详情区块**

```powershell
git add packages/web/src/features/teacher/teacher-student-roster.tsx packages/web/src/features/teacher/teacher-lesson-progress-list.tsx packages/web/src/features/teacher/teacher-class-detail-sections.test.tsx
git commit -m "feat(web): add teacher class detail sections"
```

### Task 4: 实现班级详情并连接开课流程

**Files:**
- Create: `packages/web/src/features/teacher/teacher-class-detail-page.tsx`
- Test: `packages/web/src/features/teacher/teacher-class-detail-page.test.tsx`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Consumes: `useParams()`、`useTeacherWorkspace()`、`getTeacherClassDetail`、`createDefaultStartClassInput`、`StartClassDialog`。
- Produces: `TeacherClassDetailPage`，挂载于 `/teacher/classes/:classId`。

- [ ] **Step 1: 编写失败的详情页面测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherClassDetailPage } from './teacher-class-detail-page'

describe('TeacherClassDetailPage', () => {
  it('展示班级详情和下一课节入口', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/classes/creative-2a']}>
        <Routes><Route path="/teacher/classes/:classId" element={<TeacherClassDetailPage />} /></Routes>
      </MemoryRouter>,
    )
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('学生名单')
    expect(markup).toContain('课程进度')
    expect(markup).toContain('准备上课')
  })
})
```

- [ ] **Step 2: 运行测试并确认详情页面缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-detail-page.test.tsx`

Expected: FAIL，提示无法加载 `teacher-class-detail-page`。

- [ ] **Step 3: 实现详情页面主体**

通过 `classId` 查询详情；无详情时返回 `<Navigate to="/teacher/classes" replace />`。有效详情展示标题、课程名、学生数、进度、完成率、`TeacherStudentRoster`、`TeacherLessonProgressList` 和该班级近期课堂记录。

- [ ] **Step 4: 连接下一课节与开课弹窗**

根据 `detail.summary.nextLessonId` 在 `data.lessons` 和 `data.todaySchedule` 中查找课节和安排。点击“准备上课”时调用 `createDefaultStartClassInput(schedule)`；确认处理固定为：

```ts
start(startInput)
toast.success('课堂已开始')
navigate('/teacher/classroom/active')
```

已结课或不存在下一课节时不渲染“准备上课”。已有课堂导致的 `startClass` 错误不得被吞掉；按钮在 `data.activeSession` 存在时禁用并显示“已有课堂进行中”。

- [ ] **Step 5: 注册列表与详情路由**

在 `main.tsx` 导入两个页面，将现有动态占位路由之前加入：

```tsx
<Route path="classes" element={<TeacherClassesPage />} />
<Route path="classes/:classId" element={<TeacherClassDetailPage />} />
```

- [ ] **Step 6: 运行详情测试、路由相关测试和类型检查**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-class-detail-page.test.tsx src/features/teacher/teacher-layout.test.tsx`

Run: `pnpm.cmd type-check`

Expected: 详情与布局测试 PASS，类型检查退出码为 0。

- [ ] **Step 7: 提交详情与开课连接**

```powershell
git add packages/web/src/features/teacher/teacher-class-detail-page.tsx packages/web/src/features/teacher/teacher-class-detail-page.test.tsx packages/web/src/main.tsx
git commit -m "feat(web): add teacher class detail flow"
```

### Task 5: 移除班级占位并完成整体验证

**Files:**
- Modify: `packages/web/src/features/teacher/teacher-placeholder-page.tsx`
- Modify: `packages/web/src/features/teacher/teacher-placeholder-page.test.tsx`

**Interfaces:**
- Consumes: `teacherPlaceholderRoutes`。
- Produces: 仅包含 `courses`、`works`、`students`、`records` 的后续模块占位路由。

- [ ] **Step 1: 更新占位路由失败测试**

将路径断言修改为：

```ts
expect(teacherPlaceholderRoutes.map((item) => item.path)).toEqual([
  'courses',
  'works',
  'students',
  'records',
])
expect(teacherPlaceholderRoutes.some((item) => item.path === 'classes')).toBe(false)
```

- [ ] **Step 2: 运行测试并确认仍包含班级占位**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-placeholder-page.test.tsx`

Expected: FAIL，因为当前数组仍包含 `classes`。

- [ ] **Step 3: 从占位配置移除班级管理**

删除 `teacherPlaceholderRoutes` 中 `path: 'classes'` 的对象，其余四项文案保持不变。`main.tsx` 中动态映射将自动只注册剩余占位路由。

- [ ] **Step 4: 运行全部 Web 测试**

Run: `pnpm.cmd --filter @ai-xiaobao/web test`

Expected: 所有测试文件 PASS，失败数为 0。

- [ ] **Step 5: 运行完整质量检查**

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd lint`

Run: `pnpm.cmd --filter @ai-xiaobao/web build`

Expected: 三个命令退出码均为 0；允许现有依赖弃用和构建块体积警告，但不得忽略错误。

- [ ] **Step 6: 检查修改范围**

Run: `git status --short`

Expected: 仅出现本计划列出的教师端文件和必要的 `main.tsx`；用户原有 `index.css` 与 `main.tsx` 主题修改保持存在且不被覆盖。

- [ ] **Step 7: 提交完整班级管理切片**

```powershell
git add packages/web/src/features/teacher/teacher-placeholder-page.tsx packages/web/src/features/teacher/teacher-placeholder-page.test.tsx
git commit -m "feat(web): complete teacher class management"
```

## Self-Review Result

- Spec coverage：班级指标、搜索与状态筛选、班级卡片、详情、学生名单、课节进度、近期课堂、无效 ID、空结果和现有开课流程均有对应任务。
- Scope：不包含班级写操作、学生导入、教务收费或后端持久化。
- Type consistency：`TeacherClassDetail`、`TeacherStudentSummary`、`TeacherLessonProgress`、`TeacherClassFilter` 的名称和字段在所有任务中一致。
- Safety：保留用户未提交主题修改，不触碰学生端与 `/admin` 导航，不增加动态日志。
