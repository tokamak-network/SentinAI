# Agent Marketplace Dispute Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let operators update dispute status from `/v2/marketplace` while recording reviewer metadata.

**Architecture:** Extend the Redis-backed dispute store and existing dispute PATCH route with reviewer metadata fields, then surface a minimal action form inside the existing server-rendered dispute detail panel.

**Tech Stack:** Next.js App Router, React, TypeScript, Redis, Vitest

---

### Task 1: Add failing tests for dispute metadata persistence

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/dispute-store.test.ts`
- Modify: `src/app/api/agent-marketplace/ops/disputes/[id]/route.test.ts`

**Step 1: Write failing tests**

Cover:
- updating a dispute stores `reviewerNote` and `reviewedBy`
- PATCH route accepts reviewer metadata

**Step 2: Run tests to verify failure**

Run:
- `npx vitest run src/lib/__tests__/agent-marketplace/dispute-store.test.ts 'src/app/api/agent-marketplace/ops/disputes/[id]/route.test.ts'`

Expected: FAIL

### Task 2: Extend store and API

**Files:**
- Modify: `src/lib/agent-marketplace/dispute-store.ts`
- Modify: `src/app/api/agent-marketplace/ops/disputes/[id]/route.ts`

**Step 1: Extend dispute record type**

Add optional metadata fields.

**Step 2: Extend update function**

Allow metadata to be stored with status changes.

**Step 3: Update PATCH route**

Accept:
- `status`
- `reviewedBy`
- `reviewerNote`

**Step 4: Re-run focused tests**

Expected: PASS

### Task 3: Add failing page test for action UI

**Files:**
- Modify: `src/app/v2/marketplace/page.test.ts`

**Step 1: Write failing tests**

Cover:
- selected dispute detail shows reviewer metadata when present
- detail panel renders action controls

**Step 2: Run page test to verify failure**

Run:
- `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: FAIL

### Task 4: Implement dispute action UI

**Files:**
- Modify: `src/app/v2/marketplace/page.tsx`

**Step 1: Render metadata fields**

Show:
- reviewed by
- reviewer note

**Step 2: Render minimal action form shell**

Include:
- status select
- reviewed by input
- reviewer note textarea
- submit button

**Step 3: Re-run page test**

Expected: PASS

### Task 5: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Update docs**

Document the dispute action metadata fields.

**Step 2: Run verification**

Run:
- `npx vitest run src/lib/__tests__/agent-marketplace/dispute-store.test.ts 'src/app/api/agent-marketplace/ops/disputes/[id]/route.test.ts' src/app/v2/marketplace/page.test.ts`
- `npx eslint --no-warn-ignored src/lib/agent-marketplace/dispute-store.ts src/app/api/agent-marketplace/ops/disputes/'[id]'/route.ts src/app/v2/marketplace/page.tsx src/app/v2/marketplace/page.test.ts`
- `npm run build`

Expected: PASS, aside from unchanged Next warnings.
