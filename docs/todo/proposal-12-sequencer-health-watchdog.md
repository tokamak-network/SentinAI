# Proposal 12: Sequencer Health Watchdog — 시퀀서 종합 건강 감시

> **작성일**: 2026-02-11
> **선행 조건**: Proposal 1 (Scaling), Proposal 2 (Anomaly Detection) 구현 완료
> **목적**: op-geth(sequencer)의 다차원 건강 점수를 산출하여 "살아있지만 비정상"인 상태를 감지

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

op-geth(sequencer)가 "살아있지만 비정상"인 soft failure 상태가 존재한다:

| 증상 | 원인 | 현재 감지 여부 |
|------|------|-------------|
| **Empty blocks** | P2P 고립, 트랜잭션 미수신 | ⚠️ gasUsedRatio Z-Score로 간접 감지 가능 |
| **P2P 네트워크 고립** | 모든 피어 연결 끊김 | ❌ 미감지 |
| **디스크 포화** | State DB 증가 (90%+) | ❌ 미감지 |
| **RPC 응답 지연** | 리소스 부족, GC 부하 | ❌ 미감지 |
| **TxPool 비정상** | Nonce gap, queued 축적 | ❌ 미감지 |

현재 시스템은 CPU/메모리 Z-Score만으로 판단하므로 이런 soft failure를 놓친다.

### 1.2 목표

1. 5개 차원의 건강 점수를 종합하여 0-100 점수 산출
2. 점수 기반 이상 탐지 및 원인별 자동 복구
3. 대시보드에 시퀀서 건강 상태 표시

### 1.3 핵심 원칙

- **다차원 평가**: 단일 메트릭이 아닌 5가지 차원의 종합 점수
- **원인별 대응**: 점수가 낮은 원인 차원에 따라 다른 플레이북 실행
- **Graceful Degradation**: 일부 probe 실패 시 해당 차원 제외하고 나머지로 평가

---

## 2. 아키텍처

### 2.1 Health Score 계산

```
Sequencer Health Score (0-100)
  │
  ├── Block Fullness (25%) ────── gasUsedRatio 최근 5분 평균
  │   100: ratio > 0.3   (정상적으로 트랜잭션 포함)
  │   50:  ratio 0.01-0.3 (저활동)
  │   0:   ratio < 0.01   (empty blocks)
  │
  ├── Peer Count (20%) ────────── net_peerCount RPC
  │   100: peers >= 5
  │   50:  peers 1-4
  │   0:   peers = 0 (네트워크 고립)
  │
  ├── RPC Latency (20%) ──────── eth_blockNumber 응답 시간
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
      100: queued < pending * 0.1 (정상)
      50:  queued < pending * 0.5
      0:   queued > pending (nonce gap 다수)
```

### 2.2 데이터 플로우

```
Agent Loop (60s — 매 2번째 cycle)
  │
  ├── Observe ──────────────────────────────────────────────
  │   Probes (병렬 실행, 각 probe 실패 시 해당 차원 skip):
  │     ├── Block Fullness: MetricsStore에서 최근 5분 gasUsedRatio 평균
  │     ├── Peer Count: l2Client.request({method: 'net_peerCount'})
  │     ├── RPC Latency: l2Client.getBlockNumber() 응답 시간 측정
  │     ├── Disk Usage: kubectl exec op-geth-0 -- df -h /data
  │     └── TxPool Health: txpool_status에서 pending/queued 비율
  │
  ├── Detect ──────────────────────────────────────────────
  │   sequencer-health.ts
  │     ├── score < 60 → WARNING anomaly (어떤 차원이 낮은지 포함)
  │     └── score < 30 → CRITICAL anomaly
  │
  ├── Decide ──────────────────────────────────────────────
  │   낮은 차원을 기준으로 플레이북 선택:
  │     ├── peers = 0 → sequencer-network-isolation
  │     ├── disk > 90% → sequencer-disk-pressure
  │     ├── latency > 500ms → sequencer-rpc-degradation
  │     └── queued >> pending → sequencer-txpool-corruption
  │
  └── Act (원인별 분기) ────────────────────────────────────
      ├── Network isolation → restart_pod(op-geth)
      ├── Disk pressure → escalate_operator (pruning 필요)
      ├── RPC degradation → scale_up(op-geth)
      └── TxPool corruption → flush_txpool
```

---

## 3. Agent Act — 자동 실행 액션

### 3.1 원인별 액션 매핑

| 원인 | Action | Safety | Description |
|------|--------|--------|-------------|
| **P2P 고립** (peers = 0) | `restart_pod` | Guarded | op-geth 재시작으로 P2P 재연결 |
| **디스크 포화** (> 90%) | `escalate_operator` | Safe | State pruning 필요 → 운영자 알림 |
| **RPC 지연** (> 500ms) | `scale_up` | Guarded | vCPU 스케일업으로 리소스 확보 |
| **TxPool 비정상** | `flush_txpool` | Guarded | txpool 초기화 (nonce gap 해소) |
| **복합 장애** (score < 30) | `collect_logs` + `escalate_operator` | Safe | 로그 수집 + 운영자 알림 |

### 3.2 실행 흐름 예시

**시나리오: P2P 네트워크 고립 (peers = 0, health score = 25)**

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

**시나리오: 디스크 포화 (92%)**

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
  (자동 복구 불가 — pruning은 manual action)

