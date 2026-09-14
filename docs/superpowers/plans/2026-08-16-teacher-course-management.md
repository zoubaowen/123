# 教师端课程管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/teacher/courses` 建成可筛选的课程中心，并打通课程详情、课时备课、班级分配与现有开课流程。

**Architecture:** 在现有教师领域数据中增加独立课程集合，通过纯函数课程仓库完成筛选、详情查找、课时校验、指标统计和演示分配更新。课程中心、课程详情和课时备课各自保持单一页面职责；共享教师上下文只增加课程分配写操作，活动课堂继续复用现有 `startClass` 与 `StartClassDialog`。

**Tech Stack:** React 19、TypeScript 5.7、React Router 7、Tailwind CSS 4、现有 shadcn/ui、Vitest、Lucide React、`@ai-xiaobao/chat-core`。

## Global Constraints

- 教师端只使用 `/teacher/*`，不得混入学生 `AppLayout` 或 `/admin` 技术运维导航。
- 本阶段只使用类型明确的演示数据，不新增后端接口。
- 不展示新建、删除、文件上传、富文本编辑和云端持久化等未实现能力。
- 课程封面使用已有项目资源；图标使用 Lucide；小宝必须使用 `@ai-xiaobao/chat-core` 九宫格标准生产资源。
- 日志只能使用静态字符串，不得输出动态标识、路径、密钥或令牌。
- 复用 `packages/web/src/components/ui/` 中已有组件，不手写已有 shadcn 组件的替代品。
- 不启动开发服务器；验证使用测试、类型检查、代码规范检查和正式构建。
- 保留用户对 `packages/web/src/index.css` 与 `packages/web/src/main.tsx` 的未提交主题修改。
- 提交时只暂存计划明确列出的文件，避免全仓库格式化噪音进入提交。

---

## File Map

- `packages/web/src/features/teacher/types.ts`：新增课程、章节、课时、资源与配置类型，并扩展教师数据根类型。
- `packages/web/src/features/teacher/demo-data.ts`：提供两套课程、章节、课时、资源及班级分配演示数据。
- `packages/web/src/features/teacher/teacher-course-repository.ts`：课程筛选、指标、详情、课时查找、分配更新和开课输入构造。
- `packages/web/src/features/teacher/teacher-course-repository.test.ts`：课程仓库纯函数测试。
- `packages/web/src/features/teacher/teacher-course-card.tsx`：课程摘要卡片。
- `packages/web/src/features/teacher/teacher-courses-page.tsx`：课程中心、指标、搜索和筛选。
- `packages/web/src/features/teacher/teacher-courses-page.test.tsx`：课程中心与空结果测试。
- `packages/web/src/features/teacher/teacher-course-outline.tsx`：章节和课时编排。
- `packages/web/src/features/teacher/teacher-course-detail-page.tsx`：课程详情及班级分配。
- `packages/web/src/features/teacher/teacher-course-detail-page.test.tsx`：详情、分配和无效课程测试。
- `packages/web/src/features/teacher/teacher-lesson-resource-list.tsx`：课件、示范、作业和资源清单。
- `packages/web/src/features/teacher/teacher-lesson-ai-config.tsx`：AI 能力、Skills 与 MCP 摘要。
- `packages/web/src/features/teacher/teacher-lesson-preparation-page.tsx`：课时备课和开课联动。
- `packages/web/src/features/teacher/teacher-lesson-preparation-page.test.tsx`：备课内容、无效课时和开课入口测试。
- `packages/web/src/features/teacher/teacher-provider.tsx`：暴露演示课程分配更新操作。
- `packages/web/src/features/teacher/teacher-placeholder-page.tsx`：移除课程中心占位配置。
- `packages/web/src/features/teacher/teacher-placeholder-page.test.tsx`：更新剩余占位路由断言。
- `packages/web/src/main.tsx`：注册课程中心、详情和课时备课路由。

### Task 1: 建立课程领域模型与查询仓库

**Files:**
- Modify: `packages/web/src/features/teacher/types.ts`
- Modify: `packages/web/src/features/teacher/demo-data.ts`
- Create: `packages/web/src/features/teacher/teacher-course-repository.ts`
- Test: `packages/web/src/features/teacher/teacher-course-repository.test.ts`

