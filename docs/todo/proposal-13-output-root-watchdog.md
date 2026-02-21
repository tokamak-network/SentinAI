# Proposal 13: Output Root Submission Watchdog — Output Root Submission Watchdog

> **Created date**: 2026-02-11
> **Prerequisite**: Proposal 2 (Anomaly Detection) implementation completed, Proposal 9 (EOA Balance) recommended
> **Purpose**: Monitor the submission of the op-proposer's L2 output root to prevent withdrawal finality delays and bridge operation failures

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

The op-proposer periodically submits the L2 state root (output root) to the `L2OutputOracle` contract of L1. If this submission is delayed:

| Impact | Description |
|------|------|
| **Withdrawal delay** | User funds are locked for a long period of time due to delayed start of challenge period for L2→L1 withdrawal |
| **Bridge Failure** | Dispute window expands abnormally, causing problems in bridge operation |
| **Finality Loss** | Security guarantees are weakened because the L2 state is not anchored to L1 |

Limitations of the current system:
- **Do not monitor op-proposers at all** (only collect logs)
- Does not track output root submission status
- Unable to distinguish between causes of submission delays (insufficient balance, gas surge, proposer hang)

### 1.2 Goal

1. Read L1’s `L2OutputOracle` contract to track the latest output root submission status
2. Detection of submission lag and diagnosis of cause
3. Automatic response by cause in conjunction with Proposal 9 (EOA Balance) and Proposal 11 (Gas Monitor)

### 1.3 Core principles

- **Read-only monitoring**: L1 contract only performs read-only calls (transaction is not sent)
- **Cross-feature integration**: Use data from F1 (balance) and F3 (gas) to diagnose the cause.
- **Absolutely prohibited**: “Calculating an alternative output root” or “directly submitting output transactions” is not allowed.

---

## 2. Architecture

### 2.1 L2OutputOracle contract interface

```solidity
// L2OutputOracle (Bedrock)
function latestOutputIndex() external view returns (uint256);
function getL2Output(uint256 _l2OutputIndex) external view returns (
  bytes32 outputRoot,
  uint128 timestamp,
  uint128 l2BlockNumber
);
function SUBMISSION_INTERVAL() external view returns (uint256);  // L2 blocks between submissions
function L2_BLOCK_TIME() external view returns (uint256);
```

### 2.2 Output Root Lag Calculation

```
outputRootLag = currentL2BlockHeight - lastOutputRootL2Block

example:
  currentL2Block: 6,200,000
lastOutputRootL2Block: 6,196,200 (based on SUBMISSION_INTERVAL = 1800, pushed back 2 times)
  outputRootLag: 3,800 blocks

  WARNING:  lag > SUBMISSION_INTERVAL * 2 = 3,600
  CRITICAL: lag > SUBMISSION_INTERVAL * 3 = 5,400
```

### 2.3 Data flow

```
Agent Loop (5 minute intervals — reduced contract read costs)
  │
  ├── Observe ──────────────────────────────────────────────
  │   L1 Contract Reads (viem readContract):
  │     ├── L2OutputOracle.latestOutputIndex()
  │     ├── L2OutputOracle.getL2Output(latestIndex)
  │     │   → lastOutputL2Block, lastSubmissionTimestamp
  │     └── L2OutputOracle.SUBMISSION_INTERVAL()
  │   outputRootLag = currentL2Block - lastOutputL2Block
  │
  ├── Detect ──────────────────────────────────────────────
  │   output-root-monitor.ts
  │     ├── lag > INTERVAL * 2 → WARNING
  │     ├── lag > INTERVAL * 3 → CRITICAL
  │     └── timeSinceLastSubmission > expectedInterval * 3 → CRITICAL
  │
  ├── Decide ──────────────────────────────────────────────
│ Cause diagnosis:
│ ├── Proposer EOA balance insufficient? → F1 refill trigger
│ ├── L1 gas surge? → F3 waiting strategy
│ └── Proposer hang? → Restart the pod
  │
  └── Act ─────────────────────────────────────────────────
      ├── [Safe] check_eoa_balance(proposer)
      ├── [Safe] check_l1_gas_price
      ├── [Safe] collect_logs(op-proposer)
      ├── [Guarded] restart_pod(op-proposer)
├── [Safe] verify_next_submission (after 5 minutes)
      └── [Safe] escalate_operator
```

---

## 3. Agent Act — Auto-execute action

