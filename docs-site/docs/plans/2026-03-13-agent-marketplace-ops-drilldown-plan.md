# Agent Marketplace Ops Drill-Down Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dispute detail and batch detail drill-down UI to `/v2/marketplace`.

**Architecture:** Keep `/v2/marketplace` as a server-rendered page and use query-driven selection for dispute detail. Reuse existing `ops-summary` and dispute store data so this phase adds no new API surfaces.

**Tech Stack:** Next.js App Router, React server components, TypeScript, Vitest

---

### Task 1: Add failing page tests for drill-down behavior

**Files:**
- Modify: `src/app/v2/marketplace/page.test.ts`

**Step 1: Write failing tests**

Cover:
- selected dispute detail when `searchParams.dispute` matches
- newest dispute detail fallback when no query is provided
- last batch detail empty state for `never`
- last batch detail fields for `success`

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: FAIL

### Task 2: Implement drill-down UI

**Files:**
- Modify: `src/app/v2/marketplace/page.tsx`

**Step 1: Add query param support**

Read:
- `searchParams.dispute`

**Step 2: Resolve selected dispute**

Rules:
- use matching dispute when provided
- else newest dispute

**Step 3: Render dispute detail panel**

Show full dispute metadata plus matching SLA summary when available.

**Step 4: Render last batch detail panel**

Show:
- status
- publishedAt
- batchHash
- txHash
- error

**Step 5: Re-run focused test**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: PASS

### Task 3: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Update docs**

Document:
- dispute deep link query format
- batch detail panel presence

**Step 2: Run verification**

Run:
- `npx vitest run src/app/v2/marketplace/page.test.ts src/app/marketplace/page.test.ts src/app/v2/page.test.ts`
- `npx eslint --no-warn-ignored src/app/v2/marketplace/page.tsx src/app/v2/marketplace/page.test.ts`
- `npm run build`

Expected: PASS, aside from unchanged Next warnings.
