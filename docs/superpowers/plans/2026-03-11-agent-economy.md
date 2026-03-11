# Agent Economy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents are available) or superpowers:executing-plans to implement this plan. Track each step with checkbox syntax.

**Goal:** Expose SentinAI's operational monitoring data as paid services for external AI agents via x402 and ERC-8004, with `sequencer-health` replacing `txpool` as the lead DeFi-facing product.

**Architecture:** Add a new `/api/marketplace/*` route group on top of the existing API. `catalog.ts` remains the source of truth for services and pricing, `x402-middleware.ts` remains the payment gate, and each protected route wraps its handler with `withX402(request, serviceKey)`. Phase 1 sells read-only operational signals only.

**Tech Stack:** Next.js 16 route handlers, TypeScript strict, viem, Vitest

---

## File Map

```
NEW:
  src/lib/marketplace/
    catalog.ts
    x402-middleware.ts
    payment-verifier.ts
    agent-registry.ts
    sequencer-health.ts
    incident-summary.ts
    batch-submission-status.ts

  src/app/api/marketplace/
    catalog/route.ts
    identity/route.ts
    sequencer-health/route.ts
    anomalies/route.ts
    incident-summary/route.ts
    rca/[id]/route.ts
    eoa/route.ts
    resources/route.ts
    batch-submission-status/route.ts
    metrics/route.ts
    scaling-history/route.ts
    sync-trend/route.ts

  src/lib/__tests__/marketplace/
    catalog.test.ts
    x402-middleware.test.ts
    payment-verifier.test.ts
    sequencer-health.test.ts
    incident-summary.test.ts
    batch-submission-status.test.ts

MODIFIED:
  src/lib/first-run-bootstrap.ts
  .env.local.sample
```

---

## Task 1: Define marketplace catalog

**Files:**
- Create: `src/lib/marketplace/catalog.ts`
- Create: `src/lib/__tests__/marketplace/catalog.test.ts`

**Service keys:**
- `sequencer_health`
- `anomalies`
- `incident_summary`
- `rca`
- `eoa`
- `resources`
- `batch_submission_status`
- `metrics`
- `scaling_history`
- `sync_trend`

**Default prices:**
- `sequencer_health`: `100000000000000000`
- `anomalies`: `200000000000000000`
- `incident_summary`: `150000000000000000`
- `rca`: `500000000000000000`
- `eoa`: `200000000000000000`
- `resources`: `100000000000000000`
- `batch_submission_status`: `150000000000000000`
- `metrics`: `50000000000000000`
- `scaling_history`: `100000000000000000`
- `sync_trend`: `100000000000000000`

**Descriptions:**
- `sequencer_health`: `Decision-ready execution health snapshot for agent gating`
- `incident_summary`: `Current incident state and recent reliability summary`
- `batch_submission_status`: `Recent batch posting health, lag, and settlement risk`

**Verification:**
- Run `npx vitest run src/lib/__tests__/marketplace/catalog.test.ts`
- Confirm every key resolves and env overrides work

---

## Task 2: Keep x402 middleware generic

**Files:**
- Create: `src/lib/marketplace/x402-middleware.ts`
- Create: `src/lib/marketplace/payment-verifier.ts`
- Create: `src/lib/__tests__/marketplace/x402-middleware.test.ts`
- Create: `src/lib/__tests__/marketplace/payment-verifier.test.ts`

**Requirements:**
- `withX402()` remains service-agnostic
- Replace `txpool` examples in tests and docs with `sequencer_health`
- Keep `MARKETPLACE_PAYMENT_MODE=open` for local smoke testing

**Verification:**
- Run `npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts`
- Run `npx vitest run src/lib/__tests__/marketplace/payment-verifier.test.ts`

---

## Task 3: Implement sequencer health composer

**Files:**
- Create: `src/lib/marketplace/sequencer-health.ts`
- Create: `src/lib/__tests__/marketplace/sequencer-health.test.ts`
- Create: `src/app/api/marketplace/sequencer-health/route.ts`

**Response shape:**

```json
{
  "status": "healthy",
  "healthScore": 84,
  "action": "proceed",
  "reasons": [
    "block interval stable",
    "no active critical incidents"
  ],
  "window": {
    "lookbackMinutes": 15,
    "sampleCount": 15
  },
  "blockProduction": {
    "latestBlockIntervalSec": 2.1,
    "avgBlockIntervalSec": 2.3,
    "stdDevBlockIntervalSec": 0.4,
    "trend": "stable",
    "stalled": false
  },
  "sync": {
    "lagBlocks": 0,
    "lagTrend": "stable",
    "catchingUp": false
  },
  "incident": {
    "activeCount": 0,
    "highestSeverity": "none",
    "lastIncidentAt": "2026-03-11T09:00:00Z"
  },
  "resources": {
    "cpuPressure": "normal",
    "memoryPressure": "normal"
  },
  "updatedAt": "2026-03-11T09:05:00Z"
}
```

