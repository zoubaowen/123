# Student Sidebars and Pet System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为学生创作工作区增加可交互的课程与小宝伙伴入口、宠物卡，以及可切换并可在移动端开关的右侧资源面板。

**Architecture:** 继续使用现有 `StudentSidebarNav` 和 `StudentResourcePanel` 边界。左栏通过受控视图状态切换课程与伙伴卡，宠物互动封装为独立组件；右栏内部管理页签和抽屉状态，不改变 TaskForm、Skills、MCP 或任务接口。

**Tech Stack:** React 19、TypeScript、Tailwind CSS、Lucide React、Vitest、React DOM Server。

## Global Constraints

- 使用现有 `XiaoBao` 角色组件与 academy 装扮，不创建替代角色资产。
- 宠物等级、星光值与连续陪伴天数必须明确标注为演示状态，不写入数据库。
- 不修改 TaskForm、Skills、MCP、连接器和任务创建请求。
- 所有日志只使用静态字符串，禁止敏感环境变量进入日志或响应。
- 1280px 以上显示固定右栏；较窄屏幕使用可开关抽屉。

---

### Task 1: 小宝宠物卡

**Files:**
- Create: `packages/web/src/features/student-workspace/xiaobao-pet-card.tsx`
- Create: `packages/web/src/features/student-workspace/xiaobao-pet-card.test.tsx`

**Interfaces:**
- Consumes: `XiaoBao` from `@ai-xiaobao/chat-core`.
- Produces: `XiaobaoPetCard(): ReactElement`，内部管理问候次数和当前文案。

- [ ] **Step 1: Write the failing test**

```tsx
it('shows honest demo progress and a real greeting action', () => {
  const markup = renderToStaticMarkup(<XiaobaoPetCard />)
  expect(markup).toContain('小宝伙伴')
  expect(markup).toContain('演示成长记录')
  expect(markup).toContain('和小宝打招呼')
  expect(markup).toContain('aria-live="polite"')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/xiaobao-pet-card.test.tsx`

Expected: FAIL because `xiaobao-pet-card.tsx` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create a card that renders `XiaoBao` with `outfit="academy"`, `mood="happy"`, `action="wave"`, three clearly labelled demo metrics, an `aria-live` greeting line, and a button that cycles through three static child-friendly greeting messages with `useState`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/xiaobao-pet-card.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/student-workspace/xiaobao-pet-card.tsx packages/web/src/features/student-workspace/xiaobao-pet-card.test.tsx
git commit -m "feat(web): add Xiaobao pet card"
```

### Task 2: 左侧课程与伙伴入口

**Files:**
- Modify: `packages/web/src/features/student-workspace/student-sidebar-nav.tsx`
- Modify: `packages/web/src/features/student-workspace/student-sidebar-nav.test.tsx`

**Interfaces:**
- Consumes: `XiaobaoPetCard` from Task 1.
- Produces: `StudentSidebarNav` with internal `activeSection: 'creations' | 'courses' | 'pet'` state; existing props remain unchanged.

- [ ] **Step 1: Write the failing test**

Add assertions that server-rendered markup contains enabled buttons named `我的课程` and `小宝伙伴`, contains `课程中心正在准备中`, and does not mark either button disabled.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/student-sidebar-nav.test.tsx`

Expected: FAIL because the course entry is disabled and the pet entry/card does not exist.

- [ ] **Step 3: Write minimal implementation**

Replace the disabled course item with a selectable button, add a selectable pet button beside it in the same navigation group, and render one compact panel beneath navigation: course placeholder copy for `courses`, `XiaobaoPetCard` for `pet`, and no extra panel for `creations`. Add `aria-pressed` to selectable buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/student-sidebar-nav.test.tsx`

Expected: PASS, including the existing brand/new-creation/search assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/student-workspace/student-sidebar-nav.tsx packages/web/src/features/student-workspace/student-sidebar-nav.test.tsx
git commit -m "feat(web): add course and pet navigation"
```

### Task 3: 右侧三页签与移动抽屉

**Files:**
- Modify: `packages/web/src/features/student-workspace/student-resource-panel.tsx`
- Modify: `packages/web/src/features/student-workspace/student-resource-panel.test.tsx`

**Interfaces:**
- Produces: `StudentResourcePanel` with internal `activeTab: 'files' | 'assets' | 'courses'` and `isMobileOpen: boolean` state.

- [ ] **Step 1: Write the failing tests**

Add one test asserting the `课程资料` tab and its honest empty-state copy are present. Add another asserting the open button has `aria-expanded="false"`, an accessible label, and the panel contains a close button label.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/student-resource-panel.test.tsx`

Expected: FAIL because only two tabs exist and the floating button does not control an actual drawer.

- [ ] **Step 3: Write minimal implementation**

Add the third tab using the existing icon library. Render tab-specific title and description from a typed constant. Add `isMobileOpen`, connect the floating button to it, render an overlay plus right drawer below `xl`, include a labelled close button, and keep the existing fixed desktop aside at `xl`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ai-xiaobao/web test -- src/features/student-workspace/student-resource-panel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/student-workspace/student-resource-panel.tsx packages/web/src/features/student-workspace/student-resource-panel.test.tsx
git commit -m "feat(web): improve student resource panel"
```

### Task 4: 集成验证与视觉验收

**Files:**
- Modify only if verification finds an issue: files changed in Tasks 1-3.
- Create: `design-qa.md` only after same-state reference/prototype comparison is available.

**Interfaces:**
- Consumes: all components from Tasks 1-3 through the existing student workspace composition.
- Produces: verified student workspace without changes to task submission behavior.

- [ ] **Step 1: Run focused tests**

Run: `pnpm --filter @ai-xiaobao/web test`

Expected: all student workspace tests PASS with no new runtime error.

- [ ] **Step 2: Run repository checks**

Run: `pnpm type-check`

Run: `pnpm lint`

Run: `pnpm --filter @ai-xiaobao/web build`

Expected: all commands exit 0.

- [ ] **Step 3: Perform browser interaction checks**

At a desktop viewport, verify course and pet entry selection, pet greeting interaction, all three resource tabs, and no clipped central composer. At a viewport below `xl`, verify open, overlay, close, and focusable drawer controls.

- [ ] **Step 4: Perform design QA**

Capture the prototype in the same state and viewport as `C:\Users\49781\Desktop\新建文件夹 (2)\学生创作工具界面.jpg`, compare both images together, fix P0-P2 differences, and write `design-qa.md` with `final result: passed`. If authenticated workspace capture is unavailable, write `final result: blocked` and state the exact login blocker.

- [ ] **Step 5: Final integration commit**

```bash
git add design-qa.md packages/web/src/features/student-workspace
git commit -m "chore(web): verify student workspace sidebars"
```
