# Agent Marketplace Operator Registration + Buyer Sandbox UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an operator registry registration panel to `/v2/marketplace` and a buyer sandbox tab to `/marketplace`.

**Architecture:** Keep the current split between operator and public surfaces. Add one thin operator registration route for on-chain `register(agentURI)` submission, and one public sandbox tab that reuses live catalog data to generate and preview a sample x402 purchase request.

**Tech Stack:** Next.js App Router, React server components, TypeScript, viem, Vitest

---

### Task 1: Add failing tests for operator registration route

**Files:**
- Create: `src/app/api/agent-marketplace/ops/register/route.test.ts`
- Create: `src/app/api/agent-marketplace/ops/register/route.ts`

**Step 1: Write the failing test**

Cover:
- registration success redirect or JSON response
- registration failure handling
- route calls `registerAgentMarketplaceIdentity()`

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/agent-marketplace/ops/register/route.test.ts`

Expected: FAIL

### Task 2: Add the operator registration panel to `/v2/marketplace`

**Files:**
- Modify: `src/app/v2/marketplace/page.test.ts`
- Modify: `src/app/v2/marketplace/page.tsx`

**Step 1: Write the failing test**

Cover:
- `REGISTRY REGISTRATION` panel exists
- registry address and `agent.json` URI are shown
- form action points to the operator registration route

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: FAIL

**Step 3: Write minimal implementation**

Render the registration panel using existing contract/env data.

**Step 4: Re-run test**

Run: `npx vitest run src/app/v2/marketplace/page.test.ts`

Expected: PASS

### Task 3: Add failing tests for the buyer sandbox tab

**Files:**
- Modify: `src/app/marketplace/page.test.ts`
- Modify: `src/app/marketplace/page.tsx`

**Step 1: Write the failing test**

Cover:
- `BUYER SANDBOX` tab exists
- selected sandbox tab renders buyer agent input, service selector, endpoint preview, and sample envelope section

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: FAIL

### Task 4: Implement the buyer sandbox tab

**Files:**
- Modify: `src/app/marketplace/page.tsx`

**Step 1: Add tab routing**

Support:
- `?tab=sandbox`

**Step 2: Render sandbox UI**

Show:
- buyer agent id
- service list
- endpoint preview
- payment metadata
- sample `x-payment` envelope block

**Step 3: Re-run test**

Run: `npx vitest run src/app/marketplace/page.test.ts`

Expected: PASS

### Task 5: Verification and docs

**Files:**
- Modify: `docs/todo.md`
- Modify: `docs/lessons.md`
- Modify: `docs/guide/runbook/agent-marketplace-operations-runbook.md`

**Step 1: Update docs**

Document:
- operator registration route
- buyer sandbox tab
- intended testing use only

**Step 2: Run verification**

Run:
- `npx vitest run src/app/api/agent-marketplace/ops/register/route.test.ts src/app/v2/marketplace/page.test.ts src/app/marketplace/page.test.ts`
- `npx eslint --no-warn-ignored src/app/api/agent-marketplace/ops/register/route.ts src/app/api/agent-marketplace/ops/register/route.test.ts src/app/v2/marketplace/page.tsx src/app/v2/marketplace/page.test.ts src/app/marketplace/page.tsx src/app/marketplace/page.test.ts`
- `npm run build`

Expected: PASS, aside from unchanged Next warnings.