**Implementation notes:**
- Reuse `getRecentMetrics()` and existing anomaly/event stores
- Derive `status`, `healthScore`, and `action` in one place
- Keep reasons short and machine-friendly
- Do not expose transaction-level or mempool-level detail

**Verification:**
- Add tests for healthy, degraded, and critical states
- Run `npx vitest run src/lib/__tests__/marketplace/sequencer-health.test.ts`

---

## Task 4: Implement incident summary

**Files:**
- Create: `src/lib/marketplace/incident-summary.ts`
- Create: `src/lib/__tests__/marketplace/incident-summary.test.ts`
- Create: `src/app/api/marketplace/incident-summary/route.ts`

**Response shape:**

```json
{
  "status": "degraded",
  "activeCount": 1,
  "highestSeverity": "high",
  "unresolvedCount": 1,
  "lastIncidentAt": "2026-03-11T08:42:00Z",
  "rollingWindow": {
    "lookbackHours": 24,
    "incidentCount": 3,
    "mttrMinutes": 18
  }
}
```

**Verification:**
- Test empty state
- Test active critical incident state
- Test rolling window aggregation

---

## Task 5: Implement batch submission status

**Files:**
- Create: `src/lib/marketplace/batch-submission-status.ts`
- Create: `src/lib/__tests__/marketplace/batch-submission-status.test.ts`
- Create: `src/app/api/marketplace/batch-submission-status/route.ts`

**Response shape:**

```json
{
  "status": "warning",
  "lastSuccessfulSubmissionAt": "2026-03-11T08:42:00Z",
  "submissionLagSec": 540,
  "riskLevel": "elevated",
  "reasons": [
    "batch posting delayed",
    "settlement pipeline slower than baseline"
  ]
}
```

**Implementation notes:**
- Reuse existing batcher, derivation lag, or settlement probes where possible
- If direct batch submission telemetry does not yet exist, implement a minimal derived status from currently available signals and document the fallback

**Verification:**
- Test healthy, warning, and critical cases

---

## Task 6: Implement remaining protected routes

**Files:**
- Create: `src/app/api/marketplace/anomalies/route.ts`
- Create: `src/app/api/marketplace/rca/[id]/route.ts`
- Create: `src/app/api/marketplace/eoa/route.ts`
- Create: `src/app/api/marketplace/resources/route.ts`
- Create: `src/app/api/marketplace/metrics/route.ts`
- Create: `src/app/api/marketplace/scaling-history/route.ts`
- Create: `src/app/api/marketplace/sync-trend/route.ts`

**Requirements:**
- Each route gates first with `withX402()`
- Routes stay thin and reuse existing SentinAI services
- No execution actions are exposed

**Verification:**
- Run `npm run build`
- Confirm no import or type errors

---

## Task 7: Free routes and identity

**Files:**
- Create: `src/app/api/marketplace/catalog/route.ts`
- Create: `src/app/api/marketplace/identity/route.ts`
- Create: `src/lib/__tests__/marketplace/catalog-route.test.ts`

**Requirements:**
- Catalog must expose new service keys and prices
- Identity must advertise capabilities including `sequencer_health`, `incident_summary`, and `batch_submission_status`

**Verification:**
- Run `npx vitest run src/lib/__tests__/marketplace/catalog-route.test.ts`
- Smoke test `GET /api/marketplace/catalog`

---

## Task 8: Bootstrap and environment integration

**Files:**
- Modify: `src/lib/first-run-bootstrap.ts`
- Modify: `.env.local.sample`
- Modify: `src/lib/__tests__/first-run-bootstrap.test.ts`

**Requirements:**
- Preserve ERC-8004 self-registration flow
- Update env docs to remove `MARKETPLACE_PRICE_TXPOOL`
- Add env docs for new service prices

**Verification:**
- Run `npx vitest run src/lib/__tests__/first-run-bootstrap.test.ts`

---

## Task 9: End-to-end verification

**Checks:**
- Run `npm run test:run`
- Run `npm run lint`
- Run `npm run build`
- Smoke test with:

```bash
MARKETPLACE_ENABLED=true
MARKETPLACE_PAYMENT_MODE=open
```

**Manual smoke routes:**
- `GET /api/marketplace/catalog`
- `GET /api/marketplace/sequencer-health`
- `GET /api/marketplace/incident-summary`
- `GET /api/marketplace/batch-submission-status`
- `GET /api/marketplace/anomalies`

**Expected outcomes:**
- Free routes return 200
- Protected routes return 200 in `open` mode
- Protected routes return 402 in `verify` mode without `X-PAYMENT`

---

## Known Limitations

1. Real TON settlement still requires a facilitator.
2. ERC-8004 registration remains fire-and-forget.
3. Batch submission status may initially use derived heuristics if direct telemetry is incomplete.
4. Phase 1 intentionally excludes txpool and any order-flow-adjacent market data.