**Interfaces:**
- Consumes: `TeacherDashboardData`、`TeacherClassSummary`、`TeacherCapability`、`StartClassInput`。
- Produces: `TeacherCourseDetail`、`TeacherCourseFilter`、`filterTeacherCourses`、`getTeacherCourseMetrics`、`getTeacherCourseDetail`、`getTeacherCourseLesson`、`assignCourseToClasses`、`createCourseLessonStartInput`。

- [ ] **Step 1: 编写失败的课程仓库测试**

```ts
import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import {
  assignCourseToClasses,
  createCourseLessonStartInput,
  filterTeacherCourses,
  getTeacherCourseLesson,
  getTeacherCourseMetrics,
} from './teacher-course-repository'

describe('teacher course repository', () => {
  it('组合名称、学段、主题和状态筛选课程', () => {
    const courses = filterTeacherCourses(teacherDashboardDemo, {
      query: '太空',
      stage: 'lower_primary',
      topic: '视觉创作',
      status: 'ready',
    })
    expect(courses.map((course) => course.id)).toEqual(['space-poster'])
  })

  it('汇总课程、课时、已分配班级和待完善数量', () => {
    expect(getTeacherCourseMetrics(teacherDashboardDemo)).toEqual({
      courseCount: 2,
      lessonCount: 8,
      assignedClassCount: 2,
      draftCourseCount: 1,
    })
  })

  it('只返回属于指定课程的课时', () => {
    expect(getTeacherCourseLesson(teacherDashboardDemo, 'space-poster', 'space-poster-03')?.title)
      .toBe('让太空校园海报动起来')
    expect(getTeacherCourseLesson(teacherDashboardDemo, 'space-poster', 'bounce-game-02')).toBeUndefined()
  })

  it('分配班级时去重并忽略不存在的班级', () => {
    const next = assignCourseToClasses(teacherDashboardDemo, 'space-poster', ['creative-2a', 'creative-2a', 'missing'])
    expect(next.courses[0].assignedClassIds).toEqual(['creative-2a'])
  })

  it('使用课时推荐配置构造开课输入', () => {
    expect(createCourseLessonStartInput(teacherDashboardDemo, 'space-poster', 'space-poster-03', 'creative-2a'))
      .toMatchObject({
        classId: 'creative-2a',
        lessonId: 'space-poster-03',
        capabilities: ['chat', 'image', 'video'],
      })
  })
})
```

- [ ] **Step 2: 运行测试并确认仓库缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-course-repository.test.ts`

Expected: FAIL，提示无法加载 `teacher-course-repository`。

- [ ] **Step 3: 增加课程领域类型**

在 `types.ts` 增加：

```ts
export type TeacherCourseStatus = 'ready' | 'draft'
export type TeacherCourseStage = 'lower_primary' | 'upper_primary' | 'middle_school'
export type TeacherLessonResourceType = 'slides' | 'demo' | 'worksheet' | 'assignment'

export interface TeacherCourseSummary {
  id: string
  title: string
  description: string
  coverAsset: string
  stage: TeacherCourseStage
  topic: string
  status: TeacherCourseStatus
  lessonCount: number
  completion: number
  assignedClassIds: string[]
}

export interface TeacherLessonResource {
  id: string
  title: string
  type: TeacherLessonResourceType
  status: 'ready' | 'planned'
}

export interface TeacherCourseLessonDetail {
  id: string
  title: string
  durationMinutes: number
  completion: number
  objectives: string[]
  steps: string[]
  teacherTips: string[]
  resources: TeacherLessonResource[]
  assignment: string
  capabilities: TeacherCapability[]
  skills: string[]
  mcpServers: string[]
}

export interface TeacherCourseChapter {
  id: string
  title: string
  order: number
  lessons: TeacherCourseLessonDetail[]
}

