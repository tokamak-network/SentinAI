# Proposal 10: Derivation Lag Guardian — L2 derivation lag monitoring and automatic recovery

> **Created date**: 2026-02-11
> **Prerequisite**: Proposal 2 (Anomaly Detection) implementation completed
> **Purpose**: Monitor the op-node's L1 derivation delay in real time to prevent L2 safe/finalized block confirmation delay

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

The op-node reads the L1 block and derives the L2 state. If the op-node lags behind L1 HEAD:

| Delay level | Meaning | Impact |
|----------|------|------|
| **30 blocks** (~6 minutes) | Minor derivative delay | safe/finalized finalized delayed start |
| **120 blocks** (~24 minutes) | serious derivative delays | Significant delay in L2 status confirmation |
| **600 blocks** (~2 hours) | Emergency | Withdrawal finality, impact on bridge operation |

Limitations of the current system:
- `l2BlockHeight` plateau detection detects only **full stop**
- **Cannot detect gradual derivation lag**
- Failure to distinguish between L1 own delay and op-node issues

### 1.2 Goal

1. Measure accurate derivation lag through `optimism_syncStatus` RPC
2. 3-level threshold-based notification and automatic recovery
3. Automatically distinguish between L1 delay and op-node issues and respond appropriately

### 1.3 Core principles

- **Accurate measurement**: Calculate lag based on L1 origin of `syncStatus` rather than comparing block height
- **Cause classification**: Classifies L1 RPC failure, op-node hang, and L1 reorg respectively.
- **Conservative response**: Do not attempt automatic recovery during L1 reorg

---

## 2. Architecture

### 2.1 Derivation Lag calculation principle

```
Optimism Derivation Pipeline:
  L1 Block (Ethereum)  ──→  op-node (derivation)  ──→  L2 State (safe/finalized)

Lag calculation:
  derivationLag = l1Head - syncStatus.current_l1

  syncStatus (optimism_syncStatus RPC response):
  {
"current_l1": { "number": 12340000 }, ← Last L1 block processed by op-node
"head_l1": { "number": 12340150 }, ← Latest block in L1
    "unsafe_l2":  { "number": 6200000 },    ← L2 unsafe head
    "safe_l2":    { "number": 6199500 },    ← L2 safe head
    "finalized_l2": { "number": 6199000 }   ← L2 finalized head
  }
```

### 2.2 Data flow

```
Agent Loop (30s)
  │
  ├── Observe ──────────────────────────────────────────────
  │   L2 RPC: optimism_syncStatus
  │     → current_l1, head_l1, unsafe_l2, safe_l2, finalized_l2
  │   derivationLag = head_l1.number - current_l1.number
  │
  ├── Detect ──────────────────────────────────────────────
  │   derivation-lag-monitor.ts
  │     ├── lag > 30  → WARNING (severity: medium)
  │     ├── lag > 120 → CRITICAL (severity: high)
  │     └── lag > 600 → EMERGENCY (severity: critical)
  │
  ├── Decide ──────────────────────────────────────────────
│ 1. Check L1 RPC response → If L1 itself is delayed, wait
│ 2. If L1 is normal, op-node problem → Restart playbook
  │
  └── Act ─────────────────────────────────────────────────
├── [Safe] check_l1_connection → Check whether L1 is normal
├── [Safe] collect_logs(op-node) → Collect error logs
├── [Guarded] restart_pod(op-node) → L1 정상 & lag > CRITICAL
├── [Safe] health_check → Check lag reduction trend
└── [Safe] escalate_operator → lag > EMERGENCY or L1 장애
```

---

## 3. Agent Act — Auto-execute action

### 3.1 Action table

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_l1_connection` | Safe | lag > WARNING | Check L1 RPC response and block time. Distinguish whether it is L1's own delay or an op-node problem |
| 2 | `collect_logs` | Safe | lag > WARNING | op-node recent log collection (errors related to derivation pipeline, reset) |
| 3 | `restart_pod` | **Guarded** | lag > CRITICAL & L1 normal | restart op-node pod (kubectl delete, auto-regenerate StatefulSet) |
| 4 | `health_check` | Safe | 60s after restart | Confirm derivation resumes after op-node restart (lag decreasing trend) |
| 5 | `escalate_operator` | Safe | lag > EMERGENCY or L1 failure | Operator emergency notification (L1 problems cannot be resolved automatically) |

### 3.2 Execution flow example

**Scenario: Derivation lag = 150 blocks, L1 normal**

```
[Observe] optimism_syncStatus:
  current_l1: 12340000, head_l1: 12340150
  derivationLag = 150 blocks (> CRITICAL 120)

[Detect] anomaly: {metric: 'derivationLag', value: 150, direction: 'spike',
  rule: 'threshold-breach', description: 'Derivation lag 150 blocks (critical > 120)'}

[Decide] playbook matched: 'op-node-derivation-stall' (lag > 120)

