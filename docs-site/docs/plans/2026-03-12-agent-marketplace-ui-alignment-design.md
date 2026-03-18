# Agent Marketplace UI Alignment Design

> Wireframe source: `docs/marketplace-wireframe.html`

**Goal:** Reuse the existing marketplace wireframe as the visual source-of-truth while aligning all data, service names, and operational states to the implemented `agent-marketplace` backend.

**Scope:** This design covers the remaining productization tasks:
- `1.` expose SLA summary and recent request volume in an operator-facing UI/API
- `2.` add a dispute/review UI for reputation operations
- `3.` add deployed contract ABI source-of-truth assets and surface their status in ops

## Current Backend Reality

The implemented backend is **not** the legacy `/api/marketplace/*` surface assumed by the wireframe and older docs.

The active source-of-truth is:
- catalog: `src/lib/agent-marketplace/catalog.ts`
- public catalog route: `src/app/api/agent-marketplace/catalog/route.ts`
- public manifest route: `src/app/api/agent-marketplace/agent.json/route.ts`
- paid services:
  - `/api/agent-marketplace/sequencer-health`
  - `/api/agent-marketplace/incident-summary`
  - `/api/agent-marketplace/batch-submission-status`
- request logs: Redis key `sentinai:agent-marketplace:request-logs`
- reputation scores: Redis key `sentinai:agent-marketplace:reputation:scores`
- daily batch publishing: `src/lib/agent-marketplace/reputation-job.ts` + `src/lib/scheduler.ts`

The UI must align to this backend instead of reviving the legacy marketplace prototype.

## What Stays From The Wireframe

These parts remain valid and should be reused:
- Two-surface split:
  - operator dashboard surface
  - public website marketplace surface
- Operator dashboard layout:
  - 4-stat header
  - 2-column middle section
  - recent activity section
- Website layout:
  - `Browse Registry`
  - `This Instance`
  - `Connect Guide`
- Visual language:
  - IBM Plex Mono
  - red/blue tier treatment
  - dense console-style information layout
- Disabled-state banner pattern

## What Must Change

### 1. Service Catalog Mapping

The wireframe uses outdated marketplace products. Replace them with the implemented catalog:

| Wireframe item | Replace with |
|---|---|
| `txpool` | `sequencer_health` |
| `anomalies` | `incident_summary` |
| `metrics` / `scaling-history` / `sync-trend` | `batch_submission_status` |
| `rca`, `eoa`, `resources` | remove from Phase 1 UI |

Display names should come from catalog metadata:
- `Sequencer Health`
- `Incident Summary`
- `Batch Submission Status`

### 2. API Surface Mapping

Replace all legacy route references:

| Legacy reference | Current source |
|---|---|
| `/api/marketplace/catalog` | `/api/agent-marketplace/catalog` |
| `/api/marketplace/agent.json` | `/api/agent-marketplace/agent.json` |
| `/api/marketplace/<service>` | `/api/agent-marketplace/<service>` |
| `GET /api/marketplace/stats` | new `GET /api/agent-marketplace/ops/summary` |

### 3. Revenue Language

The current backend does **not** have a trustworthy revenue ledger. The wireframe sections that imply revenue must be reinterpreted:

| Wireframe label | Current meaning |
|---|---|
| `EARNED / MO` | replace with `LAST BATCH` or `VERIFIED / 24H` |
| `TOP BUYERS` | distinct buyers ranked by verified request count |
| `RECENT SALES` | recent verified requests |

Do not fake TON revenue totals from request counts.

## Operator Surface Recommendation

Use a dedicated route:
- `/v2/marketplace`

Reason:
- `/v2` root is still mostly mock data
- the remaining productization tasks are operational console tasks
- the wireframe’s dashboard layout maps cleanly to a dedicated marketplace ops page

### `/v2/marketplace` Sections

#### Header Stats

Recommended cards:
- `STATUS`
  - `ACTIVE` / `DISABLED`
- `REQUESTS / 24H`
  - total verified + rejected + rate-limited requests in last 24h
- `BUYERS / 24H`
  - distinct `agentId` count from request logs
- `LAST BATCH`
  - `success`, `failed`, or `never`

#### Left Panel

Service activity panel:
- service display name
- TON price from catalog
- request count in the selected window

#### Right Panel

SLA / buyer panel:
- top agents by verified request count
- current SLA summary per agent
- latest score if available

#### Bottom Section

Recent verified requests:
- `agentId`
- service name
- verification result
- relative time

#### Additional Ops Panels

Add two panels below or as tabs:
- `Disputes`
- `Contracts / ABI`

## Dispute UI Design

The wireframe has no dispute section, so add a lightweight ops panel:

### Phase 1 Dispute Model

This is an **operator review UI**, not an on-chain dispute executor.

Stored fields:
- `id`
- `agentId`
- `batchHash`
- `merkleRoot`
- `requestedScore`
- `expectedScore`
- `reason`
- `status` = `open | reviewed | resolved | rejected`
- `createdAt`
- `updatedAt`

### UI Shape

Simple table/panel:
- open disputes first
- click row to expand details
- show latest SLA summary + current persisted score
- allow operator status changes through internal API

## ABI Source-Of-Truth Design

Current code supports alternate event signatures, but the repository still lacks canonical ABI assets.

Add source-of-truth modules:
- `src/lib/agent-marketplace/abi/agent-registry.ts`
- `src/lib/agent-marketplace/abi/reputation-registry.ts`

These modules should export:
- contract ABI
- supported event names
- version/source metadata

The ops UI should show:
- registry ABI loaded
- reputation ABI loaded
- active event names used for parsing

## Public Website Surface Recommendation

Keep the wireframe structure, but align the data:

### Browse Registry
- read registry-derived instances when available
- show `capabilities.length` based on current `agent.json`
- expect 3 active services by default

### This Instance
- fetch `/api/agent-marketplace/catalog`
- show the 3 active services only
- preserve red/blue grouping as a visual grouping, not a hard backend tier contract

### Connect Guide
- update snippets to current `x-payment` envelope flow
- use `/api/agent-marketplace/*` examples
- remove stale EIP-3009-specific wording unless facilitator mode truly requires it

## New Ops APIs

Add:
- `GET /api/agent-marketplace/ops/summary`
- `GET /api/agent-marketplace/ops/disputes`
- `POST /api/agent-marketplace/ops/disputes`
- `PATCH /api/agent-marketplace/ops/disputes/[id]`
- `GET /api/agent-marketplace/ops/contracts`

### `ops/summary` shape

Should include:
- `enabled`
- `window`
- `requestTotals`
- `distinctBuyerCount`
- `services[]`
- `topBuyers[]`
- `recentRequests[]`
- `slaAgents[]`
- `lastBatch`

## Risks

- Reusing the wireframe text literally will reintroduce legacy `/api/marketplace/*` assumptions.
- Showing revenue-like metrics without a payment ledger will misrepresent current system capability.
- Putting this on `/v2` root will expand scope because `/v2/page.tsx` is still mostly mock-based.

## Recommendation

Implement in this order:
1. `/v2/marketplace` + `ops/summary`
2. dispute store + dispute ops UI
3. canonical ABI modules + contracts status panel
4. only then adapt the public website marketplace page if still desired