export interface TeacherCourseDetail extends TeacherCourseSummary {
  ageRange: string
  goals: string[]
  expectedOutcome: string
  chapters: TeacherCourseChapter[]
}
```

并在 `TeacherDashboardData` 增加 `courses: TeacherCourseDetail[]`。

- [ ] **Step 4: 添加两套结构完整的演示课程**

在 `demo-data.ts` 添加 `space-poster` 与 `bounce-game`。每套课程各含两个章节、四个课时；`space-poster` 为 `ready` 并分配 `creative-2a`，`bounce-game` 为 `draft` 并分配 `game-4b`。课时 ID 必须与现有 `data.lessons` 保持一致，额外课时同时补入 `data.lessons`，使 `startClass` 能校验通过。

课程封面路径使用已存在的小宝或品牌图片资源；不得新增临时占位图。

- [ ] **Step 5: 实现课程纯函数仓库**

```ts
export type TeacherCourseFilter = {
  query: string
  stage: 'all' | TeacherCourseStage
  topic: 'all' | string
  status: 'all' | TeacherCourseStatus
}

export function getTeacherCourseDetail(data: TeacherDashboardData, courseId: string) {
  return data.courses.find((course) => course.id === courseId)
}

export function getTeacherCourseLesson(data: TeacherDashboardData, courseId: string, lessonId: string) {
  return getTeacherCourseDetail(data, courseId)?.chapters
    .flatMap((chapter) => chapter.lessons)
    .find((lesson) => lesson.id === lessonId)
}

export function assignCourseToClasses(data: TeacherDashboardData, courseId: string, classIds: string[]) {
  const validClassIds = new Set(data.classes.map((item) => item.id))
  const assignedClassIds = [...new Set(classIds)].filter((id) => validClassIds.has(id))
  return {
    ...data,
    courses: data.courses.map((course) => course.id === courseId ? { ...course, assignedClassIds } : course),
  }
}
```

`filterTeacherCourses` 依次应用四个筛选字段；`getTeacherCourseMetrics` 对课程与去重后的班级 ID 汇总。`createCourseLessonStartInput` 必须同时校验课程、课时和已分配班级，成功时返回推荐能力、Skills、MCP 和 `pointLimit: 80`，无效时返回 `undefined`。

- [ ] **Step 6: 运行仓库测试和类型检查**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-course-repository.test.ts`

Run: `pnpm.cmd type-check`

Expected: 仓库测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 7: 提交课程模型和仓库**

```powershell
git add packages/web/src/features/teacher/types.ts packages/web/src/features/teacher/demo-data.ts packages/web/src/features/teacher/teacher-course-repository.ts packages/web/src/features/teacher/teacher-course-repository.test.ts
git commit -m "feat(web): add teacher course repository"
```

### Task 2: 实现课程中心与筛选

**Files:**
- Create: `packages/web/src/features/teacher/teacher-course-card.tsx`
- Create: `packages/web/src/features/teacher/teacher-courses-page.tsx`
- Test: `packages/web/src/features/teacher/teacher-courses-page.test.tsx`

**Interfaces:**
- Consumes: `useTeacherWorkspace()`、`TeacherCourseSummary`、`filterTeacherCourses`、`getTeacherCourseMetrics`。
- Produces: `TeacherCourseCard`、`TeacherCoursesPage`。

- [ ] **Step 1: 编写失败的课程中心测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherCoursesPage } from './teacher-courses-page'

describe('TeacherCoursesPage', () => {
  it('展示课程指标和课程卡片', () => {
    const markup = renderToStaticMarkup(<MemoryRouter><TeacherCoursesPage /></MemoryRouter>)
    expect(markup).toContain('课程中心')
    expect(markup).toContain('AI 太空海报创作营')
    expect(markup).toContain('弹跳球游戏设计')
    expect(markup).toContain('8')
    expect(markup).toContain('查看课程')
  })

  it('为无结果筛选展示恢复入口', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter><TeacherCoursesPage initialQuery="不存在" /></MemoryRouter>,
    )
    expect(markup).toContain('没有找到课程')
    expect(markup).toContain('清除筛选')
    expect(markup).not.toContain('查看课程')
  })
})
```

- [ ] **Step 2: 运行测试并确认页面缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-courses-page.test.tsx`

Expected: FAIL，提示无法加载 `teacher-courses-page`。