[Act]
  Step 1: check_l1_connection
    → l1Client.getBlockNumber() responds in 200ms ✓
    → Last 10 blocks: avg interval 12.1s (normal) ✓
    → Conclusion: L1 is healthy, problem is op-node
  Step 2: collect_logs(op-node)
    → kubectl logs sepolia-thanos-stack-op-node-0 --tail=100
    → Found: "derivation pipeline stall detected", "resetting pipeline"
  Step 3: restart_pod(op-node)
    → kubectl delete pod sepolia-thanos-stack-op-node-0 --grace-period=60
    → Pod terminated, StatefulSet recreating...
  Step 4: wait 60s
  Step 5: health_check(op-node)
    → optimism_syncStatus: current_l1 = 12340080 (was 12340000)
    → Lag decreasing: 150 → 70 → recovering ✓

[Log] Derivation lag recovery: 150 blocks → op-node restarted → lag decreasing
[Alert] Slack: "✅ op-node derivation stall resolved. Lag: 150 → 70 (decreasing)"
```

**Scenario: Derivation lag = 200 blocks, L1 failure**

```
[Observe] derivationLag = 200 blocks (> CRITICAL 120)

[Act]
  Step 1: check_l1_connection
    → l1Client.getBlockNumber() timeout after 15s ✗
    → Conclusion: L1 RPC unreachable
  Step 5: escalate_operator
    → Slack: "🚨 Derivation lag 200 blocks. L1 RPC unreachable.
       Cannot auto-remediate L1 connectivity issues.
       Check L1 RPC endpoint: https://ethereum-sepolia-rpc.publicnode.com"

[Log] Derivation lag 200 blocks — L1 connectivity failure, escalated to operator
```

---

## 4. Implementation Specification

### 4.1 `src/lib/derivation-lag-monitor.ts` (~250 LOC)

```typescript
/**
 * Derivation Lag Monitor
 * Track op-node's L1 derivation progress and detect lag
 */

import { createPublicClient, http } from 'viem';
import type { SyncStatus, DerivationLagResult, LagLevel } from '@/types/derivation';

// === Configuration ===

const DEFAULT_LAG_THRESHOLDS = {
  warning: 30,    // blocks (~6 min at 12s/block)
  critical: 120,  // blocks (~24 min)
  emergency: 600, // blocks (~2 hours)
};

// === Public API ===

/** Fetch optimism_syncStatus from op-node RPC */
export async function getSyncStatus(rpcUrl: string): Promise<SyncStatus | null>;

/** Calculate derivation lag from sync status */
export function calculateLag(syncStatus: SyncStatus): number;

/** Determine lag level based on thresholds */
export function getLagLevel(lag: number): LagLevel;

/** Check derivation lag and return detection result */
export async function checkDerivationLag(
  rpcUrl: string,
  thresholds?: Partial<typeof DEFAULT_LAG_THRESHOLDS>
): Promise<DerivationLagResult>;

/** Determine if L1 is the cause of lag (vs op-node issue) */
export async function isL1Healthy(l1RpcUrl: string): Promise<{
  healthy: boolean;
  responseTimeMs: number;
  avgBlockInterval: number;
}>;
```

**Core logic: `getSyncStatus()`**

```typescript
// optimism_syncStatus is the standard Optimism RPC method
const response = await client.request({
  method: 'optimism_syncStatus' as any,
  params: [],
});

// Response parsing
return {
  currentL1: response.current_l1.number,
  headL1: response.head_l1.number,
  unsafeL2: response.unsafe_l2.number,
  safeL2: response.safe_l2.number,
  finalizedL2: response.finalized_l2.number,
};
```

---

## 5. Playbook definition

**Extend** the existing `op-node-derivation-stall` playbook to add a derivation lag condition (do not create a new playbook).

### 5.1 Extending existing playbooks

```yaml
name: op-node-derivation-stall
description: op-node derivation pipeline stagnation or lag
trigger:
  component: op-node
  indicators:
    - type: metric
condition: l2BlockHeight stagnant # existing
    - type: metric
      condition: derivationLag > 120     # NEW
    - type: log_pattern
      condition: derivation pipeline|reset
actions:
  - type: check_l1_connection    # Safe
    safetyLevel: safe
  - type: collect_logs            # Safe
    safetyLevel: safe
    target: op-node
  - type: restart_pod             # Guarded
    safetyLevel: guarded
    target: op-node
    waitAfterMs: 60000
  - type: health_check            # Safe
    safetyLevel: safe
    target: op-node
