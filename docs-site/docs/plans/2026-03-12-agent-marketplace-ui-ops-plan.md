# Agent Marketplace UI Ops Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the remaining agent-marketplace productization surfaces by adding an operator-facing `/v2/marketplace` ops console, dispute review UI, and canonical contract ABI assets aligned to the implemented backend.

**Architecture:** Reuse the existing marketplace wireframe as the layout source-of-truth, but back the UI with new `/api/agent-marketplace/ops/*` routes that read Redis-backed request logs, SLA summaries, reputation state, and batch metadata. Keep the work isolated under the `agent-marketplace` namespace and avoid reusing the legacy subscription marketplace UI or API surfaces.

**Tech Stack:** Next.js App Router, React client components, TypeScript strict mode, Vitest, Redis-backed agent marketplace stores, viem ABI modules

---

### Task 1: Add ops summary API

**Files:**
- Create: `src/lib/agent-marketplace/ops-summary.ts`
- Create: `src/app/api/agent-marketplace/ops/summary/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/ops-summary.test.ts`
- Create: `src/app/api/agent-marketplace/ops/summary/route.test.ts`

**Step 1: Write the failing tests**

Cover:
- disabled marketplace returns empty/zero summary
- enabled marketplace returns request totals, distinct buyer count, per-service stats
- SLA summary and recent verified requests are included

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/ops-summary.test.ts src/app/api/agent-marketplace/ops/summary/route.test.ts`

Expected: FAIL because the summary composer and route do not exist yet.

**Step 3: Write minimal implementation**

Use:
- Redis-backed request logs
- catalog metadata
- existing SLA tracker
- latest batch metadata if available, otherwise `never`

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/ops-summary.test.ts src/app/api/agent-marketplace/ops/summary/route.test.ts`

Expected: PASS

### Task 2: Build `/v2/marketplace` operator page

**Files:**
- Create: `src/app/v2/marketplace/page.tsx`
- Create: `src/app/v2/marketplace/page.test.tsx`
- Create: optional UI helpers under `src/components/agent-marketplace/` if needed

**Step 1: Write the failing tests**

Cover:
- loading state
- disabled state banner
- summary cards and service panels render from ops summary API
- recent verified requests render with current service names

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: FAIL because the page does not exist yet.

**Step 3: Write minimal implementation**

Follow the dashboard portion of `docs/marketplace-wireframe.html`, but align labels to:
- `STATUS`
- `REQUESTS / 24H`
- `BUYERS / 24H`
- `LAST BATCH`

Do not show fake revenue totals.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: PASS

### Task 3: Add dispute store and ops APIs

**Files:**
- Create: `src/lib/agent-marketplace/dispute-store.ts`
- Create: `src/app/api/agent-marketplace/ops/disputes/route.ts`
- Create: `src/app/api/agent-marketplace/ops/disputes/[id]/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/dispute-store.test.ts`
- Create: `src/app/api/agent-marketplace/ops/disputes/route.test.ts`

**Step 1: Write the failing tests**

Cover:
- create dispute
- list disputes
- update dispute status
- validate allowed status transitions

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/dispute-store.test.ts src/app/api/agent-marketplace/ops/disputes/route.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Persist disputes in Redis with:
- `open | reviewed | resolved | rejected`
- basic metadata only

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/dispute-store.test.ts src/app/api/agent-marketplace/ops/disputes/route.test.ts`

Expected: PASS

### Task 4: Add dispute panel to `/v2/marketplace`

**Files:**
- Modify: `src/app/v2/marketplace/page.tsx`
- Modify: `src/app/v2/marketplace/page.test.tsx`

**Step 1: Extend tests**

Cover:
- open disputes list renders
- dispute status badge renders
- empty state renders correctly

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: FAIL with missing dispute section expectations.

**Step 3: Write minimal implementation**

Add a wireframe-aligned ops panel for disputes. Keep it review-oriented, not on-chain action-oriented.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: PASS

### Task 5: Add canonical ABI assets and contracts status API

**Files:**
- Create: `src/lib/agent-marketplace/abi/agent-registry.ts`
- Create: `src/lib/agent-marketplace/abi/reputation-registry.ts`
- Create: `src/lib/agent-marketplace/contracts-status.ts`
- Create: `src/app/api/agent-marketplace/ops/contracts/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/contracts-status.test.ts`
- Create: `src/app/api/agent-marketplace/ops/contracts/route.test.ts`
- Modify: `src/lib/agent-marketplace/agent-registry.ts`
- Modify: `src/lib/agent-marketplace/reputation-submit.ts`

**Step 1: Write the failing tests**

Cover:
- ABI modules export expected metadata
- contracts status route reports configured addresses and supported event names
- registry/reputation runtime code imports ABI definitions from the canonical modules

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/contracts-status.test.ts src/app/api/agent-marketplace/ops/contracts/route.test.ts src/lib/__tests__/agent-marketplace/agent-registry.test.ts src/lib/__tests__/agent-marketplace/reputation-submit.test.ts`

Expected: FAIL because the canonical ABI modules and contracts status route do not exist yet.

**Step 3: Write minimal implementation**

Keep alternate event parsing support, but move the canonical ABI/event metadata into dedicated modules and expose them via ops.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/contracts-status.test.ts src/app/api/agent-marketplace/ops/contracts/route.test.ts src/lib/__tests__/agent-marketplace/agent-registry.test.ts src/lib/__tests__/agent-marketplace/reputation-submit.test.ts`

Expected: PASS

### Task 6: Add contracts panel to `/v2/marketplace`

**Files:**
- Modify: `src/app/v2/marketplace/page.tsx`
- Modify: `src/app/v2/marketplace/page.test.tsx`

**Step 1: Extend tests**

Cover:
- registry/reputation contract address visibility
- supported event names visibility
- missing ABI/config state renders clearly

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: FAIL

**Step 3: Write minimal implementation**

Add a small `Contracts / ABI` panel to the ops page.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/v2/marketplace/page.test.tsx`

Expected: PASS

### Task 7: Verification and docs

**Files:**
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Update docs**

Document:
- `/v2/marketplace`
- ops APIs
- dispute review workflow
- canonical ABI asset locations

**Step 2: Run verification**

Run:
- `npx eslint src/lib/agent-marketplace src/lib/__tests__/agent-marketplace src/app/api/agent-marketplace src/app/v2/marketplace src/components`
- `npm run build`

Expected: PASS, aside from pre-existing Next warnings if unchanged.

**Step 3: Commit**

```bash
git add src/lib/agent-marketplace src/app/api/agent-marketplace src/app/v2/marketplace src/components docs/guide/runbook/agent-marketplace-operations-runbook.md docs/todo.md docs/lessons.md
git commit -m "feat: add agent marketplace ops console"
```
