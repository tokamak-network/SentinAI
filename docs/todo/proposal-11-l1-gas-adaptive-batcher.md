# Proposal 11: L1 Gas Price Adaptive Batcher — L1 gas price-based placement strategy

> **Created date**: 2026-02-11
> **Prerequisite**: Proposal 2 (Anomaly Detection), Proposal 4 (Cost Optimizer) implementation completed
> **Purpose**: Optimize operating costs by automatically adjusting op-batcher deployment strategy when L1 gas price surges

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

The op-batcher submits L2 transaction batches to L1. If L1 gas prices surge:

| Situation | Impact |
|------|------|
| NFT Minting Event | 10-50X increase in batch submission costs |
| Frequency placement during gas surge | Unnecessary high gas spending |
| extreme gas prices | Batch transaction pending stay, submission failed |

Limitations of the current system:
- **No monitoring of L1 gas prices at all**
- batcher submits batches at the same frequency regardless of gas price
- Missed cost optimization opportunities (batch submissions during times of low gas availability)

### 1.2 Goal

1. Real-time monitoring of L1 gas price (base fee + priority fee)
2. Automatic adjustment of deployment strategy by gas price level (increased interval, pause, quick submission)
3. Track and report gas spending by integrating with existing cost-optimizer

### 1.3 Core principles

- **Sequencer Window Compliance**: Batch delay is up to 1 hour (1/12 of a 12-hour window)
- **Cost vs Delay Balance**: Optimal point between gas savings and data availability confirmation delay
- **Automatic Recovery**: Automatically restores to original settings when gas price stabilizes

---

## 2. Architecture

### 2.1 Gas Price Level System

```
L1 Gas Price (gwei)
  │
├── NORMAL (< 50 gwei) → Maintain default batch interval
├── HIGH (50-100 gwei) → WARNING alert, strengthened monitoring
├── SPIKE (100-200 gwei) → 4-fold increase in batch interval (15→60 channel duration)
└── EXTREME (> 200 gwei) → Pause batch (up to 1 hour)
```

### 2.2 Data flow

```
Agent Loop (30s)
  │
  ├── Observe ──────────────────────────────────────────────
  │   l1Client.getGasPrice()          → currentGasPrice (gwei)
│   l1Client.request('eth_feeHistory') → baseFee trend (선택)
  │
  ├── Detect ──────────────────────────────────────────────
  │   l1-gas-monitor.ts
  │     ├── gasPrice > HIGH   → WARNING anomaly
  │     ├── gasPrice > SPIKE  → CRITICAL anomaly
  │     └── gasPrice > EXTREME → CRITICAL anomaly (pause trigger)
  │
  ├── Decide ──────────────────────────────────────────────
│ 1. Determination of current gas level
│ 2. Compare with current batcher config
│ 3. Determine whether adjustments are needed
  │
  └── Act ─────────────────────────────────────────────────
├── [Safe] collect_logs(op-batcher) → Check current batch status
      ├── [Guarded] adjust_batcher_config → ConfigMap patch
      ├── [Guarded] pause_batcher → scale to 0 (EXTREME)
├── [Guarded] resume_batcher → scale to 1 (gas stabilization)
└── [Safe] escalate_operator → EXTREME lasts for more than 1 hour
```

### 2.3 Batcher Config adjustment method

```
op-batcher main settings:
--max-channel-duration: maximum duration of batch channel (number of L1 blocks)
Default: 15 (about 3 minutes)
SPIKE: 60 (about 12 minutes) → Deployment frequency reduced by 4 times

Adjustment method:
  kubectl patch configmap <batcher-configmap> \
    --namespace <namespace> \
    --patch '{"data":{"OP_BATCHER_MAX_CHANNEL_DURATION":"60"}}'

→ op-batcher pod restart required (config reflected)
```

---

## 3. Agent Act — Auto-execute action

### 3.1 Action table

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `collect_logs` | Safe | gas > HIGH | Check pending tx / failed submission in op-batcher log |
| 2 | `adjust_batcher_config` | **Guarded** | gas > SPIKE | Increase `MAX_CHANNEL_DURATION` in op-batcher ConfigMap with kubectl patch |
| 3 | `pause_batcher` | **Guarded** | gas > EXTREME | op-batcher Deployment/StatefulSet replicas to 0 (pause) |
| 4 | `resume_batcher` | **Guarded** | gas < SPIKE | Recover stopped op-batcher to replicas 1 |
| 5 | `escalate_operator` | Safe | EXTREME Lasts 1 hour | Long-term outage of batch submissions imminent, manual intervention requested |

