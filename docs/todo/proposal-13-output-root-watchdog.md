# Proposal 13: Output Root Submission Watchdog — Output Root 제출 감시

> **작성일**: 2026-02-11
> **선행 조건**: Proposal 2 (Anomaly Detection) 구현 완료, Proposal 9 (EOA Balance) 권장
> **목적**: op-proposer의 L2 output root 제출을 감시하여 출금 finality 지연 및 bridge 운영 장애를 방지

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

op-proposer는 L2 상태 루트(output root)를 L1의 `L2OutputOracle` 컨트랙트에 주기적으로 제출한다. 이 제출이 지연되면:

| 영향 | 설명 |
|------|------|
| **출금 지연** | L2→L1 출금의 challenge period 시작이 늦어져 사용자 자금이 장기간 잠김 |
| **Bridge 장애** | Dispute window가 비정상 확장되어 bridge 운영에 문제 발생 |
| **Finality 손실** | L2 상태가 L1에 anchor되지 않아 보안 보장이 약화 |

현재 시스템의 한계:
- op-proposer를 **전혀 모니터링하지 않음** (로그 수집만)
- Output root 제출 상태를 추적하지 않음
- 제출 지연의 원인(잔액 부족, 가스 급등, proposer hang)을 구분하지 못함

### 1.2 목표

1. L1의 `L2OutputOracle` 컨트랙트를 읽어 최신 output root 제출 상태를 추적
2. 제출 지연(submission lag) 감지 및 원인 진단
3. Proposal 9 (EOA Balance) 및 Proposal 11 (Gas Monitor)과 연동하여 원인별 자동 대응

### 1.3 핵심 원칙

- **읽기 전용 모니터링**: L1 컨트랙트는 read-only call만 수행 (트랜잭션 미전송)
- **Cross-feature 연동**: 원인 진단에 F1(잔액), F3(가스)의 데이터를 활용
- **절대 금지**: "대체 output root 계산"이나 "output 트랜잭션 직접 제출"은 불가

---

## 2. 아키텍처

### 2.1 L2OutputOracle 컨트랙트 인터페이스

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

### 2.2 Output Root Lag 계산

```
outputRootLag = currentL2BlockHeight - lastOutputRootL2Block

예시:
  currentL2Block: 6,200,000
  lastOutputRootL2Block: 6,196,200  (SUBMISSION_INTERVAL = 1800 기준, 2번 밀림)
  outputRootLag: 3,800 blocks

  WARNING:  lag > SUBMISSION_INTERVAL * 2 = 3,600
  CRITICAL: lag > SUBMISSION_INTERVAL * 3 = 5,400
```

### 2.3 데이터 플로우

```
Agent Loop (5분 간격 — contract read 비용 절감)
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
  │   원인 진단:
  │     ├── Proposer EOA 잔액 부족? → F1 refill 트리거
  │     ├── L1 가스 급등? → F3 대기 전략
  │     └── Proposer hang? → pod 재시작
  │
  └── Act ─────────────────────────────────────────────────
      ├── [Safe] check_eoa_balance(proposer)
      ├── [Safe] check_l1_gas_price
      ├── [Safe] collect_logs(op-proposer)
      ├── [Guarded] restart_pod(op-proposer)
      ├── [Safe] verify_next_submission (5분 후)
      └── [Safe] escalate_operator
```

---

## 3. Agent Act — 자동 실행 액션

