# Agent Marketplace Batch History Design

**Goal:** Persist reputation batch publish results in Redis and expose recent history in `/v2/marketplace`.

## Scope

This phase adds:
- durable batch history storage
- latest batch summary sourced from durable history
- recent batch history list in the ops console

This phase does not add:
- manual batch rerun
- per-batch detail route
- on-chain dispute execution

## Recommendation

Use a Redis-backed append-only history store with fail-closed behavior.

Why:
- matches the existing Redis durability model used by request logs and reputation scores
- keeps the scheduler and daily job changes small
- gives the ops console both `lastBatch` and a short recent history list from one source of truth

## Data Model

Store recent batch records under a single Redis list key:

- `sentinai:agent-marketplace:reputation:batches`

Each record should contain:
- `status`: `success` | `failed`
- `publishedAt`
- `window.fromIso`
- `window.toIso`
- `batchHash`
- `txHash`
- `merkleRoot`
- `error`

Rules:
- `REDIS_URL` is required
- every daily batch attempt appends one record
- success records must contain `publishedAt`
- failure records should still store the window and error
- trim history to a bounded size, for example the latest 50 records

## Write Path

`publishDailyAgentMarketplaceReputationBatch()` becomes the owner of batch history writes.

On success:
- append a `success` record after publish succeeds

On failure:
- append a `failed` record before returning

This keeps the history aligned with the job result seen by the scheduler and operators.

## Read Path

`buildAgentMarketplaceOpsSummary()` should read recent batch history and:
- use the newest record as `lastBatch`
- expose recent records as `batchHistory`

If the history store cannot be read:
- fail closed instead of silently showing `never`

## UI

`/v2/marketplace` keeps the existing `LAST BATCH DETAIL` panel and adds:
- `LAST BATCH HISTORY`

The history list should show the latest five records with:
- status
- published time
- window
- batch hash
- tx hash or error

The latest record remains visible in the detail panel.

## Testing

Add tests for:
- history store read/write and trimming
- job recording success
- job recording failure
- ops summary using stored history for `lastBatch`
- ops page rendering `LAST BATCH HISTORY`

## Follow-Up

After this phase:
1. add dedicated batch history API if the console needs pagination
2. add per-batch deep links or detail route if the history grows
3. add manual rerun tooling only if operators actually need it
