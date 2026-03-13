# Agent Marketplace Browse Registry Pagination Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add query-driven pagination to the public registry browse tab without changing the existing live discovery and cache model.

**Architecture:** Extend `registry-browse.ts` to paginate the cached full registry result and return page metadata, then wire `/marketplace?tab=registry&page=N` to render current-page rows plus `PREV / NEXT` deep links.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, viem

---

### Task 1: Document the pagination behavior

**Files:**
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-pagination-design.md`
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-pagination-plan.md`
- Modify: `docs/todo.md`

**Step 1: Save the design and plan docs**

Capture:

- query-driven `page`
- page size `5`
- summary cards using total rows
- pagination slicing after cache load

**Step 2: Update TODO context**

Record that live browse is being hardened with pagination.

### Task 2: Add failing tests

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/registry-browse.test.ts`
- Modify: `src/app/marketplace/page.test.ts`

**Step 1: Add failing library tests**

Cover:

- page metadata
- second-page slicing
- invalid page fallback

**Step 2: Add failing page tests**

Cover:

- `page=2` shows later registry row
- navigation links include `tab=registry&page=...`

**Step 3: Run focused tests and verify failure**

Run:

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.test.ts
```

Expected: page metadata and link assertions fail.

### Task 3: Implement minimal pagination

**Files:**
- Modify: `src/lib/agent-marketplace/registry-browse.ts`
- Modify: `src/app/marketplace/page.tsx`

**Step 1: Add browse options and page metadata**

Add `page` input and current-page response fields.

**Step 2: Slice rows after full-result load**

Reuse cached full rows and derive paginated rows from them.

**Step 3: Render navigation**

Add:

- current page indicator
- `PREV`
- `NEXT`

with preserved `tab=registry`.

**Step 4: Re-run focused tests**

Run:

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.test.ts
```

Expected: PASS

### Task 4: Verify and document

**Files:**
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`
- Modify: `docs/lessons.md`
- Modify: `docs/todo.md`

**Step 1: Run verification**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.test.ts
npx eslint --no-warn-ignored src/lib/agent-marketplace/registry-browse.ts src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.tsx src/app/marketplace/page.test.ts
npm run build
```

**Step 2: Update docs**

Note the `page` query contract and the fixed page size.
