# Marketplace UI Design

## Overview

Two marketplace pages that give operators and consumers a visual interface to the agent economy:

1. **`website/src/app/marketplace/`** — Public-facing page. External AI agents and developers discover SentinAI instances, browse available services, and get connection code. Registry-centric with global stats.

2. **`src/app/marketplace/`** — Operator dashboard page. Node operators see their marketplace revenue, active consumers, and service listings. Accessed via top nav link.

Both pages build on the agent economy backend defined in `docs/superpowers/specs/2026-03-11-agent-economy-design.md`.

## Prerequisites

These must exist before the marketplace UI functions end-to-end:

| Prerequisite | Status | Notes |
|---|---|---|
| Agent economy backend (`src/app/api/marketplace/`) | In plan | 9-task plan at `docs/superpowers/plans/2026-03-11-agent-economy.md` |
| x402 TON facilitator | **Phase 0 blocker** | Coinbase's x402 only supports Base/Solana. A custom TON ERC-20 facilitator must be deployed (or `MARKETPLACE_PAYMENT_MODE=verify` used as stub) |
| ERC-8004 Registry contract | **Phase 0 blocker** | Registry must be deployed on Ethereum L1 (mainnet or testnet). Contract address stored in `MARKETPLACE_REGISTRY_ADDRESS`. Phase 1 defaults to a testnet deployment |
| L1 RPC for Vercel app | Required for website Browse Registry | `website/` needs `L1_RPC_URL` env var in Vercel settings for viem `getLogs` to read AgentRegistry events. Falls back to showing 0 instances if missing |
| `NEXT_PUBLIC_OPERATOR_ENDPOINT` | Required for website This Instance tab | Vercel env var pointing to the operator's dashboard URL (e.g., `https://sentinai.operator.xyz`). If unset, the This Instance tab shows a setup instruction instead of service cards |

## Design Decisions

| Dimension | Decision | Rationale |
|-----------|----------|-----------|
| Website default view | Browse Registry (global stats + instance list) | Communicates ecosystem scale; single-instance view is secondary |
| Dashboard entry | Separate page `/marketplace` + top nav link | Dashboard is already dense 3-column; separate page gives space |
| Dashboard layout | 4-stat header + 2-column (services / top buyers) | Information density without overcrowding; scan-friendly |
| Price editing | Read-only in UI (env var instructions) | Prices set via MARKETPLACE_PRICE_* env vars; UI avoids write complexity |
| Marketplace toggle | Read-only status indicator | MARKETPLACE_ENABLED is set at deploy time; not a runtime toggle |
| Registry fallback | Show current instance only if ERC-8004 unreachable | Graceful degradation; never shows broken state |

## File Structure

```
NEW:
  website/src/app/marketplace/
    page.tsx                    — Public marketplace page (SSR-safe)

  website/src/components/
    MarketplaceTabs.tsx         — Tab switcher: This Instance / Browse Registry / Connect Guide
    RegistryBrowser.tsx         — Global stats + instance list (ERC-8004 query)
    InstanceCard.tsx            — Single SentinAI instance row (name, chain, services, status)
    ServiceGrid.tsx             — Service cards with price + tier color coding
    ConnectGuide.tsx            — Static x402 code examples (curl + SDK)

  src/app/marketplace/
    page.tsx                    — Operator dashboard page (UI inlined per existing pattern; no separate component file)

  src/app/api/marketplace/stats/
    route.ts                    — GET: aggregated marketplace stats for dashboard

MODIFIED:
  src/app/layout.tsx (or top bar component)   — Add MARKETPLACE nav link
  website/src/app/layout.tsx (or Navbar)      — Add MARKETPLACE nav link
  src/app/api/marketplace/catalog/route.ts    — Add Access-Control-Allow-Origin: * header (public read-only route)

DEPENDENCY ORDER:
  The agent economy backend (src/app/api/marketplace/) must be implemented first.
  catalog/route.ts must exist before website's This Instance tab and CORS modification are meaningful.
  stats/route.ts must exist before the dashboard page renders real data.
```

## Website Marketplace Page

