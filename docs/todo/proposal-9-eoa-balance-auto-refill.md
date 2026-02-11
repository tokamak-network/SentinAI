# Proposal 9: EOA Balance Auto-Refill — Batcher/Proposer 잔액 자동 충전

> **작성일**: 2026-02-11
> **선행 조건**: Proposal 2 (Anomaly Detection), Proposal 8 (Auto-Remediation) 구현 완료
> **목적**: op-batcher / op-proposer EOA의 L1 잔액 고갈을 사전 감지하여 자동 충전, 롤업 지연 방지

---

## 목차

1. [개요](#1-개요)
2. [아키텍처](#2-아키텍처)
3. [Agent Act — 자동 실행 액션](#3-agent-act--자동-실행-액션)
4. [구현 명세](#4-구현-명세)
5. [Playbook 정의](#5-playbook-정의)
6. [안전장치](#6-안전장치)
7. [환경 변수](#7-환경-변수)
8. [타입 정의](#8-타입-정의)
9. [기존 모듈 수정](#9-기존-모듈-수정)
10. [테스트 계획](#10-테스트-계획)

---

## 1. 개요

### 1.1 문제

op-batcher와 op-proposer는 L1에 트랜잭션을 제출할 때 ETH 가스비를 소모한다. 잔액이 고갈되면:

| 컴포넌트 | 영향 | 증상 |
|---------|------|------|
| **op-batcher** | 배치 제출 중단 | txpool 단조 증가, data availability 지연 |
| **op-proposer** | output root 제출 중단 | L2→L1 출금 finality 지연, challenge period 미시작 |

현재 시스템은 `txPoolPending monotonic increase`를 탐지할 수 있지만:
- 근본 원인이 **잔액 부족**인지 판별하지 못함
- 잔액이 고갈되기 **전에 선제 대응**할 수 없음
- 운영자가 수동으로 MetaMask/CLI를 사용해 ETH를 전송해야 함

### 1.2 목표

1. Agent Loop에서 30초마다 batcher/proposer EOA 잔액을 모니터링
2. 임계값 이하로 떨어지면 Treasury 지갑에서 자동 충전
3. 충전 실패 또는 Treasury 고갈 시 운영자 에스컬레이션

### 1.3 핵심 원칙

- **선제 대응**: 잔액이 완전히 바닥나기 전에 WARNING 단계에서 알림
- **안전한 자동화**: 충전 한도(1회/일일), cooldown, gas price guard
- **Graceful Degradation**: TREASURY_PRIVATE_KEY 미설정 시 알림 전용 모드

---

## 2. 아키텍처

### 2.1 데이터 플로우

```
Agent Loop (30s)
  │
  ├── Observe ──────────────────────────────────────────────
  │   l1Client.getBalance(batcherEOA)    → batcherBalance
  │   l1Client.getBalance(proposerEOA)   → proposerBalance
  │   l1Client.getBalance(treasuryEOA)   → treasuryBalance (충전 가능 여부)
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
        └── [Safe] escalate_operator (실패 시)
```

### 2.2 모드별 동작

| 모드 | 조건 | 동작 |
|------|------|------|
| **Full Auto** | `TREASURY_PRIVATE_KEY` 설정 + `SCALING_SIMULATION_MODE=false` | 감지 → 충전 tx 실행 → 확인 |
| **Notification Only** | `TREASURY_PRIVATE_KEY` 미설정 | 감지 → 알림만 (Slack/Dashboard) |
| **Simulation** | `SCALING_SIMULATION_MODE=true` | 감지 → 로그 기록 (tx 미실행) |

---

## 3. Agent Act — 자동 실행 액션

### 3.1 액션 테이블

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_treasury_balance` | Safe | balance < CRITICAL | Treasury 지갑의 L1 잔액을 조회하여 충전 가능 여부 확인 |
| 2 | `check_l1_gas_price` | Safe | balance < CRITICAL | 현재 L1 gas price 확인. 과도하면 충전 유보 |
| 3 | `refill_eoa` | **Guarded** | balance < CRITICAL & treasury OK & gas OK | viem walletClient로 Treasury → Target EOA ETH 전송 tx 서명 & broadcast |
| 4 | `verify_balance_restored` | Safe | refill tx confirmed | Target EOA 잔액 재조회, 임계값 이상 복구 확인 |
| 5 | `escalate_operator` | Safe | EMERGENCY / treasury empty / refill failed | Slack/Webhook으로 운영자 긴급 알림 |

### 3.2 실행 흐름 예시

**시나리오: Batcher 잔액 = 0.08 ETH (< CRITICAL 0.1)**

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

**시나리오: Treasury 잔액 부족**

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

## 4. 구현 명세

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

**핵심 로직: `refillEOA()`**

```
1. Check TREASURY_PRIVATE_KEY exists → 없으면 {success: false, reason: 'no-signer'}
2. Check SCALING_SIMULATION_MODE → true면 로그만 기록
3. Check cooldown → lastRefillTime[target] + cooldownMs > now → skip
4. Check daily limit → dailyRefillTotal + amount > maxDailyRefillEth → skip
5. Check treasury balance → < minTreasuryBalanceEth → skip + escalate
6. Check L1 gas price → > gasGuardGwei → skip (gas too high)
7. Create walletClient with treasury account
8. sendTransaction({to: target, value: parseEther(amount)})
9. waitForTransactionReceipt (timeout: 60s)
10. Verify target balance increased
11. Update state: lastRefillTime, dailyRefillTotal, lastNonce
12. Return {success: true, txHash, previousBalance, newBalance}
```

### 4.2 `src/app/api/eoa-balance/route.ts` (~80 LOC)

```typescript
// GET: Return current balance status
// POST: Trigger manual refill (body: {target: 'batcher' | 'proposer'})
```

---

## 5. Playbook 정의

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

## 6. 안전장치

### 6.1 충전 제한

| 제한 | 값 | 설명 |
|------|---|------|
| 1회 충전 상한 | 1.0 ETH | `EOA_REFILL_AMOUNT_ETH` |
| 일일 충전 상한 | 5.0 ETH | `EOA_REFILL_MAX_DAILY_ETH` (batcher + proposer 합산) |
| Cooldown | 10분 | 동일 EOA에 대한 연속 충전 간격 |
| Gas Guard | 100 gwei | L1 gas price가 이 이상이면 충전 유보 |
| Treasury 최소 잔액 | 1.0 ETH | Treasury 자체 잔액이 이 이하면 충전 거부 |

### 6.2 Nonce 관리

```typescript
// 동시 충전 방지: nonce를 명시적으로 관리
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

### 6.3 Transaction 확인

```typescript
// Tx broadcast 후 반드시 receipt 대기
const receipt = await l1Client.waitForTransactionReceipt({
  hash,
  timeout: 60_000, // 60초 타임아웃
  confirmations: 1,
});

if (receipt.status === 'reverted') {
  // Revert 시 실패 처리 + 에스컬레이션
}
```

### 6.4 Private Key 보호

- `TREASURY_PRIVATE_KEY`는 `.env.local`에만 저장 (`.gitignore`에 포함됨)
- 키 미설정 시 자동으로 Notification Only 모드로 전환
- 로그에 private key 출력 금지 (address만 로깅)

---

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `BATCHER_EOA_ADDRESS` | — | Batcher EOA address on L1 (required) |
| `PROPOSER_EOA_ADDRESS` | — | Proposer EOA address on L1 (required) |
| `TREASURY_PRIVATE_KEY` | — | Treasury wallet private key (optional, notification-only if unset) |
| `EOA_BALANCE_WARNING_ETH` | `0.5` | Warning threshold in ETH |
| `EOA_BALANCE_CRITICAL_ETH` | `0.1` | Critical threshold (triggers refill) |
| `EOA_BALANCE_EMERGENCY_ETH` | `0.01` | Emergency threshold (immediate escalation) |
| `EOA_REFILL_AMOUNT_ETH` | `1.0` | ETH amount per refill transaction |
| `EOA_REFILL_MAX_DAILY_ETH` | `5.0` | Maximum daily refill total |
| `EOA_REFILL_COOLDOWN_MIN` | `10` | Cooldown between refills (minutes) |
| `EOA_GAS_GUARD_GWEI` | `100` | Max L1 gas price for refill (gwei) |

**기존 환경변수 재사용:**
- `L1_RPC_URL` → L1 잔액 조회 및 tx broadcast
- `SCALING_SIMULATION_MODE` → true일 때 tx 미실행
- `ALERT_WEBHOOK_URL` → 잔액 알림 전송

---

## 8. 타입 정의

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

## 9. 기존 모듈 수정

### 9.1 `src/lib/agent-loop.ts`

`collectMetrics()` 함수에 EOA 잔액 조회 추가:

```typescript
// Line 93: Promise.all에 잔액 조회 추가
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

`AnomalyMetric` 타입에 잔액 메트릭 추가:

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

새 detection rule 추가:

```typescript
// 절대 임계값 기반 잔액 감지 (Z-Score 아님)
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
  // WARNING은 anomaly가 아닌 dashboard alert로 처리
  return null;
}
```

### 9.4 `src/lib/playbook-matcher.ts`

`PLAYBOOKS[]` 배열에 2개 플레이북 추가 + `matchesMetricCondition()`에 잔액 조건 추가.

### 9.5 `src/lib/action-executor.ts`

`executeAction()` switch문에 새 액션 추가:

```typescript
case 'refill_eoa':
  return await executeRefillEOA(action);
case 'check_treasury_balance':
  return await executeCheckTreasuryBalance();
case 'verify_balance_restored':
  return await executeVerifyBalanceRestored(action);
```

### 9.6 `src/types/remediation.ts`

`RemediationActionType`에 새 액션 추가:

```typescript
export type RemediationActionType =
  // ... existing
  | 'refill_eoa'
  | 'check_treasury_balance'
  | 'verify_balance_restored';
```

---

## 10. 테스트 계획

### 10.1 유닛 테스트 (`eoa-balance-monitor.test.ts`)

| # | 테스트 | 검증 |
|---|--------|------|
| 1 | Balance threshold detection | WARNING/CRITICAL/EMERGENCY 구간별 정확한 anomaly 생성 |
| 2 | Refill execution (simulation) | SCALING_SIMULATION_MODE=true일 때 tx 미실행, 로그만 기록 |
| 3 | Cooldown enforcement | 10분 이내 재충전 시 거부 |
| 4 | Daily limit enforcement | 일일 5 ETH 초과 시 거부 |
| 5 | Gas guard | L1 gas > 100 gwei일 때 충전 유보 |
| 6 | Treasury protection | Treasury 잔액 < 1.0 ETH일 때 충전 거부 |
| 7 | No signer fallback | TREASURY_PRIVATE_KEY 미설정 시 알림 전용 모드 |
| 8 | Nonce management | 연속 충전 시 nonce 순차 증가 |
| 9 | Tx receipt verification | Reverted tx 처리 |
| 10 | Daily counter reset | 날짜 변경 시 카운터 초기화 |

### 10.2 통합 테스트 시나리오

```
시나리오 1: Batcher 잔액 0.08 ETH → auto-refill → 1.08 ETH 확인
시나리오 2: Proposer 잔액 0.005 ETH → EMERGENCY → 운영자 알림 (refill skip)
시나리오 3: Treasury 잔액 부족 → refill 거부 → 운영자 알림
시나리오 4: L1 gas 150 gwei → refill 유보 → gas 30 gwei로 하락 → refill 실행
시나리오 5: 일일 한도 도달 → 추가 refill 거부 → 다음 날 카운터 리셋
```

---

## 의존관계

```
신규 모듈:
  ├── src/lib/eoa-balance-monitor.ts
  ├── src/types/eoa-balance.ts
  └── src/app/api/eoa-balance/route.ts

수정 모듈:
  ├── src/lib/agent-loop.ts          → collectMetrics()에 getBalance 추가
  ├── src/lib/anomaly-detector.ts    → detectBalanceThreshold() 추가
  ├── src/lib/playbook-matcher.ts    → 2개 플레이북 추가
  ├── src/lib/action-executor.ts     → 3개 액션 추가
  ├── src/types/anomaly.ts           → AnomalyMetric 확장
  └── src/types/remediation.ts       → RemediationActionType 확장

의존 라이브러리:
  └── viem (이미 설치됨) → createWalletClient, privateKeyToAccount
```
