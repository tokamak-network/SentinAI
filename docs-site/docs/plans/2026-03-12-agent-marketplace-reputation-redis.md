# Agent Marketplace Reputation Redis Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move agent marketplace reputation score persistence from in-process memory to Redis and fail closed when Redis is unavailable.

**Architecture:** Keep the change scoped to the `agent-marketplace` reputation path by replacing the current in-memory score store with a Redis-backed adapter under the same module boundary. The daily reputation job will read previous scores from Redis when input does not provide them, persist the latest scores back to Redis after a successful publish, and return an explicit failure result if Redis configuration or Redis I/O is unavailable.

**Tech Stack:** TypeScript strict mode, Vitest, ioredis via existing `src/lib/redis-store.ts` patterns, Next.js runtime env configuration

---

### Task 1: Define fail-closed Redis store behavior

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/reputation-state-store.test.ts`
- Modify: `src/lib/__tests__/agent-marketplace/reputation-job.test.ts`

**Step 1: Write the failing tests**

Add tests that verify:
- reputation score reads fail when `REDIS_URL` is missing
- reputation score writes fail when `REDIS_URL` is missing
- the daily reputation job returns `ok: false` when Redis score lookup fails
- the daily reputation job returns `ok: false` when Redis score persistence fails after publish

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-state-store.test.ts src/lib/__tests__/agent-marketplace/reputation-job.test.ts`

Expected: FAIL because the current store is in-memory and does not require Redis.

**Step 3: Write minimal implementation**

Replace the in-memory reputation state store with a Redis-backed implementation that:
- requires `REDIS_URL`
- uses a dedicated key under the SentinAI namespace
- throws explicit errors for missing config or unavailable Redis state store

Update the daily reputation job to:
- await Redis reads/writes
- convert Redis store failures into explicit `ok: false` results

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-state-store.test.ts src/lib/__tests__/agent-marketplace/reputation-job.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/reputation-state-store.ts src/lib/agent-marketplace/reputation-job.ts src/lib/__tests__/agent-marketplace/reputation-state-store.test.ts src/lib/__tests__/agent-marketplace/reputation-job.test.ts
git commit -m "feat: persist marketplace reputation scores in redis"
```

### Task 2: Verify runtime contract and document the requirement

**Files:**
- Modify: `.env.local.sample`
- Modify: `ENV_GUIDE.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Update docs**

Document that:
- Redis is required for marketplace reputation publishing
- missing `REDIS_URL` causes fail-closed behavior
- daily scheduler runs will fail rather than fallback to in-memory state

**Step 2: Run verification**

Run:
- `npx eslint src/lib/agent-marketplace src/lib/__tests__/agent-marketplace src/lib/scheduler.ts src/lib/first-run-bootstrap.ts src/app/api/agent-marketplace src/types/agent-marketplace.ts`
- `npm run build`

Expected: PASS, with only pre-existing Next.js warnings if they still apply.

**Step 3: Commit**

```bash
git add .env.local.sample ENV_GUIDE.md docs/guide/runbook/agent-marketplace-operations-runbook.md docs/todo.md docs/lessons.md
git commit -m "docs: document redis requirement for marketplace reputation"
```