### 3.2 Execution flow example

**Scenario: L1 gas = 130 gwei (SPIKE)**

```
[Observe] l1Client.getGasPrice() = 130 gwei

[Detect] anomaly: {metric: 'l1GasPrice', value: 130, direction: 'spike',
  rule: 'threshold-breach', description: 'L1 gas price spike: 130 gwei (> 100)'}

[Decide] playbook matched: 'l1-gas-spike' (gas > SPIKE)
  Current batcher config: MAX_CHANNEL_DURATION = 15
  Target: MAX_CHANNEL_DURATION = 60

[Act]
  Step 1: collect_logs(op-batcher)
    → "batch submitted at 125 gwei, cost: 0.15 ETH per batch"
  Step 2: adjust_batcher_config
    → kubectl patch configmap sepolia-thanos-stack-op-batcher-config \
        -n thanos-sepolia \
        --patch '{"data":{"OP_BATCHER_MAX_CHANNEL_DURATION":"60"}}'
    → kubectl delete pod sepolia-thanos-stack-op-batcher-0 (config reload)
    → Pod restarted with new config ✓

[Log] L1 gas spike: 130 gwei → batcher interval increased (15→60 channel duration)
[Alert] Slack: "⚠️ L1 gas spike (130 gwei). Batcher interval increased 4x to reduce costs."
```

**Scenario: Recovery after gas stabilization**

```
[Observe] l1Client.getGasPrice() = 35 gwei (NORMAL, was SPIKE)

[Decide] Gas stabilized. Current batcher config: MAX_CHANNEL_DURATION = 60
  Target: restore to 15 (default)

[Act]
  Step 1: adjust_batcher_config
    → kubectl patch configmap ... --patch '{"data":{"OP_BATCHER_MAX_CHANNEL_DURATION":"15"}}'
    → kubectl delete pod (config reload)

[Log] L1 gas stabilized: 35 gwei → batcher interval restored (60→15)
```

**Scenario: EXTREME gas (250 gwei)**

```
[Observe] l1Client.getGasPrice() = 250 gwei

[Act]
  Step 1: pause_batcher
    → kubectl scale statefulset sepolia-thanos-stack-op-batcher --replicas=0
    → Batcher paused. Batches will accumulate in sequencer.
  Step 2: Start timer: max pause duration = 60 minutes

--- 45 minutes later ---

[Observe] l1Client.getGasPrice() = 80 gwei (< SPIKE)

[Act]
  Step 1: resume_batcher
    → kubectl scale statefulset sepolia-thanos-stack-op-batcher --replicas=1
    → Batcher resumed. Accumulated batches will be submitted.
  Step 2: adjust_batcher_config → restore defaults

--- If 1 hour has passed, still EXTREME ---

[Act]
  Step 5: escalate_operator
    → Slack: "🚨 L1 gas extreme (250+ gwei) for 1 hour.
       Batcher paused. Sequencer window: 11h remaining.
       Manual decision required: continue waiting or submit at high cost."
```

---

## 4. Implementation Specification

### 4.1 `src/lib/l1-gas-monitor.ts` (~220 LOC)

```typescript
/**
 * L1 Gas Price Monitor
 * Track L1 gas prices and determine batch strategy
 */

import { createPublicClient, http, formatGwei } from 'viem';
import type { GasPrice, GasLevel, BatchStrategy, GasMonitorResult } from '@/types/l1-gas';

// === Configuration ===

const DEFAULT_GAS_THRESHOLDS = {
  high: 50n * 10n ** 9n,     // 50 gwei
  spike: 100n * 10n ** 9n,   // 100 gwei
  extreme: 200n * 10n ** 9n, // 200 gwei
};

// === State ===

let batcherPausedAt: number | null = null;
let originalChannelDuration: string | null = null;

// === Public API ===

/** Fetch current L1 gas price */
export async function getL1GasPrice(l1RpcUrl: string): Promise<GasPrice>;

/** Determine gas price level */
export function getGasLevel(gasPriceWei: bigint): GasLevel;

/** Determine recommended batch strategy */
export function recommendStrategy(gasLevel: GasLevel): BatchStrategy;

/** Check gas price and return monitor result */
export async function checkGasPrice(l1RpcUrl: string): Promise<GasMonitorResult>;

/** Check if batcher is currently paused */
export function isBatcherPaused(): boolean;

/** Get pause duration in minutes */
export function getPauseDurationMinutes(): number | null;
```

