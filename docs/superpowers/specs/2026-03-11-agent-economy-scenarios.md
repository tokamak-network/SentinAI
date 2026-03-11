# Agent Economy: Revenue Scenarios for EVM Operators

> SentinAI turns monitoring infrastructure from a cost center into a revenue stream.
> This document demonstrates how external AI agents consuming operational data
> generate additional income for the node operator.

---

## The Premise

An EVM node operator (e.g., running Thanos L2 + Ethrex L1) already runs SentinAI
to monitor their infrastructure. With `MARKETPLACE_ENABLED=true`, that same
infrastructure becomes a data API that AI agents across DeFi, MEV, and bridge
protocols are willing to pay for — because SentinAI holds data they cannot get
anywhere else.

**The operator's marginal cost of serving these agents is near zero.**
The monitoring data is already collected. Serving it via HTTP adds no meaningful load.

---

## Tier Reference

| Tier | Endpoint | Price | What makes it unique |
|------|----------|-------|----------------------|
| 1 | `/marketplace/txpool` | 0.1 TON | Node-internal txpool state (not on public RPC) |
| 1 | `/marketplace/anomalies` | 0.2 TON | 4-layer anomaly detection result |
| 1 | `/marketplace/rca/:id` | 0.5 TON | Root cause analysis report |
| 1 | `/marketplace/eoa` | 0.2 TON | Batcher/proposer balance + depletion forecast |
| 1 | `/marketplace/resources` | 0.1 TON | K8s pod CPU/memory actual usage |
| 2 | `/marketplace/metrics` | 0.05 TON | Block interval history (60-min stats) |
| 2 | `/marketplace/scaling-history` | 0.1 TON | Scaling event log with reasons |
| 2 | `/marketplace/sync-trend` | 0.1 TON | Block production trend + lag detection |

---

## Scenario 1: DeFi Protocol Agent — Pre-Trade Health Check

**Who:** An automated trading agent for a DeFi protocol on Thanos L2.
**Problem:** Before executing large swaps or liquidations, the agent needs to know
whether the L2 is congested or degraded. A failed tx on a congested network
wastes gas and may cause slippage losses far exceeding 0.1 TON.

**Usage pattern:**
- Queries `/marketplace/txpool` before every significant transaction (≥$10k)
- Protocol executes ~200 such transactions per day

**Revenue calculation:**
```
200 queries/day × 0.1 TON × 30 days = 600 TON/month
```

**What the agent gets:**
```json
{
  "pending": 312,
  "queued": 47,
  "namespace": "txpool",
  "timestamp": "2026-03-11T09:00:00Z"
}
```

If `pending > 500`, the agent delays the transaction by 30 seconds.
If `pending < 100`, it proceeds immediately with tighter slippage tolerance.

**Operator perspective:**
> "My node was already collecting this data every 60 seconds.
> Now I serve it on-demand and earn 600 TON/month from one client alone."

---

## Scenario 2: Bridge Protocol Agent — Safety Gate Before Withdrawal

**Who:** An automated bridge agent managing L2→L1 ETH withdrawals.
**Problem:** A withdrawal that initiates while the batcher EOA is about to run dry
will be delayed or stuck. The bridge agent needs EOA health data before
initiating the 7-day withdrawal window.

**Usage pattern:**
- Queries `/marketplace/eoa` before every withdrawal initiation
- Protocol processes ~50 withdrawals per day

**Revenue calculation:**
```
50 queries/day × 0.2 TON × 30 days = 300 TON/month
```

**What the agent gets:**
```json
{
  "batcher": {
    "address": "0xabc...",
    "balanceEth": 0.42,
    "estimatedHoursRemaining": 18,
    "status": "warning"
  },
  "proposer": {
    "balanceEth": 1.21,
    "estimatedHoursRemaining": 96,
    "status": "healthy"
  }
}
```

When `estimatedHoursRemaining < 24`, the agent pauses withdrawal initiation
and alerts its protocol's operations team — preventing stuck withdrawals entirely.

**Operator perspective:**
> "This data also helps me: the bridge agent's queries act as a
> second set of eyes on my EOA health, and I get paid for it."

---

## Scenario 3: MEV Bot — Block Timing Arbitrage

**Who:** An MEV searcher bot targeting Thanos L2 block production gaps.
**Problem:** When block intervals spike, certain arbitrage opportunities open
(stale prices, liquidation thresholds crossed). The bot needs historical block
timing data to calibrate when to scan aggressively.

**Usage pattern:**
- Queries `/marketplace/metrics` every 5 minutes (288 queries/day)
- Also queries `/marketplace/sync-trend` when metrics show anomaly

**Revenue calculation:**
```
288 × 0.05 TON + 30 × 0.1 TON = 14.4 + 3 = 17.4 TON/day
17.4 TON/day × 30 days = 522 TON/month
```

**What the agent gets from `/marketplace/metrics`:**
```json
{
  "stats": {
    "blockInterval": {
      "mean": 2.1,
      "stdDev": 0.3,
      "trend": "stable",
      "slope": 0.002
    }
  },
  "pointCount": 60,
  "latestTimestamp": "2026-03-11T09:00:00Z"
}
```

