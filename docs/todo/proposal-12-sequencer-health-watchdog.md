# Proposal 12: Sequencer Health Watchdog — Sequencer Comprehensive Health Surveillance

> **Created date**: 2026-02-11
> **Prerequisite**: Proposal 1 (Scaling), Proposal 2 (Anomaly Detection) implementation completed
> **Purpose**: Detect the “alive but abnormal” state by calculating a multidimensional health score of op-geth (sequencer)

---

## index

1. [Overview](#1-Overview)
2. [Architecture](#2-Architecture)
3. [Agent Act — auto-run action](#3-agent-act--auto-run-action)
4. [Implementation Specification](#4-Implementation-Specification)
5. [Playbook definition](#5-playbook-definition)
6. [Safety device](#6-Safety device)
7. [Environment Variables](#7-Environment-Variables)
8. [Type-Definition](#8-Type-Definition)
9. [Modify existing module](#9-Existing-module-Modify)
10. [Test Plan](#10-Test-Plan)

---

## 1. Overview

### 1.1 Problem

A soft failure state exists where the op-geth(sequencer) is "alive but unhealthy":

| Symptoms | Cause | Current detection status |
|------|------|-------------|
| **Empty blocks** | P2P isolation, transaction not received | ⚠️ gasUsedRatio can be detected indirectly with Z-Score |
| **P2P Network Isolation** | All peers disconnected | ❌ Not detected |
| **Disc Saturation** | State DB increase (90%+) | ❌ Not detected |
| **RPC response delay** | Resource shortage, GC load | ❌ Not detected |
| **TxPool abnormal** | Nonce gap, queued accumulation | ❌ Not detected |

The current system only judges CPU/memory Z-Score, so it misses these soft failures.

### 1.2 Goal

1. Calculate a score of 0-100 by combining health scores in five dimensions
2. Score-based abnormality detection and automatic recovery by cause
3. Display sequencer health status on dashboard

### 1.3 Core principles

- **Multidimensional Assessment**: Composite score across five dimensions rather than a single metric
- **Response by cause**: Execute different playbooks depending on the cause dimension of the low score
- **Graceful Degradation**: If some probes fail, evaluate to the rest excluding the relevant dimension.

---

## 2. Architecture

### 2.1 Health Score Calculation

```
Sequencer Health Score (0-100)
  │
├── Block Fullness (25%) ────── gasUsedRatio Last 5 minutes average
│ 100: ratio > 0.3 (including transactions normally)
│ 50: ratio 0.01-0.3 (low activity)
  │   0:   ratio < 0.01   (empty blocks)
  │
  ├── Peer Count (20%) ────────── net_peerCount RPC
  │   100: peers >= 5
  │   50:  peers 1-4
│ 0: peers = 0 (network isolation)
  │
├── RPC Latency (20%) ──────── eth_blockNumber response time
  │   100: < 100ms
  │   50:  100-500ms
  │   0:   > 500ms or timeout
  │
  ├── Disk Usage (20%) ────────── kubectl exec df -h /data
  │   100: < 70%
  │   50:  70-85%
  │   0:   > 85%
  │
└── TxPool Health (15%) ────── pending vs queued 비율
100: queued < pending * 0.1 (normal)
      50:  queued < pending * 0.5
0:   queued > pending (nonce gap 다수)
```

### 2.2 Data flow

```
Agent Loop (60s — every 2nd cycle)
  │
  ├── Observe ──────────────────────────────────────────────
│ Probes (run in parallel, skipping the corresponding dimension if each probe fails):
│ ├── Block Fullness: average gasUsedRatio over the last 5 minutes in MetricsStore
  │     ├── Peer Count: l2Client.request({method: 'net_peerCount'})
│ ├── RPC Latency: l2Client.getBlockNumber() response time measurement
  │     ├── Disk Usage: kubectl exec op-geth-0 -- df -h /data
│ └── TxPool Health: pending/queued ratio in txpool_status
  │
  ├── Detect ──────────────────────────────────────────────
  │   sequencer-health.ts
│ ├── score < 60 → WARNING anomaly (including which dimension is low)
  │     └── score < 30 → CRITICAL anomaly
  │
  ├── Decide ──────────────────────────────────────────────
│ Select playbooks based on lower dimensions:
  │     ├── peers = 0 → sequencer-network-isolation
  │     ├── disk > 90% → sequencer-disk-pressure
  │     ├── latency > 500ms → sequencer-rpc-degradation
  │     └── queued >> pending → sequencer-txpool-corruption
  │
└── Act (quarter by cause) ─────────────────────────────────────
      ├── Network isolation → restart_pod(op-geth)
├── Disk pressure → escalate_operator (pruning 필요)
      ├── RPC degradation → scale_up(op-geth)
      └── TxPool corruption → flush_txpool
```

---

## 3. Agent Act — Auto-execute action

### 3.1 Action mapping by cause

| Cause | Action | Safety | Description |
|------|--------|--------|-------------|
| **P2P Isolation** (peers = 0) | `restart_pod` | Guarded | P2P reconnection with op-geth restart |
| **Disc Saturation** (> 90%) | `escalate_operator` | Safe | State pruning required → Operator notification |
| **RPC Latency** (> 500ms) | `scale_up` | Guarded | Free up resources with vCPU scale-up |
| **TxPool abnormal** | `flush_txpool` | Guarded | Initialize txpool (resolve nonce gap) |
| **Multiple Disabilities** (score < 30) | `collect_logs` + `escalate_operator` | Safe | Log collection + operator notification |

### 3.2 Execution flow example

**Scenario: P2P network isolation (peers = 0, health score = 25)**

```
[Observe] Health Probes:
  Block Fullness: gasUsedRatio avg = 0.0 → score: 0/25
  Peer Count: net_peerCount = 0 → score: 0/20
  RPC Latency: 120ms → score: 20/20
  Disk Usage: 72% → score: 15/20
  TxPool Health: pending=0, queued=0 → score: 15/15
  Total: 50/100 → but peers=0 is critical flag

[Detect] anomaly: {metric: 'sequencerHealth', value: 50,
  description: 'Sequencer health degraded: peers=0 (network isolation), empty blocks'}

[Decide] Lowest dimension: peers = 0
  → playbook: 'sequencer-network-isolation'

[Act]
  Step 1: collect_logs(op-geth)
    → "p]eer discovery failed", "no suitable peers available"
  Step 2: restart_pod(op-geth)
    → kubectl delete pod sepolia-thanos-stack-op-geth-0 --grace-period=60
    → StatefulSet recreating pod...
  Step 3: wait 60s
  Step 4: health_check
    → net_peerCount = 4, gasUsedRatio = 0.12
    → Health score: 78 ✓

[Log] Sequencer P2P isolation resolved: peers 0→4, health 50→78
```

**Scenario: Disk Saturation (92%)**

```
[Observe] Disk Usage: 92% → score: 0/20
  Total health score: 65 (WARNING)

[Detect] anomaly: {metric: 'sequencerHealth', value: 65,
  description: 'Sequencer disk pressure: 92% usage'}

[Decide] Lowest dimension: disk > 90%
  → playbook: 'sequencer-disk-pressure'

[Act]
  Step 1: escalate_operator
    → Slack: "⚠️ op-geth disk usage 92%.
       State pruning recommended. Current data dir: /data (92% of 100Gi).
       Run: kubectl exec op-geth-0 -- geth snapshot prune-state"
(Automatic recovery not possible — pruning is a manual action)

[Log] Sequencer disk pressure alert: 92% → operator notified
```

---

## 4. Implementation Specification

### 4.1 `src/lib/sequencer-health.ts` (~280 LOC)

```typescript
/**
 * Sequencer Health Watchdog
 * Multi-dimensional health scoring for op-geth sequencer
 */

import type { HealthScore, HealthDimension, ProbeResult, HealthCheckResult } from '@/types/sequencer-health';

// === Configuration ===

const DIMENSION_WEIGHTS: Record<HealthDimension, number> = {
  blockFullness: 25,
  peerCount: 20,
  rpcLatency: 20,
  diskUsage: 20,
  txPoolHealth: 15,
};

// === Probes ===

/** Probe: Block Fullness (uses existing metrics) */
async function probeBlockFullness(): Promise<ProbeResult>;

/** Probe: Peer Count (net_peerCount RPC) */
async function probePeerCount(rpcUrl: string): Promise<ProbeResult>;

/** Probe: RPC Latency (timed eth_blockNumber call) */
async function probeRpcLatency(rpcUrl: string): Promise<ProbeResult>;

/** Probe: Disk Usage (kubectl exec df) */
async function probeDiskUsage(podName: string, namespace: string): Promise<ProbeResult>;

/** Probe: TxPool Health (txpool_status pending vs queued) */
async function probeTxPoolHealth(rpcUrl: string): Promise<ProbeResult>;

// === Public API ===

/** Run all probes and calculate composite health score */
export async function checkSequencerHealth(
  rpcUrl: string,
  options?: { podName?: string; namespace?: string }
): Promise<HealthCheckResult>;

/** Get the lowest-scoring dimension (for playbook selection) */
export function getLowestDimension(result: HealthCheckResult): HealthDimension;

/** Calculate dimension score (0-100) from raw value */
export function calculateDimensionScore(
  dimension: HealthDimension,
  rawValue: number
): number;
```

**Probe failure handling:**

```typescript
// Run each probe in parallel with Promise.allSettled
// For failed probes, the remaining weights are redistributed except for that dimension.
const results = await Promise.allSettled([
  probeBlockFullness(),
  probePeerCount(rpcUrl),
  probeRpcLatency(rpcUrl),
  probeDiskUsage(podName, namespace),
  probeTxPoolHealth(rpcUrl),
]);

// Calculate weighted score only with successful probes
// Weight redistribution: Proportionally distribute the weight of failed probes to successful probes
```

---

## 5. Playbook definition

### 5.1 Playbook: `sequencer-network-isolation`

```yaml
name: sequencer-network-isolation
description: Sequencer P2P network isolation (no peers)
trigger:
  component: op-geth
  indicators:
    - type: metric
      condition: peerCount = 0
actions:
  - type: collect_logs
    safetyLevel: safe
    target: op-geth
  - type: restart_pod
    safetyLevel: guarded
    target: op-geth
    waitAfterMs: 60000
  - type: health_check
    safetyLevel: safe
    target: op-geth
maxAttempts: 2
```

### 5.2 Playbook: `sequencer-disk-pressure`

```yaml
name: sequencer-disk-pressure
description: Sequencer disk usage above 90%
trigger:
  component: op-geth
  indicators:
    - type: metric
      condition: diskUsage > 90
actions:
  - type: escalate_operator
    safetyLevel: safe
    params:
      message: "op-geth disk usage critical. State pruning recommended."
maxAttempts: 0  # No auto-remediation for disk — requires manual pruning
```

### 5.3 Playbook: `sequencer-rpc-degradation`

```yaml
name: sequencer-rpc-degradation
description: Sequencer RPC response latency above 500ms
trigger:
  component: op-geth
  indicators:
    - type: metric
      condition: rpcLatency > 500
actions:
  - type: scale_up
    safetyLevel: guarded
    target: op-geth
    params: { targetVcpu: "next_tier" }
  - type: health_check
    safetyLevel: safe
    target: op-geth
    waitAfterMs: 30000
fallback:
  - type: restart_pod
    safetyLevel: guarded
    target: op-geth
maxAttempts: 1
```

---

## 6. Safety device

### 6.1 Probe security

| Probe | Requirements | Fallback |
|-------|----------|----------|
| `net_peerCount` | op-geth `--http.api` needs to include `net` | probe skip, weight redistribution |
| `admin_peers` | `admin` API activation required | Use `net_peerCount` |
| Disk Usage | kubectl exec permission required | probe skip |
| TxPool | `txpool` API needs to be enabled | Fallback to existing txpool_status |

### 6.2 Action-specific restrictions

| action | Limited |
|------|------|
| `restart_pod` (P2P isolation) | Cooldown 5 minutes, up to 2 times per hour |
| `scale_up` (RPC degradation) | Apply existing scaling cooldown (5 minutes) |
| `flush_txpool` | Cooldown 30분, safety level `guarded` |
| Disk pressure | No automatic recovery → Only operator notification |

### 6.3 Health Check Interval

- Default: every 2nd agent cycle (60 second intervals)
- Can be adjusted with `SEQUENCER_HEALTH_CHECK_INTERVAL`
- Disk probe every 5 minutes (kubectl exec cost savings)

---

## 7. Environment variables

| variable | default | Description |
|------|--------|------|
| `SEQUENCER_HEALTH_THRESHOLD` | `60` | Health score WARNING threshold |
| `SEQUENCER_HEALTH_CRITICAL` | `30` | Health score CRITICAL threshold |
| `SEQUENCER_HEALTH_CHECK_INTERVAL` | `60` | Check interval (seconds) |
| `SEQUENCER_DISK_CHECK_INTERVAL` | `300` | Disk probe interval (seconds) |

**Reuse of existing environment variables:**
- `L2_RPC_URL` → RPC probes
- `K8S_NAMESPACE` → kubectl exec for disk check

---

## 8. Type definition

### 8.1 `src/types/sequencer-health.ts` (~80 LOC)

```typescript
/**
 * Sequencer Health Monitoring Types
 */

export type HealthDimension =
  | 'blockFullness'
  | 'peerCount'
  | 'rpcLatency'
  | 'diskUsage'
  | 'txPoolHealth';

export interface ProbeResult {
  dimension: HealthDimension;
  rawValue: number;     // Raw metric value
  score: number;        // Normalized 0-100
  success: boolean;     // Probe succeeded
  error?: string;       // Error if failed
  timestamp: string;
}

export interface HealthCheckResult {
  totalScore: number;            // Weighted composite 0-100
  dimensions: ProbeResult[];     // Individual probe results
  lowestDimension: HealthDimension | null;
  timestamp: string;
  probesSucceeded: number;
  probesTotal: number;
}

export interface HealthScore {
  score: number;
  level: 'healthy' | 'degraded' | 'critical';
  details: string;
}
```

---

## 9. Modify existing modules

### 9.1 `src/lib/agent-loop.ts`

Add health check call to `runAgentCycle()` (every 2nd cycle):

```typescript
// After collectMetrics() and runDetectionPipeline()
const cycleCount = /* track cycle number */;
if (cycleCount % 2 === 0) {
  const healthResult = await checkSequencerHealth(rpcUrl);
// Combine health anomaly with detection results
}
```

### 9.2 `src/types/anomaly.ts`

```typescript
export type AnomalyMetric =
  // ... existing
  | 'sequencerHealth';  // NEW
```

### 9.3 `src/lib/playbook-matcher.ts`

Added 3 playbooks + added sequencer health case to `identifyComponent()`:

```typescript
// sequencerHealth anomaly → determine component according to cause dimension
if (metrics.includes('sequencerHealth')) {
// Parse cause from anomaly description
// or refer to separate healthCheckResult
  return 'op-geth';
}
```

### 9.4 `src/lib/action-executor.ts`

Add `flush_txpool` action:

```typescript
case 'flush_txpool':
// RPC: txpool.flush() 또는 debug_setHead
  const response = await fetch(rpcUrl, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', method: 'debug_setHead', params: ['latest'], id: 1 }),
  });
  return response.ok ? 'TxPool flushed' : 'TxPool flush failed';
```

### 9.5 `src/types/remediation.ts`

```typescript
export type RemediationActionType =
  // ... existing
  | 'flush_txpool';  // NEW
```

---

## 10. Test plan

### 10.1 Unit tests (`sequencer-health.test.ts`)

| # | test | verification |
|---|--------|------|
| 1 | Score calculation | Accurate calculation of 5-dimensional weighted scores |
| 2 | Dimension scoring | rawValue → score conversion for each dimension |
| 3 | Probe failure handling | Weight redistribution when some probes fail |
| 4 | Lowest dimension | Lowest dimension correct identification |
| 5 | Threshold detection | score < 60 → WARNING, < 30 → CRITICAL |
| 6 | Peer count = 0 | Instant network isolation playbook matching |
| 7 | Disk > 90% | Check manual escalation |
| 8 | All probes fail | graceful degradation (unknown state) |

### 10.2 Integration test scenario

```
Scenario 1: peers=0 + empty blocks → restart op-geth → check peers recovery
Scenario 2: disk 92% → operator notification (no automatic recovery)
Scenario 3: RPC latency 800ms → scale_up → confirmation of latency improvement
Scenario 4: queued >> pending → flush_txpool → txpool normalization
Scenario 5: Complex failure (score=20) → collect_logs + operator notification
Scenario 6: net_peerCount RPC disabled → probe skip, evaluated in 4 dimensions
```

---

## Dependencies

```
New modules:
  ├── src/lib/sequencer-health.ts
  └── src/types/sequencer-health.ts

Modification module:
├── src/lib/agent-loop.ts → Add health check call
├── src/lib/anomaly-detector.ts    → sequencerHealth anomaly 추가
├── src/lib/playbook-matcher.ts → Add 3 playbooks
├── src/lib/action-executor.ts → Add flush_txpool action
├── src/types/anomaly.ts           → AnomalyMetric 확장
└── src/types/remediation.ts       → RemediationActionType 확장

Dependent libraries:
└── viem (already installed) → custom RPC calls (net_peerCount, txpool)

Optional:
└── src/app/page.tsx → Add Health Score gauge to dashboard
```