### 3.1 Action table

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_eoa_balance` | Safe | lag > WARNING | proposer Check EOA balance. Shortage triggers refill of Proposal 9 |
| 2 | `check_l1_gas_price` | Safe | lag > WARNING | Check L1 gas price. If excessive, wait for gas to stabilize |
| 3 | `collect_logs` | Safe | lag > WARNING | Check the cause of failure in the op-proposer log |
| 4 | `restart_pod` | **Guarded** | lag > CRITICAL & balance OK & gas OK | restart op-proposer pod |
| 5 | `verify_next_submission` | Safe | 5min after restart | Recheck L2OutputOracle to confirm submission of new output root |
| 6 | `escalate_operator` | Safe | lag > CRITICAL * 2 or restart failed | Challenge window imminent, operator emergency notification |

### 3.2 Execution flow example

**Scenario: Output root lag = 5,500 blocks (> CRITICAL 5,400)**

```
[Observe] L2OutputOracle contract reads:
  latestOutputIndex() = 1234
  getL2Output(1234) = {l2BlockNumber: 6194500, timestamp: 1739280000}
  SUBMISSION_INTERVAL() = 1800
  currentL2Block = 6200000
  outputRootLag = 6200000 - 6194500 = 5500 (> CRITICAL: 1800 * 3 = 5400)

[Detect] anomaly: {metric: 'outputRootLag', value: 5500,
  description: 'Output root submission lag: 5500 blocks (critical > 5400)'}

[Decide] playbook matched: 'op-proposer-stall'

[Act]
  Step 1: check_eoa_balance(proposer)
    → l1Client.getBalance(proposerEOA) = 0.8 ETH ✓ (> CRITICAL 0.1)
  Step 2: check_l1_gas_price
    → 30 gwei ✓ (NORMAL)
  Step 3: collect_logs(op-proposer)
    → kubectl logs sepolia-thanos-stack-op-proposer-0 --tail=100
    → Found: "nonce too low, resetting...", "failed to send output transaction"
  Step 4: restart_pod(op-proposer)
    → kubectl delete pod sepolia-thanos-stack-op-proposer-0 --grace-period=60
    → Pod restarted ✓
  Step 5: wait 5 minutes
  Step 6: verify_next_submission
    → latestOutputIndex() = 1235 (increased!) ✓
    → getL2Output(1235) = {l2BlockNumber: 6200000}
    → New output submitted ✓

[Log] Output root submission resumed: proposer restarted, new output at index 1235
[Alert] Slack: "✅ op-proposer stall resolved. Output root #1235 submitted."
```

**Scenario: Proposer balance insufficient (F1 linked)**

```
[Observe] outputRootLag = 4000 blocks (> WARNING 3600)

[Act]
  Step 1: check_eoa_balance(proposer)
    → 0.05 ETH ✗ (< CRITICAL 0.1)
    → Trigger Proposal 9 refill!
  Step 2: (F1 auto-refill executes)
    → Treasury → Proposer: 1.0 ETH sent
  Step 3: wait for proposer to auto-resume submission
  Step 4: verify_next_submission (5min)
    → latestOutputIndex increased ✓

[Log] Output root stall caused by low proposer balance (0.05 ETH).
  Auto-refilled to 1.05 ETH. Submissions resumed.
```

---

## 4. Implementation Specification

### 4.1 `src/lib/output-root-monitor.ts` (~250 LOC)

```typescript
/**
 * Output Root Submission Monitor
 * Track L2OutputOracle contract state and detect submission lag
 */

import { createPublicClient, http, getContract } from 'viem';
import { sepolia } from 'viem/chains';
import type { OutputRootStatus, SubmissionLag } from '@/types/output-root';

// === L2OutputOracle ABI (minimal) ===