maxAttempts: 1
```

---

## 6. Safety device

### 6.1 L1 Reorg response

```
When detecting L1 reorg:
→ Do not attempt automatic recovery
→ Give op-node time to process reorg on its own (wait for 5 minutes)
→ If the lag increases even after 5 minutes, the operator is notified
```

Detection method: L1 reorg occurs when `syncStatus.head_l1` decreases from the previous cycle.

### 6.2 Preventing False Positives

| Cause | Classification method | Response |
|------|---------|------|
| L1 RPC failure | Check `isL1Healthy()` | Operator notification (auto-fix not possible) |
| L1 itself is slow (merge, etc.) | L1 avg block interval > 15s | Threshold dynamic adjustment |
| op-node normal catch-up | lag decreasing trend | Suppress notifications |
| L1 reorg | head_l1 decrease | Suspend automatic recovery |

### 6.3 Restart Limitations

- Op-node restart applies the safety features of existing Proposal 8:
- Cooldown: 5 minutes (same pod restart interval)
- Maximum per hour: 3 times
- Circuit Breaker: Deactivated for 24 hours if it fails 3 times in a row

---

## 7. Environment variables

| variable | default | Description |
|------|--------|------|
| `OP_NODE_RPC_URL` | `L2_RPC_URL` | op-node admin RPC endpoint (syncStatus 호출용) |
| `DERIVATION_LAG_WARNING` | `30` | Warning threshold in L1 blocks |
| `DERIVATION_LAG_CRITICAL` | `120` | Critical threshold in L1 blocks |
| `DERIVATION_LAG_EMERGENCY` | `600` | Emergency threshold in L1 blocks |

**Reuse of existing environment variables:**
- `L1_RPC_URL` → L1 health check
- `L2_RPC_URL` → fallback for op-node RPC

---

## 8. Type definition

### 8.1 `src/types/derivation.ts` (~50 LOC)

```typescript
/**
 * Derivation Lag Monitoring Types
 */

export type LagLevel = 'normal' | 'warning' | 'critical' | 'emergency';

export interface SyncStatus {
  currentL1: number;   // L1 block op-node has processed
  headL1: number;      // L1 head block
  unsafeL2: number;    // L2 unsafe head
  safeL2: number;      // L2 safe head
  finalizedL2: number; // L2 finalized head
  timestamp: string;
}

export interface DerivationLagResult {
  lag: number;          // L1 blocks behind
  level: LagLevel;
  syncStatus: SyncStatus;
  l1Healthy: boolean;
  isReorg: boolean;     // L1 reorg detected
  trend: 'increasing' | 'decreasing' | 'stable';
}
```

---

## 9. Modify existing modules

### 9.1 `src/lib/agent-loop.ts`

Add `optimism_syncStatus` call to `collectMetrics()`:

```typescript
// Check sync status with L2 RPC (if op-node exposes the same RPC)
let syncStatus: SyncStatus | null = null;
try {
  const opNodeRpcUrl = process.env.OP_NODE_RPC_URL || rpcUrl;
  syncStatus = await getSyncStatus(opNodeRpcUrl);
} catch {
// syncStatus failure is non-fatal
}
```

### 9.2 `src/types/anomaly.ts`

```typescript
export type AnomalyMetric =
  // ... existing
  | 'derivationLag';  // NEW
```

### 9.3 `src/lib/anomaly-detector.ts`

```typescript
function detectDerivationLag(lag: number, thresholds: LagThresholds): AnomalyResult | null {
  if (lag > thresholds.critical) {
    return { isAnomaly: true, metric: 'derivationLag', value: lag,
      zScore: 0, direction: 'spike', rule: 'threshold-breach',
      description: `Derivation lag ${lag} blocks (critical > ${thresholds.critical})` };
  }
return null; // WARNING is a dashboard alert, not an anomaly
}
```

### 9.4 `src/lib/playbook-matcher.ts`

Add derivation lag condition to `matchesMetricCondition()`:

```typescript
if (condition.includes('derivationLag >')) {
  const threshold = parseInt(condition.split('>')[1].trim());
  const anomaly = event.anomalies.find(a => a.metric === 'derivationLag');
  return anomaly ? anomaly.value > threshold : false;
}
```

---

## 10. Test plan

### 10.1 Unit tests (`derivation-lag-monitor.test.ts`)

| # | test | verification |
|---|--------|------|
| 1 | getSyncStatus() parsing | optimism_syncStatus RPC response parsing |
| 2 | calculateLag() | lag = headL1 - currentL1 exact calculation |
| 3 | getLagLevel() thresholds | Level determination for each threshold section |
| 4 | L1 health check | L1 RPC response time and block interval measurement |
| 5 | L1 reorg detection | When reducing headL1 isReorg = true |
| 6 | Trend calculation | lag change trend (increasing/decreasing/stable) |
| 7 | RPC failure handling | graceful fallback when syncStatus call fails |

### 10.2 Integration test scenario

```
Scenario 1: lag 150 blocks + L1 normal → op-node restart → check lag reduction
Scenario 2: lag 200 blocks + L1 failure → operator notification (no restart)
Scenario 3: lag 10 blocks → normal (anomaly not created)
Scenario 4: Detect L1 reorg → Suspend automatic recovery → Wait 5 minutes
Scenario 5: Lag reduction trend → Prevention of unnecessary restarts
```

---

## Dependencies

```
New modules:
  ├── src/lib/derivation-lag-monitor.ts
  └── src/types/derivation.ts

Modification module:
├── src/lib/agent-loop.ts → Add syncStatus to collectMetrics()
├── src/lib/anomaly-detector.ts    → detectDerivationLag() 추가
├── src/lib/playbook-matcher.ts → Add derivationLag condition
└── src/types/anomaly.ts → Add ‘derivationLag’ to AnomalyMetric

Dependent libraries:
└── viem (already installed) → client.request() for custom RPC
```
