# Agent Marketplace Browse Registry Design

**Goal:** Replace the placeholder `BROWSE REGISTRY` view with live ERC-8004 registry data derived from on-chain registration events and fetched `agent.json` manifests.

## Scope

This phase adds server-side registry discovery for the public `/marketplace?tab=registry` surface.

It includes:

- ERC-8004 event scan against the configured registry
- latest-registration deduplication per operator address
- `agent.json` fetch for each discovered `agentURI`
- graceful fallback when registry config or manifest fetch is unavailable

It does not include:

- client-side pagination
- background caching
- write actions from the public page

## Source Of Truth

The browse source-of-truth is the registry event log, not local placeholder data.

Why:

- the deployed contract already emits `AgentRegistered(agentId, agent, agentURI)`
- the spec explicitly defines browse implementation around event scan
- browse should reflect the actual discovery surface that external agents will use

## Recommended Approach

Use a new server-side library that:

1. reads the configured registry address and L1 RPC URL
2. scans `AgentRegistered` logs from block `0`
3. keeps the latest registration for each operator address
4. fetches the referenced `agentURI`
5. parses the remote manifest into a lightweight browse row

The `/marketplace` page should call this library only when rendering the `registry` tab.

## Data Model

Each browse row should expose:

- `agentId`
- `agent`
- `agentUri`
- `manifest`
- `manifestStatus`

`manifest` should include:

- `name`
- `version`
- `endpoint`
- `capabilities`
- `payment.network`

If manifest fetch or parse fails, the row should still render with `manifestStatus = "unavailable"`.

## Error Handling

- Missing `ERC8004_REGISTRY_ADDRESS` or missing RPC URL should return an empty state, not crash the page.
- Event scan failure should return an empty state plus a short status note for the page.
- Manifest fetch failure should only affect that row.

## UI Behavior

The registry tab should show:

- registered instance count from live rows
- configured chain count
- one row per latest discovered instance
- live capabilities and endpoint when manifest fetch succeeds
- `manifest unavailable` when fetch fails

The current local-only placeholder note should be removed once live browse is active.

## Testing

- unit tests for registry browse event parsing and manifest enrichment
- page tests proving the registry tab renders live rows
- page tests proving missing registry config falls back to empty messaging
