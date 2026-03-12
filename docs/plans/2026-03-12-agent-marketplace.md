# Agent Marketplace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone agent marketplace in SentinAI that sells paid operational signals to external agents via x402, without reusing or depending on the existing subscription pricing codepath.

**Architecture:** Create a new `agent-marketplace` domain with isolated types, catalog, payment middleware, request logging, and route handlers under `/api/agent-marketplace/*`. Phase 1 ships only three paid read-only products: `sequencer-health`, `incident-summary`, and `batch-submission-status`; trust and discovery layers are added incrementally after the purchase flow is proven end to end.

**Tech Stack:** Next.js App Router route handlers, TypeScript strict mode, Vitest, existing SentinAI Redis-backed stores, viem-compatible payment integration

---

## Guardrails

- Do not import or extend the existing subscription marketplace pricing types or store.
- Treat `src/lib/marketplace-store.ts`, `src/lib/redis-marketplace-store.ts`, and `/api/marketplace/pricing` as unrelated legacy/prototype surfaces.
- Keep all new code under an explicit `agent-marketplace` namespace unless a shared utility is genuinely cross-domain.
- Marketplace routes are additive only. Existing internal monitoring routes remain the operator-facing source surfaces.
- Phase 1 exposes coarse operational safety signals only. No mempool, tx-level, or execution-triggering APIs.

## Delivery Order

1. Establish isolated domain types and catalog.
2. Add generic x402 gate and payment verification boundary.
3. Ship the three MVP paid products.
4. Add request logging, rate limiting, and SLA aggregation.
5. Add identity/discovery (`agent.json`, ERC-8004 bootstrap) after paid flow is stable.
6. Add on-chain reputation anchoring only after off-chain SLA data is trustworthy.

## File Map

**Create**

- `src/types/agent-marketplace.ts`
- `src/lib/agent-marketplace/catalog.ts`
- `src/lib/agent-marketplace/x402-middleware.ts`
- `src/lib/agent-marketplace/payment-verifier.ts`
- `src/lib/agent-marketplace/request-log-store.ts`
- `src/lib/agent-marketplace/rate-limit.ts`
- `src/lib/agent-marketplace/sequencer-health.ts`
- `src/lib/agent-marketplace/incident-summary.ts`
- `src/lib/agent-marketplace/batch-submission-status.ts`
- `src/lib/agent-marketplace/catalog-response.ts`
- `src/app/api/agent-marketplace/catalog/route.ts`
- `src/app/api/agent-marketplace/sequencer-health/route.ts`
- `src/app/api/agent-marketplace/incident-summary/route.ts`
- `src/app/api/agent-marketplace/batch-submission-status/route.ts`
- `src/app/api/agent-marketplace/agent.json/route.ts`
- `src/lib/__tests__/agent-marketplace/catalog.test.ts`
- `src/lib/__tests__/agent-marketplace/x402-middleware.test.ts`
- `src/lib/__tests__/agent-marketplace/payment-verifier.test.ts`
- `src/lib/__tests__/agent-marketplace/sequencer-health.test.ts`
- `src/lib/__tests__/agent-marketplace/incident-summary.test.ts`
- `src/lib/__tests__/agent-marketplace/batch-submission-status.test.ts`
- `src/lib/__tests__/agent-marketplace/request-log-store.test.ts`
- `src/app/api/agent-marketplace/catalog/route.test.ts`

**Modify Later**

- `src/lib/first-run-bootstrap.ts`
- `.env.local.sample`
- `ENV_GUIDE.md`

## Phase 1: Domain Isolation and Catalog

### Task 1: Define agent marketplace types

**Files:**
- Create: `src/types/agent-marketplace.ts`
- Test: `src/lib/__tests__/agent-marketplace/catalog.test.ts`

**Step 1: Write failing type-driven tests for catalog/service resolution**