### 3.1 액션 테이블

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_eoa_balance` | Safe | lag > WARNING | proposer EOA 잔액 확인. 부족이면 Proposal 9의 refill 트리거 |
| 2 | `check_l1_gas_price` | Safe | lag > WARNING | L1 gas price 확인. 과도하면 gas 안정화 대기 |
| 3 | `collect_logs` | Safe | lag > WARNING | op-proposer 로그에서 실패 원인 확인 |
| 4 | `restart_pod` | **Guarded** | lag > CRITICAL & balance OK & gas OK | op-proposer pod 재시작 |
| 5 | `verify_next_submission` | Safe | restart 후 5min | L2OutputOracle 재조회하여 새 output root 제출 확인 |
| 6 | `escalate_operator` | Safe | lag > CRITICAL * 2 or restart 실패 | challenge window 임박, 운영자 긴급 알림 |

### 3.2 실행 흐름 예시

**시나리오: Output root lag = 5,500 blocks (> CRITICAL 5,400)**

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

**시나리오: Proposer 잔액 부족 (F1 연동)**

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

## 4. 구현 명세

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

**핵심 로직: `getOutputRootStatus()`**

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

## 5. Playbook 정의

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

## 6. 안전장치

### 6.1 Contract 호환성

| 버전 | Contract | 참고 |
|------|----------|------|
| **Bedrock** | `L2OutputOracle` | 현재 구현 대상 |
| **Fault Proof (향후)** | `DisputeGameFactory` | ABI 변경 필요 → 환경변수로 모드 전환 |

```typescript
// 향후 Fault Proof 모드 지원 가능
const CONTRACT_MODE = process.env.OUTPUT_ROOT_CONTRACT_MODE || 'bedrock';
// 'bedrock' → L2OutputOracle
// 'fault-proof' → DisputeGameFactory (미구현, placeholder)
```

### 6.2 Proposer 재시작 안전성

| 위험 | 대응 |
|------|------|
| Pending output tx 충돌 | 재시작 전 proposer의 pending tx 확인 (`eth_getTransactionCount pending vs latest`) |
| 중복 output 제출 | L2OutputOracle가 자체적으로 중복 거부 (contract-level safety) |
| Nonce 충돌 | proposer가 재시작 시 자동으로 nonce를 재동기화 |

### 6.3 Check 간격

- Contract read는 5분 간격 (L1 RPC 호출 비용 절감)
- `SUBMISSION_INTERVAL`은 캐싱 (변경 빈도 매우 낮음)
- Anomaly 발생 시 다음 cycle부터 1분 간격으로 전환 (빠른 복구 확인)

### 6.4 절대 금지 사항

- **Output root 계산**: 시스템이 직접 output root를 계산하거나 제출하지 않음
- **컨트랙트 쓰기**: L2OutputOracle에 트랜잭션을 보내지 않음
- **Proposer 설정 변경**: op-proposer의 submission interval을 변경하지 않음

---

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `L2_OUTPUT_ORACLE_ADDRESS` | — | L2OutputOracle contract address on L1 (required) |
| `OUTPUT_ROOT_CHECK_INTERVAL` | `300` | Check interval in seconds (default 5min) |
| `OUTPUT_ROOT_LAG_WARNING_MULTIPLIER` | `2` | Warning: lag > SUBMISSION_INTERVAL * N |
| `OUTPUT_ROOT_LAG_CRITICAL_MULTIPLIER` | `3` | Critical: lag > SUBMISSION_INTERVAL * N |
| `OUTPUT_ROOT_CONTRACT_MODE` | `bedrock` | Contract mode: bedrock or fault-proof |

**기존 환경변수 재사용:**
- `L1_RPC_URL` → L1 contract read
- `PROPOSER_EOA_ADDRESS` → proposer balance check (Proposal 9 연동)

---

## 8. 타입 정의

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

## 9. 기존 모듈 수정

### 9.1 `src/lib/agent-loop.ts`

5분 간격으로 output root 체크 추가:

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

`PLAYBOOKS[]`에 `op-proposer-stall` 추가 + `matchesMetricCondition()`에 outputRootLag 조건.

### 9.5 `src/lib/action-executor.ts`

`verify_next_submission` 액션 추가:

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

### 9.7 Cross-feature 연동

```
Proposal 9 (EOA Balance):
  → outputRootLag > WARNING 시 proposer 잔액 확인
  → 잔액 부족이면 자동 충전 트리거

Proposal 11 (Gas Monitor):
  → outputRootLag > WARNING 시 L1 gas price 확인
  → 가스 급등이면 gas 안정화 대기 (proposer 재시작 유보)

RCA Engine (기존):
  → op-proposer → l1 의존성 이미 정의됨
  → outputRootLag anomaly 발생 시 RCA에 자동 포함
```

---

## 10. 테스트 계획

### 10.1 유닛 테스트 (`output-root-monitor.test.ts`)

| # | 테스트 | 검증 |
|---|--------|------|
| 1 | Contract ABI parsing | L2OutputOracle 응답 파싱 |
| 2 | Lag calculation | currentL2 - lastOutputL2 정확 계산 |
| 3 | Lag level classification | WARNING/CRITICAL 구간별 판정 |
| 4 | Check interval enforcement | 5분 간격 준수 |
| 5 | SUBMISSION_INTERVAL caching | 캐싱 동작 확인 |
| 6 | Contract read failure | graceful fallback (anomaly 미생성) |
| 7 | Time-based detection | timeSinceSubmission 기반 이상 탐지 |

### 10.2 통합 테스트 시나리오

```
시나리오 1: lag 5500 blocks + proposer balance OK + gas OK → restart proposer → 새 output 확인
시나리오 2: lag 4000 blocks + proposer balance 0.05 ETH → F1 auto-refill → 자동 복구
시나리오 3: lag 6000 blocks + L1 gas 250 gwei → gas 안정 대기 → gas 정상화 후 proposer 재시작
시나리오 4: L2OutputOracle 주소 미설정 → monitor skip (graceful)
시나리오 5: Contract read 실패 → 이전 캐싱 데이터 사용 or skip
```

---

## 의존관계

```
신규 모듈:
  ├── src/lib/output-root-monitor.ts
  └── src/types/output-root.ts

수정 모듈:
  ├── src/lib/agent-loop.ts          → 5분 간격 output root check 추가
  ├── src/lib/anomaly-detector.ts    → detectOutputRootDelay() 추가
  ├── src/lib/playbook-matcher.ts    → op-proposer-stall 플레이북 추가
  ├── src/lib/action-executor.ts     → verify_next_submission 액션 추가
  ├── src/types/anomaly.ts           → AnomalyMetric 확장
  └── src/types/remediation.ts       → RemediationActionType 확장

Cross-feature 의존:
  ├── Proposal 9 (EOA Balance)       → proposer 잔액 확인 및 자동 충전
  └── Proposal 11 (Gas Monitor)      → L1 가스 가격 확인

의존 라이브러리:
  └── viem (이미 설치됨) → getContract, readContract
```
