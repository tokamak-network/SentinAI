# SentinAI Agent Economy Design

## Overview

Introduce an agent-to-agent economy into SentinAI so that AI agents can buy high-value operational signals from rollup operators. SentinAI exposes paid read-only monitoring services through x402 and makes them discoverable through the ERC-8004 on-chain identity registry.

Phase 1 is intentionally conservative: it optimizes for agent utility and monetization while avoiding data products that are too easy to repurpose for MEV or order-flow exploitation. For that reason, `txpool` is removed from the marketplace surface and replaced with `sequencer-health`, an agent-ready execution safety snapshot.

## Design Decisions

| Dimension | Decision | Rationale |
|-----------|----------|-----------|
| Interaction direction | Producer (Phase 1) | SentinAI sells monitoring data; consumer side deferred |
| Payment | L1 TON via x402 | HTTP-native payment flow with low integration friction |
| Transaction unit | Per request | Fits agent request/response patterns and simple pricing |
| Identity/Discovery | ERC-8004 Identity Registry | Portable on-chain discovery for agents |
| Service scope | Read-only operational signals | Execution endpoints remain out of scope |
| Abuse posture | Prefer safety-gating signals over order-flow signals | Keeps DeFi demand while reducing MEV misuse risk |
| Activation | `MARKETPLACE_ENABLED=true` opt-in | No behavior change for existing deployments |
| Existing code impact | None | Additive `/api/marketplace/*` routes only |

## Standards Used

- **ERC-8004**: On-chain agent identity registry
- **x402**: HTTP 402-based machine payment protocol
- **Facilitator-defined EIP-712 authorization**: signed purchase intent verified by the TON facilitator before `approve + transferFrom` settlement

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
          │  │   Existing SentinAI Services + Stores    │    │
          │  │ RCA | Anomaly | Metrics | EOA | K8s      │    │
          │  └──────────────────────────────────────────┘    │
          └─────────────────────────────────────────────────┘
                           ↑
                 External agent HTTP request
                 (discovered via ERC-8004)
```

## Services for Sale

### Tier 1 — Agent-Ready Operational Signals

| Endpoint | Content | Price |
|----------|---------|-------|
| `GET /api/marketplace/sequencer-health` | Decision-ready execution health snapshot for pre-trade and pre-withdrawal gating | 0.1 TON |
| `GET /api/marketplace/anomalies` | Latest 4-layer anomaly detection results | 0.2 TON |
| `GET /api/marketplace/incident-summary` | Agent-friendly summary of active incidents and recent reliability | 0.15 TON |
| `GET /api/marketplace/rca/:id` | Root cause analysis report for a specific anomaly | 0.5 TON |
| `GET /api/marketplace/eoa` | Batcher/proposer EOA balance and depletion forecast | 0.2 TON |
| `GET /api/marketplace/resources` | K8s pod CPU and memory usage | 0.1 TON |
| `GET /api/marketplace/batch-submission-status` | Recent batch submission health, lag, and settlement risk | 0.15 TON |

### Tier 2 — Aggregated Context Data

| Endpoint | Content | Price |
|----------|---------|-------|
| `GET /api/marketplace/metrics` | Block interval mean/stddev/trend over recent history | 0.05 TON |
| `GET /api/marketplace/scaling-history` | When and why scaling events occurred | 0.1 TON |
| `GET /api/marketplace/sync-trend` | L2 sync gap trend and short-term direction | 0.1 TON |

### Free

| Endpoint | Content |
|----------|---------|
| `GET /api/marketplace/catalog` | Available services, prices, and SentinAI identity |
| `GET /api/marketplace/agent.json` | ERC-8004 agentURI registration file |

## Sequencer Health Response Shape

`GET /api/marketplace/sequencer-health` is intentionally not a raw metric dump. It is an agent-ready policy input:

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

Field intent:
- `status`: `healthy | degraded | critical`
- `healthScore`: 0-100 composite score for thresholding and ranking
- `action`: `proceed | caution | delay | halt`
- `reasons`: short machine-readable explanations
- `blockProduction`: recent execution stability summary
- `sync`: lag and catch-up state
- `incident`: active incident context
- `resources`: coarse pressure signal only, not detailed pod internals

## Data Flow

### External agent purchasing Sequencer Health data

```
1. Discovery
   Agent → ERC-8004 Registry: query "l2ChainId=55004 AND capability=sequencer_health"
   ← NFT #N: SentinAI @ Thanos, endpoint: https://sentinai.example.com

2. Catalog (free)
   Agent → GET /api/marketplace/catalog
   ← { sequencer_health: "0.1 TON", incident_summary: "0.15 TON", rca: "0.5 TON", ... }

3. First request (no payment)
   Agent → GET /api/marketplace/sequencer-health
   ← 402 Payment Required
     { "accepts": [{ "scheme": "exact", "network": "eip155:1",
                     "token": "<TON contract>", "amount": "100000000000000000" }] }