Cover:
- allowed service keys
- TON-denominated price representation
- free vs paid endpoint metadata
- response status/action enums for sequencer health

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/catalog.test.ts`
Expected: FAIL because the module does not exist yet

**Step 3: Implement minimal isolated domain types**

Include:
- `AgentMarketplaceServiceKey`
- `AgentMarketplaceCatalog`
- `PaymentRequirement`
- `SequencerHealthSnapshot`
- `IncidentSummarySnapshot`
- `BatchSubmissionStatusSnapshot`
- `MarketplaceAgentMetadata`

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/catalog.test.ts`
Expected: PASS for type-backed catalog expectations

**Step 5: Commit**

```bash
git add src/types/agent-marketplace.ts src/lib/__tests__/agent-marketplace/catalog.test.ts
git commit -m "feat: add agent marketplace core types"
```

### Task 2: Create the catalog source of truth

**Files:**
- Create: `src/lib/agent-marketplace/catalog.ts`
- Create: `src/lib/agent-marketplace/catalog-response.ts`
- Modify: `src/lib/__tests__/agent-marketplace/catalog.test.ts`
- Create: `src/app/api/agent-marketplace/catalog/route.ts`
- Create: `src/app/api/agent-marketplace/catalog/route.test.ts`

**Step 1: Extend tests to cover catalog structure and free route response**

Verify:
- only the approved Phase 1 services are marked launch-ready
- prices match the design docs
- catalog endpoint omits internal-only fields

**Step 2: Run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/catalog.test.ts src/app/api/agent-marketplace/catalog/route.test.ts`
Expected: FAIL with missing catalog and route modules

**Step 3: Implement catalog and route**

Catalog must define:
- `sequencer_health`
- `incident_summary`
- `batch_submission_status`
- future services may be listed as `planned`, not `active`

Route response must include:
- marketplace agent metadata
- service list
- payment requirements for paid services
- AUP/version metadata

**Step 4: Re-run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/catalog.test.ts src/app/api/agent-marketplace/catalog/route.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/catalog.ts src/lib/agent-marketplace/catalog-response.ts src/app/api/agent-marketplace/catalog/route.ts src/app/api/agent-marketplace/catalog/route.test.ts src/lib/__tests__/agent-marketplace/catalog.test.ts
git commit -m "feat: add agent marketplace catalog"
```

## Phase 2: Payment Gate and Purchase Flow

### Task 3: Implement generic x402 middleware boundary

**Files:**
- Create: `src/lib/agent-marketplace/x402-middleware.ts`
- Create: `src/lib/agent-marketplace/payment-verifier.ts`
- Create: `src/lib/__tests__/agent-marketplace/x402-middleware.test.ts`
- Create: `src/lib/__tests__/agent-marketplace/payment-verifier.test.ts`

**Step 1: Write failing tests for 402 challenge and payment parsing**

Cover:
- no payment header returns 402 with `accepts`
- invalid payload returns 402 with machine-readable error
- `MARKETPLACE_PAYMENT_MODE=open` bypasses settlement but still records intent
- middleware remains service-agnostic

**Step 2: Run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/x402-middleware.test.ts src/lib/__tests__/agent-marketplace/payment-verifier.test.ts`
Expected: FAIL because middleware/verifier do not exist yet

**Step 3: Implement minimal verifier boundary**

Requirements:
- accept a parsed payment envelope
- validate required fields and service amount match
- isolate facilitator-specific network calls behind one function
- support `open`, `stub`, and `facilitated` verification modes

**Step 4: Re-run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/x402-middleware.test.ts src/lib/__tests__/agent-marketplace/payment-verifier.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/x402-middleware.ts src/lib/agent-marketplace/payment-verifier.ts src/lib/__tests__/agent-marketplace/x402-middleware.test.ts src/lib/__tests__/agent-marketplace/payment-verifier.test.ts
git commit -m "feat: add x402 middleware for agent marketplace"
```

## Phase 3: MVP Products

### Task 4: Ship sequencer health