---

## 5. Playbook definition

### 5.1 Playbook: `l1-gas-spike`

```yaml
name: l1-gas-spike
description: L1 gas price spike — adjust batcher submission strategy
trigger:
  component: l1
  indicators:
    - type: metric
      condition: l1GasPrice > 100  # gwei
actions:
  - type: collect_logs
    safetyLevel: safe
    target: op-batcher
  - type: adjust_batcher_config
    safetyLevel: guarded
    target: op-batcher
    params:
      maxChannelDuration: "60"  # 4x increase
    waitAfterMs: 30000
fallback:
  - type: escalate_operator
    safetyLevel: safe
maxAttempts: 1
```

### 5.2 Playbook: `l1-gas-extreme`

```yaml
name: l1-gas-extreme
description: L1 gas price extreme — pause batcher to prevent overspend
trigger:
  component: l1
  indicators:
    - type: metric
      condition: l1GasPrice > 200  # gwei
actions:
  - type: pause_batcher
    safetyLevel: guarded
    target: op-batcher
    params:
      maxPauseMinutes: 60
fallback:
  - type: escalate_operator
    safetyLevel: safe
    params:
      message: "L1 gas extreme for 1h+. Batcher paused. Manual decision needed."
maxAttempts: 0  # Single pause, then escalate if still extreme
```

---

## 6. Safety device

### 6.1 Sequencer Window Limitations

| Limited | value | Description |
|------|---|------|
| maximum batch delay | 1 hour | 1/12 of Optimism sequencer window (12 hours) |
| Pause timer | 60 minutes | Automatic escalation when exceeding 60 minutes |
| Preserve original config | automatic | Save the original value before change and use it when recovering |

### 6.2 Config change safety

```
1. Before change: Save current ConfigMap value to originalChannelDuration
2. Change: kubectl patch configmap
3. Restart the Pod: kubectl delete pod (StatefulSet will regenerate with new config)
4. When recovering: patch back to the originalChannelDuration value
```

### 6.3 Re-evaluation cycle

- Reassess **every 5 minutes** even after gas price changes
- **Instant** recovery in case of a plunge (in the next agent cycle)
- Gas price recheck log every 30 minutes in Pause state

---

## 7. Environment variables

| variable | default | Description |
|------|--------|------|
| `L1_GAS_PRICE_HIGH_GWEI` | `50` | High threshold (warning) |
| `L1_GAS_PRICE_SPIKE_GWEI` | `100` | Spike threshold (adjust batcher) |
| `L1_GAS_PRICE_EXTREME_GWEI` | `200` | Extreme threshold (pause batcher) |
| `BATCH_DELAY_MAX_MINUTES` | `60` | Maximum batch delay / pause duration |
| `BATCHER_CONFIGMAP_NAME` | auto-detect | op-batcher ConfigMap name |
| `BATCHER_DEFAULT_CHANNEL_DURATION` | `15` | Default max channel duration (fallback) |

**Reuse of existing environment variables:**
- `L1_RPC_URL` → L1 gas price query
- `K8S_NAMESPACE` → kubectl patch namespace

---

## 8. Type definition

### 8.1 `src/types/l1-gas.ts` (~70 LOC)

```typescript
/**
 * L1 Gas Price Monitoring Types
 */

export type GasLevel = 'normal' | 'high' | 'spike' | 'extreme';

export type BatchStrategy = 'default' | 'delay' | 'pause' | 'rush';

export interface GasPrice {
  wei: bigint;
  gwei: number;
  timestamp: string;
}

export interface GasMonitorResult {
  currentPrice: GasPrice;
  level: GasLevel;
  recommendedStrategy: BatchStrategy;
  batcherPaused: boolean;
  pauseDurationMinutes: number | null;
  trend: 'rising' | 'falling' | 'stable';
}

export interface GasThresholds {
  highGwei: number;
  spikeGwei: number;
  extremeGwei: number;
}
```

