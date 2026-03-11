# SentinAI Agent Economy Design

## Overview

Introduce an agent-to-agent economy into SentinAI so that AI agents (not just humans) can be consumers and producers. SentinAI exposes its unique L1/L2 monitoring data as paid services via the x402 payment protocol, discoverable through the ERC-8004 on-chain identity registry.

## Design Decisions

| Dimension | Decision | Rationale |
|-----------|----------|-----------|
| Interaction direction | Producer (Phase 1) | SentinAI sells monitoring data; consumer side (hiring external agents) deferred |
| Payment | L1 TON via x402 | L1 TON has liquidity and recognition; x402 is HTTP-native, zero friction |
| Transaction unit | Task-based (per request) | Aligns with AI agent request/response pattern; easy to verify and price |
| Identity/Discovery | ERC-8004 Identity Registry | Portable NFT-based agent ID; reputation and endpoint advertisement |
| Service scope | Read-only data (Tier 1 + Tier 2) | Execution services (scaling, restart) are too dangerous to expose externally |
| Activation | `MARKETPLACE_ENABLED=true` opt-in | Zero impact on existing deployments by default |
| Existing code impact | None | New `/api/marketplace/*` routes only; existing internal APIs untouched |

## Standards Used

- **ERC-8004**: On-chain agent identity registry (NFT-based) + reputation registry
- **x402**: HTTP 402-based machine payment protocol (EIP-3009 token transfers)
- **EIP-3009**: `transferWithAuthorization` — gasless ERC-20 transfer via signature

## Architecture

```
                    ERC-8004 Identity Registry (Ethereum L1)
                           ↑ register()    ↓ discover()
                           │               │
          ┌────────────────┴───────────────┴────────────────┐
          │              SentinAI Instance                  │
          │                                                  │
          │  ┌──────────────┐    ┌───────────────────────┐  │
          │  │ Marketplace  │    │  x402 Middleware       │  │
          │  │ Catalog API  │←───│  (HTTP 402 → TON pay)  │  │
          │  └──────────────┘    └───────────────────────┘  │
          │         │                       │                │
          │         ↓                       ↓                │
          │  ┌──────────────────────────────────────────┐    │
          │  │     Existing SentinAI Services           │    │
          │  │  RCA | Anomaly | TxPool | Metrics        │    │
          │  └──────────────────────────────────────────┘    │
          └─────────────────────────────────────────────────┘
                           ↑
                 External agent HTTP request
                 (discovered via ERC-8004)
```

## Services for Sale

### Tier 1 — Exclusive Data (not available via public RPC)

| Endpoint | Content | Price |
|----------|---------|-------|
| `GET /api/marketplace/txpool` | pending/queued counts (requires node-level access) | 0.1 TON |
| `GET /api/marketplace/anomalies` | 4-layer anomaly detection result (Z-Score + AI) | 0.2 TON |
| `GET /api/marketplace/rca/:id` | Root cause analysis report for a specific anomaly | 0.5 TON |
| `GET /api/marketplace/eoa` | batcher/proposer EOA balance + depletion forecast | 0.2 TON |
| `GET /api/marketplace/resources` | K8s pod CPU/memory actual usage | 0.1 TON |

### Tier 2 — Aggregated Context Data

| Endpoint | Content | Price |
|----------|---------|-------|
| `GET /api/marketplace/metrics` | Block interval mean/stddev/trend (60-min history) | 0.05 TON |
| `GET /api/marketplace/scaling-history` | When and why scaling events occurred | 0.1 TON |
| `GET /api/marketplace/sync-trend` | L2 sync gap time series + prediction | 0.1 TON |

### Free

| Endpoint | Content |
|----------|---------|
| `GET /api/marketplace/catalog` | Available services, prices, and SentinAI identity |
| `GET /api/marketplace/agent.json` | ERC-8004 agentURI registration file |

## Data Flow

### External agent purchasing TxPool data

```
1. Discovery
   Agent → ERC-8004 Registry: query "l2ChainId=55004 AND capability=txpool"
   ← NFT #N: SentinAI @ Thanos, endpoint: https://sentinai.example.com

2. Catalog (free)
   Agent → GET /api/marketplace/catalog
   ← { txpool: "0.1 TON", anomaly: "0.2 TON", rca: "0.5 TON", ... }

3. First request (no payment)
   Agent → GET /api/marketplace/txpool
   ← 402 Payment Required
     { "accepts": [{ "scheme": "exact", "network": "eip155:1",
                     "token": "<TON contract>", "amount": "100000000000000000" }] }

4. Payment + retry
   Agent signs EIP-3009 transferWithAuthorization for 0.1 TON
   Agent → GET /api/marketplace/txpool
              X-PAYMENT: <base64 PaymentPayload>

5. Verify + respond
   payment-verifier.ts validates signature, requests TON settlement via facilitator
   ← 200 OK { "pending": 142, "queued": 8, "timestamp": "...", "buyerAgentId": "..." }
```