4. Payment + retry
   Agent signs the facilitator-defined EIP-712 `PaymentAuthorization` for 0.1 TON
   Agent → GET /api/marketplace/sequencer-health
              X-PAYMENT: <base64 PaymentPayload>

5. Verify + respond
   payment-verifier.ts validates the facilitator authorization, requests TON settlement via the same-app facilitator, and verifies the signed settlement receipt
   ← 200 OK { status: "healthy", healthScore: 84, action: "proceed", ... }
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
  payment-verifier.ts   — TON facilitator authorization validation + facilitator call

src/app/api/marketplace/
  catalog/route.ts                  — GET: service catalog (free)
  agent.json/route.ts               — GET: ERC-8004 agentURI file (free)
  sequencer-health/route.ts         — GET: sequencer execution health snapshot (x402 protected)
  anomalies/route.ts                — GET: anomaly detection results (x402 protected)
  incident-summary/route.ts         — GET: active incident summary (x402 protected)
  rca/[id]/route.ts                 — GET: RCA report (x402 protected)
  eoa/route.ts                      — GET: EOA balance + forecast (x402 protected)
  resources/route.ts                — GET: K8s resource usage (x402 protected)
  batch-submission-status/route.ts  — GET: batch submission health (x402 protected)
  metrics/route.ts                  — GET: block metrics history (x402 protected)
  scaling-history/route.ts          — GET: scaling event history (x402 protected)
  sync-trend/route.ts               — GET: sync gap trend (x402 protected)
```

## Modified Files

```
src/lib/first-run-bootstrap.ts   — Add ERC-8004 registration when MARKETPLACE_ENABLED
```

## Environment Variables

```bash
# Marketplace activation
MARKETPLACE_ENABLED=false

# Identity + payment wallet
MARKETPLACE_WALLET_KEY=
MARKETPLACE_TON_ADDRESS=

# x402 configuration
X402_FACILITATOR_URL=
X402_NETWORK=eip155:1

# TON facilitator configuration
TON_FACILITATOR_INTERNAL_AUTH_SECRET=
TON_FACILITATOR_MAINNET_ENABLED=false
TON_FACILITATOR_MAINNET_RPC_URL=
TON_FACILITATOR_MAINNET_ADDRESS=
TON_FACILITATOR_MAINNET_RELAYER_KEY=
TON_FACILITATOR_SEPOLIA_ENABLED=true
TON_FACILITATOR_SEPOLIA_RPC_URL=
TON_FACILITATOR_SEPOLIA_ADDRESS=
TON_FACILITATOR_SEPOLIA_RELAYER_KEY=
TON_FACILITATOR_RECEIPT_SIGNING_KEY=
TON_FACILITATOR_REDIS_PREFIX=sentinai
TON_FACILITATOR_MERCHANT_ALLOWLIST=
TON_FACILITATOR_RECONCILER_ENABLED=true
TON_FACILITATOR_RECONCILER_CRON=*/15 * * * * *

# ERC-8004 configuration
ERC8004_REGISTRY_ADDRESS=
MARKETPLACE_AGENT_URI_BASE=

# Pricing (TON in wei, 18 decimals)
MARKETPLACE_PRICE_SEQUENCER_HEALTH=100000000000000000
MARKETPLACE_PRICE_ANOMALY=200000000000000000
MARKETPLACE_PRICE_INCIDENT_SUMMARY=150000000000000000
MARKETPLACE_PRICE_RCA=500000000000000000
MARKETPLACE_PRICE_EOA=200000000000000000
MARKETPLACE_PRICE_RESOURCES=100000000000000000
MARKETPLACE_PRICE_BATCH_SUBMISSION_STATUS=150000000000000000
MARKETPLACE_PRICE_METRICS=50000000000000000
MARKETPLACE_PRICE_SCALING_HISTORY=100000000000000000
MARKETPLACE_PRICE_SYNC_TREND=100000000000000000
```

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `MARKETPLACE_ENABLED=false` | All `/api/marketplace/*` routes return 404 or config error responses |
| Payment signature invalid | Return 402 with error detail; no service provided |
| ERC-8004 registration fails at bootstrap | Log warning only; bootstrap continues |
| TON facilitator unreachable | Return 503 on marketplace routes; internal APIs unaffected |
| `MARKETPLACE_WALLET_KEY` missing | Skip ERC-8004 registration; marketplace routes return 503 with config error |

## Out of Scope (Phase 1)

- SentinAI as consumer (hiring external agents)
- Execution services such as scaling or restart
- Reputation submission to ERC-8004 Reputation Registry
- Subscription or streaming pricing
- Smart contract escrow deployment

## Key External Dependencies

- **x402 TON facilitator**: A TON-capable facilitator is still required for real settlement.
- **ERC-8004 Registry contract**: Must exist on a chain reachable by operators and agent consumers.
