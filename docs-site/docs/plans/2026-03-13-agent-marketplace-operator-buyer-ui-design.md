# Agent Marketplace Operator Registration + Buyer Sandbox UI Design

**Goal:** Let SentinAI operators register the local marketplace instance to the deployed ERC-8004 registry from the ops console, and let external-agent developers simulate a purchase flow from the public marketplace surface.

## Scope

This phase adds two UI surfaces:

1. operator-facing registry registration UI in `/v2/marketplace`
2. buyer-facing sandbox UI in `/marketplace`

This phase does not add:

- true multi-instance `BROWSE REGISTRY` event scan
- production wallet UX for human buyers
- full facilitator settlement UI
- browser wallet integration

## Recommended Approach

Use the existing split surface:

- `/v2/marketplace` remains the operator console
- `/marketplace` remains the public discovery and integration surface

Then add:

- an operator registry registration panel to `/v2/marketplace`
- a new `BUYER SANDBOX` tab to `/marketplace`

## Why this approach

- It respects the current information architecture instead of inventing new routes
- Operators and buyers have clearly different goals and should not share the same primary UI
- The current pages are already server-rendered and query-driven, so the new functionality can stay simple and testable

## Operator UI

### Location

`/v2/marketplace`

### New Panel

`REGISTRY REGISTRATION`

### Contents

- current registry address
- resolved `agent.json` URI
- registration readiness status
- latest known registration result
- `Register to Registry` action

### Interaction

Use a simple HTML form or POST action that calls a new internal route.

The route should:

1. resolve `MARKETPLACE_AGENT_URI_BASE`
2. call `registerAgentMarketplaceIdentity()`
3. return a result summary
4. redirect back to `/v2/marketplace`

### Result State

The ops console should surface:

- success / failure
- tx hash
- parsed `agentId` if available
- latest attempted timestamp

This state should be persisted in Redis or another existing store only if needed for post-refresh continuity. For the first pass, query-driven flash state or route response rendering is enough.

## Buyer Sandbox UI

### Location

`/marketplace?tab=sandbox`

### Purpose

Give external-agent developers a deterministic way to understand and test the paid request flow without reading raw docs only.

### New Tab

`BUYER SANDBOX`

### Contents

- buyer agent id input
- service selector
- target endpoint preview
- current price / network / token preview
- sample `x-payment` envelope preview
- “simulate request” output block

### Interaction Model

The sandbox is not a wallet UI.

It should support:

1. choosing one of the three services
2. generating a sample base64 envelope from provided buyer inputs
3. showing the exact curl / request shape
4. optionally calling the protected route in `open` mode or against a mock verifier path

### Important Constraint

This sandbox is for developer integration testing, not real token settlement.

That means:

- user-facing text must clearly say it is a sandbox
- production settlement still depends on the actual x402 / facilitator integration

## API / Route Additions

### Operator registration route

Recommended:

- `POST /api/agent-marketplace/ops/register`

Behavior:

- calls the registry write client
- returns redirect or JSON summary

### Buyer sandbox support

Minimal first pass can avoid a new API by computing the sample envelope in-page.

If route support is preferred:

- `POST /api/agent-marketplace/sandbox/payment-envelope`

Behavior:

- validates buyer agent id and selected service
- returns the sample envelope and target request preview

## Data Sources

Operator UI should use:

- `getAgentMarketplaceContractsStatus()`
- `registerAgentMarketplaceIdentity()`
- current marketplace env-derived agent URI

Buyer sandbox should use:

- `getAgentMarketplaceCatalog()`
- `toAgentMarketplaceAgentManifest()`
- service definitions and payment metadata already exposed by the catalog

## Testing

Add coverage for:

- operator registration route success/failure
- `/v2/marketplace` rendering the registration panel
- `/marketplace?tab=sandbox` rendering the buyer sandbox
- sample service/payment selection output

## Follow-Up

After this phase:

1. connect `BROWSE REGISTRY` to on-chain event scan
2. replace local-instance-only registry view with real multi-instance discovery
3. expand sandbox into a real buyer test client if operationally needed