When `stdDev > 1.5` or `trend = "increasing"`, the bot switches to high-frequency
scan mode and captures arbitrage opportunities invisible to bots relying on
public block explorers (which lag by 1-2 blocks).

**Operator perspective:**
> "My block production data — which I watch for operational reasons —
> is worth paying for to an MEV bot. 522 TON/month for 60 seconds of stored data."

---

## Scenario 4: Insurance Protocol — Uptime Attestation

**Who:** A decentralized on-chain insurance protocol covering L2 infrastructure risk.
**Problem:** To price insurance premiums and pay claims, the protocol needs
historical evidence of anomaly frequency and severity for a specific L2.
SentinAI is the only canonical source of this data for this operator's node.

**Usage pattern:**
- Monthly audit: pulls full anomaly history + 3 RCA reports
- Queries `/marketplace/anomalies` (paginated, ~10 calls)
- Queries `/marketplace/rca/:id` for each active incident (avg 3/month)

**Revenue calculation:**
```
10 × 0.2 TON + 3 × 0.5 TON = 2 + 1.5 = 3.5 TON/month
```
*(Lower volume, but zero marginal effort for the operator)*

**What the agent gets from `/marketplace/anomalies`:**
```json
{
  "events": [
    {
      "id": "anom-789",
      "detectedAt": "2026-03-05T14:32:00Z",
      "severity": "high",
      "metric": "txPoolPending",
      "zScore": 4.2,
      "resolved": true,
      "resolvedAt": "2026-03-05T15:01:00Z"
    }
  ],
  "total": 3,
  "activeCount": 0
}
```

The insurance protocol uses 30-day anomaly counts to adjust premiums monthly.
Zero incidents → premium reduction. Multiple unresolved incidents → claim trigger.

**Operator perspective:**
> "My monitoring history becomes a verifiable uptime record
> that reduces my own insurance premium — and earns me TON for sharing it."

---

## Scenario 5: Cross-Protocol Monitoring Agent — Scaling Intelligence

**Who:** A shared infrastructure agent used by multiple DeFi protocols
that all rely on Thanos L2. The agent monitors multiple L2 networks
and correlates their scaling events to detect systemic risk.

**Usage pattern:**
- Queries `/marketplace/scaling-history` weekly for trend analysis
- Queries `/marketplace/resources` during known high-load events (daily)

**Revenue calculation:**
```
4 × 0.1 TON (scaling-history/week) + 30 × 0.1 TON (resources/day)
= 0.4 + 3 = 3.4 TON/month
```

**What the agent gets from `/marketplace/scaling-history`:**
```json
{
  "events": [
    {
      "timestamp": "2026-03-10T08:12:00Z",
      "fromVcpu": 2,
      "toVcpu": 4,
      "reason": "scaling_score=78, txPoolPending spike",
      "mode": "in_place_resize"
    }
  ]
}
```

The cross-protocol agent uses this to warn protocols: "Thanos L2 has scaled up
twice this week — expect higher gas competition over the next 48 hours."

---

## Combined Revenue Projection

Assuming all 5 agents above are active simultaneously:

| Agent | Monthly Revenue |
|-------|----------------|
| DeFi Protocol Agent | 600 TON |
| Bridge Agent | 300 TON |
| MEV Bot | 522 TON |
| Insurance Protocol | 3.5 TON |
| Cross-Protocol Monitor | 3.4 TON |
| **Total** | **~1,429 TON/month** |

At a conservative TON price of $2 USD:
```
1,429 TON × $2 = ~$2,858/month in additional revenue
```

**The operator's marginal cost:** ~0 (data already collected, HTTP serving negligible).

---

## Discovery: How Agents Find This Operator

```
Agent queries ERC-8004 Identity Registry:
  "l2ChainId=55004 AND capability=txpool"

Registry returns:
  SentinAI @ Thanos-Mainnet
  NFT ID: #4521
  Endpoint: https://sentinai.operator.xyz/api/marketplace
  x402Support: true
  Capabilities: [txpool, anomalies, rca, eoa, resources, metrics, ...]

Agent sends GET /api/marketplace/catalog
← Price list confirmed

Agent sends GET /api/marketplace/txpool (no payment header)
← 402 Payment Required: { amount: "0.1 TON", to: "0xoperator..." }

Agent signs EIP-3009 authorization, retries with X-PAYMENT header
← 200 OK: { pending: 312, queued: 47 }
```

The operator never manually onboarded this agent.
ERC-8004 made them discoverable; x402 made the transaction frictionless.

---

## Key Insight

> SentinAI already does the work.
> The marketplace is the monetization layer on top of work already done.

An EVM node operator who runs SentinAI for their own monitoring needs
zero additional infrastructure to participate in the agent economy.
`MARKETPLACE_ENABLED=true` is the only configuration change required.

The data they already collect — txpool state, anomaly history, EOA balances,
K8s resource usage — is exactly the data that AI agents across DeFi, MEV,
and infrastructure protocols will pay to access.
