# Proposal 11: L1 Gas Price Adaptive Batcher — L1 가스 가격 기반 배치 전략

> **작성일**: 2026-02-11
> **선행 조건**: Proposal 2 (Anomaly Detection), Proposal 4 (Cost Optimizer) 구현 완료
> **목적**: L1 가스 가격 급등 시 op-batcher 배치 전략을 자동 조정하여 운영 비용 최적화

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

op-batcher는 L2 트랜잭션 배치를 L1에 제출한다. L1 가스 가격이 급등하면:

| 상황 | 영향 |
|------|------|
| NFT 민팅 이벤트 | 배치 제출 비용 10~50배 증가 |
| 가스 급등 중 일정 빈도 배치 | 불필요한 고가스 지출 |
| 극단적 가스 가격 | 배치 트랜잭션 pending 체류, 제출 실패 |

현재 시스템의 한계:
- **L1 가스 가격을 전혀 모니터링하지 않음**
- batcher가 가스 가격에 관계없이 동일 빈도로 배치 제출
- 비용 최적화 기회를 놓침 (가스가 싼 시간대에 배치를 몰아서 제출)

### 1.2 목표

1. L1 가스 가격을 실시간 모니터링 (base fee + priority fee)
2. 가스 가격 수준별 배치 전략 자동 조정 (간격 증가, 일시 중지, 빠른 제출)
3. 기존 cost-optimizer와 통합하여 가스비 지출 추적 및 보고

### 1.3 핵심 원칙

- **Sequencer Window 준수**: 배치 지연은 최대 1시간 (12시간 window의 1/12)
- **비용 vs 지연 균형**: 가스 절감과 data availability 확정 지연 사이의 최적점
- **자동 복구**: 가스 가격 안정화 시 원래 설정으로 자동 복구

---

## 2. 아키텍처

### 2.1 Gas Price Level 체계

```
L1 Gas Price (gwei)
  │
  ├── NORMAL  (< 50 gwei)   → 기본 배치 간격 유지
  ├── HIGH    (50-100 gwei)  → WARNING alert, 모니터링 강화
  ├── SPIKE   (100-200 gwei) → 배치 간격 4배 증가 (15→60 channel duration)
  └── EXTREME (> 200 gwei)   → 배치 일시 중지 (최대 1시간)
```

### 2.2 데이터 플로우

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
  │   1. 현재 gas level 판정
  │   2. 현재 batcher config와 비교
  │   3. 조정 필요 여부 결정
  │
  └── Act ─────────────────────────────────────────────────
      ├── [Safe] collect_logs(op-batcher) → 현재 배치 상태 확인
      ├── [Guarded] adjust_batcher_config → ConfigMap patch
      ├── [Guarded] pause_batcher → scale to 0 (EXTREME)
      ├── [Guarded] resume_batcher → scale to 1 (gas 안정화)
      └── [Safe] escalate_operator → 1시간 이상 EXTREME 지속
```

### 2.3 Batcher Config 조정 방식

```
op-batcher 주요 설정:
  --max-channel-duration: 배치 채널 최대 지속 시간 (L1 블록 수)
    기본: 15 (약 3분)
    SPIKE: 60 (약 12분) → 배치 빈도 4배 감소

조정 방법:
  kubectl patch configmap <batcher-configmap> \
    --namespace <namespace> \
    --patch '{"data":{"OP_BATCHER_MAX_CHANNEL_DURATION":"60"}}'

  → op-batcher pod restart 필요 (config 반영)
```

---

## 3. Agent Act — 자동 실행 액션

### 3.1 액션 테이블

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `collect_logs` | Safe | gas > HIGH | op-batcher 로그에서 pending tx / failed submission 확인 |
| 2 | `adjust_batcher_config` | **Guarded** | gas > SPIKE | op-batcher ConfigMap의 `MAX_CHANNEL_DURATION`을 kubectl patch로 증가 |
| 3 | `pause_batcher` | **Guarded** | gas > EXTREME | op-batcher Deployment/StatefulSet replicas를 0으로 (일시 중지) |
| 4 | `resume_batcher` | **Guarded** | gas < SPIKE (급락) | 중지된 op-batcher를 replicas 1로 복구 |
| 5 | `escalate_operator` | Safe | EXTREME 1시간 지속 | 배치 제출 장기 중단 임박, 수동 개입 요청 |

### 3.2 실행 흐름 예시

**시나리오: L1 gas = 130 gwei (SPIKE)**

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

**시나리오: 가스 안정화 후 복구**

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

**시나리오: EXTREME gas (250 gwei)**

```
[Observe] l1Client.getGasPrice() = 250 gwei

[Act]
  Step 1: pause_batcher
    → kubectl scale statefulset sepolia-thanos-stack-op-batcher --replicas=0
    → Batcher paused. Batches will accumulate in sequencer.
  Step 2: Start timer: max pause duration = 60 minutes

--- 45분 후 ---

[Observe] l1Client.getGasPrice() = 80 gwei (< SPIKE)

[Act]
  Step 1: resume_batcher
    → kubectl scale statefulset sepolia-thanos-stack-op-batcher --replicas=1
    → Batcher resumed. Accumulated batches will be submitted.
  Step 2: adjust_batcher_config → restore defaults

