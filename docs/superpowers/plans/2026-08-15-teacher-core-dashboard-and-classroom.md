# Teacher Core Dashboard and Classroom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the independent `/teacher` teaching workspace with its own navigation, realistic dashboard data, and a working start/end-class interaction loop.

**Architecture:** Add a self-contained `teacher` feature directory in the existing React web package. A small typed demo repository supplies institution, schedule, class, and lesson-session data; route pages consume that repository through focused components, while `/admin` and the student workspace remain untouched.

**Tech Stack:** React 19, TypeScript 5.7, React Router 7, Tailwind CSS 4, shadcn/ui components already present in the repository, Vitest, Lucide React, existing `XiaoBao` raster character component.

## Global Constraints

- Teacher routes use `/teacher/*`; platform operations remain under `/admin/*`.
- Do not add teacher navigation to the student `AppLayout` or student workspace sidebar.
- Reuse existing UI primitives from `packages/web/src/components/ui/`; do not hand-write replacements for available shadcn components.
- Logs must use static strings only and must not expose identifiers, paths, tokens, or environment values.
- First delivery uses realistic typed demo data and no new backend/API endpoints.
- Xiaobao must use the production nine-grid raster assets through `@ai-xiaobao/chat-core`.
- Verify with `pnpm.cmd --filter @ai-xiaobao/web test`, `pnpm.cmd type-check`, `pnpm.cmd lint`, and `pnpm.cmd --filter @ai-xiaobao/web build`.

---

## File Map

- `packages/web/src/features/teacher/types.ts`: teacher-domain value types and session state contracts.
- `packages/web/src/features/teacher/demo-data.ts`: realistic institution, schedule, class, course, and review fixtures.
- `packages/web/src/features/teacher/teacher-store.ts`: pure functions for starting and ending a class session.
- `packages/web/src/features/teacher/teacher-store.test.ts`: state-transition tests.
- `packages/web/src/features/teacher/teacher-layout.tsx`: teacher-only shell, navigation, organization identity, and profile area.
- `packages/web/src/features/teacher/teacher-layout.test.tsx`: shell and navigation contract tests.
- `packages/web/src/features/teacher/teacher-dashboard-page.tsx`: daily teaching overview and primary start-class action.
- `packages/web/src/features/teacher/teacher-dashboard-page.test.tsx`: dashboard content and interaction tests.
- `packages/web/src/features/teacher/start-class-dialog.tsx`: lesson, quota, capability, Skills, and MCP configuration form.
- `packages/web/src/features/teacher/active-class-page.tsx`: active classroom view and end-class action.
- `packages/web/src/features/teacher/class-session-flow.test.tsx`: complete start/end-class flow test.
- `packages/web/src/features/teacher/teacher-placeholder-page.tsx`: explicit placeholders for later class, course, work, student, and record modules.
- `packages/web/src/main.tsx`: register independent `/teacher/*` routes.

### Task 1: Define the Teacher Domain and Demo Repository

**Files:**
- Create: `packages/web/src/features/teacher/types.ts`
- Create: `packages/web/src/features/teacher/demo-data.ts`
- Create: `packages/web/src/features/teacher/teacher-store.ts`
- Test: `packages/web/src/features/teacher/teacher-store.test.ts`

**Interfaces:**
- Produces: `TeacherDashboardData`, `ClassSession`, `StartClassInput`, `startClass(data, input)`, and `endClass(data)`.
- Consumes: no teacher feature dependencies.

- [ ] **Step 1: Write the failing state-transition tests**