### URL
`/marketplace` on the website (Vercel deployment)

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ Navbar: SENTINAI | DOCS  [MARKETPLACE]  DEPLOY | GitHub        │
├─────────────────────────────────────────────────────────────────┤
│ Tabs: [This Instance]  Browse Registry ←default  [Connect Guide]│
├─────────────────────────────────────────────────────────────────┤
│                     BROWSE REGISTRY TAB                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │  12          │  │  5           │                            │
│  │  registered  │  │  chains      │                            │
│  └──────────────┘  └──────────────┘                            │
│                                                                 │
│  SentinAI #4521   Thanos L2 · ethrex    8 services              │
│  SentinAI #4522   OP Mainnet · geth     6 services              │
│  SentinAI #4523   Base · reth           4 services              │
│  SentinAI #4524   Arbitrum · nethermind 3 services              │
└─────────────────────────────────────────────────────────────────┘
```

**Phase 1 liveness:** No live health check per instance. Online/offline status dot is **not shown** in Phase 1 — all registered instances are displayed uniformly. Global stats show only "registered" and "chains" counts (no "online" count). Liveness polling per instance is Phase 2.

**`InstanceCard.tsx`** renders: `name`, `chainId` (from `agentURI`), `nodeClient`, `capabilities.length` as service count. It does **not** display individual capability names — only the count.

### This Instance Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  ● SentinAI @ Thanos-L2   eip155:55004   x402 ✓               │
├─────────────────────────────────────────────────────────────────┤
│  TIER 1 (red border-top)              TIER 2 (blue border-top) │
│  ┌──────────┐ ┌──────────┐           ┌──────────┐ ┌─────────┐ │
│  │ txpool   │ │anomalies │           │ metrics  │ │scaling  │ │
│  │ 0.1 TON  │ │ 0.2 TON  │    ...    │ 0.05 TON │ │ 0.1 TON │ │
│  │ live ●   │ │ live ●   │           │ live ●   │ │ live ●  │ │
│  └──────────┘ └──────────┘           └──────────┘ └─────────┘ │
│                                                                 │
│  Clicking a service card → shows endpoint URL + sample response│
└─────────────────────────────────────────────────────────────────┘
```

**Cross-origin data source:** The website (Vercel) fetches `GET {NEXT_PUBLIC_OPERATOR_ENDPOINT}/api/marketplace/catalog`. The operator configures `NEXT_PUBLIC_OPERATOR_ENDPOINT` in Vercel settings (e.g., `https://sentinai.operator.xyz`). If not set, the tab shows: `"Set NEXT_PUBLIC_OPERATOR_ENDPOINT to your SentinAI instance URL to display services."` The dashboard app allows CORS from any origin for `/api/marketplace/catalog` only (read-only, public data). `/api/marketplace/stats` does NOT need CORS (internal use only).

**ERC-8004 / registry unreachable:** If the L1 RPC call fails or returns no logs, `RegistryBrowser.tsx` shows 0 instances with no error message — just an empty list. No retry button in Phase 1.

### Connect Guide Tab

Static content — no API calls needed:

