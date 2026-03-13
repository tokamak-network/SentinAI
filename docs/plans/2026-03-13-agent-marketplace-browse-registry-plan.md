# Agent Marketplace Browse Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Load real ERC-8004 registry data into the public marketplace browse tab by scanning registration events and fetching each instance manifest.

**Architecture:** Add a server-side `registry-browse` library that scans canonical `AgentRegistered` logs, deduplicates to the latest registration per operator, and enriches rows with fetched `agent.json` metadata. Wire the public `/marketplace` registry tab to this library while keeping fail-safe empty states for missing config or fetch failures.

**Tech Stack:** Next.js App Router, TypeScript, Vitest, viem, server-side fetch

---

### Task 1: Document the browse-registry behavior

**Files:**
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-design.md`
- Create: `docs/plans/2026-03-13-agent-marketplace-browse-registry-plan.md`
- Modify: `docs/todo.md`

**Step 1: Update the active TODO context**

Add a short note that `BROWSE REGISTRY` is moving from placeholder mode to live registry discovery.

**Step 2: Save the design and plan docs**

Capture:

- event scan as source-of-truth
- latest-registration deduplication
- manifest enrichment behavior
- fail-safe empty states

**Step 3: Review the docs**

Check that the files mention the concrete runtime dependencies:

- `ERC8004_REGISTRY_ADDRESS`
- `SENTINAI_L1_RPC_URL`
- `/marketplace?tab=registry`

### Task 2: Add failing tests for browse-registry loading

**Files:**
- Create: `src/lib/__tests__/agent-marketplace/registry-browse.test.ts`
- Modify: `src/app/marketplace/page.test.ts`

**Step 1: Write the failing library tests**

Cover:

- returns empty state when registry config is missing
- parses `AgentRegistered` logs into latest-per-agent rows
- keeps rows even when manifest fetch fails

**Step 2: Run the focused test file and verify failure**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts`

Expected: failing import or missing implementation errors.

**Step 3: Write the failing page tests**

Add registry-tab expectations for:

- multiple live registry rows
- manifest-derived capabilities
- empty-state message when no rows exist

**Step 4: Run the page test and verify failure**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: missing text from live registry implementation.

### Task 3: Implement the minimal registry browse library

**Files:**
- Create: `src/lib/agent-marketplace/registry-browse.ts`
- Modify: `src/lib/agent-marketplace/abi/agent-registry.ts`

**Step 1: Add the read ABI needed for event scan**

Ensure the registry ABI module exports the canonical event definition used by browse.

**Step 2: Implement config resolution and fail-safe guards**

Return an empty browse result when:

- registry address is missing
- L1 RPC URL is missing

**Step 3: Implement event scan**

Use viem to:

- create a public client
- get `AgentRegistered` logs
- sort/deduplicate by latest `agentId` per operator

**Step 4: Implement manifest enrichment**

Fetch each `agentURI`, parse JSON, and return either:

- `manifestStatus: "ok"`
- `manifestStatus: "unavailable"`

**Step 5: Re-run library tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts`

Expected: PASS

### Task 4: Wire the public marketplace registry tab

**Files:**
- Modify: `src/app/marketplace/page.tsx`
- Test: `src/app/marketplace/page.test.ts`

**Step 1: Read browse result when rendering the registry tab**

Replace the static `1 instance` placeholder with live summary values.

**Step 2: Render live registry rows**

Each row should show:

- manifest name or fallback URI label
- payment network when available
- version when available
- capability count
- manifest status

**Step 3: Render an empty-state note when registry rows are unavailable**

Keep the page informative when:

- registry env is not set
- no logs exist yet

**Step 4: Re-run page tests**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: PASS

### Task 5: Verify and document

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Run focused verification**

Run:

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.test.ts
npx eslint --no-warn-ignored src/lib/agent-marketplace/registry-browse.ts src/lib/__tests__/agent-marketplace/registry-browse.test.ts src/app/marketplace/page.tsx src/app/marketplace/page.test.ts
npm run build
```

Expected:

- tests pass
- eslint passes
- build succeeds

**Step 2: Update docs**

Capture:

- live browse runtime dependencies
- empty-state behavior
- follow-up note that pagination can wait until registry volume grows
