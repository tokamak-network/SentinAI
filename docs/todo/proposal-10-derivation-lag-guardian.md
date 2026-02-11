# Proposal 10: Derivation Lag Guardian — L2 파생 지연 감시 및 자동 복구

> **작성일**: 2026-02-11
> **선행 조건**: Proposal 2 (Anomaly Detection) 구현 완료
> **목적**: op-node의 L1 derivation 지연을 실시간 감시하여 L2 safe/finalized 블록 확정 지연을 방지

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

op-node는 L1 블록을 읽어 L2 상태를 derive(파생)한다. op-node가 L1 HEAD 대비 뒤처지면:

| 지연 수준 | 의미 | 영향 |
|----------|------|------|
| **30 blocks** (~6분) | 경미한 파생 지연 | safe/finalized 확정 지연 시작 |
| **120 blocks** (~24분) | 심각한 파생 지연 | L2 상태 확정이 크게 지연 |
| **600 blocks** (~2시간) | 비상 | 출금 finality, bridge 운영에 영향 |

현재 시스템의 한계:
- `l2BlockHeight` plateau 탐지로 **완전 정지**만 감지
- **서서히 벌어지는 derivation lag**는 탐지하지 못함
- L1 자체 지연과 op-node 문제를 구분하지 못함

### 1.2 목표

1. `optimism_syncStatus` RPC를 통해 정확한 derivation lag를 측정
2. 3단계 임계값 기반 알림 및 자동 복구
3. L1 지연 vs op-node 문제를 자동 구분하여 적절한 대응

### 1.3 핵심 원칙

- **정확한 측정**: block height 비교가 아닌 `syncStatus`의 L1 origin 기반 lag 계산
- **원인 구분**: L1 RPC 장애, op-node hang, L1 reorg를 각각 구분
- **보수적 대응**: L1 reorg 시에는 자동 복구를 시도하지 않음

---

## 2. 아키텍처

### 2.1 Derivation Lag 계산 원리

```
Optimism Derivation Pipeline:
  L1 Block (Ethereum)  ──→  op-node (derivation)  ──→  L2 State (safe/finalized)

Lag 계산:
  derivationLag = l1Head - syncStatus.current_l1

  syncStatus (optimism_syncStatus RPC response):
  {
    "current_l1": { "number": 12340000 },   ← op-node가 처리한 마지막 L1 블록
    "head_l1":    { "number": 12340150 },   ← L1의 최신 블록
    "unsafe_l2":  { "number": 6200000 },    ← L2 unsafe head
    "safe_l2":    { "number": 6199500 },    ← L2 safe head
    "finalized_l2": { "number": 6199000 }   ← L2 finalized head
  }
```

### 2.2 데이터 플로우

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
  │   1. L1 RPC 응답 확인 → L1 자체 지연이면 대기
  │   2. L1 정상이면 op-node 문제 → 재시작 플레이북
  │
  └── Act ─────────────────────────────────────────────────
      ├── [Safe] check_l1_connection → L1 정상 여부 확인
      ├── [Safe] collect_logs(op-node) → 에러 로그 수집
      ├── [Guarded] restart_pod(op-node) → L1 정상 & lag > CRITICAL
      ├── [Safe] health_check → lag 감소 추세 확인
      └── [Safe] escalate_operator → lag > EMERGENCY or L1 장애
```

---

## 3. Agent Act — 자동 실행 액션

### 3.1 액션 테이블

| # | Action | Safety | Trigger | Description |
|---|--------|--------|---------|-------------|
| 1 | `check_l1_connection` | Safe | lag > WARNING | L1 RPC 응답 및 block time 확인. L1 자체 지연인지 op-node 문제인지 구분 |
| 2 | `collect_logs` | Safe | lag > WARNING | op-node 최근 로그 수집 (derivation pipeline, reset 관련 에러) |
| 3 | `restart_pod` | **Guarded** | lag > CRITICAL & L1 정상 | op-node pod 재시작 (kubectl delete, StatefulSet 자동 재생성) |
| 4 | `health_check` | Safe | restart 후 60s | op-node 재시작 후 derivation 재개 확인 (lag 감소 추세) |
| 5 | `escalate_operator` | Safe | lag > EMERGENCY or L1 장애 | 운영자 긴급 알림 (L1 문제는 자동 해결 불가) |

### 3.2 실행 흐름 예시

**시나리오: Derivation lag = 150 blocks, L1 정상**

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

**시나리오: Derivation lag = 200 blocks, L1 장애**

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

## 4. 구현 명세

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

**핵심 로직: `getSyncStatus()`**

```typescript
// optimism_syncStatus는 표준 Optimism RPC method
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

## 5. Playbook 정의

기존 `op-node-derivation-stall` 플레이북을 **확장**하여 derivation lag 조건을 추가한다 (새 플레이북을 만들지 않음).

### 5.1 기존 플레이북 확장