- [ ] **Step 3: 实现课程卡片**

`TeacherCourseCard` 接收 `course: TeacherCourseSummary`，使用真实 `coverAsset` 图片、状态标签、学段、主题、课时数、班级数和完善度进度条。主操作固定为：

```tsx
<Button asChild>
  <Link to={`/teacher/courses/${course.id}`}>查看课程</Link>
</Button>
```

图片提供准确 `alt`；图片失败时隐藏图片区域，不画占位插画。

- [ ] **Step 4: 实现课程中心**

页面保存以下状态：

```ts
const [query, setQuery] = useState(initialQuery)
const [stage, setStage] = useState<TeacherCourseFilter['stage']>('all')
const [topic, setTopic] = useState<TeacherCourseFilter['topic']>('all')
const [status, setStatus] = useState<TeacherCourseFilter['status']>('all')
```

摘要显示四项仓库指标。筛选控件使用现有 `Input` 与 `Select`；课程卡片采用响应式 `lg:grid-cols-3 md:grid-cols-2`。有结果时在列表后使用 `<XiaoBao outfit="academy" ... />` 给出备课提示；无结果时仅显示空状态和清除按钮。

- [ ] **Step 5: 运行课程中心测试和完整 Web 测试**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-courses-page.test.tsx`

Run: `pnpm.cmd --filter @ai-xiaobao/web test`

Expected: 新测试和现有 Web 测试全部 PASS。

- [ ] **Step 6: 提交课程中心**

```powershell
git add packages/web/src/features/teacher/teacher-course-card.tsx packages/web/src/features/teacher/teacher-courses-page.tsx packages/web/src/features/teacher/teacher-courses-page.test.tsx
git commit -m "feat(web): add teacher course center"
```

### Task 3: 实现课程详情、课时编排和班级分配

**Files:**
- Create: `packages/web/src/features/teacher/teacher-course-outline.tsx`
- Create: `packages/web/src/features/teacher/teacher-course-detail-page.tsx`
- Test: `packages/web/src/features/teacher/teacher-course-detail-page.test.tsx`
- Modify: `packages/web/src/features/teacher/teacher-provider.tsx`

**Interfaces:**
- Consumes: `getTeacherCourseDetail`、`assignCourseToClasses`、`useTeacherWorkspace()`、`TeacherCourseChapter[]`。
- Produces: `TeacherCourseOutline`、`TeacherCourseDetailPage`、上下文方法 `assignCourse(courseId, classIds)`。

- [ ] **Step 1: 编写失败的详情与分配测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherCourseDetailPage } from './teacher-course-detail-page'

describe('TeacherCourseDetailPage', () => {
  it('展示课程目标、章节课时和班级分配', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/courses/space-poster']}>
        <Routes><Route path="/teacher/courses/:courseId" element={<TeacherCourseDetailPage />} /></Routes>
      </MemoryRouter>,
    )
    expect(markup).toContain('AI 太空海报创作营')
    expect(markup).toContain('课程目标')
    expect(markup).toContain('章节与课时')
    expect(markup).toContain('让太空校园海报动起来')
    expect(markup).toContain('二年级创作 A 班')
    expect(markup).toContain('保存本次演示配置')
  })
})
```

- [ ] **Step 2: 运行测试并确认详情页缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-course-detail-page.test.tsx`

Expected: FAIL，提示无法加载 `teacher-course-detail-page`。

- [ ] **Step 3: 扩展教师上下文的课程分配操作**

在上下文类型和默认值中增加：

```ts
assignCourse: (courseId: string, classIds: string[]) => void
```

Provider 实现固定为：

```ts
assignCourse: (courseId, classIds) =>
  setData((current) => assignCourseToClasses(current, courseId, classIds))
