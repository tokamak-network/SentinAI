# Agent Economy: Revenue Scenarios for EVM Operators

> SentinAI turns monitoring infrastructure from a cost center into a revenue stream.
> This document shows how external AI agents consuming operational signals
> can generate additional income for the node operator.

---

## The Premise

An EVM node operator already runs SentinAI for internal monitoring. With `MARKETPLACE_ENABLED=true`, that same infrastructure becomes a paid data API for DeFi, bridge, insurance, and shared infrastructure agents.

The marketplace should optimize for two things at once:
- Strong buyer demand
- Low abuse potential

For that reason, `txpool` is excluded from the marketplace. Phase 1 sells decision-ready execution safety signals such as `sequencer-health`, `incident-summary`, and `batch-submission-status` instead of order-flow-adjacent data.

**The operator's marginal cost of serving these agents is near zero.**
The monitoring data is already collected. Serving it via HTTP adds negligible load.

---

## Tier Reference

| Tier | Endpoint | Price | What makes it unique |
|------|----------|-------|----------------------|
| 1 | `/marketplace/sequencer-health` | 0.1 TON | Decision-ready execution health for pre-trade and pre-withdrawal gating |
| 1 | `/marketplace/anomalies` | 0.2 TON | 4-layer anomaly detection result |
| 1 | `/marketplace/incident-summary` | 0.15 TON | Current incident state and recent reliability in agent-friendly form |
| 1 | `/marketplace/rca/:id` | 0.5 TON | Root cause analysis report |
| 1 | `/marketplace/eoa` | 0.2 TON | Batcher/proposer balance and depletion forecast |
| 1 | `/marketplace/resources` | 0.1 TON | K8s pod CPU/memory actual usage |
| 1 | `/marketplace/batch-submission-status` | 0.15 TON | Recent batch posting health and lag |
| 2 | `/marketplace/metrics` | 0.05 TON | Block interval history (60-min stats) |
| 2 | `/marketplace/scaling-history` | 0.1 TON | Scaling event log with reasons |
| 2 | `/marketplace/sync-trend` | 0.1 TON | Block production trend and lag detection |

---

## Acceptable Use Policy

All agents accessing the marketplace must agree to the following terms at registration.

### Permitted Uses

- **Execution safety gating**: Check whether the L2 is healthy enough before swaps, liquidations, settlements, or withdrawals.
- **Infrastructure safety gating**: Pause or delay actions when the node is degraded.
- **Risk modeling**: Price insurance, adjust bridge parameters, or set protocol thresholds.
- **Operational automation**: Trigger alerts, scaling decisions, or maintenance workflows from aggregate health signals.

### Prohibited Uses

- **Latency-sensitive execution alpha extraction**: Use marketplace data to front-run, sandwich, or otherwise target individual user transactions.
- **Transaction ordering manipulation**: Use marketplace health or timing data to influence ordering for profit at the expense of users.
- **Raw data re-selling**: Redistribute raw marketplace outputs to third parties without meaningful transformation.
- **High-frequency arbitrage against public propagation lag**: Exploit operator-grade signals to gain unfair advantages over users relying on public endpoints.

### Sequencer Health Data Constraints

The `/marketplace/sequencer-health` endpoint deliberately exposes **coarse operational health only**, not transaction-level or order-flow data:

```json
{
  "status": "healthy",
  "healthScore": 84,
  "action": "proceed",
  "updatedAt": "2026-03-11T09:00:00Z"
}
```

**Not exposed:**
- Individual transaction hashes, senders, or recipients
- Gas prices or pending transaction composition
- Contract call data or decoded signatures
- Any signal that directly identifies a specific pending transaction or order-flow pattern

This design keeps the product useful for **execution safety gating** while making it materially less useful for **transaction-targeting MEV**.

### Enforcement

| Mechanism | How |
|-----------|-----|
| Registration claim | Agent signs a declared purpose payload at ERC-8004 registration |
| Rate limiting | Requests above policy thresholds per agent ID are throttled |
| Anomaly detection | SentinAI monitors marketplace access patterns for abuse |
| Revocation | Operator can revoke marketplace access by invalidating the agent capability claim |