```yaml
name: op-node-derivation-stall
description: op-node derivation pipeline stagnation or lag
trigger:
  component: op-node
  indicators:
    - type: metric
      condition: l2BlockHeight stagnant  # 기존
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

## 6. 안전장치

### 6.1 L1 Reorg 대응

```
L1 reorg 감지 시:
  → 자동 복구 시도하지 않음
  → op-node가 자체적으로 reorg를 처리할 시간을 줌 (5분 대기)
  → 5분 후에도 lag 증가 시 운영자 알림
```

감지 방법: `syncStatus.head_l1`이 이전 cycle보다 감소하면 L1 reorg 발생.

### 6.2 False Positive 방지

| 원인 | 구분 방법 | 대응 |
|------|---------|------|
| L1 RPC 장애 | `isL1Healthy()` 체크 | 운영자 알림 (auto-fix 불가) |
| L1 자체 느림 (merge 등) | L1 avg block interval > 15s | 임계값 동적 조정 |
| op-node 정상 catch-up | lag 감소 추세 | 알림 억제 |
| L1 reorg | head_l1 감소 | 자동 복구 유보 |

### 6.3 재시작 제한

- op-node 재시작은 기존 Proposal 8의 안전장치 적용:
  - Cooldown: 5분 (동일 pod 재시작 간격)
  - 시간당 최대: 3회
  - Circuit Breaker: 연속 3회 실패 시 24시간 비활성화

---

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `OP_NODE_RPC_URL` | `L2_RPC_URL` | op-node admin RPC endpoint (syncStatus 호출용) |
| `DERIVATION_LAG_WARNING` | `30` | Warning threshold in L1 blocks |
| `DERIVATION_LAG_CRITICAL` | `120` | Critical threshold in L1 blocks |
| `DERIVATION_LAG_EMERGENCY` | `600` | Emergency threshold in L1 blocks |

**기존 환경변수 재사용:**
- `L1_RPC_URL` → L1 health check
- `L2_RPC_URL` → fallback for op-node RPC

---

## 8. 타입 정의

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

## 9. 기존 모듈 수정

### 9.1 `src/lib/agent-loop.ts`

`collectMetrics()` 에 `optimism_syncStatus` 호출 추가:

```typescript
// L2 RPC로 sync status 조회 (op-node가 동일 RPC를 노출하는 경우)
let syncStatus: SyncStatus | null = null;
try {
  const opNodeRpcUrl = process.env.OP_NODE_RPC_URL || rpcUrl;
  syncStatus = await getSyncStatus(opNodeRpcUrl);
} catch {
  // syncStatus 실패는 non-fatal
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
  return null; // WARNING은 anomaly가 아닌 dashboard alert
}
```

### 9.4 `src/lib/playbook-matcher.ts`

`matchesMetricCondition()`에 derivation lag 조건 추가:

```typescript
if (condition.includes('derivationLag >')) {
  const threshold = parseInt(condition.split('>')[1].trim());
  const anomaly = event.anomalies.find(a => a.metric === 'derivationLag');
  return anomaly ? anomaly.value > threshold : false;
}
```

---

## 10. 테스트 계획

### 10.1 유닛 테스트 (`derivation-lag-monitor.test.ts`)

| # | 테스트 | 검증 |
|---|--------|------|
| 1 | getSyncStatus() parsing | optimism_syncStatus RPC 응답 파싱 |
| 2 | calculateLag() | lag = headL1 - currentL1 정확 계산 |
| 3 | getLagLevel() thresholds | 각 임계값 구간별 level 판정 |
| 4 | L1 health check | L1 RPC 응답 시간 및 block interval 측정 |
| 5 | L1 reorg detection | headL1 감소 시 isReorg = true |
| 6 | Trend calculation | lag 변화 추세 (increasing/decreasing/stable) |
| 7 | RPC failure handling | syncStatus 호출 실패 시 graceful fallback |

### 10.2 통합 테스트 시나리오

```
시나리오 1: lag 150 blocks + L1 정상 → op-node restart → lag 감소 확인
시나리오 2: lag 200 blocks + L1 장애 → operator 알림 (restart 안 함)
시나리오 3: lag 10 blocks → normal (anomaly 미생성)
시나리오 4: L1 reorg 감지 → 자동 복구 유보 → 5분 대기
시나리오 5: lag 감소 추세 → 불필요한 restart 방지
```

---

## 의존관계

```
신규 모듈:
  ├── src/lib/derivation-lag-monitor.ts
  └── src/types/derivation.ts

수정 모듈:
  ├── src/lib/agent-loop.ts          → collectMetrics()에 syncStatus 추가
  ├── src/lib/anomaly-detector.ts    → detectDerivationLag() 추가
  ├── src/lib/playbook-matcher.ts    → derivationLag 조건 추가
  └── src/types/anomaly.ts           → AnomalyMetric에 'derivationLag' 추가

의존 라이브러리:
  └── viem (이미 설치됨) → client.request() for custom RPC
```