---

## 9. Modify existing modules

### 9.1 `src/lib/agent-loop.ts`

```typescript
// Add gas price query to collectMetrics()
const [block, l1BlockNumber, ..., l1GasPrice] = await Promise.all([
  // ... existing
  l1Client.getGasPrice(),
]);
```

### 9.2 `src/types/anomaly.ts`

```typescript
export type AnomalyMetric =
  // ... existing
  | 'l1GasPrice';  // NEW
```

### 9.3 `src/lib/anomaly-detector.ts`

```typescript
function detectGasPriceSpike(gasPriceGwei: number): AnomalyResult | null {
  const spikeThreshold = Number(process.env.L1_GAS_PRICE_SPIKE_GWEI || '100');
  if (gasPriceGwei > spikeThreshold) {
    return { isAnomaly: true, metric: 'l1GasPrice', value: gasPriceGwei,
      zScore: 0, direction: 'spike', rule: 'threshold-breach',
      description: `L1 gas price spike: ${gasPriceGwei} gwei (> ${spikeThreshold})` };
  }
  return null;
}
```

### 9.4 `src/lib/action-executor.ts`

Added 3 new actions:

```typescript
case 'adjust_batcher_config':
  // kubectl patch configmap + pod restart
  return await executeAdjustBatcherConfig(action);

case 'pause_batcher':
  // kubectl scale --replicas=0
  return await executePauseBatcher(action);

case 'resume_batcher':
  // kubectl scale --replicas=1 + restore config
  return await executeResumeBatcher(action);
```

### 9.5 `src/types/remediation.ts`

```typescript
export type RemediationActionType =
  // ... existing
  | 'adjust_batcher_config'
  | 'pause_batcher'
  | 'resume_batcher';
```

### 9.6 `src/lib/cost-optimizer.ts`

Integrate gas price data into cost analysis:
- Tracking of L1 gas expenses by section
- Calculate savings by adjusting deployment strategy

### 9.7 `src/lib/daily-report-generator.ts`

Added gas cost section to daily report:
- Daily average/maximum L1 gas price
- Number of placement strategy adjustments
- Estimated gas cost savings

---

## 10. Test plan

### 10.1 Unit tests (`l1-gas-monitor.test.ts`)

| # | test | verification |
|---|--------|------|
| 1 | Gas level classification | Accurate classification by NORMAL/HIGH/SPIKE/EXTREME section |
| 2 | Strategy recommendation | Recommend correct strategies for each level |
| 3 | Batcher pause/resume state | Track pause state and calculate duration |
| 4 | Config change and restore | Preserve and restore original config |
| 5 | Max pause duration | Trigger escalation when exceeding 60 minutes |
| 6 | Trend calculation | Rising/falling/stable trend determination |
| 7 | Gas stabilization detection | SPIKE → NORMAL transition detection |

### 10.2 Integration test scenario

```
Scenario 1: gas 130 gwei → config adjustment (15→60) → gas 35 gwei → config recovery (60→15)
Scenario 2: gas 250 gwei → batcher pause → 45 minutes later gas 80 gwei → resume
Scenario 3: gas 250 gwei → 60 minutes duration → operator escalation
Scenario 4: Severe gas fluctuation (100↔150) → Prevent unnecessary config changes (hysteresis)
Scenario 5: Simulation mode → config unchanged, only log recorded
```

---

## Dependencies

```
New modules:
  ├── src/lib/l1-gas-monitor.ts
  └── src/types/l1-gas.ts

Modification module:
├── src/lib/agent-loop.ts → Add getGasPrice to collectMetrics()
├── src/lib/anomaly-detector.ts    → detectGasPriceSpike() 추가
├── src/lib/playbook-matcher.ts → Add 2 playbooks
├── src/lib/action-executor.ts → Add 3 actions
├── src/lib/cost-optimizer.ts → Gas cost data integration
├── src/lib/daily-report-generator.ts → Add gas cost section
├── src/types/anomaly.ts           → AnomalyMetric 확장
└── src/types/remediation.ts       → RemediationActionType 확장

Dependent libraries:
└── viem (already installed) → getGasPrice, formatGwei
```
