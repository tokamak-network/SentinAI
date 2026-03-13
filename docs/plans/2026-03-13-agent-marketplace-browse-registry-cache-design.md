# Agent Marketplace Browse Registry Cache Design

**Goal:** Reduce repeated RPC log scans and remote `agent.json` fetches for the public `BROWSE REGISTRY` tab by adding a lightweight server-side TTL cache.

## Scope

This phase adds a process-local cache around `getAgentMarketplaceRegistryBrowseData()`.

It includes:

- TTL caching for successful browse results
- explicit cache invalidation helper for tests
- no caching for failed browse attempts

It does not include:

- Redis-backed browse caching
- pagination
- background refresh

## Recommended Approach

Use a small global in-process cache, similar to other lightweight runtime caches in the repository.

Why:

- browse is a public read path, not a settlement or reputation source-of-truth
- fail-closed Redis would be too heavy for this surface
- the goal is latency and RPC reduction, not durable state

## Cache Policy

- cache key: single browse result for the configured registry
- cache TTL: 30 seconds
- cache only successful results
- do not cache:
  - missing-config responses
  - RPC failures
  - manifest fetch total failure at the top-level browse call

## Runtime Semantics

- first request performs full event scan + manifest fetch
- subsequent requests within TTL reuse the cached result
- after TTL expires, the next request refreshes the result

## Testing

- first call fetches and caches
- second call within TTL reuses cached result
- expired cache causes refetch
- failed top-level browse result does not poison the cache