[Log] Sequencer disk pressure alert: 92% → operator notified
```

---

## 4. 구현 명세

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

**Probe 실패 처리:**

```typescript
// 각 probe를 Promise.allSettled로 병렬 실행
// 실패한 probe는 해당 차원 제외하고 나머지 weight 재분배
const results = await Promise.allSettled([
  probeBlockFullness(),
  probePeerCount(rpcUrl),
  probeRpcLatency(rpcUrl),
  probeDiskUsage(podName, namespace),
  probeTxPoolHealth(rpcUrl),
]);

// 성공한 probe만으로 weighted score 계산
// Weight 재분배: 실패 probe의 weight를 성공 probe에 비례 분배
```

---

## 5. Playbook 정의

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

## 6. 안전장치

### 6.1 Probe 보안

| Probe | 요구 사항 | Fallback |
|-------|----------|----------|
| `net_peerCount` | op-geth `--http.api` 에 `net` 포함 필요 | probe skip, weight 재분배 |
| `admin_peers` | `admin` API 활성화 필요 | `net_peerCount` 사용 |
| Disk Usage | kubectl exec 권한 필요 | probe skip |
| TxPool | `txpool` API 활성화 필요 | 기존 txpool_status로 fallback |

### 6.2 액션별 제한

| 액션 | 제한 |
|------|------|
| `restart_pod` (P2P isolation) | Cooldown 5분, 시간당 최대 2회 |
| `scale_up` (RPC degradation) | 기존 scaling cooldown (5분) 적용 |
| `flush_txpool` | Cooldown 30분, safety level `guarded` |
| Disk pressure | 자동 복구 불가 → 운영자 알림만 |

### 6.3 Health Check 간격

- 기본: 매 2번째 agent cycle (60초 간격)
- `SEQUENCER_HEALTH_CHECK_INTERVAL`로 조정 가능
- Disk probe는 5분 간격 (kubectl exec 비용 절감)

---

## 7. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `SEQUENCER_HEALTH_THRESHOLD` | `60` | Health score WARNING threshold |
| `SEQUENCER_HEALTH_CRITICAL` | `30` | Health score CRITICAL threshold |
| `SEQUENCER_HEALTH_CHECK_INTERVAL` | `60` | Check interval (seconds) |
| `SEQUENCER_DISK_CHECK_INTERVAL` | `300` | Disk probe interval (seconds) |

**기존 환경변수 재사용:**
- `L2_RPC_URL` → RPC probes
- `K8S_NAMESPACE` → kubectl exec for disk check

---

## 8. 타입 정의

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

## 9. 기존 모듈 수정

### 9.1 `src/lib/agent-loop.ts`

`runAgentCycle()`에 health check 호출 추가 (매 2번째 cycle):

```typescript
// After collectMetrics() and runDetectionPipeline()
const cycleCount = /* track cycle number */;
if (cycleCount % 2 === 0) {
  const healthResult = await checkSequencerHealth(rpcUrl);
  // health anomaly를 detection 결과에 합침
}
```

### 9.2 `src/types/anomaly.ts`

```typescript
export type AnomalyMetric =
  // ... existing
  | 'sequencerHealth';  // NEW
```

### 9.3 `src/lib/playbook-matcher.ts`

3개 플레이북 추가 + `identifyComponent()`에 sequencer health 케이스 추가:

```typescript
// sequencerHealth anomaly → 원인 차원에 따라 component 결정
if (metrics.includes('sequencerHealth')) {
  // anomaly description에서 원인 파싱
  // 또는 별도의 healthCheckResult를 참조
  return 'op-geth';
}
```

### 9.4 `src/lib/action-executor.ts`

`flush_txpool` 액션 추가:

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

## 10. 테스트 계획

### 10.1 유닛 테스트 (`sequencer-health.test.ts`)

| # | 테스트 | 검증 |
|---|--------|------|
| 1 | Score calculation | 5차원 weighted 점수 정확 계산 |
| 2 | Dimension scoring | 각 차원별 rawValue → score 변환 |
| 3 | Probe failure handling | 일부 probe 실패 시 weight 재분배 |
| 4 | Lowest dimension | 가장 낮은 차원 정확 식별 |
| 5 | Threshold detection | score < 60 → WARNING, < 30 → CRITICAL |
| 6 | Peer count = 0 | 즉시 network isolation 플레이북 매칭 |
| 7 | Disk > 90% | manual escalation 확인 |
| 8 | All probes fail | graceful degradation (unknown state) |

### 10.2 통합 테스트 시나리오

```
시나리오 1: peers=0 + empty blocks → restart op-geth → peers 복구 확인
시나리오 2: disk 92% → operator 알림 (자동 복구 안 함)
시나리오 3: RPC latency 800ms → scale_up → latency 개선 확인
시나리오 4: queued >> pending → flush_txpool → txpool 정상화
시나리오 5: 복합 장애 (score=20) → collect_logs + operator 알림
시나리오 6: net_peerCount RPC 비활성화 → probe skip, 4차원으로 평가
```

---

## 의존관계

```
신규 모듈:
  ├── src/lib/sequencer-health.ts
  └── src/types/sequencer-health.ts

수정 모듈:
  ├── src/lib/agent-loop.ts          → health check 호출 추가
  ├── src/lib/anomaly-detector.ts    → sequencerHealth anomaly 추가
  ├── src/lib/playbook-matcher.ts    → 3개 플레이북 추가
  ├── src/lib/action-executor.ts     → flush_txpool 액션 추가
  ├── src/types/anomaly.ts           → AnomalyMetric 확장
  └── src/types/remediation.ts       → RemediationActionType 확장

의존 라이브러리:
  └── viem (이미 설치됨) → custom RPC calls (net_peerCount, txpool)

선택적:
  └── src/app/page.tsx → 대시보드에 Health Score 게이지 추가
```
