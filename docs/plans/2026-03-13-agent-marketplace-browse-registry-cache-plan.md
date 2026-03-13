# Agent Marketplace Browse Registry Cache Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight TTL cache to registry browse so the public marketplace does not scan registry logs and fetch manifests on every request.

**Architecture:** Extend `registry-browse.ts` with a small process-local cache stored on `globalThis`, keep success-only TTL caching, and expose a cache reset helper for focused tests. The page contract stays unchanged.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, viem

---

### Task 1: Document the cache behavior

**Files:**
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-cache-design.md`
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-cache-plan.md`
- Modify: `docs/todo.md`

**Step 1: Save the design and plan docs**

Document:

- 30 second TTL
- success-only cache writes
- no caching for top-level browse failures

**Step 2: Update TODO context**

Record that browse discovery is being hardened with runtime cache.

### Task 2: Add failing cache tests

**Files:**
- Modify: `src/lib/__tests__/agent-marketplace/registry-browse.test.ts`

**Step 1: Add failing tests for cache hits**

Cover:

- first call performs `getLogs`
- second call within TTL does not

**Step 2: Add failing tests for cache expiry**

Advance time beyond TTL and assert the next call refetches.

**Step 3: Add failing tests for failure bypass**

Make the first call fail and assert the second call retries instead of returning cached failure.

**Step 4: Run the focused test file and verify failure**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts`

Expected: cache assertions fail.

### Task 3: Implement the minimal cache

**Files:**
- Modify: `src/lib/agent-marketplace/registry-browse.ts`

**Step 1: Add cache state**

Store:

- `value`
- `cachedAt`

on `globalThis`.

**Step 2: Add a reset helper for tests**

Expose a narrow test helper to clear cache state between cases.

**Step 3: Use cache on successful browse results**

If TTL is valid, return cached data before hitting viem.

**Step 4: Keep failures uncached**

Only write cache when `ok === true`.

**Step 5: Re-run the focused test file**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts`

Expected: PASS

### Task 4: Verify and document

**Files:**
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`
- Modify: `docs/lessons.md`
- Modify: `docs/todo.md`

**Step 1: Run verification**

Run:

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.test.ts
npx eslint --no-warn-ignored src/lib/agent-marketplace/registry-browse.ts src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.tsx src/app/marketplace/page.test.ts
npm run build
```

**Step 2: Update docs**

Capture the 30-second browse cache and the fact that failures are not cached.
