# Proposal 8: Auto-Remediation Engine - 자동 복구 엔진

> **작성일**: 2026-02-09
> **선행 조건**: Proposal 2 (Anomaly Detection), Proposal 3 (RCA Engine) 구현 완료
> **목적**: 이상 탐지 → 알림 이후 운영자 개입 없이 자동 복구까지 루프를 완결

---

## 목차

1. [개요](#1-개요)
2. [현재 파이프라인의 한계](#2-현재-파이프라인의-한계)
3. [아키텍처](#3-아키텍처)
4. [복구 액션 분류 체계](#4-복구-액션-분류-체계)
5. [Playbook 시스템](#5-playbook-시스템)
6. [에스컬레이션 래더](#6-에스컬레이션-래더)
7. [안전장치](#7-안전장치)
8. [타입 정의](#8-타입-정의)
9. [신규 모듈 명세](#9-신규-모듈-명세)
10. [기존 모듈 수정](#10-기존-모듈-수정)
11. [API 명세](#11-api-명세)
12. [환경 변수](#12-환경-변수)
13. [테스트 검증](#13-테스트-검증)
14. [의존관계](#14-의존관계)

---

## 1. 개요

### 1.1 문제

현재 SentinAI의 파이프라인은 3단계에서 끊긴다:

```
Layer 1: Z-Score 이상 탐지
  ↓
Layer 2: AI 심층 분석
  ↓
Layer 3: Slack/Webhook 알림
  ↓
❌ 운영자가 Slack 확인 → 대시보드 접속 → RCA 수동 트리거 → 권장사항 읽기 → kubectl 수동 실행
```

RCA 엔진이 `RemediationAdvice`(즉각 조치 + 예방 조치)를 텍스트로 제공하지만, 실제 실행은 전적으로 운영자에게 의존한다. 새벽 3시에 op-geth OOM이 발생하면 운영자가 깨어나 수동 대응해야 한다.

### 1.2 목표

**Layer 4: Auto-Remediation Engine**을 추가하여 감지-분석-복구 루프를 자동으로 완결한다.

1. **Playbook 기반 자동 복구**: 사전 정의된 장애 패턴별 복구 절차를 자동 실행
2. **안전성 분류**: 복구 액션을 Safe / Guarded / Manual 3단계로 분류
3. **에스컬레이션 래더**: 자동 복구 → 재시도 → 운영자 승인 요청 → 긴급 알림 단계적 상승
4. **실행 추적**: 모든 복구 작업의 실행 이력, 성공률, 소요 시간 기록
5. **피드백 루프**: 복구 성공/실패 결과를 학습하여 향후 판단에 반영

### 1.3 핵심 원칙

- **Do No Harm**: 자동 복구가 장애를 악화시키지 않도록 보수적으로 동작
- **Observable**: 모든 자동 액션은 추적 가능하고 감사 로그로 남음
- **Escapable**: 운영자가 언제든 자동 복구를 비활성화할 수 있음
- **Gradual**: Safe 액션부터 시작하고, 신뢰도가 쌓이면 Guarded 액션까지 확대

---

## 2. 현재 파이프라인의 한계

### 2.1 끊어진 루프

| 단계 | 현재 상태 | 자동화 여부 |
|------|----------|------------|
| 이상 탐지 | Z-Score + AI 분석 | ✅ 자동 |
| 알림 발송 | Slack/Webhook | ✅ 자동 |
| 근본 원인 분석 | RCA 엔진 | ⚠️ 수동 트리거 |
| 복구 권장 | RemediationAdvice 텍스트 | ⚠️ 읽기만 가능 |
| 복구 실행 | kubectl 수동 실행 | ❌ 수동 |
| 결과 확인 | 대시보드 수동 확인 | ❌ 수동 |

### 2.2 재사용 가능한 빌딩 블록

이미 구현된 K8s 작업들이 자동 복구의 실행기로 재사용 가능하다:

| 모듈 | 가능한 작업 |
|------|-----------|
| `k8s-scaler.ts` | StatefulSet 리소스 패치 (vCPU/Memory) |
| `zero-downtime-scaler.ts` | Parallel Pod Swap 무중단 스케일링 |
| `k8s-config.ts` | kubectl 명령 실행 (get/patch/delete/exec) |

---

## 3. 아키텍처

### 3.1 전체 흐름

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        Layer 4: Auto-Remediation                          │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  [Input: AnomalyEvent + DeepAnalysisResult + RCAResult(optional)]         │
│                          │                                                 │
│                          ▼                                                 │
│  ┌────────────────────────────────────────────┐                           │
│  │         Playbook Matcher                    │                           │
│  │                                             │                           │
│  │   AnomalyEvent 패턴 매칭                    │                           │
│  │   → 일치하는 Playbook 선택                   │                           │
│  │   → 매칭 실패 시 AI 기반 액션 추출            │                           │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Safety Classifier                   │                           │
│  │                                             │                           │
│  │   각 액션의 안전 등급 확인:                    │                           │
│  │   • Safe → 즉시 실행                         │                           │
│  │   • Guarded → 조건 충족 시 실행               │                           │
│  │   • Manual → 운영자 승인 대기                  │                           │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Action Executor                     │                           │
│  │                                             │                           │
│  │   k8s-scaler.ts / zero-downtime-scaler.ts  │                           │
│  │   / k8s-config.ts 호출                      │                           │
│  │   실행 결과 수집                              │                           │
│  └─────────────────┬──────────────────────────┘                           │
│                    │                                                       │
│                    ▼                                                       │
│  ┌────────────────────────────────────────────┐                           │
│  │         Result Monitor                      │                           │
│  │                                             │                           │
│  │   복구 후 메트릭 재확인 (30초~2분 대기)         │                           │
│  │   • 정상화 → 완료 + 알림                      │                           │
│  │   • 미해결 → 에스컬레이션                      │                           │
│  └────────────────────────────────────────────┘                           │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 데이터 플로우

```
alert-dispatcher.ts (Layer 3)
  │
  ├─ severity: high/critical
  │
  ▼
remediation-engine.ts (Layer 4)
  │
  ├─ playbook-matcher.ts   → 장애 패턴 → Playbook 선택
  ├─ action-executor.ts    → K8s 작업 실행
  └─ remediation-store.ts  → 실행 이력 저장
  │
  ├─ 성공 → Slack 복구 완료 알림
  └─ 실패 → 에스컬레이션 (재시도 / 운영자 호출)
```

---

## 4. 복구 액션 분류 체계

### 4.1 3단계 안전 등급

| 등급 | 설명 | 조건 | 예시 |
|------|------|------|------|
| **Safe** | 부작용 없는 진단/경량 복구 | 무조건 자동 실행 | 로그 수집, 헬스체크, Pod 상태 조회 |
| **Guarded** | 서비스 영향 가능한 복구 | Cooldown + 시간당 횟수 제한 충족 시 자동 | Pod 재시작, 리소스 스케일업 |
| **Manual** | 데이터 손실 또는 다운타임 위험 | 운영자 승인 필수 | StatefulSet 삭제, 설정 변경, 롤백 |

### 4.2 사전 정의 액션 목록

```
Safe Actions:
  ├─ collect_logs          로그 수집 및 저장
  ├─ health_check          Pod/RPC 상태 확인
  ├─ check_l1_connection   L1 RPC 연결 확인
  └─ describe_pod          Pod 상세 상태 조회

Guarded Actions:
  ├─ restart_pod           Pod 재시작 (delete → auto-recreate)
  ├─ scale_up              리소스 증가 (vCPU/Memory)
  ├─ scale_down            리소스 감소
  └─ zero_downtime_swap    무중단 Pod 교체

Manual Actions:
  ├─ config_change         환경변수/설정 변경
  ├─ rollback_deployment   이전 버전으로 롤백
  └─ force_restart_all     전체 컴포넌트 재시작
```

---

## 5. Playbook 시스템

### 5.1 개념

Playbook은 **장애 패턴 → 복구 절차**의 선언적 매핑이다. Optimism Rollup 컴포넌트별 알려진 장애 패턴에 대해 검증된 복구 절차를 사전 정의한다.

### 5.2 Playbook 정의

#### Playbook 1: op-geth OOM / 높은 CPU

```yaml
name: op-geth-resource-exhaustion
trigger:
  component: op-geth
  indicators:
    - metric: cpuPercent > 90 (sustained 3+ checks)
    - metric: memoryPercent > 85
    - log_pattern: "out of memory" | "OOM killed"
actions:
  - type: scale_up          # Guarded
    target: op-geth
    params: { targetVcpu: "next_tier" }
  - type: health_check      # Safe (복구 확인)
    target: op-geth
    wait: 30s
fallback:
  - type: restart_pod       # Guarded (스케일업 후에도 미해결 시)
    target: op-geth
escalate_after: 2 attempts
```

#### Playbook 2: op-node Derivation Stall

```yaml
name: op-node-derivation-stall
trigger:
  component: op-node
  indicators:
    - metric: l2BlockNumber stagnant (3+ checks)
    - log_pattern: "derivation pipeline" | "reset"
actions:
  - type: check_l1_connection  # Safe
  - type: restart_pod           # Guarded
    target: op-node
    wait: 60s
  - type: health_check          # Safe (블록 번호 증가 확인)
escalate_after: 1 attempt
```

#### Playbook 3: op-batcher Backlog

```yaml
name: op-batcher-backlog
trigger:
  component: op-batcher
  indicators:
    - metric: txPoolSize monotonic increase (5+ checks)
    - log_pattern: "failed to submit" | "insufficient funds"
actions:
  - type: check_l1_connection   # Safe (L1 가스 상태 확인)
  - type: collect_logs           # Safe
    target: op-batcher
  - type: restart_pod            # Guarded
    target: op-batcher
escalate_after: 1 attempt       # L1 가스 문제는 자동 해결 불가
```

#### Playbook 4: 전반적 리소스 부족

```yaml
name: general-resource-pressure
trigger:
  component: system
  indicators:
    - metric: hybridScore >= 70 (sustained)
    - metric: cpuPercent > 80
actions:
  - type: scale_up                # Guarded
    target: op-geth
    params: { targetVcpu: "next_tier" }
  - type: zero_downtime_swap      # Guarded (가능한 경우)
escalate_after: 1 attempt
```

#### Playbook 5: L1 연결 장애

```yaml
name: l1-connectivity-failure
trigger:
  component: l1
  indicators:
    - metric: l1BlockNumber stagnant
    - log_pattern: "connection refused" | "timeout" | "ECONNRESET"
actions:
  - type: check_l1_connection   # Safe (진단)
  - type: collect_logs           # Safe
    target: [op-node, op-batcher, op-proposer]
escalate_after: 0 attempts     # L1 문제는 자동 복구 불가 → 즉시 에스컬레이션
```

### 5.3 매칭 로직

```
1. AnomalyEvent의 affectedMetrics + severity 확인
2. 최근 로그 패턴에서 component 식별
3. RCAResult가 있으면 rootCause.component 우선 사용
4. 일치하는 Playbook 선택 (복수 매칭 시 severity 높은 것 우선)
5. 매칭 없음 → AI 기반 fallback (RCA의 RemediationAdvice에서 Safe 액션만 추출)
```

---

## 6. 에스컬레이션 래더

자동 복구 실패 시 단계적으로 상승하는 대응 체계:

```
Level 0: Auto-Remediation
  │  Playbook의 Safe + Guarded 액션 자동 실행
  │  성공 → Slack 알림: "✅ [자동 복구 완료] op-geth 리소스 확장 (2→4 vCPU)"
  │
  │  실패 ↓
  │
Level 1: Retry with Fallback
  │  Playbook의 fallback 액션 실행
  │  성공 → Slack 알림: "✅ [자동 복구 완료] op-geth 재시작으로 복구"
  │
  │  실패 ↓
  │
Level 2: Operator Approval Request
  │  Slack 알림: "⚠️ [승인 필요] 자동 복구 실패. 수동 조치 필요:"
  │  + RCA 결과 요약 + 권장 kubectl 명령어 제공
  │  + Dashboard 링크
  │
  │  미응답 (30분) ↓
  │
Level 3: Urgent Escalation
     Slack @channel 멘션 + Webhook 반복 알림
     "🚨 [긴급] op-geth 장애 미해결 (30분 경과). 즉시 확인 필요"
```

---

## 7. 안전장치

### 7.1 실행 제한

| 제한 | 값 | 설명 |
|------|----|------|
| Cooldown | 5분 | 동일 대상에 대한 복구 간격 |
| 시간당 최대 실행 | 3회 | 동일 Playbook의 시간당 실행 횟수 |
| 일일 최대 실행 | 10회 | 전체 자동 복구의 일일 총 횟수 |
| 최대 동시 실행 | 1건 | 복구 작업 직렬화 (충돌 방지) |
| 스케일업 상한 | 4 vCPU | 자동으로 올릴 수 있는 최대 vCPU |

### 7.2 Circuit Breaker

```
같은 장애에 대해 자동 복구가 연속 3회 실패하면:
  → 해당 Playbook을 24시간 동안 비활성화
  → 운영자에게 알림: "자동 복구 반복 실패. 수동 개입 필요."
  → Circuit Breaker 상태를 대시보드에 표시
```

### 7.3 Kill Switch

```
AUTO_REMEDIATION_ENABLED=false  # 모든 자동 복구 즉시 중단
```

운영자가 대시보드 UI에서도 토글 가능.

### 7.4 Dry Run 모드

`SCALING_SIMULATION_MODE=true`(기존 환경변수)일 때 모든 복구 액션은 로그만 남기고 실제 실행하지 않음.

---

## 8. 타입 정의

### 8.1 파일: `src/types/remediation.ts` (신규)

```typescript
/**
 * Auto-Remediation Engine Type Definitions
 */

import type { RCAComponent } from './rca';
import type { AISeverity } from './scaling';

// ============================================================
// Action Types
// ============================================================

/** 복구 액션의 안전 등급 */
export type SafetyLevel = 'safe' | 'guarded' | 'manual';

/** 사전 정의된 복구 액션 타입 */
export type RemediationActionType =
  // Safe
  | 'collect_logs'
  | 'health_check'
  | 'check_l1_connection'
  | 'describe_pod'
  // Guarded
  | 'restart_pod'
  | 'scale_up'
  | 'scale_down'
  | 'zero_downtime_swap'
  // Manual
  | 'config_change'
  | 'rollback_deployment'
  | 'force_restart_all';

/** 단일 복구 액션 */
export interface RemediationAction {
  type: RemediationActionType;
  safetyLevel: SafetyLevel;
  target?: RCAComponent;
  params?: Record<string, unknown>;
  /** 실행 후 대기 시간 (ms) */
  waitAfterMs?: number;
}

// ============================================================
// Playbook Types
// ============================================================

/** 트리거 조건 */
export interface PlaybookTrigger {
  component: RCAComponent;
  indicators: PlaybookIndicator[];
}

export interface PlaybookIndicator {
  type: 'metric' | 'log_pattern';
  /** 메트릭 조건 (예: "cpuPercent > 90") 또는 로그 패턴 (정규식) */
  condition: string;
}

/** Playbook 정의 */
export interface Playbook {
  name: string;
  description: string;
  trigger: PlaybookTrigger;
  actions: RemediationAction[];
  fallback?: RemediationAction[];
  /** 에스컬레이션 전 최대 시도 횟수 */
  maxAttempts: number;
}

// ============================================================
// Execution Types
// ============================================================

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'escalated';

/** 단일 액션의 실행 결과 */
export interface ActionResult {
  action: RemediationAction;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  output?: string;
  error?: string;
}

/** Playbook 실행 전체 기록 */
export interface RemediationExecution {
  id: string;
  playbookName: string;
  triggeredBy: 'auto' | 'manual';
  anomalyEventId?: string;
  status: ExecutionStatus;
  actions: ActionResult[];
  escalationLevel: number;
  startedAt: string;
  completedAt?: string;
}

// ============================================================
// Escalation Types
// ============================================================

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface EscalationState {
  level: EscalationLevel;
  /** Level 2 이후 운영자 응답 대기 시작 시간 */
  awaitingSince?: string;
  /** 운영자 응답 여부 */
  acknowledged: boolean;
}

// ============================================================
// Configuration Types
// ============================================================

export interface RemediationConfig {
  enabled: boolean;
  /** Guarded 액션 자동 실행 허용 여부 */
  allowGuardedActions: boolean;
  cooldownMinutes: number;
  maxExecutionsPerHour: number;
  maxExecutionsPerDay: number;
  /** 자동 스케일업 최대 vCPU */
  maxAutoScaleVcpu: number;
  /** Circuit breaker: 연속 실패 시 비활성화 임계값 */
  circuitBreakerThreshold: number;
}

/** Circuit Breaker 상태 */
export interface CircuitBreakerState {
  playbookName: string;
  consecutiveFailures: number;
  isOpen: boolean;
  openedAt?: string;
  /** 비활성화 해제 시간 */
  resetAt?: string;
}
```

---

## 9. 신규 모듈 명세

### 9.1 `src/lib/remediation-engine.ts`

Layer 4의 메인 오케스트레이터. 이상 이벤트를 받아 Playbook 매칭 → 실행 → 모니터링까지 수행.

```typescript
/**
 * Layer 4: Auto-Remediation Engine
 * 이상 탐지 → 자동 복구 루프 완결
 */

// === Public API ===

/** 이상 이벤트에 대한 자동 복구 실행 */
export async function executeRemediation(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult,
  rca?: RCAResult
): Promise<RemediationExecution>;

/** 수동 Playbook 실행 */
export async function executePlaybook(
  playbookName: string,
  triggeredBy: 'manual'
): Promise<RemediationExecution>;

/** 현재 설정 조회/수정 */
export function getRemediationConfig(): RemediationConfig;
export function updateRemediationConfig(partial: Partial<RemediationConfig>): RemediationConfig;

/** 실행 이력 조회 */
export function getExecutionHistory(limit?: number): RemediationExecution[];

/** Circuit Breaker 상태 조회 */
export function getCircuitBreakerStates(): CircuitBreakerState[];

/** Circuit Breaker 수동 리셋 */
export function resetCircuitBreaker(playbookName: string): void;
```

**핵심 로직:**

```
1. Config 확인 (enabled? simulation mode?)
2. Cooldown 확인 (최근 실행과 간격)
3. Rate limit 확인 (시간당/일일 실행 횟수)
4. Circuit breaker 확인 (해당 Playbook 활성 여부)
5. Playbook 매칭 (패턴 기반)
6. 액션별 safety level 확인
   - Safe → 즉시 실행
   - Guarded → allowGuardedActions && 제한 조건 확인 후 실행
   - Manual → 건너뛰고 에스컬레이션
7. 액션 순차 실행 (waitAfterMs 대기 포함)
8. 실행 후 메트릭 재확인 (30초 대기)
9. 미해결 시 fallback 실행 또는 에스컬레이션
10. 결과 저장 + 알림
```

### 9.2 `src/lib/playbook-matcher.ts`

장애 패턴을 Playbook에 매칭하는 모듈.

```typescript
/**
 * Playbook Matcher
 * AnomalyEvent + 메트릭/로그 패턴 → 적합한 Playbook 선택
 */

/** 등록된 Playbook 목록 (코드 내 하드코딩) */
export const PLAYBOOKS: Playbook[];

/** 이벤트에 매칭되는 Playbook 찾기 */
export function matchPlaybook(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult,
  rca?: RCAResult
): Playbook | null;
```

**매칭 우선순위:**
1. RCA 결과의 `rootCause.component` 기반 매칭 (가장 정확)
2. DeepAnalysis의 `severity` + `affectedMetrics` 기반 매칭
3. AnomalyEvent의 `anomalies` 필드 기반 매칭
4. 매칭 없음 → `null` 반환 (AI fallback은 remediation-engine에서 처리)

### 9.3 `src/lib/action-executor.ts`

개별 복구 액션을 실행하는 모듈. 기존 K8s 모듈을 래핑.

```typescript
/**
 * Action Executor
 * RemediationAction → 실제 K8s 작업 실행
 */

/** 단일 액션 실행 */
export async function executeAction(
  action: RemediationAction,
  config: K8sConfig
): Promise<ActionResult>;
```

**액션별 실행 로직:**

| 액션 | 실행 방식 |
|------|---------|
| `collect_logs` | 기존 log-ingester.ts 호출 |
| `health_check` | kubectl get pod + RPC 호출로 상태 확인 |
| `check_l1_connection` | viem으로 L1 blockNumber 조회 |
| `describe_pod` | kubectl describe pod |
| `restart_pod` | kubectl delete pod (StatefulSet이 자동 재생성) |
| `scale_up` | k8s-scaler.ts의 `scaleOpGeth()` 호출 |
| `scale_down` | k8s-scaler.ts의 `scaleOpGeth()` 호출 |
| `zero_downtime_swap` | zero-downtime-scaler.ts의 `zeroDowntimeScale()` 호출 |

### 9.4 `src/lib/remediation-store.ts`

실행 이력 및 Circuit Breaker 상태를 인메모리로 관리.

```typescript
/**
 * Remediation Store
 * 실행 이력 + Circuit Breaker 상태 관리 (in-memory)
 */

/** 실행 기록 저장 (최대 100건 보관) */
export function addExecution(execution: RemediationExecution): void;

/** 최근 실행 이력 조회 */
export function getExecutions(limit?: number): RemediationExecution[];

/** 특정 Playbook의 최근 실행 시간 조회 (cooldown용) */
export function getLastExecutionTime(playbookName: string): Date | null;

/** 시간당/일일 실행 횟수 조회 (rate limit용) */
export function getExecutionCount(windowMs: number): number;

/** Circuit Breaker 상태 관리 */
export function recordFailure(playbookName: string): void;
export function recordSuccess(playbookName: string): void;
export function isCircuitOpen(playbookName: string): boolean;
export function getCircuitStates(): CircuitBreakerState[];
export function resetCircuit(playbookName: string): void;
```

---

## 10. 기존 모듈 수정

### 10.1 `src/lib/alert-dispatcher.ts` 수정

Layer 3 알림 발송 후 Layer 4 자동 복구를 트리거하는 연결점 추가:

```typescript
// dispatch() 함수 끝에 추가:
// Layer 4: Auto-Remediation 트리거
if (config.autoRemediation !== false) {
  const { executeRemediation } = await import('./remediation-engine');
  // 비동기로 실행 (알림 응답을 차단하지 않음)
  executeRemediation(event, analysis).catch(err =>
    console.error('[Layer4] Remediation failed:', err)
  );
}
```

### 10.2 `src/types/anomaly.ts` 수정

AlertConfig에 자동 복구 토글 추가:

```typescript
// AlertConfig에 필드 추가:
export interface AlertConfig {
  // ... 기존 필드
  /** Layer 4 자동 복구 활성화 (default: false) */
  autoRemediation?: boolean;
}
```

---

## 11. API 명세

### 11.1 `GET /api/remediation`

자동 복구 상태 및 실행 이력 조회.

**Response:**
```json
{
  "config": {
    "enabled": true,
    "allowGuardedActions": true,
    "cooldownMinutes": 5,
    "maxExecutionsPerHour": 3,
    "maxExecutionsPerDay": 10,
    "maxAutoScaleVcpu": 4,
    "circuitBreakerThreshold": 3
  },
  "circuitBreakers": [
    {
      "playbookName": "op-geth-resource-exhaustion",
      "consecutiveFailures": 0,
      "isOpen": false
    }
  ],
  "recentExecutions": [
    {
      "id": "rem_abc123",
      "playbookName": "op-geth-resource-exhaustion",
      "triggeredBy": "auto",
      "status": "success",
      "actions": [...],
      "escalationLevel": 0,
      "startedAt": "2026-02-09T06:30:00Z",
      "completedAt": "2026-02-09T06:31:15Z"
    }
  ]
}
```

### 11.2 `POST /api/remediation`

수동 Playbook 실행.

**Request:**
```json
{
  "playbookName": "op-geth-resource-exhaustion"
}
```

### 11.3 `PATCH /api/remediation`

설정 변경.

**Request:**
```json
{
  "enabled": true,
  "allowGuardedActions": false
}
```

---

## 12. 환경 변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AUTO_REMEDIATION_ENABLED` | `false` | 자동 복구 Kill Switch |
| `REMEDIATION_ALLOW_GUARDED` | `true` | Guarded 액션 자동 실행 허용 |
| `REMEDIATION_COOLDOWN_MIN` | `5` | 동일 대상 복구 간격 (분) |
| `REMEDIATION_MAX_VCPU` | `4` | 자동 스케일업 최대 vCPU |

**기존 환경변수 재사용:**
- `SCALING_SIMULATION_MODE=true` → 모든 복구 액션 Dry Run
- `ALERT_WEBHOOK_URL` → 복구 결과 알림 전송

---

## 13. 테스트 검증

### 13.1 유닛 테스트

| 테스트 파일 | 검증 대상 |
|------------|----------|
| `playbook-matcher.test.ts` | 패턴 매칭 정확도, 우선순위, 매칭 실패 케이스 |
| `action-executor.test.ts` | 각 액션 타입별 실행 (simulation mode) |
| `remediation-engine.test.ts` | Cooldown, rate limit, circuit breaker 동작 |
| `remediation-store.test.ts` | 이력 저장/조회, 순환 버퍼 |

### 13.2 통합 테스트 시나리오

```
시나리오 1: op-geth OOM → 자동 스케일업 → 정상화 확인
시나리오 2: 연속 3회 실패 → Circuit Breaker 동작 확인
시나리오 3: Rate limit 초과 → 실행 거부 확인
시나리오 4: Manual 액션 → 건너뛰고 에스컬레이션 확인
시나리오 5: Simulation mode → 로그만 남기고 실행 안 함 확인
```

---

## 14. 의존관계

```
기존 모듈 (변경 없이 사용):
  ├─ k8s-scaler.ts          → scale_up, scale_down 실행
  ├─ k8s-config.ts          → kubectl 명령 실행
  ├─ zero-downtime-scaler.ts → zero_downtime_swap 실행
  └─ anomaly-event-store.ts → 이벤트 ID 참조

기존 모듈 (경미한 수정):
  ├─ alert-dispatcher.ts    → Layer 4 트리거 연결점 추가
  └─ types/anomaly.ts       → AlertConfig에 autoRemediation 필드 추가

신규 모듈:
  ├─ types/remediation.ts   → 타입 정의
  ├─ remediation-engine.ts  → 오케스트레이터
  ├─ playbook-matcher.ts    → 패턴 매칭
  ├─ action-executor.ts     → 액션 실행
  └─ remediation-store.ts   → 이력 저장

신규 API:
  └─ /api/remediation        → GET/POST/PATCH
```

```
의존 방향:
  alert-dispatcher.ts
    └─▶ remediation-engine.ts
           ├─▶ playbook-matcher.ts
           ├─▶ action-executor.ts
           │     ├─▶ k8s-scaler.ts (기존)
           │     ├─▶ zero-downtime-scaler.ts (기존)
           │     └─▶ k8s-config.ts (기존)
           └─▶ remediation-store.ts
```