### ERC-8004 self-registration (at bootstrap)

```
When MARKETPLACE_ENABLED=true AND MARKETPLACE_WALLET_KEY is set:

first-run-bootstrap.ts:
  1. Build agentURI JSON (chain info, service list, pricing)
  2. Host at /api/marketplace/agent.json (or upload to IPFS)
  3. Call register(agentURI) on ERC-8004 Identity Registry
  4. Persist returned agentId to Redis/local storage
  5. On restart: reuse existing agentId (idempotent)
```

## New Files

```
src/lib/marketplace/
  agent-registry.ts     — ERC-8004 registration and lookup client
  x402-middleware.ts    — HTTP 402 response builder + payment header parser
  catalog.ts            — Service definitions, pricing, capability list
  payment-verifier.ts   — TON EIP-3009 signature verification + facilitator call

src/app/api/marketplace/
  catalog/route.ts          — GET: service catalog (free)
  agent.json/route.ts       — GET: ERC-8004 agentURI file (free)
  txpool/route.ts           — GET: txpool status (x402 protected)
  anomalies/route.ts        — GET: anomaly detection results (x402 protected)
  rca/[id]/route.ts         — GET: RCA report (x402 protected)
  eoa/route.ts              — GET: EOA balance + forecast (x402 protected)
  resources/route.ts        — GET: K8s resource usage (x402 protected)
  metrics/route.ts          — GET: block metrics history (x402 protected)
  scaling-history/route.ts  — GET: scaling event history (x402 protected)
  sync-trend/route.ts       — GET: sync gap trend (x402 protected)
```

## Modified Files

```
src/lib/first-run-bootstrap.ts   — Add ERC-8004 registration when MARKETPLACE_ENABLED
```

## Environment Variables

```bash
# Marketplace activation
MARKETPLACE_ENABLED=false                  # Default: disabled

# Identity + payment wallet
MARKETPLACE_WALLET_KEY=                    # Private key for ERC-8004 registration and TON receipt
MARKETPLACE_TON_ADDRESS=                   # TON receive address (auto-derived from WALLET_KEY if unset)

# x402 configuration
X402_FACILITATOR_URL=                      # Custom TON facilitator endpoint
X402_NETWORK=eip155:1                      # Default: Ethereum L1

# ERC-8004 configuration
ERC8004_REGISTRY_ADDRESS=                  # Identity Registry contract address
MARKETPLACE_AGENT_URI_BASE=               # agentURI hosting base URL (default: /api/marketplace/agent.json)

# Pricing (TON in wei, 18 decimals)
MARKETPLACE_PRICE_TXPOOL=100000000000000000        # 0.1 TON
MARKETPLACE_PRICE_ANOMALY=200000000000000000       # 0.2 TON
MARKETPLACE_PRICE_RCA=500000000000000000           # 0.5 TON
MARKETPLACE_PRICE_EOA=200000000000000000           # 0.2 TON
MARKETPLACE_PRICE_RESOURCES=100000000000000000     # 0.1 TON
MARKETPLACE_PRICE_METRICS=50000000000000000        # 0.05 TON
MARKETPLACE_PRICE_SCALING_HISTORY=100000000000000000  # 0.1 TON
MARKETPLACE_PRICE_SYNC_TREND=100000000000000000    # 0.1 TON
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `MARKETPLACE_ENABLED=false` | All `/api/marketplace/*` routes return 404; zero impact on existing behavior |
| Payment signature invalid | Return 402 with error detail; no service provided |
| ERC-8004 registration fails at bootstrap | Log warning only; bootstrap continues; marketplace unavailable |
| TON facilitator unreachable | Return 503 on marketplace routes; internal APIs unaffected |
| `MARKETPLACE_WALLET_KEY` missing | Skip ERC-8004 registration; marketplace routes return 503 with config error |

## Out of Scope (Phase 1)

- SentinAI as consumer (hiring external agents) — deferred to Phase 2
- Execution services (scaling, restart) — never exposed to external agents
- Reputation submission to ERC-8004 Reputation Registry — deferred
- Subscription/streaming pricing model
- Smart contract deployment (ERC-8183 escrow) — x402 handles settlement without it

## Key External Dependencies

- **x402 TON facilitator**: Coinbase's default facilitator supports Base/Solana only. A custom facilitator supporting TON (EIP-3009) on Ethereum L1 is required. Must verify TON contract implements `transferWithAuthorization`.
- **ERC-8004 Registry contract**: Must be deployed on a chain accessible to both SentinAI and potential agent consumers. Chain selection TBD (likely Ethereum L1 or Thanos L2).