**Files:**
- Create: `src/lib/agent-marketplace/sequencer-health.ts`
- Create: `src/app/api/agent-marketplace/sequencer-health/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/sequencer-health.test.ts`

**Step 1: Write failing tests for healthy/degraded/critical decisions**

Use existing metrics/anomaly stores as fixtures. Verify:
- `status`
- `healthScore`
- `action`
- short machine-readable `reasons`

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/sequencer-health.test.ts`
Expected: FAIL

**Step 3: Implement composer and protected route**

Reuse:
- `getRecentMetrics()` from `src/lib/metrics-store.ts`
- anomaly event summary from `src/lib/anomaly-event-store.ts`

Keep output coarse:
- no txpool details
- no raw pod names

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/sequencer-health.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/sequencer-health.ts src/app/api/agent-marketplace/sequencer-health/route.ts src/lib/__tests__/agent-marketplace/sequencer-health.test.ts
git commit -m "feat: add sequencer health marketplace product"
```

### Task 5: Ship incident summary

**Files:**
- Create: `src/lib/agent-marketplace/incident-summary.ts`
- Create: `src/app/api/agent-marketplace/incident-summary/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/incident-summary.test.ts`

**Step 1: Write failing aggregation tests**

Cover:
- empty state
- active high-severity incident
- 24h rolling counts and MTTR

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/incident-summary.test.ts`
Expected: FAIL

**Step 3: Implement aggregator and route**

Use anomaly event history as the Phase 1 incident source of truth.

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/incident-summary.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/incident-summary.ts src/app/api/agent-marketplace/incident-summary/route.ts src/lib/__tests__/agent-marketplace/incident-summary.test.ts
git commit -m "feat: add incident summary marketplace product"
```

### Task 6: Ship batch submission status

**Files:**
- Create: `src/lib/agent-marketplace/batch-submission-status.ts`
- Create: `src/app/api/agent-marketplace/batch-submission-status/route.ts`
- Create: `src/lib/__tests__/agent-marketplace/batch-submission-status.test.ts`

**Step 1: Write failing tests for fallback-derived health**

Cover:
- healthy baseline
- warning lag
- critical submission gap

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/batch-submission-status.test.ts`
Expected: FAIL

**Step 3: Implement derived signal**

If direct batch telemetry is unavailable in current codebase:
- derive status from recent block interval instability
- sync lag trend
- unresolved incident severity
- explicit fallback note in code comments and docs

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/batch-submission-status.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/batch-submission-status.ts src/app/api/agent-marketplace/batch-submission-status/route.ts src/lib/__tests__/agent-marketplace/batch-submission-status.test.ts
git commit -m "feat: add batch submission marketplace product"
```

## Phase 4: Abuse Controls and SLA Baseline

### Task 7: Add request logging and rate limiting

**Files:**
- Create: `src/lib/agent-marketplace/request-log-store.ts`
- Create: `src/lib/agent-marketplace/rate-limit.ts`
- Create: `src/lib/__tests__/agent-marketplace/request-log-store.test.ts`
- Modify: `src/lib/agent-marketplace/x402-middleware.ts`

**Step 1: Write failing tests for request recording and throttle behavior**

Cover:
- successful paid request log
- failed verification log
- agent/service scoped rate threshold

**Step 2: Run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/request-log-store.test.ts src/lib/__tests__/agent-marketplace/x402-middleware.test.ts`
Expected: FAIL

**Step 3: Implement minimal abuse controls**

Record:
- `agentId`
- `serviceKey`
- `timestamp`
- `latencyMs`
- `verificationResult`

Throttle:
- per-agent
- per-service
- configurable via env

**Step 4: Re-run focused tests**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/request-log-store.test.ts src/lib/__tests__/agent-marketplace/x402-middleware.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/request-log-store.ts src/lib/agent-marketplace/rate-limit.ts src/lib/__tests__/agent-marketplace/request-log-store.test.ts src/lib/agent-marketplace/x402-middleware.ts
git commit -m "feat: add agent marketplace request logging and rate limits"
```