```

- [ ] **Step 4: 实现章节与课时组件**

`TeacherCourseOutline` 接收 `courseId` 与 `chapters`。每个章节显示顺序和标题；每个课时显示标题、建议时长、完善度，并通过以下链接进入备课：

```tsx
<Link to={`/teacher/courses/${courseId}/lessons/${lesson.id}`}>准备课时</Link>
```

- [ ] **Step 5: 实现课程详情与分配**

页面通过 `courseId` 查询课程；无效时返回 `<Navigate to="/teacher/courses" replace />`。有效页面展示课程目标、年龄、预期作品、能力标签、`TeacherCourseOutline` 和班级复选框。

复选框维护局部 `selectedClassIds`，点击“保存本次演示配置”时调用 `assignCourse(course.id, selectedClassIds)`，然后显示静态成功文案“本次演示配置已保存”。不得出现“已同步到云端”等表述。

- [ ] **Step 6: 运行详情测试、Provider 回归和类型检查**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-course-detail-page.test.tsx src/features/teacher/teacher-store.test.ts`

Run: `pnpm.cmd type-check`

Expected: 测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 7: 提交课程详情**

```powershell
git add packages/web/src/features/teacher/teacher-provider.tsx packages/web/src/features/teacher/teacher-course-outline.tsx packages/web/src/features/teacher/teacher-course-detail-page.tsx packages/web/src/features/teacher/teacher-course-detail-page.test.tsx
git commit -m "feat(web): add teacher course detail"
```

### Task 4: 实现课时备课和开课联动

**Files:**
- Create: `packages/web/src/features/teacher/teacher-lesson-resource-list.tsx`
- Create: `packages/web/src/features/teacher/teacher-lesson-ai-config.tsx`
- Create: `packages/web/src/features/teacher/teacher-lesson-preparation-page.tsx`
- Test: `packages/web/src/features/teacher/teacher-lesson-preparation-page.test.tsx`

**Interfaces:**
- Consumes: `getTeacherCourseDetail`、`getTeacherCourseLesson`、`createCourseLessonStartInput`、`StartClassDialog`、`useTeacherWorkspace()`。
- Produces: `TeacherLessonResourceList`、`TeacherLessonAiConfig`、`TeacherLessonPreparationPage`。

- [ ] **Step 1: 编写失败的备课页测试**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherLessonPreparationPage } from './teacher-lesson-preparation-page'

describe('TeacherLessonPreparationPage', () => {
  it('展示课时目标、步骤、资源和 AI 配置', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={['/teacher/courses/space-poster/lessons/space-poster-03']}>
        <Routes>
          <Route path="/teacher/courses/:courseId/lessons/:lessonId" element={<TeacherLessonPreparationPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(markup).toContain('让太空校园海报动起来')
    expect(markup).toContain('教学目标')
    expect(markup).toContain('课堂步骤')
    expect(markup).toContain('教学资源')
    expect(markup).toContain('课堂 Skills')
    expect(markup).toContain('开始上课')
  })
})
```

- [ ] **Step 2: 运行测试并确认备课页缺失**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-lesson-preparation-page.test.tsx`

Expected: FAIL，提示无法加载 `teacher-lesson-preparation-page`。

- [ ] **Step 3: 实现资源和 AI 配置组件**

`TeacherLessonResourceList` 按 `slides`、`demo`、`worksheet`、`assignment` 映射 Lucide 图标和中文标签，同时显示 `ready` 或 `planned` 文字状态。`TeacherLessonAiConfig` 分三列展示能力、Skills、MCP；能力使用既有中文映射，列表为空时明确显示“本课时未配置”。

- [ ] **Step 4: 实现课时备课页面**

校验 `courseId` 和 `lessonId`；课程无效返回课程中心，课时无效或不属于课程时返回对应课程详情。页面展示目标、步骤、教师提示、作业、资源和 AI 配置。

从 `course.assignedClassIds` 中选择首个有效班级作为默认班级；没有已分配班级时禁用“开始上课”，显示“请先返回课程详情分配班级”。有班级时调用：

```ts
const input = createCourseLessonStartInput(data, course.id, lesson.id, assignedClassId)
setStartInput(input)
setDialogOpen(Boolean(input))
```

确认弹窗时执行：

```ts
start(startInput)
toast.success('课堂已开始')
navigate('/teacher/classroom/active')
```

已有 `data.activeSession` 时禁用按钮并显示“已有课堂进行中”。

