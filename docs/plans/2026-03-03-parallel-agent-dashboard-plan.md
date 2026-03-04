# Parallel Agent Dashboard Upgrade Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first production-ready parallel-agent observability layer to the main dashboard (fleet status + parallel execution KPIs) with a dedicated API and tested metric derivation.

**Architecture:** Keep existing agent loop panel intact and add a new `Agent Fleet` panel powered by a lightweight `/api/agent-fleet` endpoint. The endpoint composes orchestrator status + recent cycle history and derives deterministic KPI aggregates through a pure utility module with unit tests.

**Tech Stack:** Next.js App Router, TypeScript, React, Vitest

---

### Task 1: Define KPI derivation contract (TDD first)

**Files:**
- Create: `src/lib/__tests__/agent-fleet.test.ts`
- Create: `src/lib/agent-fleet.ts`

**Step 1: Write failing tests**
- Add tests for:
  - Fleet counts (`total`, `running`, `stale`, `instances`)
  - Success rate + throughput
  - P95 latency and critical-path phase selection
  - Empty input safety defaults

**Step 2: Run test to verify it fails**
- Run: `npm run test:run -- src/lib/__tests__/agent-fleet.test.ts`
- Expected: FAIL because `src/lib/agent-fleet.ts` does not exist yet.

**Step 3: Write minimal implementation**
- Implement `buildAgentFleetSnapshot()` in `src/lib/agent-fleet.ts`.
- Keep logic deterministic and side-effect free.

**Step 4: Re-run test to verify it passes**
- Run: `npm run test:run -- src/lib/__tests__/agent-fleet.test.ts`
- Expected: PASS.

**Step 5: Commit**
```bash
git add src/lib/__tests__/agent-fleet.test.ts src/lib/agent-fleet.ts
git commit -m "feat: add parallel agent fleet metric derivation"
```

### Task 2: Add Agent Fleet API endpoint

**Files:**
- Create: `src/app/api/agent-fleet/route.ts`
- Modify: `src/lib/agent-fleet.ts` (types/export adjustments only if needed)

**Step 1: Write/expand failing test (if endpoint test is added)**
- Optional if time-boxed; focus mandatory coverage on pure utility.

**Step 2: Implement route**
- Gather orchestrator statuses using `getAgentOrchestrator().getStatuses()`.
- Gather recent cycles via `getAgentCycleHistory(limit)`.
- Return `NextResponse.json` with `summary`, `kpi`, `roles`, `updatedAt`.
- Add explicit try/catch and 500 error payload.

**Step 3: Validate route type safety**
- Run: `npx tsc --noEmit`
- Expected: PASS.

**Step 4: Commit**
```bash
git add src/app/api/agent-fleet/route.ts src/lib/agent-fleet.ts
git commit -m "feat: expose parallel agent fleet status api"
```

### Task 3: Integrate dashboard panel

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add client-side fetch state**
- Define `AgentFleetData` interfaces in `page.tsx`.
- Poll `/api/agent-fleet` every 30s with existing dashboard polling style.

**Step 2: Render new panel**
- Add “Parallel Agent Fleet” card below existing Agent Loop panel.
- Include:
  - Fleet counters (agents, instances, stale)
  - Parallel KPIs (throughput, success rate, p95)
  - Role health strip (`collector/detector/analyzer/executor/verifier`)

**Step 3: Keep graceful fallback**
- If API unavailable, show muted `No fleet data` state without breaking existing UI.

**Step 4: Commit**
```bash
git add src/app/page.tsx
git commit -m "feat: add parallel agent fleet panel to dashboard"
```

### Task 4: Verification + documentation updates

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`

**Step 1: Run verification commands**
- Run:
  - `npm run lint -- src/app/page.tsx src/app/api/agent-fleet/route.ts src/lib/agent-fleet.ts src/lib/__tests__/agent-fleet.test.ts`
  - `npm run test:run -- src/lib/__tests__/agent-fleet.test.ts`
  - `npx tsc --noEmit`
- Expected: all pass.

**Step 2: Update task tracking and review notes**
- Mark completed checklist in `docs/todo.md`.
- Add a short “Detailed Review (2026-03-03 Parallel Agent Dashboard Upgrade)” section.

**Step 3: Update lessons**
- Add one rule learned from this change in `docs/lessons.md`.

**Step 4: Commit**
```bash
git add docs/todo.md docs/lessons.md
git commit -m "docs: record parallel agent dashboard implementation review"
```