### Task 8: Add off-chain SLA aggregation

**Files:**
- Create: `src/lib/agent-marketplace/sla-tracker.ts`
- Create: `src/lib/__tests__/agent-marketplace/sla-tracker.test.ts`

**Step 1: Write failing tests for daily SLA summaries**

Cover:
- success rate calculation
- average latency calculation
- no-success penalty
- recovery bonus logic

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/sla-tracker.test.ts`
Expected: FAIL

**Step 3: Implement off-chain daily aggregation only**

Do not add blockchain writes yet. Output should be sufficient for:
- internal dashboards
- operator review
- later Merkle export

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/sla-tracker.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/sla-tracker.ts src/lib/__tests__/agent-marketplace/sla-tracker.test.ts
git commit -m "feat: add off-chain sla aggregation for agent marketplace"
```

## Phase 5: Discovery and Trust Extensions

### Task 9: Publish agent metadata and bootstrap registration hooks

**Files:**
- Create: `src/app/api/agent-marketplace/agent.json/route.ts`
- Modify: `src/lib/first-run-bootstrap.ts`
- Modify: `.env.local.sample`
- Modify: `ENV_GUIDE.md`

**Step 1: Write failing tests for metadata publishing and safe bootstrap behavior**

Verify:
- metadata route publishes current catalog capabilities
- bootstrap skips registration cleanly when marketplace is disabled
- registration failure does not break core bootstrap

**Step 2: Run focused tests**

Run: `npx vitest run src/lib/__tests__/first-run-bootstrap.test.ts`
Expected: FAIL on missing registration hooks/metadata expectations

**Step 3: Implement metadata route and guarded bootstrap integration**

Requirements:
- marketplace registration is opt-in only
- no registration attempt without required env
- clear warnings when disabled or partially configured

**Step 4: Re-run focused tests**

Run: `npx vitest run src/lib/__tests__/first-run-bootstrap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/app/api/agent-marketplace/agent.json/route.ts src/lib/first-run-bootstrap.ts .env.local.sample ENV_GUIDE.md
git commit -m "feat: add agent marketplace metadata publishing"
```

### Task 10: Prepare on-chain reputation integration boundary

**Files:**
- Create: `src/lib/agent-marketplace/reputation-batch.ts`
- Create: `src/lib/__tests__/agent-marketplace/reputation-batch.test.ts`
- Docs only if contract code is not yet in scope

**Step 1: Write failing tests for Merkle export payload generation**

Cover:
- score clamping
- deterministic leaf encoding
- per-agent batch payload generation

**Step 2: Run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-batch.test.ts`
Expected: FAIL

**Step 3: Implement export-only boundary**

Out of scope for this task:
- deploying contracts
- submitting transactions
- dispute UI

In scope:
- deterministic batch payload
- Merkle-ready export contract

**Step 4: Re-run focused test**

Run: `npx vitest run src/lib/__tests__/agent-marketplace/reputation-batch.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/agent-marketplace/reputation-batch.ts src/lib/__tests__/agent-marketplace/reputation-batch.test.ts
git commit -m "feat: add reputation batch export for agent marketplace"
```

## Final Verification

Run:

```bash
npx vitest run src/lib/__tests__/agent-marketplace
npm run lint
npm run build
git diff --stat
```

Expected:
- all agent marketplace tests pass
- lint passes
- production build succeeds
- diff is isolated to the new agent marketplace domain and documented bootstrap/env changes

## Open Decisions Captured

- Route prefix: use `/api/agent-marketplace/*` to avoid collision with the legacy subscription marketplace prototype.
- Price unit: use TON smallest-unit strings in catalog/payment metadata; do not reuse USD cent types.
- Identity registration: deferred until after paid request/response flow is stable.
- Reputation system: off-chain SLA first, on-chain anchoring later.
