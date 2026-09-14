# Commercial Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the project pass release checks and remove the highest-risk commercial deployment defaults.

**Architecture:** Keep changes narrowly scoped to existing server and kernel boundaries. Security-sensitive behavior is enforced at route/middleware boundaries and covered by focused unit tests.

**Tech Stack:** TypeScript, Hono, Vitest, tsup, Vite, pnpm.

## Global Constraints

- Do not start long-running dev servers.
- Run `pnpm format`, `pnpm type-check`, and `pnpm lint` before completion.
- Keep logs free of dynamic sensitive values.
- Do not expose secrets, tokens, paths, user IDs, or environment IDs in logs or API responses.

---

### Task 1: Server Build Dependency

**Files:**
- Modify: `packages/server/src/services/sms.ts`

**Interfaces:**
- Consumes: Tencent Cloud SDK package already declared as `tencentcloud-sdk-nodejs`.
- Produces: `sendSms(phone: string, code: string): Promise<void>`.

- [ ] Write or run build reproduction: `pnpm.cmd build:server`
- [ ] Verify it fails on unresolved `tencentcloud-sdk-nodejs-sms`.
- [ ] Change the SMS import to the installed SDK package.
- [ ] Run `pnpm.cmd build:server` and verify the unresolved import is gone.

### Task 2: Production Admin Bootstrap

**Files:**
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/__tests__/admin-bootstrap.test.ts`

**Interfaces:**
- Produces: `getInitialAdminPassword(): string | undefined`.

- [ ] Write failing tests that production does not use `Admin123`, development keeps the old local bootstrap, and configured passwords must meet minimum complexity.
- [ ] Verify tests fail before implementation.
- [ ] Export and use a helper that reads `INITIAL_ADMIN_PASSWORD`, falls back to `Admin123` only outside production, and refuses weak configured passwords.
- [ ] Run the targeted test and verify it passes.

### Task 3: CAPI Allowlist

**Files:**
- Modify: `packages/server/src/routes/capi.ts`
- Test: `packages/server/src/routes/__tests__/capi-allowlist.test.ts`

**Interfaces:**
- Produces: `isAllowedCapiAction(service?: string, action?: string): boolean`.

- [ ] Write failing tests for allowed CloudBase dashboard read/write actions and blocked unrelated actions.
- [ ] Verify tests fail before implementation.
- [ ] Add a static allowlist and reject disallowed actions with 403 before constructing CloudBase.
- [ ] Run the targeted test and verify it passes.

### Task 4: Credential Injection Tests

**Files:**
- Modify: `packages/server/src/lib/__tests__/cloudbase-mcp-inject-credentials.test.ts`
- Modify only if needed: `packages/server/src/lib/cloudbase-mcp.ts`

**Interfaces:**
- Consumes: `userResources.findByTaskId(conversationId)` and `findByUserId(userId)`.

- [ ] Update tests to mock `findByTaskId`.
- [ ] Add a test showing mismatched task resources are ignored.
- [ ] Run the targeted tests and verify they pass.

### Task 5: Kernel Cwd Isolation

**Files:**
- Modify: `packages/open-agent-kernel/src/runtime/agent-builder.ts`
- Test: existing `packages/open-agent-kernel/src/runtime/__tests__/agent-builder.test.ts`

**Interfaces:**
- Produces: isolated `cwd` and `CLAUDE_CONFIG_DIR` behavior matching current tests.

- [ ] Run the existing failing test to confirm red.
- [ ] Restore ephemeral cwd when no cwd is provided.
- [ ] Use per-user cwd when user memory is active.
- [ ] Keep `CLAUDE_CONFIG_DIR` unset when user memory degrades or is disabled.
- [ ] Run the targeted test and verify it passes.

### Task 6: Path Resolution Tests

**Files:**
- Modify: `packages/server/src/agent/runtime/__tests__/resolveOnPath.test.ts`

**Interfaces:**
- Consumes: platform-specific `path.delimiter`, `path.join`, and Windows executable extensions.

- [ ] Make tests platform-neutral by building expected paths with `path.join` and including `PATHEXT` behavior on Windows.
- [ ] Run the targeted test and verify it passes.

### Task 7: Release Gate

**Files:**
- Format only files touched by this plan plus known Prettier offenders.

- [ ] Run `pnpm.cmd format`.
- [ ] Run `pnpm.cmd type-check`.
- [ ] Run `pnpm.cmd lint`.
- [ ] Run `pnpm.cmd build:server`.
- [ ] Run targeted server and kernel tests.
- [ ] Report any remaining commercial risks that require product decisions.
