# Student Courses and Xiaobao Growth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the student platform's course and Xiaobao companion placeholders into a local, testable learning-and-growth loop without adding institution-management behavior.

**Architecture:** Keep course catalog and growth rules in focused pure modules. The sidebar owns the local growth session and emits selected course prompts upward; the existing workspace passes those prompts into the current composer. Browser storage is an adapter with an in-memory fallback.

**Tech Stack:** React 19, TypeScript, Vitest, Tailwind CSS, Lucide icons, existing `@ai-xiaobao/chat-core` character component.

## Global Constraints

- Modify only the student programming platform.
- Do not add institution, campus, teacher, class, bulk-student, course-publishing, analytics, or Skills/MCP administration models or UI.
- Keep the existing three-column student workspace and AI小宝学院 visual language.
- Use static log messages only.
- Follow red-green-refactor for every behavior change.

---

### Task 1: Growth rules and persistence

**Files:**
- Create: `packages/web/src/features/student-workspace/student-growth.ts`
- Create: `packages/web/src/features/student-workspace/student-growth.test.ts`

**Interfaces:**
- Produces: `StudentGrowthState`, `getGrowthLevel(starlight)`, `awardGreeting(state)`, `awardCourse(state, courseId)`, `loadStudentGrowth(storage)`, and `saveStudentGrowth(storage, state)`.
- Reward rules: first greeting gives 5 points; first continuation of each course gives 10 points; every 100 points advances one level.

- [ ] **Step 1: Write failing tests** covering level boundaries, one-time greeting reward, one-time per-course reward, and invalid-storage fallback.
- [ ] **Step 2: Run** `.\node_modules\.bin\vitest.CMD run src/features/student-workspace/student-growth.test.ts` from `packages/web`; expect missing-module failure.
- [ ] **Step 3: Implement** the pure rules and storage adapter with `{ starlight, greeted, rewardedCourseIds }` as the serialized shape.
- [ ] **Step 4: Run the focused test** and confirm all assertions pass.

### Task 2: Student course panel

**Files:**
- Create: `packages/web/src/features/student-workspace/student-course-panel.tsx`
- Create: `packages/web/src/features/student-workspace/student-course-panel.test.tsx`

**Interfaces:**
- Produces: `StudentCourse`, `STUDENT_COURSES`, and `StudentCoursePanel({ onContinue })`.
- `onContinue(course)` receives the selected course, whose `nextPrompt` is safe to place into the composer.

- [ ] **Step 1: Write failing tests** asserting the three course titles, progress labels, next tasks, and enabled continue buttons.
- [ ] **Step 2: Run the focused test** and confirm it fails because the panel does not exist.
- [ ] **Step 3: Implement** compact course cards for AI绘画入门、小游戏制作、故事写作 using existing card colors and Lucide icons.
- [ ] **Step 4: Run the focused test** and confirm it passes.

### Task 3: Xiaobao growth card

**Files:**
- Modify: `packages/web/src/features/student-workspace/xiaobao-pet-card.tsx`
- Modify: `packages/web/src/features/student-workspace/xiaobao-pet-card.test.tsx`

**Interfaces:**
- Consumes: `StudentGrowthState`, calculated level information, and `onGreet()`.
- Displays: current level, total starlight, progress to the next level, companion day, and next outfit unlock hint.

- [ ] **Step 1: Update the test first** to require passed growth values, a progress indicator, and an enabled greeting action.
- [ ] **Step 2: Run the focused test** and confirm the current component fails the new contract.
- [ ] **Step 3: Implement** the controlled presentation component; retain rotating greetings and call `onGreet` on interaction.
- [ ] **Step 4: Run the focused test** and confirm it passes.

### Task 4: Connect courses and growth to the composer

**Files:**
- Modify: `packages/web/src/features/student-workspace/student-sidebar-nav.tsx`
- Modify: `packages/web/src/features/student-workspace/student-sidebar-nav.test.tsx`
- Modify: `packages/web/src/features/student-workspace/student-workspace.tsx`
- Modify: `packages/web/src/features/student-workspace/student-workspace.test.tsx`
- Modify: `packages/web/src/components/app-layout.tsx`

**Interfaces:**
- `StudentSidebarNav` adds `onCoursePrompt(prompt: string)`.
- `StudentWorkspace` remains the single adapter to the existing `onPromptChange(prompt)` composer callback.
- Sidebar loads growth once, persists after rewards, and passes the current state to `XiaobaoPetCard`.

- [ ] **Step 1: Update integration tests first** to require course selection callbacks and growth-card values.
- [ ] **Step 2: Run the focused tests** and verify failures describe the missing callbacks/content.
- [ ] **Step 3: Replace the course placeholder** with `StudentCoursePanel`, award the course once, close the panel, and forward `nextPrompt` to the composer callback.
- [ ] **Step 4: Wire `app-layout.tsx`** so its sidebar and `StudentWorkspace` share the existing prompt setter without introducing an institution API.
- [ ] **Step 5: Run focused integration tests** and confirm they pass.

### Task 5: Verification and visual walkthrough

**Files:**
- Modify only files needed to fix defects found by verification.

- [ ] **Step 1: Run** `pnpm.cmd --filter @ai-xiaobao/web test`; expect all web tests to pass.
- [ ] **Step 2: Run** `pnpm.cmd type-check`; expect exit code 0.
- [ ] **Step 3: Run** `pnpm.cmd --filter @ai-xiaobao/web build`; expect a successful Vite production build.
- [ ] **Step 4: Walk through** login, 我的课程, 继续学习, composer prompt insertion, 小宝伙伴, greeting reward, and refresh persistence in the local browser.
- [ ] **Step 5: Confirm** no institution-management terminology or routes were added to student workspace files.