const L2_OUTPUT_ORACLE_ABI = [
  {
    name: 'latestOutputIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getL2Output',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '_l2OutputIndex', type: 'uint256' }],
    outputs: [
      { name: 'outputRoot', type: 'bytes32' },
      { name: 'timestamp', type: 'uint128' },
      { name: 'l2BlockNumber', type: 'uint128' },
    ],
  },
  {
    name: 'SUBMISSION_INTERVAL',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

// === State ===

let lastCheckTime = 0;
let cachedSubmissionInterval: number | null = null;

// === Public API ===

/** Read latest output root status from L1 contract */
export async function getOutputRootStatus(
  l1RpcUrl: string,
  oracleAddress: string,
  currentL2Block: number
): Promise<OutputRootStatus>;

/** Calculate submission lag */
export function calculateSubmissionLag(
  currentL2Block: number,
  lastOutputL2Block: number,
  submissionInterval: number
): SubmissionLag;

/** Check if output root monitor should run (5-min interval) */
export function shouldCheck(): boolean;
```

**Core logic: `getOutputRootStatus()`**

```
1. Create viem publicClient for L1
2. getContract({address: oracleAddress, abi: L2_OUTPUT_ORACLE_ABI, client})
3. Promise.all([
     contract.read.latestOutputIndex(),
     contract.read.SUBMISSION_INTERVAL(),
   ])
4. contract.read.getL2Output([latestIndex])
5. Calculate lag = currentL2Block - lastOutputL2Block
6. Calculate timeSinceSubmission = now - lastSubmissionTimestamp
7. Return OutputRootStatus with lag, level, expected next submission time
```

---

## 5. Playbook definition

### 5.1 Playbook: `op-proposer-stall`

```yaml
name: op-proposer-stall
description: Output root submission delayed beyond critical threshold
trigger:
  component: op-proposer
  indicators:
    - type: metric
      condition: outputRootLag > SUBMISSION_INTERVAL * 3
actions:
  - type: check_eoa_balance        # Safe — check proposer balance (F1 synergy)
    safetyLevel: safe
    target: op-proposer
    params:
      role: proposer
  - type: check_l1_gas_price        # Safe — check L1 gas (F3 synergy)
    safetyLevel: safe
  - type: collect_logs              # Safe — get proposer logs
    safetyLevel: safe
    target: op-proposer
  - type: restart_pod               # Guarded — restart if balance OK & gas OK
    safetyLevel: guarded
    target: op-proposer
    waitAfterMs: 300000             # 5 min for new submission
  - type: verify_next_submission    # Safe — check new output root
    safetyLevel: safe
fallback:
  - type: escalate_operator
    safetyLevel: safe
    params:
      message: "Output root submission stall. Challenge window may be affected."
maxAttempts: 1
```

---

## 6. Safety device

### 6.1 Contract compatibility

| version | Contract | Note |
|------|----------|------|
| **Bedrock** | `L2OutputOracle` | Current Implementation Target |
| **Fault Proof (future)** | `DisputeGameFactory` | ABI change required → Mode switching with environment variables |

```typescript
// Fault Proof mode can be supported in the future
const CONTRACT_MODE = process.env.OUTPUT_ROOT_CONTRACT_MODE || 'bedrock';
// 'bedrock' → L2OutputOracle
// 'fault-proof' → DisputeGameFactory (미구현, placeholder)
```

### 6.2 Proposer restart safety

| danger | Response |
|------|------|
| Pending output tx conflict | Check proposer's pending tx before restarting (`eth_getTransactionCount pending vs latest`) |
| Submit duplicate output | L2OutputOracle itself rejects duplicates (contract-level safety) |
| Nonce conflict | automatically resynchronize nonce when proposer restarts |

### 6.3 Check interval

- Contract read every 5 minutes (reduces L1 RPC call costs)
- `SUBMISSION_INTERVAL` is cached (changes very rarely)
- When anomaly occurs, switch to 1 minute interval from the next cycle (check for quick recovery)

### 6.4 Absolutely prohibited things

- **Output root calculation**: The system does not directly calculate or submit the output root.
- **Contract Write**: Do not send transaction to L2OutputOracle.
- **Proposer settings change**: Do not change the submission interval of the op-proposer

---

## 7. Environment variables

| variable | default | Description |
|------|--------|------|
| `L2_OUTPUT_ORACLE_ADDRESS` | — | L2OutputOracle contract address on L1 (required) |
| `OUTPUT_ROOT_CHECK_INTERVAL` | `300` | Check interval in seconds (default 5min) |
| `OUTPUT_ROOT_LAG_WARNING_MULTIPLIER` | `2` | Warning: lag > SUBMISSION_INTERVAL * N |
| `OUTPUT_ROOT_LAG_CRITICAL_MULTIPLIER` | `3` | Critical: lag > SUBMISSION_INTERVAL * N |
| `OUTPUT_ROOT_CONTRACT_MODE` | `bedrock` | Contract mode: bedrock or fault-proof |

**Reuse of existing environment variables:**
- `L1_RPC_URL` → L1 contract read
- `PROPOSER_EOA_ADDRESS` → propose balance check (Proposal 9 연동)

---

## 8. Type definition

### 8.1 `src/types/output-root.ts` (~70 LOC)

```typescript
/**
 * Output Root Monitoring Types
 */

export type OutputLagLevel = 'normal' | 'warning' | 'critical';

export interface OutputRootInfo {
  outputRoot: string;          // bytes32 hex
  l2BlockNumber: number;
  timestamp: number;           // Unix timestamp
  outputIndex: number;
}

export interface SubmissionLag {
  lagBlocks: number;            // currentL2 - lastOutputL2
  lagMultiplier: number;        // lagBlocks / SUBMISSION_INTERVAL
  level: OutputLagLevel;
  timeSinceSubmission: number;  // seconds since last submission
  expectedNextAt: number;       // expected next submission timestamp
}

export interface OutputRootStatus {
  latestOutput: OutputRootInfo;
  submissionInterval: number;   // L2 blocks between submissions
  currentL2Block: number;
  lag: SubmissionLag;
  timestamp: string;
}
```

---

## 9. Modify existing modules

### 9.1 `src/lib/agent-loop.ts`

Add output root check every 5 minutes:

```typescript
// Track last check time
let lastOutputRootCheck = 0;
const OUTPUT_ROOT_INTERVAL = Number(process.env.OUTPUT_ROOT_CHECK_INTERVAL || '300') * 1000;

// In runAgentCycle(), after scaling evaluation:
const oracleAddress = process.env.L2_OUTPUT_ORACLE_ADDRESS;
if (oracleAddress && Date.now() - lastOutputRootCheck > OUTPUT_ROOT_INTERVAL) {
  const status = await getOutputRootStatus(l1RpcUrl, oracleAddress, dataPoint.blockHeight);
  lastOutputRootCheck = Date.now();
  // Generate anomaly if lag is critical
}
```

### 9.2 `src/types/anomaly.ts`

```typescript
export type AnomalyMetric =
  // ... existing
  | 'outputRootLag';  // NEW
```

### 9.3 `src/lib/anomaly-detector.ts`

```typescript
function detectOutputRootDelay(
  lagBlocks: number,
  submissionInterval: number,
  warningMultiplier: number,
  criticalMultiplier: number
): AnomalyResult | null {
  if (lagBlocks > submissionInterval * criticalMultiplier) {
    return { isAnomaly: true, metric: 'outputRootLag', value: lagBlocks,
      zScore: 0, direction: 'spike', rule: 'threshold-breach',
      description: `Output root lag: ${lagBlocks} blocks (critical > ${submissionInterval * criticalMultiplier})` };
  }
  return null;
}
```

### 9.4 `src/lib/playbook-matcher.ts`

Added `op-proposer-stall` to `PLAYBOOKS[]` + outputRootLag condition to `matchesMetricCondition()`.

### 9.5 `src/lib/action-executor.ts`

Add `verify_next_submission` action:

```typescript
case 'verify_next_submission':
  // Re-read L2OutputOracle.latestOutputIndex()
  // Compare with previous value
  // Return success if increased
  return await executeVerifyNextSubmission(action);
```

### 9.6 `src/types/remediation.ts`

```typescript
export type RemediationActionType =
  // ... existing
  | 'verify_next_submission';  // NEW
```

### 9.7 Cross-feature integration

```
Proposal 9 (EOA Balance):
→ outputRootLag > Check proposer balance when WARNING
→ Automatic recharge trigger if balance is insufficient

Proposal 11 (Gas Monitor):
→ outputRootLag > Check L1 gas price when WARNING
→ If gas surges, wait for gas to stabilize (hold off proposer restart)

RCA Engine (existing):
→ op-proposer → l1 dependency already defined
→ Automatically included in RCA when outputRootLag anomaly occurs
```

---

## 10. Test plan

### 10.1 Unit tests (`output-root-monitor.test.ts`)

| # | test | verification |
|---|--------|------|
| 1 | Contract ABI parsing | Parsing L2OutputOracle response |
| 2 | Lag calculation | currentL2 - lastOutputL2 exact calculation |
| 3 | Lag level classification | WARNING/CRITICAL Judgment by section |
| 4 | Check interval enforcement | Observe 5-minute intervals |
| 5 | SUBMISSION_INTERVAL caching | Check caching operation |
| 6 | Contract read failure | graceful fallback (anomaly 미생성) |
| 7 | Time-based detection | timeSinceSubmission based anomaly detection |

### 10.2 Integration test scenario

```
Scenario 1: lag 5500 blocks + proposer balance OK + gas OK → restart proposer → check new output
Scenario 2: lag 4000 blocks + proposer balance 0.05 ETH → F1 auto-refill → automatic recovery
Scenario 3: lag 6000 blocks + L1 gas 250 gwei → wait for gas to stabilize → restart proposer after gas normalization
Scenario 4: L2OutputOracle address not set → monitor skip (graceful)
Scenario 5: Contract read failure → Use previous caching data or skip
```

---

## Dependencies

```
New modules:
  ├── src/lib/output-root-monitor.ts
  └── src/types/output-root.ts

Modification module:
├── src/lib/agent-loop.ts → Add output root check every 5 minutes
├── src/lib/anomaly-detector.ts    → detectOutputRootDelay() 추가
├── src/lib/playbook-matcher.ts → Add op-proposer-stall playbook
├── src/lib/action-executor.ts → Add verify_next_submission action
├── src/types/anomaly.ts           → AnomalyMetric 확장
└── src/types/remediation.ts       → RemediationActionType 확장

Cross-feature dependency:
├── Proposal 9 (EOA Balance) → Check proposer balance and automatically recharge
└── Proposal 11 (Gas Monitor) → Check L1 gas price

Dependent libraries:
└── viem (already installed) → getContract, readContract
```