--- 만약 1시간 경과, 여전히 EXTREME ---

[Act]
  Step 5: escalate_operator
    → Slack: "🚨 L1 gas extreme (250+ gwei) for 1 hour.
       Batcher paused. Sequencer window: 11h remaining.
       Manual decision required: continue waiting or submit at high cost."
```

---

## 4. 구현 명세

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

## 5. Playbook 정의

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

## 6. 안전장치

### 6.1 Sequencer Window 제한

| 제한 | 값 | 설명 |
|------|---|------|
| 최대 배치 지연 | 1시간 | Optimism sequencer window (12시간)의 1/12 |
| Pause 타이머 | 60분 | 60분 초과 시 자동 escalation |
| 원본 config 보존 | 자동 | 변경 전 원본 값 저장, 복구 시 사용 |

### 6.2 Config 변경 안전성

```
1. 변경 전: 현재 ConfigMap 값을 originalChannelDuration에 저장
2. 변경: kubectl patch configmap
3. Pod 재시작: kubectl delete pod (StatefulSet이 새 config로 재생성)
4. 복구 시: originalChannelDuration 값으로 다시 patch
```

### 6.3 재평가 주기

- 가스 가격 변경 후에도 **5분마다** 재평가
- 급락 시 **즉시** 복구 (다음 agent cycle에서)
- Pause 상태에서 30분마다 gas price 재확인 로그

---

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `L1_GAS_PRICE_HIGH_GWEI` | `50` | High threshold (warning) |
| `L1_GAS_PRICE_SPIKE_GWEI` | `100` | Spike threshold (adjust batcher) |
| `L1_GAS_PRICE_EXTREME_GWEI` | `200` | Extreme threshold (pause batcher) |
| `BATCH_DELAY_MAX_MINUTES` | `60` | Maximum batch delay / pause duration |
| `BATCHER_CONFIGMAP_NAME` | auto-detect | op-batcher ConfigMap name |
| `BATCHER_DEFAULT_CHANNEL_DURATION` | `15` | Default max channel duration (fallback) |

**기존 환경변수 재사용:**
- `L1_RPC_URL` → L1 gas price 조회
- `K8S_NAMESPACE` → kubectl patch namespace

---

## 8. 타입 정의

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

## 9. 기존 모듈 수정

### 9.1 `src/lib/agent-loop.ts`

```typescript
// collectMetrics()에 gas price 조회 추가
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

새 액션 3개 추가:

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

가스 가격 데이터를 비용 분석에 통합:
- L1 가스비 지출 구간별 추적
- 배치 전략 조정에 의한 절감액 계산

### 9.7 `src/lib/daily-report-generator.ts`

일일 보고서에 가스비 섹션 추가:
- 일일 평균/최대 L1 gas price
- 배치 전략 조정 횟수
- 가스비 절감 추정액

---

## 10. 테스트 계획

### 10.1 유닛 테스트 (`l1-gas-monitor.test.ts`)

| # | 테스트 | 검증 |
|---|--------|------|
| 1 | Gas level classification | NORMAL/HIGH/SPIKE/EXTREME 구간별 정확한 분류 |
| 2 | Strategy recommendation | 각 level에 대한 올바른 전략 권장 |
| 3 | Batcher pause/resume state | pause 상태 추적 및 duration 계산 |
| 4 | Config change and restore | 원본 config 보존 및 복구 |
| 5 | Max pause duration | 60분 초과 시 escalation 트리거 |
| 6 | Trend calculation | rising/falling/stable 추세 판정 |
| 7 | Gas stabilization detection | SPIKE → NORMAL 전환 감지 |

### 10.2 통합 테스트 시나리오

```
시나리오 1: gas 130 gwei → config 조정 (15→60) → gas 35 gwei → config 복구 (60→15)
시나리오 2: gas 250 gwei → batcher pause → 45분 후 gas 80 gwei → resume
시나리오 3: gas 250 gwei → 60분 지속 → operator escalation
시나리오 4: gas 변동 심함 (100↔150) → 불필요한 config 변경 방지 (hysteresis)
시나리오 5: Simulation mode → config 미변경, 로그만 기록
```

---

## 의존관계

```
신규 모듈:
  ├── src/lib/l1-gas-monitor.ts
  └── src/types/l1-gas.ts

수정 모듈:
  ├── src/lib/agent-loop.ts          → collectMetrics()에 getGasPrice 추가
  ├── src/lib/anomaly-detector.ts    → detectGasPriceSpike() 추가
  ├── src/lib/playbook-matcher.ts    → 2개 플레이북 추가
  ├── src/lib/action-executor.ts     → 3개 액션 추가
  ├── src/lib/cost-optimizer.ts      → 가스비 데이터 통합
  ├── src/lib/daily-report-generator.ts → 가스비 섹션 추가
  ├── src/types/anomaly.ts           → AnomalyMetric 확장
  └── src/types/remediation.ts       → RemediationActionType 확장

의존 라이브러리:
  └── viem (이미 설치됨) → getGasPrice, formatGwei
```
