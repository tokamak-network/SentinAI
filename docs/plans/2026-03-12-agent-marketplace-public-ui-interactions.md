# Agent Marketplace Public UI Interactions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn the public `/marketplace` page into a real tabbed marketplace UI using the current `agent-marketplace` backend.

**Architecture:** Keep the page server-rendered and use `searchParams.tab` as the source of truth for tab selection. This preserves simple deep-linking, keeps the current backend integration unchanged, and avoids adding unnecessary client state for Phase 1.

**Tech Stack:** Next.js App Router, React server components, TypeScript, Vitest

---

### Task 1: Add tab resolution behavior tests

**Files:**
- Modify: `src/app/marketplace/page.test.ts`

**Step 1: Write the failing tests**

Cover:
- default render shows registry tab content
- `tab=instance` shows service grid and hides registry-only note
- `tab=guide` shows connect guide and hides instance-only marker
- invalid tab falls back to registry

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: FAIL because the page still renders all sections at once.

**Step 3: Write minimal implementation**

Add tab resolution and conditional rendering to the page.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: PASS

### Task 2: Implement query-driven tabs in `/marketplace`

**Files:**
- Modify: `src/app/marketplace/page.tsx`

**Step 1: Add a small tab resolver**

Support:
- `registry`
- `instance`
- `guide`

Fallback invalid values to `registry`.

**Step 2: Update tab links**

Use:
- `/marketplace?tab=registry`
- `/marketplace?tab=instance`
- `/marketplace?tab=guide`

Apply active styling from the resolved tab.

**Step 3: Conditionally render sections**

Only render the active tab section while keeping the shared shell visible.

**Step 4: Run focused tests**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: PASS

### Task 3: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Update docs**

Document:
- query-driven public marketplace tabs
- deep-link examples

**Step 2: Run verification**

Run:
- `npx vitest run src/app/marketplace/page.test.ts src/app/v2/page.test.ts src/app/v2/marketplace/page.test.ts`
- `npx eslint --no-warn-ignored src/app/marketplace/page.tsx src/app/marketplace/page.test.ts src/app/v2/page.tsx src/app/v2/page.test.ts src/app/v2/marketplace/page.tsx src/app/v2/marketplace/page.test.ts src/lib/agent-marketplace src/app/api/agent-marketplace src/types/agent-marketplace.ts`
- `npm run build`

Expected: PASS, aside from pre-existing Next warnings if unchanged.
