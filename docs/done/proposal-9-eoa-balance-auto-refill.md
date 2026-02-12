# Proposal 9: EOA Balance Auto-Refill — Automatic Batcher/Proposer Balance Refill

> **Created**: 2026-02-11
> **Prerequisites**: Proposal 2 (Anomaly Detection), Proposal 8 (Auto-Remediation) implementation completed
> **Objective**: Proactively detect L1 balance depletion for op-batcher/op-proposer EOAs and automatically refill to prevent rollup submission delays

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Agent Act — Automatic Execution Actions](#3-agent-act--automatic-execution-actions)
4. [Implementation Specification](#4-implementation-specification)
5. [Playbook Definition](#5-playbook-definition)
6. [Safety Mechanisms](#6-safety-mechanisms)
7. [Environment Variables](#7-environment-variables)
8. [Type Definitions](#8-type-definitions)
9. [Existing Module Modifications](#9-existing-module-modifications)
10. [Testing Plan](#10-testing-plan)

---

## 1. Overview

### 1.1 Problem

op-batcher and op-proposer consume ETH gas fees when submitting transactions to L1. When balance is depleted:

| Component | Impact | Symptoms |
|-----------|--------|----------|
| **op-batcher** | Batch submission halted | txpool monotonic increase, data availability delay |
| **op-proposer** | Output root submission halted | L2→L1 withdrawal finality delay, challenge period not initiated |

The current system can detect `txPoolPending monotonic increase` but:
- Cannot determine if the root cause is **insufficient balance**
- Cannot take **proactive action before balance completely depletes**
- Operators must manually transfer ETH via MetaMask/CLI

### 1.2 Objectives

1. Monitor batcher/proposer EOA balance every 30 seconds in Agent Loop
2. Automatically refill from Treasury wallet when balance falls below threshold
3. Escalate to operator if refill fails or Treasury balance is depleted

### 1.3 Core Principles

- **Proactive Response**: Alert at WARNING stage before balance completely runs out
- **Safe Automation**: Refill limits (daily), cooldown, gas price guard
- **Graceful Degradation**: Notification-only mode when TREASURY_PRIVATE_KEY is not set

---

## 2. Architecture

### 2.1 Data Flow

```
Agent Loop (30s)
  │
  ├── Observe ──────────────────────────────────────────────
  │   l1Client.getBalance(batcherEOA)    → batcherBalance
  │   l1Client.getBalance(proposerEOA)   → proposerBalance
  │   l1Client.getBalance(treasuryEOA)   → treasuryBalance (refill eligibility)
  │
  ├── Detect ──────────────────────────────────────────────
  │   eoa-balance-monitor.ts
  │     ├── balance < WARNING (0.5 ETH)  → anomaly (severity: medium)
  │     ├── balance < CRITICAL (0.1 ETH) → anomaly (severity: high)
  │     └── balance < EMERGENCY (0.01 ETH) → anomaly (severity: critical)
  │
  ├── Decide ──────────────────────────────────────────────
  │   playbook-matcher.ts
  │     └── match: 'eoa-balance-critical' playbook
  │
  └── Act ─────────────────────────────────────────────────
      action-executor.ts
        ├── [Safe] check_treasury_balance
        ├── [Safe] check_l1_gas_price
        ├── [Guarded] refill_eoa → viem walletClient.sendTransaction()
        ├── [Safe] verify_balance_restored
        └── [Safe] escalate_operator (on failure)
```

### 2.2 Mode-Specific Behavior

| Mode | Condition | Behavior |
|------|-----------|----------|
| **Full Auto** | `TREASURY_PRIVATE_KEY` set + `SCALING_SIMULATION_MODE=false` | Detect → Execute refill tx → Verify |
| **Notification Only** | `TREASURY_PRIVATE_KEY` not set | Detect → Alert only (Slack/Dashboard) |
| **Simulation** | `SCALING_SIMULATION_MODE=true` | Detect → Log (tx not executed) |

---

## 3. Agent Act — Automatic Execution Actions

### 3.1 Action Table

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_treasury_balance` | Safe | balance < CRITICAL | Query Treasury wallet L1 balance to determine refill eligibility |
| 2 | `check_l1_gas_price` | Safe | balance < CRITICAL | Check current L1 gas price. Hold if excessive |
| 3 | `refill_eoa` | **Guarded** | balance < CRITICAL & treasury OK & gas OK | Sign and broadcast ETH transfer tx from Treasury → Target EOA via viem walletClient |
| 4 | `verify_balance_restored` | Safe | refill tx confirmed | Requery Target EOA balance, confirm recovery above threshold |
| 5 | `escalate_operator` | Safe | EMERGENCY / treasury empty / refill failed | Send urgent operator alert via Slack/Webhook |

### 3.2 Execution Flow Example

**Scenario: Batcher balance = 0.08 ETH (< CRITICAL 0.1)**

```
[Observe] l1Client.getBalance(batcherEOA) = 0.08 ETH
[Detect]  anomaly: {metric: 'batcherBalance', value: 0.08, direction: 'drop',
           rule: 'threshold-breach', description: 'Batcher EOA balance below critical (0.1 ETH)'}
[Decide]  playbook matched: 'eoa-balance-critical' (component: op-batcher)
[Act]
  Step 1: check_treasury_balance
    → l1Client.getBalance(treasury) = 3.2 ETH ✓ (> minTreasuryBalance 1.0 ETH)
  Step 2: check_l1_gas_price
    → l1Client.getGasPrice() = 25 gwei ✓ (< gasGuardGwei 100)
  Step 3: refill_eoa
    → walletClient.sendTransaction({to: batcherEOA, value: parseEther('1.0')})
    → tx hash: 0xabc123...
    → waitForTransactionReceipt() → confirmed (block 12345678)
  Step 4: verify_balance_restored
    → l1Client.getBalance(batcherEOA) = 1.08 ETH ✓ (> CRITICAL 0.1)
[Log] EOA refill completed: batcher 0.08 → 1.08 ETH (tx: 0xabc123, gas: 21000)
[Alert] Slack: "✅ Batcher EOA auto-refilled: 0.08 → 1.08 ETH"
```

**Scenario: Treasury balance insufficient**

```
[Observe] l1Client.getBalance(batcherEOA) = 0.05 ETH
[Act]
  Step 1: check_treasury_balance
    → l1Client.getBalance(treasury) = 0.3 ETH ✗ (< minTreasuryBalance 1.0 ETH)
  Step 5: escalate_operator
    → Slack: "🚨 Batcher EOA critically low (0.05 ETH) AND Treasury insufficient (0.3 ETH).
       Manual refill required immediately."
```

---

## 4. Implementation Specification

### 4.1 `src/lib/eoa-balance-monitor.ts` (~200 LOC)

```typescript
/**
 * EOA Balance Monitor
 * Monitor batcher/proposer L1 ETH balance and trigger auto-refill
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import type { EOABalanceConfig, BalanceCheckResult, RefillResult } from '@/types/eoa-balance';

// === Configuration ===

const DEFAULT_CONFIG: EOABalanceConfig = {
  warningThresholdEth: 0.5,
  criticalThresholdEth: 0.1,
  emergencyThresholdEth: 0.01,
  refillAmountEth: 1.0,
  maxDailyRefillEth: 5.0,
  cooldownMs: 10 * 60 * 1000, // 10 minutes
  gasGuardGwei: 100,
  minTreasuryBalanceEth: 1.0,
};

// === State ===

let dailyRefillTotal = 0;
let dailyResetDate = new Date().toDateString();
let lastRefillTime: Record<string, number> = {}; // address -> timestamp
let lastNonce: number | null = null;

// === Public API ===

/** Check balance of a target EOA against thresholds */
export async function checkBalance(
  l1RpcUrl: string,
  targetAddress: string,
  config?: Partial<EOABalanceConfig>
): Promise<BalanceCheckResult>;

/** Execute refill transaction from treasury to target */
export async function refillEOA(
  l1RpcUrl: string,
  targetAddress: string,
  config?: Partial<EOABalanceConfig>
): Promise<RefillResult>;

/** Get current balance status for all monitored EOAs */
export async function getAllBalanceStatus(
  l1RpcUrl: string
): Promise<BalanceCheckResult[]>;

/** Check if refill is possible (treasury balance, gas price, cooldown, daily limit) */
export async function canRefill(
  l1RpcUrl: string,
  targetAddress: string,
  config?: Partial<EOABalanceConfig>
): Promise<{ allowed: boolean; reason?: string }>;

/** Reset daily refill counter (called at midnight or on date change) */
export function resetDailyCounter(): void;
```

**Core Logic: `refillEOA()`**

```
1. Check TREASURY_PRIVATE_KEY exists → if not, return {success: false, reason: 'no-signer'}
2. Check SCALING_SIMULATION_MODE → if true, log only
3. Check cooldown → if lastRefillTime[target] + cooldownMs > now, skip
4. Check daily limit → if dailyRefillTotal + amount > maxDailyRefillEth, skip
5. Check treasury balance → if < minTreasuryBalanceEth, skip + escalate
6. Check L1 gas price → if > gasGuardGwei, skip (gas too high)
7. Create walletClient with treasury account
8. sendTransaction({to: target, value: parseEther(amount)})
9. waitForTransactionReceipt (timeout: 60s)
10. Verify target balance increased
11. Update state: lastRefillTime, dailyRefillTotal, lastNonce
12. Return {success: true, txHash, previousBalance, newBalance}
```

### 4.2 `src/lib/eoa-balance-monitor.ts` - Integration with Auto-Detection

Update `getAllBalanceStatus()` to use auto-detection:

```typescript
export async function getAllBalanceStatus(
  l1RpcUrl?: string
): Promise<EOABalanceStatus> {
  // ... existing code ...

  // If not in env, attempt auto-detection from L1 transactions
  if (!batcherAddr || !proposerAddr) {
    try {
      const detectedBatcher = !batcherAddr
        ? await getEOAAddressWithAutoDetect('batcher', rpcUrl)
        : null;
      const detectedProposer = !proposerAddr
        ? await getEOAAddressWithAutoDetect('proposer', rpcUrl)
        : null;

      if (detectedBatcher) {
        batcherAddr = detectedBatcher;
        console.log(`[EOA Monitor] Auto-detected batcher: ${batcherAddr}`);
      }
      if (detectedProposer) {
        proposerAddr = detectedProposer;
        console.log(`[EOA Monitor] Auto-detected proposer: ${proposerAddr}`);
      }
    } catch (err) {
      console.warn('[EOA Monitor] Auto-detection failed, continuing with available addresses');
    }
  }

  // ... rest of implementation ...
}
```

### 4.3 `src/app/api/eoa-balance/route.ts` (~80 LOC)

```typescript
// GET: Return current balance status (auto-detects EOAs if not set)
// POST: Trigger manual refill (body: {target: 'batcher' | 'proposer'})
```

---

## 5. Playbook Definition

### 5.1 Playbook: `eoa-balance-critical`

```yaml
name: eoa-balance-critical
description: Batcher or proposer EOA balance below critical threshold
trigger:
  component: op-batcher | op-proposer
  indicators:
    - type: metric
      condition: batcherBalance < 0.1 OR proposerBalance < 0.1
actions:
  - type: check_treasury_balance
    safetyLevel: safe
  - type: check_l1_gas_price
    safetyLevel: safe
  - type: refill_eoa
    safetyLevel: guarded
    params:
      amount: 1.0  # ETH
    waitAfterMs: 30000  # Wait for tx confirmation
  - type: verify_balance_restored
    safetyLevel: safe
fallback:
  - type: escalate_operator
    safetyLevel: safe
    params:
      message: "EOA refill failed. Manual intervention required."
maxAttempts: 1
```

### 5.2 Playbook: `eoa-balance-emergency`

```yaml
name: eoa-balance-emergency
description: EOA balance critically low — immediate operator alert
trigger:
  component: op-batcher | op-proposer
  indicators:
    - type: metric
      condition: batcherBalance < 0.01 OR proposerBalance < 0.01
actions:
  - type: escalate_operator
    safetyLevel: safe
    params:
      urgency: critical
      message: "EOA balance near zero. Rollup submission will halt imminently."
maxAttempts: 0  # Immediate escalation, no auto-remediation attempt
```

---

## 6. Safety Mechanisms

### 6.1 Refill Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Per-refill cap | 1.0 ETH | `EOA_REFILL_AMOUNT_ETH` |
| Daily refill cap | 5.0 ETH | `EOA_REFILL_MAX_DAILY_ETH` (batcher + proposer combined) |
| Cooldown | 10 minutes | Interval between refills for same EOA |
| Gas Guard | 100 gwei | Hold refill if L1 gas price exceeds this |
| Treasury minimum balance | 1.0 ETH | Deny refill if Treasury balance falls below this |

### 6.2 Nonce Management

```typescript
// Prevent concurrent refills: manage nonce explicitly
const nonce = lastNonce !== null
  ? lastNonce + 1
  : await l1Client.getTransactionCount({ address: treasuryAddress });

const hash = await walletClient.sendTransaction({
  to: targetAddress,
  value: parseEther(amount),
  nonce,
});

lastNonce = nonce;
```

### 6.3 Transaction Verification

```typescript
// After tx broadcast, always wait for receipt
const receipt = await l1Client.waitForTransactionReceipt({
  hash,
  timeout: 60_000, // 60 second timeout
  confirmations: 1,
});

if (receipt.status === 'reverted') {
  // Handle revert: log failure + escalate
}
```

### 6.4 Private Key Protection

- `TREASURY_PRIVATE_KEY` stored only in `.env.local` (included in `.gitignore`)
- Auto-switch to Notification Only mode if key not set
- Never log private key (address only)

---

## 7. Environment Variables

### 7.1 Required/Optional EOA Addresses

| Variable | Default | Description |
|----------|---------|-------------|
| `BATCHER_EOA_ADDRESS` | auto-detect | Batcher EOA address on L1 (optional if auto-detect enabled) |
| `PROPOSER_EOA_ADDRESS` | auto-detect | Proposer EOA address on L1 (optional if auto-detect enabled) |
| `TREASURY_PRIVATE_KEY` | — | Treasury wallet private key (required for auto-refill, notification-only if unset) |

**Note:** If `BATCHER_EOA_ADDRESS`/`PROPOSER_EOA_ADDRESS` not set, system automatically detects them by analyzing L1 transactions:
- **Batcher**: Identified from transactions to `BatcherInbox` (0xFF00000000000000000000000000000000000054)
- **Proposer**: Identified from transactions to `L2OutputOracle` (varies by network)
- Detection scans recent 1000 blocks and requires live batcher/proposer activity
- Confidence: high (both detected) → medium (one detected) → low (auto-detection failed)

### 7.2 Balance Thresholds & Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `EOA_BALANCE_WARNING_ETH` | `0.5` | Warning threshold in ETH |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | Critical threshold (triggers refill) |
| `EOA_BALANCE_EMERGENCY_ETH` | `0.01` | Emergency threshold (immediate escalation) |
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | ETH amount per refill transaction |
| `EOA_REFILL_MAX_DAILY_ETH` | `5.0` | Maximum daily refill total |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | Cooldown between refills (minutes) |
| `EOA_GAS_GUARD_GWEI` | `100` | Max L1 gas price for refill (gwei) |
| `EOA_TREASURY_MIN_ETH` | `1.0` | Minimum Treasury balance before refill blocked |

**Reuse Existing Environment Variables:**
- `L1_RPC_URL` → L1 balance queries, tx broadcast, and EOA auto-detection
- `SCALING_SIMULATION_MODE` → Skip tx execution when true
- `ALERT_WEBHOOK_URL` → Send balance alerts

---

## 8. Type Definitions

### 8.1 `src/types/eoa-balance.ts` (~60 LOC)

```typescript
/**
 * EOA Balance Monitoring Types
 */

export type EOARole = 'batcher' | 'proposer';
export type BalanceLevel = 'normal' | 'warning' | 'critical' | 'emergency';

export interface EOABalanceConfig {
  warningThresholdEth: number;
  criticalThresholdEth: number;
  emergencyThresholdEth: number;
  refillAmountEth: number;
  maxDailyRefillEth: number;
  cooldownMs: number;
  gasGuardGwei: number;
  minTreasuryBalanceEth: number;
}

export interface BalanceCheckResult {
  address: string;
  role: EOARole;
  balanceEth: number;
  level: BalanceLevel;
  timestamp: string;
}

export interface RefillResult {
  success: boolean;
  txHash?: string;
  previousBalanceEth?: number;
  newBalanceEth?: number;
  refillAmountEth?: number;
  gasUsed?: bigint;
  reason?: string; // Failure reason: 'no-signer' | 'cooldown' | 'daily-limit' | 'treasury-low' | 'gas-high' | 'tx-reverted' | 'simulation'
}

export interface EOABalanceStatus {
  batcher: BalanceCheckResult | null;
  proposer: BalanceCheckResult | null;
  treasury: BalanceCheckResult | null;
  dailyRefillTotalEth: number;
  dailyRefillRemaining: number;
  signerAvailable: boolean;
}
```

---

## 9. Existing Module Modifications

### 9.0 New Module: `src/lib/eoa-detector.ts` (~300 LOC)

Auto-detect batcher/proposer EOAs from L1 transaction analysis:

```typescript
/**
 * Detect EOA addresses from L1 transaction patterns
 * - Batcher: identified from transactions to BatcherInbox (data availability)
 * - Proposer: identified from transactions to L2OutputOracle (state roots)
 */

export async function detectOrUseManualEOA(
  l1RpcUrl?: string,
  networkKey?: string
): Promise<DetectionResult>;

export async function getEOAAddressWithAutoDetect(
  role: EOARole,
  l1RpcUrl?: string
): Promise<`0x${string}` | null>;
```

**Implementation Details:**

1. **Batcher Detection**:
   - Scan L1 blocks for transactions to `BatcherInbox`
   - Look for calldata starting with 0x00 (frame opcode) with significant data
   - Extract sender address as batcher EOA

2. **Proposer Detection**:
   - Scan L1 blocks for transactions to `L2OutputOracle`
   - Match function selector 0x9c6de194 (proposeL2Output)
   - Extract sender address as proposer EOA

3. **Network Support**:
   - Optimism Mainnet (BatcherInbox: 0xFF00...0054, L2OutputOracle: 0xdfe9...)
   - Optimism Sepolia (BatcherInbox: 0xFF00...0054, L2OutputOracle: 0x90e9...)
   - Base Mainnet, Base Sepolia, and others via configuration
   - Defaults to Sepolia if network cannot be detected

4. **Priority & Fallback**:
   - Priority 1: Manual env vars (BATCHER_EOA_ADDRESS, PROPOSER_EOA_ADDRESS)
   - Priority 2: Auto-detect from recent L1 blocks (1000-block window)
   - Priority 3: Not detected (warn user to set manually)
   - Confidence scoring: high (both found) → medium (one) → low (none)

### 9.1 `src/lib/agent-loop.ts`

Add EOA balance queries to `collectMetrics()` function:

```typescript
// Line 93: Add balance queries to Promise.all
const batcherAddress = process.env.BATCHER_EOA_ADDRESS as `0x${string}` | undefined;
const proposerAddress = process.env.PROPOSER_EOA_ADDRESS as `0x${string}` | undefined;

const [block, l1BlockNumber, batcherBalance, proposerBalance] = await Promise.all([
  l2Client.getBlock({ blockTag: 'latest' }),
  l1Client.getBlockNumber(),
  batcherAddress ? l1Client.getBalance({ address: batcherAddress }) : Promise.resolve(null),
  proposerAddress ? l1Client.getBalance({ address: proposerAddress }) : Promise.resolve(null),
]);
```

### 9.2 `src/types/anomaly.ts`

Add balance metrics to `AnomalyMetric` type:

```typescript
export type AnomalyMetric =
  | 'cpuUsage'
  | 'txPoolPending'
  | 'gasUsedRatio'
  | 'l2BlockHeight'
  | 'l2BlockInterval'
  | 'batcherBalance'    // NEW
  | 'proposerBalance';  // NEW
```

### 9.3 `src/lib/anomaly-detector.ts`

Add new detection rule:

```typescript
// Absolute threshold-based balance detection (not Z-Score)
function detectBalanceThreshold(
  balanceEth: number,
  role: 'batcher' | 'proposer',
  config: EOABalanceConfig
): AnomalyResult | null {
  if (balanceEth < config.emergencyThresholdEth) {
    return { isAnomaly: true, metric: `${role}Balance`, value: balanceEth,
      zScore: 0, direction: 'drop', rule: 'threshold-breach',
      description: `${role} EOA balance emergency: ${balanceEth} ETH` };
  }
  if (balanceEth < config.criticalThresholdEth) {
    return { isAnomaly: true, metric: `${role}Balance`, value: balanceEth,
      zScore: 0, direction: 'drop', rule: 'threshold-breach',
      description: `${role} EOA balance critical: ${balanceEth} ETH` };
  }
  // WARNING handled as dashboard alert, not anomaly
  return null;
}
```

### 9.4 `src/lib/playbook-matcher.ts`

Add 2 playbooks to `PLAYBOOKS[]` array + add balance conditions to `matchesMetricCondition()`.

### 9.5 `src/lib/action-executor.ts`

Add new actions to `executeAction()` switch statement:

```typescript
case 'refill_eoa':
  return await executeRefillEOA(action);
case 'check_treasury_balance':
  return await executeCheckTreasuryBalance();
case 'verify_balance_restored':
  return await executeVerifyBalanceRestored(action);
```

### 9.6 `src/types/remediation.ts`

Add new actions to `RemediationActionType`:

```typescript
export type RemediationActionType =
  // ... existing
  | 'refill_eoa'
  | 'check_treasury_balance'
  | 'verify_balance_restored';
```

---

## 10. Testing Plan

### 10.1 Unit Tests - EOA Detector (`eoa-detector.test.ts`, 20+ tests)

| # | Test Category | Verification |
|---|---|---|
| 1 | Manual ENV - Both set | Return high-confidence results |
| 2 | Manual ENV - Only one set | Return not-detected, low confidence |
| 3 | Manual ENV - Invalid format | Reject and continue to auto-detection |
| 4 | Manual ENV - Checksum normalization | Normalize addresses to checksum |
| 5 | Auto-Detection - No RPC URL | Return not-detected with clear message |
| 6 | Auto-Detection - RPC failure | Handle gracefully, log error |
| 7 | Auto-Detection - L1 TX analysis | Scan for batcher/proposer transactions |
| 8 | Network detection | Recognize Optimism/Base mainnet and testnet |
| 9 | Confidence scoring | high (both) → medium (one) → low (none) |
| 10 | Contract address mapping | Use correct BatcherInbox/L2OutputOracle per network |

### 10.2 Unit Tests - EOA Balance Monitor (`eoa-balance-monitor.test.ts`)

| # | Test | Verification |
|---|------|--------------|
| 1 | Balance threshold detection | Accurate anomaly generation per WARNING/CRITICAL/EMERGENCY band |
| 2 | Refill execution (simulation) | Skip tx execution and log only when SCALING_SIMULATION_MODE=true |
| 3 | Cooldown enforcement | Deny refill within 10 minutes |
| 4 | Daily limit enforcement | Deny refill if daily 5 ETH exceeded |
| 5 | Gas guard | Hold refill if L1 gas > 100 gwei |
| 6 | Treasury protection | Deny refill if Treasury balance < 1.0 ETH |
| 7 | No signer fallback | Auto-switch to notification-only mode if TREASURY_PRIVATE_KEY unset |
| 8 | Nonce management | Sequential nonce increment on consecutive refills |
| 9 | Tx receipt verification | Handle reverted transactions |
| 10 | Daily counter reset | Counter reset on date change |
| 11 | EOA auto-detection | Fallback to auto-detection if env vars not set |

### 10.3 Integration Test Scenarios

```
Scenario 1: No env vars → auto-detect batcher/proposer from L1 → monitor balances
Scenario 2: Manual env vars set → use manual addresses (skip auto-detection)
Scenario 3: Batcher 0.08 ETH (< CRITICAL) → auto-refill → verify 1.08 ETH
Scenario 4: Proposer 0.005 ETH (< EMERGENCY) → EMERGENCY alert (no auto-refill)
Scenario 5: Treasury insufficient → deny refill → operator alert
Scenario 6: L1 gas 150 gwei → hold refill → gas drops → execute refill
Scenario 7: Daily limit reached → deny additional refill → next day resets
```

### 10.4 E2E Test Checklist

- [ ] Dev environment with no env vars: auto-detect batcher/proposer
- [ ] Dev environment with manual vars: use manual addresses
- [ ] Sepolia testnet: detect from BatcherInbox/L2OutputOracle transactions
- [ ] Mainnet simulation: verify contract addresses match docs.optimism.io
- [ ] Confidence scoring: high (both detected) vs low (failed)

---

## Dependencies

```
New Modules:
  ├── src/lib/eoa-detector.ts              ← NEW: Auto-detect EOAs from L1
  ├── src/lib/eoa-balance-monitor.ts
  ├── src/types/eoa-balance.ts
  └── src/app/api/eoa-balance/route.ts

Modified Modules:
  ├── src/lib/eoa-balance-monitor.ts     → Import & use getEOAAddressWithAutoDetect
  ├── src/lib/agent-loop.ts              → Add getBalance to collectMetrics()
  ├── src/lib/anomaly-detector.ts        → Add detectBalanceThreshold()
  ├── src/lib/playbook-matcher.ts        → Add 2 playbooks
  ├── src/lib/action-executor.ts         → Add 3 actions
  ├── src/types/anomaly.ts               → Extend AnomalyMetric
  └── src/types/remediation.ts           → Extend RemediationActionType

New Tests:
  ├── src/lib/__tests__/eoa-detector.test.ts    (~250 lines, 20+ tests)
  └── src/lib/__tests__/eoa-balance-monitor.test.ts (existing)

Dependent Libraries:
  ├── viem (already installed) → createWalletClient, privateKeyToAccount, createPublicClient
  └── viem (already installed) → getAddress, isAddress for address validation
```

### Optimism Contract Addresses

| Network | BatcherInbox | L2OutputOracle | Notes |
|---------|--------------|----------------|-------|
| **Optimism Mainnet** | 0xFF00000000000000000000000000000000000054 | 0xdfe97868233d1b6f5e00d8d181f0302b92b77018 | Production |
| **Optimism Sepolia** | 0xFF00000000000000000000000000000000000054 | 0x90e9c4f8a994a250f6aefd61cafb4f2e895ea02b | Testnet (default) |
| **Base Mainnet** | 0xFF00000000000000000000000000000000000054 | 0x56315b90c40730925ec5485cf004d835260518a7 | Superchain |
| **Base Sepolia** | 0xFF00000000000000000000000000000000000054 | 0x84457ca8fc6b7ae495687e9ebfa0250990f50efa | Testnet |

Source: https://docs.optimism.io/ (OP Stack specifications)
```