- [ ] **Step 5: 运行备课页、开课和活动课堂测试**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-lesson-preparation-page.test.tsx src/features/teacher/start-class-dialog.test.tsx src/features/teacher/active-class-page.test.tsx`

Run: `pnpm.cmd type-check`

Expected: 测试全部 PASS，类型检查退出码为 0。

- [ ] **Step 6: 提交课时备课与开课连接**

```powershell
git add packages/web/src/features/teacher/teacher-lesson-resource-list.tsx packages/web/src/features/teacher/teacher-lesson-ai-config.tsx packages/web/src/features/teacher/teacher-lesson-preparation-page.tsx packages/web/src/features/teacher/teacher-lesson-preparation-page.test.tsx
git commit -m "feat(web): add teacher lesson preparation"
```

### Task 5: 注册路由、移除占位并完成整体验证

**Files:**
- Modify: `packages/web/src/main.tsx`
- Modify: `packages/web/src/features/teacher/teacher-placeholder-page.tsx`
- Modify: `packages/web/src/features/teacher/teacher-placeholder-page.test.tsx`

**Interfaces:**
- Consumes: `TeacherCoursesPage`、`TeacherCourseDetailPage`、`TeacherLessonPreparationPage`、`teacherPlaceholderRoutes`。
- Produces: 三条真实课程路由，以及仅包含 `works`、`students`、`records` 的后续占位路由。

- [ ] **Step 1: 更新占位路由失败测试**

```ts
expect(teacherPlaceholderRoutes.map((item) => item.path)).toEqual([
  'works',
  'students',
  'records',
])
```

- [ ] **Step 2: 运行测试并确认仍包含课程占位**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-placeholder-page.test.tsx`

Expected: FAIL，因为当前数组仍包含 `courses`。

- [ ] **Step 3: 注册真实课程路由并移除占位**

从 `teacherPlaceholderRoutes` 删除 `courses`。在 `main.tsx` 导入三个真实页面，并在动态占位映射之前注册：

```tsx
<Route path="courses" element={<TeacherCoursesPage />} />
<Route path="courses/:courseId" element={<TeacherCourseDetailPage />} />
<Route path="courses/:courseId/lessons/:lessonId" element={<TeacherLessonPreparationPage />} />
```

- [ ] **Step 4: 运行完整 Web 测试**

Run: `pnpm.cmd --filter @ai-xiaobao/web test`

Expected: 所有测试文件 PASS，失败数为 0。

- [ ] **Step 5: 运行完整质量检查**

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd lint --ignore-pattern ".worktrees/**" --ignore-pattern "**/dist/**"`

Run: `pnpm.cmd --filter @ai-xiaobao/web build`

Expected: 三个命令退出码均为 0；允许既有依赖弃用和构建块体积警告，但不得忽略错误。

- [ ] **Step 6: 检查修改范围**

Run: `git diff --check`

Run: `git status --short`

Expected: 只出现本计划列出的课程模块文件与必要的 `main.tsx`；隔离区内没有用户主题改动，主工作区的 `index.css` 与 `main.tsx` 仍保持原状态。

- [ ] **Step 7: 提交完整课程管理切片**

```powershell
git add packages/web/src/main.tsx packages/web/src/features/teacher/teacher-placeholder-page.tsx packages/web/src/features/teacher/teacher-placeholder-page.test.tsx
git commit -m "feat(web): complete teacher course management"
```

## Self-Review Result

- Spec coverage：课程指标、搜索、学段/主题/状态筛选、课程卡片、详情、章节课时、班级分配、课时目标、步骤、资源、作业、Skills、MCP、无效 ID、未分配班级和开课联动均有对应任务。
- Scope：不包含课程生产编辑器、上传、后端持久化、Skills/MCP 安装授权、课程市场或学生端课程学习页。
- Type consistency：`TeacherCourseDetail`、`TeacherCourseLessonDetail`、`TeacherCourseFilter`、`assignCourseToClasses` 与 `createCourseLessonStartInput` 在前后任务中的名称和字段一致。
- Safety：课程只进入 `/teacher/*`；不触碰 `/admin` 与学生布局；不新增动态日志；保留用户主题修改。

