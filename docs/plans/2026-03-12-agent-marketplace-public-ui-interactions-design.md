# Agent Marketplace Public UI Interactions Design

**Goal:** Upgrade the public `/marketplace` surface from a static wireframe-aligned page into an actually navigable marketplace UI while staying aligned to the current `agent-marketplace` backend.

**Scope:** This design covers Phase 1 public UI interaction only:
- interactive `THIS INSTANCE / BROWSE REGISTRY / CONNECT GUIDE` switching
- current-catalog-backed instance presentation
- registry summary presentation for the current instance
- connect guide rendered as an active tab instead of a permanently visible long page

## Context

The current `/marketplace` page already uses the right backend sources:
- `getAgentMarketplaceCatalog()`
- `toAgentMarketplaceAgentManifest()`
- `getAgentMarketplaceContractsStatus()`

However, it still renders all sections in a single long document. The wireframe assumes tabbed navigation, and the current page does not actually behave like tabs.

## Recommended Approach

Use a query-driven server-rendered tab model:
- `/marketplace?tab=registry`
- `/marketplace?tab=instance`
- `/marketplace?tab=guide`

### Why this approach

- Works cleanly with the current App Router server page.
- Avoids introducing client state or browser-only test infrastructure just to switch tabs.
- Keeps the UI shareable and deep-linkable.
- Preserves progressive enhancement and simple test coverage in the current Vitest node environment.

## Tab Contract

Supported tab keys:
- `registry`
- `instance`
- `guide`

Invalid or missing values fall back to `registry`.

## UI Behavior

### Shared Shell

Always visible:
- top nav
- page hero
- tab bar
- disabled banner when `MARKETPLACE_ENABLED !== 'true'`

### `registry` tab

Show:
- registered instance count
- configured chain count
- current SentinAI marketplace instance row
- explanatory Phase 1 note

Hide:
- service grid
- connect guide code blocks

### `instance` tab

Show:
- current instance header
- live services cards
- manifest panel
- contracts panel

Hide:
- registry summary cards
- connect guide blocks

### `guide` tab

Show:
- x402 connect steps
- current `/api/agent-marketplace/*` examples
- `X-PAYMENT` envelope example

Hide:
- registry summary
- instance service grid

## Rendering Model

Keep `/marketplace/page.tsx` as the server page and make it read:
- `searchParams.tab`

Normalize the input through a small helper:
- `resolveMarketplaceTab(value): 'registry' | 'instance' | 'guide'`

Use that resolved tab for:
- active tab styling
- conditional section rendering

## Testing Strategy

Add route-level page tests that verify:
- default render falls back to `registry`
- `tab=instance` renders service grid and hides registry-only content
- `tab=guide` renders connect guide and hides instance-only content
- invalid tab values fall back to `registry`

## Non-Goals

This phase does not add:
- multi-instance registry reads from ERC-8004
- live tab switching without navigation
- client-side filtering or search
- real registry liveness checks

## Follow-Up

After this phase:
1. add actual registry read path for multiple instances
2. enrich the registry tab with real discovered agents
3. optionally migrate tab switching to a client-enhanced experience if interaction needs exceed simple URL-based navigation
