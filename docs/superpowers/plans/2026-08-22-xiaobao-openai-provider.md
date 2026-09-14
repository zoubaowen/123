# XiaoBao OpenAI-Compatible Provider Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Use superpowers:verification-before-completion before declaring the plan complete.

**Goal:** Connect XiaoBao Runtime to a configurable real OpenAI-compatible model endpoint, with reliable tool/completion parsing, safe error mapping, token accounting, and production dependency assembly.

**Architecture:** A standalone HTTP provider translates XiaoBao model requests into `/chat/completions` messages and tool definitions. It exposes the internal `xiaobao_complete` function so a model can finish deterministically. A production dependency factory reads validated environment configuration, combines the model with the durable checkpoint store, and leaves unsupported tools explicit rather than silently faking success.

**Tech Stack:** TypeScript, native `fetch`, Zod, Vitest, existing XiaoBao Runtime ports and database provider.

---

## Task 1: Extend model results with usage and typed failures

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/ports.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/testing.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/__tests__/ports.test.ts`

- [ ] Write failing tests for normalized usage metadata and provider error categories.
- [ ] Extend every `ModelResponse` branch with optional usage:

```ts
export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type ModelProviderErrorCode =
  | 'authentication'
  | 'rate_limit'
  | 'unavailable'
  | 'timeout'
  | 'invalid_response'
```

- [ ] Add `ModelProviderError` with safe, user-facing messages and no raw response bodies.
- [ ] Update deterministic test providers without changing existing behavior.
- [ ] Commit: `feat(agent): define model usage and failures`

## Task 2: Build the OpenAI-compatible request mapper

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/openai-compatible-provider.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/__tests__/openai-compatible-provider.test.ts`

- [ ] Write failing tests for URL normalization, headers, system/skill/task/observation messages, configured model ID, and tool schemas.
- [ ] Implement constructor-injected `fetch` and configuration so tests never use the network.
- [ ] Map runtime actions to OpenAI tool definitions and always add:

```ts
{
  type: 'function',
  function: {
    name: 'xiaobao_complete',
    description: '完成当前任务并返回最终内容',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text'],
      additionalProperties: false,
    },
  },
}
```

- [ ] POST only to the normalized `/chat/completions` endpoint and honor the caller abort signal plus configured timeout.
- [ ] Run the provider test and commit: `feat(agent): request openai compatible models`

## Task 3: Parse completion, tool calls, usage, and failures

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/openai-compatible-provider.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/__tests__/openai-compatible-provider.test.ts`

- [ ] Add failing fixtures for text, `xiaobao_complete`, ordinary tool call, malformed arguments, missing choices, 401/403, 429, 5xx, timeout, and aborted request.
- [ ] Parse the first valid tool call; map `xiaobao_complete` to `{ kind: 'complete' }` and other calls to validated `XiaobaoAction`.
- [ ] Normalize `prompt_tokens`, `completion_tokens`, and `total_tokens` without inventing values.
- [ ] Map failures to `ModelProviderError`; never expose API keys, authorization headers, or raw provider bodies.
- [ ] Implement `healthCheck()` and configured `listModels()` without depending on optional vendor-specific model-list endpoints.
- [ ] Run provider tests and commit: `feat(agent): parse openai compatible responses`

## Task 4: Account actual model usage in the agent loop

**Files:**
- Modify: `packages/server/src/agent/xiaobao-runtime/agent-loop.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/__tests__/agent-loop.test.ts`

- [ ] Add failing tests proving successful completion records actual total tokens when supplied, falls back to turn count for legacy providers, and maps recoverable provider errors to a resumable task state.
- [ ] Accumulate usage across turns without changing checkpoint determinism.
- [ ] Keep authentication and invalid-response failures terminal; rate-limit, timeout, and unavailable failures recoverable.
- [ ] Emit only child-friendly static failure messages.
- [ ] Run all XiaoBao agent-loop tests and commit: `feat(agent): account xiaobao model usage`

## Task 5: Validate configuration and assemble production dependencies

**Files:**
- Create: `packages/server/src/agent/xiaobao-runtime/config.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/dependencies.ts`
- Create: `packages/server/src/agent/xiaobao-runtime/__tests__/dependencies.test.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/runtime.ts`
- Modify: `packages/server/src/agent/xiaobao-runtime/index.ts`
- Modify: `.env.example`

- [ ] Write failing tests for absent config, valid config, invalid URL, invalid timeout/context window, and dependency singleton reuse.
- [ ] Parse `XIAOBAO_MODEL_BASE_URL`, `XIAOBAO_MODEL_API_KEY`, `XIAOBAO_MODEL_ID`, `XIAOBAO_MODEL_NAME`, `XIAOBAO_MODEL_TIMEOUT_MS`, and `XIAOBAO_MODEL_CONTEXT_WINDOW` with Zod.
- [ ] Build `OpenAICompatibleModelProvider` plus `DatabaseCheckpointStore` from the existing database provider.
- [ ] Preserve `xiaobaoRuntime.isAvailable() === false` when configuration is incomplete; do not make XiaoBao the registry default.
- [ ] Resolve only approved initial capabilities (`writing`, `learning`) and reject unsupported media/sandbox flows explicitly.
- [ ] Document variables with placeholders only; never add a real key.
- [ ] Run dependency/runtime tests and commit: `feat(agent): assemble xiaobao production runtime`

## Task 6: Verify and record the completed model-provider round

**Files:**
- Modify: `docs/progress/2026-08-21-xiaobao-runtime.md`

- [ ] Run targeted Prettier on changed TypeScript files.
- [ ] Run `pnpm --filter @ai-xiaobao/server test`.
- [ ] Run `pnpm type-check`, `pnpm lint`, and `pnpm build:server`.
- [ ] Search changed files for dynamic log interpolation and secret exposure.
- [ ] Append exact verification evidence, environment setup, known limitations, and next production milestone to the progress log.
- [ ] Commit: `docs(agent): verify xiaobao model provider`