```ts
import { describe, expect, it } from 'vitest'
import { teacherDashboardDemo } from './demo-data'
import { endClass, startClass } from './teacher-store'

describe('teacher classroom state', () => {
  it('starts the selected lesson with explicit classroom capabilities', () => {
    const next = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 120,
      capabilities: ['chat', 'image'],
      skills: ['poster-designer'],
      mcpServers: ['safe-image-library'],
    })
    expect(next.activeSession?.className).toBe('二年级创作 A 班')
    expect(next.activeSession?.capabilities).toEqual(['chat', 'image'])
  })

  it('ends the active class and appends one classroom record', () => {
    const started = startClass(teacherDashboardDemo, {
      classId: 'creative-2a',
      lessonId: 'space-poster-03',
      pointLimit: 120,
      capabilities: ['chat'],
      skills: [],
      mcpServers: [],
    })
    const ended = endClass(started)
    expect(ended.activeSession).toBeNull()
    expect(ended.recentSessions).toHaveLength(teacherDashboardDemo.recentSessions.length + 1)
  })
})
```

- [ ] **Step 2: Run the tests and confirm the missing-module failure**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-store.test.ts`

Expected: FAIL because the teacher domain modules do not exist.

- [ ] **Step 3: Implement typed data and pure state transitions**

Define capability IDs as `'chat' | 'image' | 'music' | 'video' | 'code'`, use immutable object updates, reject a second start when `activeSession` already exists, and make `endClass` return the original data when no session is active.

- [ ] **Step 4: Run the state tests**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-store.test.ts`

Expected: both tests PASS.

- [ ] **Step 5: Commit the teacher domain**

```powershell
git add packages/web/src/features/teacher/types.ts packages/web/src/features/teacher/demo-data.ts packages/web/src/features/teacher/teacher-store.ts packages/web/src/features/teacher/teacher-store.test.ts
git commit -m "feat(web): add teacher classroom domain"
```

### Task 2: Build the Independent Teacher Shell

**Files:**
- Create: `packages/web/src/features/teacher/teacher-layout.tsx`
- Create: `packages/web/src/features/teacher/teacher-layout.test.tsx`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Consumes: `XiaoBao` from `@ai-xiaobao/chat-core` and `Outlet` from React Router.
- Produces: `TeacherLayout`, mounted at `/teacher/*`.

- [ ] **Step 1: Write the failing shell test**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { TeacherLayout } from './teacher-layout'

describe('TeacherLayout', () => {
  it('shows teaching navigation without platform operations', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <TeacherLayout />
      </MemoryRouter>,
    )
    expect(markup).toContain('教学首页')
    expect(markup).toContain('班级管理')
    expect(markup).toContain('课程中心')
    expect(markup).not.toContain('运行环境')
    expect(markup).not.toContain('系统日志')
  })
})
```

- [ ] **Step 2: Run the shell test and confirm failure**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-layout.test.tsx`

Expected: FAIL because `TeacherLayout` is missing.

- [ ] **Step 3: Implement the teacher layout**

Create a 248px light sidebar with the AI小宝学院 identity, institution name “星河青少年创新中心”, role badge “授课老师”, and routes for teaching dashboard, classes, courses, works, students, and classroom records. Use the production `academy` Xiaobao at 44px in the brand header and keep `/admin` navigation out of this file.

- [ ] **Step 4: Register the independent routes**

Add a `/teacher/*` parent route in `main.tsx`, wrapped in `RequireAuth`, with `/teacher` redirecting to `/teacher/dashboard`. Do not place it inside `AppLayout` or `AdminLayout`.

- [ ] **Step 5: Run the shell test and type-check**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-layout.test.tsx`

Run: `pnpm.cmd type-check`

Expected: PASS and zero TypeScript errors.

- [ ] **Step 6: Commit the shell**

```powershell
git add packages/web/src/features/teacher/teacher-layout.tsx packages/web/src/features/teacher/teacher-layout.test.tsx packages/web/src/main.tsx
git commit -m "feat(web): add independent teacher workspace"
```

### Task 3: Build the Daily Teaching Dashboard

**Files:**
- Create: `packages/web/src/features/teacher/teacher-dashboard-page.tsx`
- Create: `packages/web/src/features/teacher/teacher-dashboard-page.test.tsx`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Consumes: `teacherDashboardDemo` and `TeacherDashboardData`.
- Produces: `TeacherDashboardPage` with `onStartClass(scheduleId: string)`.

- [ ] **Step 1: Write the failing dashboard test**

```tsx
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TeacherDashboardPage } from './teacher-dashboard-page'