```
┌─────────────────────────────────────────────────────────────────┐
│  HOW TO BUY DATA WITH x402                                     │
│                                                                 │
│  1. Discover via ERC-8004 registry                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ GET /api/marketplace/catalog                            │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  2. Send request — get 402 back                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ curl https://sentinai.example.com/api/marketplace/txpool│  │
│  │ → 402 { "accepts": [{ "amount": "0.1 TON", ... }] }    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                 │
│  3. Sign EIP-3009 auth + retry with X-PAYMENT header           │
│  [copy button on each snippet]                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Dashboard Marketplace Page

### URL
`/marketplace` in the dashboard app (`src/app/`)

### Navigation
Add "MARKETPLACE" to the existing top bar alongside the existing nav items. "DASHBOARD" (or a home link) must also be present so users can return from `/marketplace`. Red underline on the active link. Returning to dashboard = navigating to `/`.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Top bar: SENTINAI | ● online  Thanos-L2 | DASHBOARD MARKETPLACE│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐  ┌───────────────┐  ┌──────────┐  ┌──────────┐  │
│  │ STATUS   │  │ EARNED / MO   │  │  CALLS   │  │  BUYERS  │  │
│  │ ACTIVE ● │  │ 1,429 TON     │  │   623    │  │    5     │  │
│  └──────────┘  └───────────────┘  └──────────┘  └──────────┘  │
│                                                                 │
│  ┌─────────────────────────┐  ┌─────────────────────────────┐  │
│  │ SERVICES                │  │ TOP BUYERS                  │  │
│  │ txpool       0.1 TON   │  │ DeFi Agent #21    600 TON   │  │
│  │ anomalies    0.2 TON   │  │ MEV Bot #44       522 TON   │  │
│  │ rca          0.5 TON   │  │ Bridge Agent #07  300 TON   │  │
│  │ eoa          0.2 TON   │  │ Insurance #12       3.5 TON │  │
│  │ resources    0.1 TON   │  │ Cross-Proto #33     3.4 TON │  │
│  │ metrics      0.05 TON  │  │                             │  │
│  │ +2 more                │  │ (agentId from X-PAYMENT hdr)│  │
│  └─────────────────────────┘  └─────────────────────────────┘  │
│                                                                 │
│  RECENT SALES                                                  │
│  DeFi #21 · txpool · 0.1 TON · 2m ago  (relative time)        │
│  MEV #44  · metrics · 0.05 TON · 5m ago                       │
│  Bridge #07 · eoa · 0.2 TON · 12m ago                         │
└─────────────────────────────────────────────────────────────────┘
```

**When MARKETPLACE_ENABLED=false:**
```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠ MARKETPLACE DISABLED                                        │
│  Set MARKETPLACE_ENABLED=true to start earning TON.            │
│                                                                 │
│  Required env vars:                                            │
│  MARKETPLACE_ENABLED=true                                      │
│  MARKETPLACE_WALLET_KEY=0x...  (private key for ERC-8004 reg)  │
│  MARKETPLACE_RECEIVER_ADDRESS=0x...  (Ethereum addr for TON ERC-20) │
└─────────────────────────────────────────────────────────────────┘
```

## New API Route

### `GET /api/marketplace/stats`

Returns aggregated stats for the dashboard page. Reads from existing marketplace infrastructure (x402 payment logs, catalog).

```typescript
interface MarketplaceStats {
  enabled: boolean;               // Maps to STATUS: true → "ACTIVE", false → "DISABLED"
  totalEarnedThisMonth: string;   // TON in wei string (gross amount received from all buyers); UI divides by 10^18 to display
  totalCallsToday: number;        // Past 24 hours UTC
  activeBuyerCount: number;
  services: Array<{
    key: string;                  // Underscore ServiceKey as-is (e.g. "scaling_history") — UI converts to kebab for display
    priceWei: string;             // UI displays as TON: divide by 10^18
    callsToday: number;           // Past 24h UTC
  }>;
  // Note: the route does NOT convert services[].key — the UI calls key.replaceAll('_', '-') for display
  topBuyers: Array<{
    agentId: string;              // Ethereum address (0x...) of the paying agent
    spentThisMonth: string;       // TON in wei string (gross amount paid by this buyer); UI divides by 10^18
  }>;
  recentSales: Array<{
    agentId: string;              // Ethereum address (0x...) of the paying agent
    service: string;              // kebab-case route key (e.g. "scaling-history")
    amountWei: string;
    timestamp: string;            // ISO 8601; UI renders as relative time ("2m ago") via Date.now() diff
  }>;
}
```

**HTTP status:** always returns `200 OK`. The `enabled` field signals state; no 4xx/5xx used for disabled/no-data states.

**When disabled:** returns all fields as zero/empty with `enabled: false`:
```json
{ "enabled": false, "totalEarnedThisMonth": "0", "totalCallsToday": 0, "activeBuyerCount": 0, "services": [], "topBuyers": [], "recentSales": [] }
```
Dashboard shows the disabled banner.

**Phase 1 limitation:** All revenue and usage fields require a payment log store that is **not yet implemented**. Phase 1 returns hard-coded zeros:
- `totalEarnedThisMonth: "0"`
- `totalCallsToday: 0`
- `activeBuyerCount: 0`
- `topBuyers: []`
- `recentSales: []`
- `services[].callsToday: 0`

Dashboard shows "No sales yet" gracefully. Payment log store is a Phase 2 item.

### Payment Log Store (Phase 2)