---

## Scenario 1: DeFi Protocol Agent — Pre-Trade Execution Safety Check

**Who:** An automated trading agent for a DeFi protocol on Thanos L2.
**Problem:** Before executing large swaps or liquidations, the agent needs to know whether the execution environment is degraded. A failed trade on a degraded network wastes gas and can cause slippage losses far greater than 0.1 TON.

**Usage pattern:**
- Queries `/marketplace/sequencer-health` before every significant transaction (≥$10k)
- Protocol executes ~200 such transactions per day

**Revenue calculation:**
```
200 queries/day × 0.1 TON × 30 days = 600 TON/month
```

**What the agent gets:**
```json
{
  "status": "degraded",
  "healthScore": 61,
  "action": "delay",
  "reasons": [
    "block interval variance elevated",
    "recent high severity incident still active"
  ],
  "blockProduction": {
    "avgBlockIntervalSec": 4.8,
    "stdDevBlockIntervalSec": 1.7,
    "trend": "rising",
    "stalled": false
  },
  "updatedAt": "2026-03-11T09:00:00Z"
}
```

If `action = "delay"`, the agent waits 30 seconds.
If `action = "proceed"`, it executes with tighter slippage settings.

**Operator perspective:**
> "My node was already collecting the signals behind this health score every minute.
> Now I serve them on-demand and earn 600 TON/month from one client."

---

## Scenario 2: Bridge Protocol Agent — Safety Gate Before Withdrawal

**Who:** An automated bridge agent managing L2→L1 withdrawals.
**Problem:** A withdrawal that starts while the batcher EOA is near depletion or batch posting is unhealthy may be delayed or stuck.

**Usage pattern:**
- Queries `/marketplace/eoa` before every withdrawal initiation
- Queries `/marketplace/batch-submission-status` during high withdrawal volume windows

**Revenue calculation:**
```
50 × 0.2 TON + 50 × 0.15 TON = 10 + 7.5 = 17.5 TON/day
17.5 TON/day × 30 days = 525 TON/month
```

**What the agent gets from `/marketplace/batch-submission-status`:**
```json
{
  "status": "warning",
  "lastSuccessfulSubmissionAt": "2026-03-11T08:42:00Z",
  "submissionLagSec": 540,
  "riskLevel": "elevated",
  "reasons": [
    "batch posting delayed",
    "settlement pipeline slower than baseline"
  ]
}
```

When `riskLevel = "elevated"` or `estimatedHoursRemaining < 24`, the bridge pauses withdrawal initiation and alerts operators.

**Operator perspective:**
> "This data protects my own bridge path and creates direct marketplace revenue."

---

## Scenario 3: Shared Infrastructure Agent — Multi-Protocol Health Routing

**Who:** A shared infrastructure agent used by multiple DeFi protocols on Thanos L2.
**Problem:** The agent must decide whether to let each protocol execute normally, switch to conservative settings, or temporarily pause actions during rollup degradation.

**Usage pattern:**
- Queries `/marketplace/incident-summary` every 10 minutes (144 queries/day)
- Queries `/marketplace/sequencer-health` during high-value execution windows (60 queries/day)

**Revenue calculation:**
```
144 × 0.15 TON + 60 × 0.1 TON = 21.6 + 6 = 27.6 TON/day
27.6 TON/day × 30 days = 828 TON/month
```

**What the agent gets from `/marketplace/incident-summary`:**
```json
{
  "status": "degraded",
  "activeCount": 1,
  "highestSeverity": "high",
  "unresolvedCount": 1,
  "lastIncidentAt": "2026-03-11T08:42:00Z",
  "rollingWindow": {
    "lookbackHours": 24,
    "incidentCount": 3,
    "mttrMinutes": 18
  }
}
```

If `status = "degraded"` and `highestSeverity = "high"`, the shared agent moves connected protocols into conservative mode.

**Operator perspective:**
> "The same operational signals I use internally now coordinate multiple external agents and create recurring revenue."

---

## Scenario 4: Insurance Protocol — Uptime Attestation