describe('TeacherDashboardPage', () => {
  it('prioritizes today teaching and pending reviews', () => {
    const markup = renderToStaticMarkup(<TeacherDashboardPage />)
    expect(markup).toContain('今天要上的课')
    expect(markup).toContain('开始上课')
    expect(markup).toContain('待点评作品')
    expect(markup).toContain('二年级创作 A 班')
  })
})
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-dashboard-page.test.tsx`

Expected: FAIL because the dashboard page is missing.

- [ ] **Step 3: Implement the dashboard sections**

Build a page header, Xiaobao teaching reminder, four compact metrics, today schedule, class-progress cards, pending-review list, and recent-class records. The only filled primary CTA is “开始上课”; secondary actions use outline or ghost styling.

- [ ] **Step 4: Register `/teacher/dashboard` and run the test**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/teacher-dashboard-page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the dashboard**

```powershell
git add packages/web/src/features/teacher/teacher-dashboard-page.tsx packages/web/src/features/teacher/teacher-dashboard-page.test.tsx packages/web/src/main.tsx
git commit -m "feat(web): add teacher daily dashboard"
```

### Task 4: Implement Start-Class Configuration

**Files:**
- Create: `packages/web/src/features/teacher/start-class-dialog.tsx`
- Modify: `packages/web/src/features/teacher/teacher-dashboard-page.tsx`
- Test: `packages/web/src/features/teacher/class-session-flow.test.tsx`

**Interfaces:**
- Consumes: `StartClassInput`, schedule and lesson data.
- Produces: `StartClassDialog` with `onConfirm(input: StartClassInput)` and `onOpenChange(open: boolean)`.

- [ ] **Step 1: Write the failing start-class interaction test**

Use a DOM test to click “开始上课”, assert that “本节课允许的 AI 能力” appears, choose image generation, and submit. Assert that the active-session heading “正在上课” appears and names the selected class.

- [ ] **Step 2: Run the interaction test and confirm failure**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/class-session-flow.test.tsx`

Expected: FAIL because the dialog and interaction are not implemented.

- [ ] **Step 3: Implement the configuration form**

Use the existing Dialog, Checkbox, Input, Label, and Button components. Require one lesson, require at least `chat`, constrain point limit to 10–500, and provide explicit switches for image, music, video, and code. Include Skills choices `poster-designer`, `story-coach`, and `game-builder`, plus MCP choices `safe-image-library` and `course-resource-library`.

- [ ] **Step 4: Connect dashboard state**

Hold `TeacherDashboardData` in page state, call `startClass`, close the dialog, show a success toast, and navigate to `/teacher/classroom/active`.

- [ ] **Step 5: Run the interaction test**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/class-session-flow.test.tsx`

Expected: start-class flow PASS.

- [ ] **Step 6: Commit start-class configuration**

```powershell
git add packages/web/src/features/teacher/start-class-dialog.tsx packages/web/src/features/teacher/teacher-dashboard-page.tsx packages/web/src/features/teacher/class-session-flow.test.tsx
git commit -m "feat(web): add teacher start class flow"
```

### Task 5: Implement the Active Classroom and End-Class Flow

**Files:**
- Create: `packages/web/src/features/teacher/active-class-page.tsx`
- Modify: `packages/web/src/features/teacher/class-session-flow.test.tsx`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Consumes: `ClassSession` and `endClass`.
- Produces: `/teacher/classroom/active` page with `onEndClass()`.

- [ ] **Step 1: Extend the flow test for classroom completion**

After starting class, assert that the active classroom shows lesson title, elapsed-time label, student completion, capability badges, Skills, MCP permissions, and an “结束上课” button. Click it, confirm the dialog, and assert navigation back to the teaching dashboard with no active session.

- [ ] **Step 2: Run the extended test and confirm failure**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/class-session-flow.test.tsx`