When implemented, the payment log store records each verified x402 payment:

```typescript
interface PaymentLogEntry {
  agentId: string;      // Ethereum address from X-PAYMENT header `from` field (EIP-3009 authorizer)
  service: string;      // Internal ServiceKey with underscore (e.g. "scaling_history")
  amountWei: string;    // e.g. "100000000000000000" (0.1 TON)
  timestamp: string;    // ISO 8601
}
```

**Conversion responsibility:** `PaymentLogEntry.service` stores the raw underscore key. `GET /api/marketplace/stats` (the route, not the log store) converts to kebab-case before returning in `recentSales[].service`. The log store is never modified.

`agentId` is stored as the **Ethereum address** from the `X-PAYMENT` header's `from` field (the EIP-3009 authorizer). For display, the dashboard truncates to `0xabcd...ef12` format. Full ERC-8004 NFT ID resolution (matching address → `#{nftId}`) is a Phase 2 enhancement requiring a registry lookup.

## Styling

Follow existing SentinAI conventions:
- Font: IBM Plex Mono throughout
- Colors: `#D40000` (brand/Tier 1), `#0055AA` (Tier 2/links), `#27ae60` (online/active)
- Background: `#FFFFFF`, borders: `#D0D0D0`
- Service tier visual distinction: red `border-top` for Tier 1, blue for Tier 2

## Data Sources

| Page | Data | Source |
|------|------|--------|
| Website / Browse Registry | Instance list | ERC-8004 `register()` events (viem getLogs on L1) |
| Website / Browse Registry | Global stats | Aggregate from registry events |
| Website / This Instance | Service list + prices | `GET /api/marketplace/catalog` |
| Website / Connect Guide | Code examples | Static (hardcoded) |
| Dashboard | All stats | `GET /api/marketplace/stats` (new) |

### agentURI JSON Format (AgentRegistry)

> Note: "ERC-8004" is used as a working name for the custom AgentRegistry contract. No finalized EIP with this number exists. The contract ABI is defined in `docs/superpowers/specs/2026-03-11-agent-economy-design.md`.


When an operator calls ERC-8004 `register(agentURI)`, the URI points to a JSON document:

```json
{
  "name": "SentinAI #4521",
  "chainId": "eip155:55004",
  "nodeClient": "ethrex",
  "endpoint": "https://sentinai.operator.xyz/api/marketplace",
  "x402": true,
  "capabilities": ["txpool", "anomalies", "rca", "eoa", "resources", "metrics", "scaling-history", "sync-trend"]
}
```

**Fields used by Browse Registry UI:**
- `name` → instance display name
- `chainId` → shown as L2 chain label
- `nodeClient` → shown next to chain (e.g., `ethrex`, `geth`, `reth`)
- `capabilities.length` → service count displayed per row
- `x402: true` → marks instance as "payment-capable" (static at registration, NOT a liveness signal — displayed as a label, not an online dot)

### Service Key Naming Convention

`catalog.ts` defines `ServiceKey` as a union type using **underscore** internally:

```typescript
type ServiceKey = 'txpool' | 'anomalies' | 'rca' | 'eoa' | 'resources'
                | 'metrics' | 'scaling_history' | 'sync_trend';
```

Route paths and `agentURI.capabilities[]` use **kebab-case** (underscore → hyphen):
- `txpool`, `anomalies`, `rca`, `eoa`, `resources`, `metrics`, `scaling-history`, `sync-trend`

Conversion direction: catalog internal key → route path via `key.replaceAll('_', '-')`. This only affects `scaling_history` and `sync_trend`.

## Out of Scope

- Real-time stats updates (polling or WebSocket) — static load only
- Charts/graphs for revenue trends — text + numbers only for Phase 1
- Price editing in UI — MARKETPLACE_PRICE_* env vars only
- Marketplace toggle in UI — MARKETPLACE_ENABLED env var only
- Buyer identity resolution (names beyond agent NFT ID)
- Search/filter in Browse Registry — show all instances, no client-side filtering (Phase 2)
- Inline row expansion in Browse Registry — clicking a row does nothing in Phase 1 (Phase 2)
- Payment log store implementation — Phase 2; Phase 1 shows empty arrays gracefully