**Who:** A decentralized insurance protocol covering L2 infrastructure risk.
**Problem:** To price premiums and pay claims, the protocol needs historical evidence of anomaly frequency, incident severity, and recovery speed.

**Usage pattern:**
- Monthly audit pulls anomaly history plus active-incident context
- Queries `/marketplace/anomalies` (~10 calls)
- Queries `/marketplace/incident-summary` (~4 calls)
- Queries `/marketplace/rca/:id` for active incidents (avg 3/month)

**Revenue calculation:**
```
10 × 0.2 TON + 4 × 0.15 TON + 3 × 0.5 TON = 2 + 0.6 + 1.5 = 4.1 TON/month
```

**What the agent gets from `/marketplace/anomalies`:**
```json
{
  "events": [
    {
      "id": "anom-789",
      "detectedAt": "2026-03-05T14:32:00Z",
      "severity": "high",
      "metric": "blockInterval",
      "zScore": 4.2,
      "resolved": true,
      "resolvedAt": "2026-03-05T15:01:00Z"
    }
  ],
  "total": 3,
  "activeCount": 0
}
```

**Operator perspective:**
> "My monitoring history becomes a verifiable uptime record that lowers my own insurance friction and earns me TON."

---

## Scenario 5: Cross-Protocol Monitoring Agent — Scaling Intelligence

**Who:** A shared monitoring agent used by multiple protocols that depend on Thanos L2.
**Problem:** The agent correlates scaling events, resource pressure, and health degradation across multiple L2s to detect systemic risk.

**Usage pattern:**
- Queries `/marketplace/scaling-history` weekly
- Queries `/marketplace/resources` during known high-load events (daily)

**Revenue calculation:**
```
4 × 0.1 TON + 30 × 0.1 TON = 0.4 + 3 = 3.4 TON/month
```

**What the agent gets from `/marketplace/scaling-history`:**
```json
{
  "events": [
    {
      "timestamp": "2026-03-10T08:12:00Z",
      "fromVcpu": 2,
      "toVcpu": 4,
      "reason": "sequencer_health degraded, block interval variance elevated",
      "mode": "in_place_resize"
    }
  ]
}
```

---

## Combined Revenue Projection

Assuming all 5 agents above are active simultaneously:

| Agent | Monthly Revenue | AUP Status |
|-------|----------------|------------|
| DeFi Protocol Agent | 600 TON | ✅ Permitted |
| Bridge Agent | 525 TON | ✅ Permitted |
| Shared Infrastructure Agent | 828 TON | ✅ Permitted |
| Insurance Protocol | 4.1 TON | ✅ Permitted |
| Cross-Protocol Monitor | 3.4 TON | ✅ Permitted |
| **Total** | **~1,960.5 TON/month** | ✅ |

At a conservative TON price of $2 USD:
```
1,960.5 TON × $2 = ~$3,921/month in additional revenue
```

**Operator marginal cost:** ~0

---

## Discovery: How Agents Find This Operator

```
Agent queries ERC-8004 Identity Registry:
  "l2ChainId=55004 AND capability=sequencer_health"

Registry returns:
  SentinAI @ Thanos-Mainnet
  NFT ID: #4521
  Endpoint: https://sentinai.operator.xyz/api/marketplace
  x402Support: true
  Capabilities: [sequencer_health, incident_summary, anomalies, rca, eoa, resources, ...]

Agent sends GET /api/marketplace/catalog
← Price list confirmed

Agent sends GET /api/marketplace/sequencer-health (no payment header)
← 402 Payment Required: { amount: "0.1 TON", to: "0xoperator..." }

Agent signs EIP-3009 authorization, retries with X-PAYMENT header
← 200 OK: { status: "healthy", healthScore: 84, action: "proceed" }
```

The operator never manually onboarded this agent. ERC-8004 made them discoverable; x402 made payment frictionless.

---

## Key Insight

> SentinAI already does the work.
> The marketplace is the monetization layer on top of work already done.

The data operators already collect — sequencer health, anomaly history, EOA balances, batch submission health, and K8s resource usage — is exactly the kind of operational signal that external agents will pay for when it helps them avoid failed execution and infrastructure risk.
