# Agent Marketplace Ops Drill-Down Design

**Goal:** Upgrade `/v2/marketplace` from a read-only summary console into an operator-friendly drill-down surface without introducing unnecessary client state.

## Scope

Phase 1 drill-down covers:
- dispute detail view
- batch detail view
- query-driven selection so detail state is shareable and testable

## Recommendation

Use query-driven server-rendered detail panels:
- `/v2/marketplace?dispute=<id>`

Batch detail does not need a separate query yet because only the latest batch is currently exposed by `ops-summary`.

## Why this approach

- Keeps the page as a server component
- Avoids client-only interaction and browser test overhead
- Makes detail states deep-linkable for operators
- Reuses the same testing strategy already used for `/marketplace` and `/v2/marketplace`

## UI Changes

### Disputes

Current:
- flat list only

Add:
- each dispute row becomes a link
- selected dispute detail panel below the list
- detail panel shows:
  - dispute id
  - agent id
  - batch hash
  - merkle root
  - requested score
  - expected score
  - score delta
  - current status
  - created / updated timestamps
  - matching SLA summary for the same agent when available

Selection rules:
- if `?dispute=<id>` exists and matches, show that dispute
- otherwise show the newest dispute when disputes exist
- if none exist, show current empty state

### Batch

Current:
- only `LAST BATCH` card

Add:
- `LAST BATCH DETAIL` panel
- fields:
  - status
  - publishedAt
  - batchHash
  - txHash
  - error

Rendering rules:
- when status is `never`, show a clear no-batch-yet empty state
- when status is `failed`, highlight `error`
- when status is `success`, highlight batch identifiers

## Data Sources

- disputes: `listAgentMarketplaceDisputes()`
- matching SLA data: `summary.slaAgents`
- batch summary: `summary.lastBatch`

No new API route is required for this phase.

## Testing

Add page tests for:
- selected dispute detail rendering when `searchParams.dispute` matches
- defaulting to newest dispute when no query is provided
- batch detail empty state for `never`
- batch detail fields for `success` and `failed`

## Non-Goals

- dispute mutation UI
- reviewer notes
- batch history list
- manual batch rerun action

## Follow-Up

After this phase:
1. add dispute status mutation UI
2. add reviewer note / audit trail
3. add batch history persistence and list view