Expected: FAIL at the missing active-classroom assertions.

- [ ] **Step 3: Implement the classroom page**

Build a compact lesson header, 16:9 lesson-content panel, student-status sidebar, permission summary, teacher-notes textarea, and a red-outline “结束上课” action. Use an AlertDialog before ending class.

- [ ] **Step 4: Wire the active classroom route**

Register `/teacher/classroom/active`. If no class is active, redirect to `/teacher/dashboard`; after ending class, append the record and return to the dashboard.

- [ ] **Step 5: Run the complete flow test**

Run: `pnpm.cmd --filter @ai-xiaobao/web test -- --run src/features/teacher/class-session-flow.test.tsx`

Expected: full start/end flow PASS.

- [ ] **Step 6: Commit the active classroom**

```powershell
git add packages/web/src/features/teacher/active-class-page.tsx packages/web/src/features/teacher/class-session-flow.test.tsx packages/web/src/main.tsx
git commit -m "feat(web): add active classroom experience"
```

### Task 6: Add Honest Placeholders and Verify the Slice

**Files:**
- Create: `packages/web/src/features/teacher/teacher-placeholder-page.tsx`
- Modify: `packages/web/src/main.tsx`

**Interfaces:**
- Consumes: title and next-deliverable copy.
- Produces: explicit placeholder routes for classes, courses, works, students, and records without fake management behavior.

- [ ] **Step 1: Add placeholder route coverage**

Extend `teacher-layout.test.tsx` to assert that every navigation destination has a registered route and that placeholder pages say “正在建设” rather than presenting nonfunctional controls.

- [ ] **Step 2: Implement and register placeholders**

Create routes `/teacher/classes`, `/teacher/courses`, `/teacher/works`, `/teacher/students`, and `/teacher/records`. Each page names the next planned capability and provides a working link back to the teaching dashboard.

- [ ] **Step 3: Run all web tests**

Run: `pnpm.cmd --filter @ai-xiaobao/web test`

Expected: all test files PASS with zero failures.

- [ ] **Step 4: Run required repository checks**

Run: `pnpm.cmd type-check`

Run: `pnpm.cmd lint`

Run: `pnpm.cmd --filter @ai-xiaobao/web build`

Expected: all commands exit 0. Existing dependency deprecation and chunk-size warnings may be reported but must not be converted into ignored errors.

- [ ] **Step 5: Perform desktop visual verification**

Inspect `/teacher/dashboard`, the start-class dialog, and `/teacher/classroom/active` at 1440×900 and 1366×768. Confirm no crop, overflow, text collision, broken transparency, or student/admin navigation leakage. Record the comparison in `design-qa.md` and require `final result: passed`.

- [ ] **Step 6: Commit the verified vertical slice**

```powershell
git add packages/web/src/features/teacher/teacher-placeholder-page.tsx packages/web/src/features/teacher/teacher-layout.test.tsx packages/web/src/main.tsx design-qa.md
git commit -m "feat(web): complete teacher dashboard classroom slice"
```

## Self-Review Result

- Spec coverage for this slice: independent teacher route, teacher-only shell, daily dashboard, start-class settings, Skills/MCP selection, active classroom, end-class record, responsive desktop verification.
- Deferred by design: full class CRUD, course-detail/lesson-preview, student import/detail, work preview/review, teacher permissions, usage billing, activities, and parent reports.
- Placeholder scan: no unresolved implementation placeholders in the plan; product placeholder pages are an intentional, explicitly scoped deliverable.
- Type consistency: `TeacherDashboardData`, `StartClassInput`, `ClassSession`, `startClass`, and `endClass` are defined in Task 1 and reused consistently.
