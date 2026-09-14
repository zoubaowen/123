# XiaoBao Runtime Checkpoint Persistence Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Use superpowers:verification-before-completion before declaring the plan complete.

**Goal:** Replace the in-memory XiaoBao task checkpoint with durable, revision-safe persistence shared by SQLite/Drizzle and CloudBase deployments.

**Architecture:** Add a provider-neutral checkpoint repository to the existing `DatabaseProvider`, then adapt it to the runtime's `CheckpointStore`. Each task has one row/document containing a schema-versioned JSON snapshot and monotonically increasing revision. Saves use compare-and-swap semantics; replaying the identical snapshot is idempotent, while a stale divergent write raises a typed conflict.

**Tech Stack:** TypeScript, Zod, Drizzle ORM/SQLite, Tencent CloudBase database, Vitest.

---

## Task 1: Specify the persistence contract with failing tests

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/__tests__/checkpoint-store.test.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/ports.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/index.ts`

- [ ] Write tests for first save, reload, monotonic revision, identical replay, stale divergent save, malformed stored JSON, and unsupported schema version.
- [ ] Run `pnpm --filter @ai-xiaobao/server test -- src/agent/xiaobao-runtime/__tests__/checkpoint-store.test.ts` and confirm the tests fail because the store does not exist.
- [ ] Add the minimal repository-facing types:

```ts
export interface CheckpointRecord {
  taskId: string
  revision: number
  schemaVersion: number
  snapshotJson: string
  createdAt: number
  updatedAt: number
}

export interface CheckpointRepository {
  findByTaskId(taskId: string): Promise<CheckpointRecord | null>
  create(record: CheckpointRecord): Promise<CheckpointRecord | null>
  compareAndSwap(taskId: string, expectedRevision: number, next: CheckpointRecord): Promise<CheckpointRecord | null>
}
```

- [ ] Export typed `CheckpointConflictError` and `CheckpointCorruptError` boundaries without implementing persistence yet.
- [ ] Commit: `test(agent): specify checkpoint persistence`

## Task 2: Add the database schema and migration

**Files:**
- Modify: `packages/server/src/db/types.ts`
- Modify: `packages/server/src/db/schema.ts`
- Create: generated files under `packages/server/src/db/migrations/`
- Mirror: generated schema/migration artifacts under `packages/server/deploy/src/db/`

- [ ] Add `xiaobaoRuntimeCheckpoints` with `taskId` primary key, `revision`, `schemaVersion`, `snapshotJson`, `createdAt`, and `updatedAt`.
- [ ] Add `CheckpointRepository` to `DatabaseProvider` as `xiaobaoRuntimeCheckpoints`.
- [ ] Run `pnpm db:generate` to create an additive migration and its Drizzle metadata; do not hand-edit generated snapshots.
- [ ] Verify the generated SQL contains the equivalent of:

```sql
CREATE TABLE `xiaobao_runtime_checkpoints` (
  `task_id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL,
  `schema_version` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
```

- [ ] Run the targeted test and `pnpm type-check`; confirm only missing provider implementations remain.
- [ ] Commit: `feat(db): add xiaobao checkpoint schema`

## Task 3: Implement Drizzle compare-and-swap persistence

**Files:**
- Modify: `packages/server/src/db/drizzle/repositories.ts`
- Create: `packages/server/src/db/drizzle/__tests__/xiaobao-checkpoints.test.ts`

- [ ] Write integration tests against an isolated SQLite database for create collision and `WHERE task_id = ? AND revision = ?` compare-and-swap behavior.
- [ ] Confirm the new tests fail before implementation.
- [ ] Implement `DrizzleXiaobaoCheckpointRepository`; return `null` on lost races rather than overwriting.
- [ ] Register it in `createDrizzleProvider()`.
- [ ] Run both new checkpoint test files.
- [ ] Commit: `feat(db): persist xiaobao checkpoints in drizzle`

## Task 4: Implement CloudBase compare-and-swap persistence

**Files:**
- Modify: `packages/server/src/db/cloudbase/repositories.ts`
- Create: `packages/server/src/db/cloudbase/__tests__/xiaobao-checkpoints.test.ts`

- [ ] Add mocked CloudBase boundary tests verifying collection name, revision-qualified update, create collision, and normalized return shape.
- [ ] Implement `CloudBaseXiaobaoCheckpointRepository` using `where({ taskId, revision: expectedRevision })` before update.
- [ ] Register it in `createCloudBaseProvider()`.
- [ ] Keep all runtime logs static and never include document contents.
- [ ] Run the CloudBase and Drizzle checkpoint tests.
- [ ] Commit: `feat(db): persist xiaobao checkpoints in cloudbase`

## Task 5: Implement and wire the production checkpoint store

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/checkpoint-store.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/__tests__/checkpoint-store.test.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/index.ts`

- [ ] Define a strict Zod schema for `XiaobaoTaskSnapshot` and a constant `XIAOBAO_CHECKPOINT_SCHEMA_VERSION = 1`.
- [ ] Implement `DatabaseCheckpointStore.load()` with validation and typed corruption errors.
- [ ] Implement `save()` so the first write uses revision 1, updates increment revision, identical replay succeeds without a write, and stale divergent state throws `CheckpointConflictError`.
- [ ] Use stable serialization for equality checks; do not log snapshot content or identifiers.
- [ ] Run all XiaoBao Runtime tests and server type-check.
- [ ] Commit: `feat(agent): add durable xiaobao checkpoint store`

## Task 6: Verify and record the completed checkpoint round

**Files:**
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

- [ ] Run targeted Prettier on changed TypeScript files.
- [ ] Run `pnpm --filter @ai-xiaobao/server test`.
- [ ] Run `pnpm type-check`, `pnpm lint`, and `pnpm build:server`.
- [ ] Review changed log statements for dynamic values and secrets.
- [ ] Append exact test evidence, completed commits, known limitations, and the next task to the progress log.
- [ ] Commit: `docs(agent): verify checkpoint persistence`
