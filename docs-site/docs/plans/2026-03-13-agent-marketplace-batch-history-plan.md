# Agent Marketplace Batch History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Redis-backed reputation batch history persistence and show recent batch history in `/v2/marketplace`.

**Architecture:** Introduce a dedicated Redis history store that records every daily reputation batch result. Reuse that store in `ops-summary` so the latest record powers `lastBatch` and the recent records power a new history panel in the ops console.

**Tech Stack:** Next.js App Router, React server components, TypeScript, Redis, Vitest

---

### Task 1: Add failing tests for the batch history store

**Files:**
- Create: `src/lib/__tests__/agent-marketplace/batch-history-store.test.ts`
- Create: `src/lib/agent-marketplace/batch-history-store.ts`

**Step 1: Write the failing test**

Cover:
- append success and failure records
- return newest-first history
- trim to the latest 50 records
- fail when `REDIS_URL` is missing

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/batch-history-store.test.ts`

Expected: FAIL

### Task 2: Persist batch history from the reputation job

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/reputation-job.test.ts`
- Modify: `src/lib/agent-marketplace/reputation-job.ts`
- Modify: `src/lib/agent-marketplace/reputation-publisher.ts`

**Step 1: Write the failing test**

Cover:
- success path appends a success record
- publish failure appends a failure record
- Redis write failure returns a fail-closed job result

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-job.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Record history entries from the daily job with the batch window and result fields.

**Step 4: Re-run test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-job.test.ts`

Expected: PASS

### Task 3: Surface batch history in ops summary

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/ops-summary.test.ts`
- Modify: `src/app/api/agent-marketplace/ops/summary/route.test.ts`
- Modify: `src/lib/agent-marketplace/ops-summary.ts`

**Step 1: Write the failing test**

Cover:
- `lastBatch` comes from the newest history record
- `batchHistory` returns recent records

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/ops-summary.test.ts src/app/api/agent-marketplace/ops/summary/route.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Read the Redis history store in `buildAgentMarketplaceOpsSummary()`.

**Step 4: Re-run tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/ops-summary.test.ts src/app/api/agent-marketplace/ops/summary/route.test.ts`

Expected: PASS

### Task 4: Render batch history in `/v2/marketplace`

**Files:**
- Modify: `src/app/v2/marketplace/page.test.ts`
- Modify: `src/app/v2/marketplace/page.tsx`

**Step 1: Write the failing test**

Cover:
- `LAST BATCH HISTORY` panel appears
- records show status, published time, window, and tx hash or error

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Render the latest five `summary.batchHistory` entries below the detail panel.

**Step 4: Re-run test**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: PASS

### Task 5: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Update docs**

Document:
- Redis batch history key
- fail-closed behavior
- history panel in `/v2/marketplace`

**Step 2: Run verification**

Run:
- `npx vitest run src/lib/__tests__/agent-marketplace/batch-history-store.test.ts src/lib/__tests__/agent-marketplace/reputation-job.test.ts src/lib/__tests__/agent-marketplace/ops-summary.test.ts src/app/api/agent-marketplace/ops/summary/route.test.ts src/app/v2/marketplace/page.test.ts`
- `npx eslint --no-warn-ignored src/lib/agent-marketplace/batch-history-store.ts src/lib/agent-marketplace/reputation-job.ts src/lib/agent-marketplace/ops-summary.ts src/app/v2/marketplace/page.tsx src/app/v2/marketplace/page.test.ts`
- `npm run build`

Expected: PASS, aside from unchanged Next warnings.
