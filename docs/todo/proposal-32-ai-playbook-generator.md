# Proposal 32: Self-Evolving Playbook System

> Date: 2026-02-27
> Owner: SentinAI Core
> Scope: 운영 데이터 자기 학습 → 플레이북 자동 진화 → 자율성 수준 점진적 상승

---

## 1) 핵심 원칙

> SentinAI는 스스로 운영 데이터를 쌓으면서 플레이북을 만들고 그에 맞춰서 대응한다.

단순한 "AI가 플레이북을 생성해준다"가 아니다.
**에이전트 루프 자체가 학습 데이터를 생산하고, 그 데이터로 자신의 대응 능력을 진화시킨다.**

```
[기존 – 정적]
고정 플레이북 → 패턴 매칭 → 실행

[이 제안 – 자기 진화]
감지 → 실행 → 검증 → 결과 기록
                          ↓
                    패턴 분석 (주기적)
                          ↓
                  플레이북 생성/강화/폐기
                          ↓
                  다음 대응이 더 빠르고 정확
                          ↓
                      다시 반복
```

---

## 2) 아키텍처

### 2.1 학습 루프 전체 흐름

```
[에이전트 루프 – 매 사이클]

CollectorAgent  →  MetricsStore
DetectorAgent   →  AnomalyEvent 발생
                         ↓
ExecutorAgent   →  플레이북 실행 시작
                   OperationLedger.recordStart(anomalyId, playbookId, action)
                         ↓
VerifierAgent   →  결과 검증 (post-condition 확인)
                   OperationLedger.recordOutcome(operationId, result)
                         ↑
                   ← 이 단계가 학습 데이터 생산 지점

[PatternMiner – 주기적 (예: 매일 새벽)]
  OperationLedger 분석
    → 동일 패턴 N회 이상 반복 감지
    → 성공률 계산
    → PlaybookEvolver에 PatternCandidate 전달

[PlaybookEvolver – PatternMiner 결과 수신 시]
  기존 플레이북과 매칭
    → 없으면: draft 플레이북 자동 생성
    → 있으면: confidence 업데이트
    → 임계값 도달 시: 자율성 수준 승격 알림
```

### 2.2 핵심 모듈

```
src/core/operation-ledger.ts      // 모든 실행 결과 영속 저장 (학습 원천)
src/core/pattern-miner.ts         // 렛저 분석 → 반복 패턴 추출
src/core/playbook-evolver.ts      // 패턴 기반 플레이북 생성/강화/폐기
src/core/playbook-confidence.ts   // confidence 계산 및 이력 관리
```

### 2.3 OperationLedger

```typescript
// 모든 실행 결과를 Redis에 영속 저장
// inst:{id}:ledger:{operationId}

interface OperationRecord {
  operationId: string
  instanceId: string
  timestamp: string
  trigger: {
    anomalyType: string         // 'z-score' | 'threshold' | 'plateau' | 'monotonic'
    metricName: string          // 'txPoolPending' | 'blockHeight' | ...
    zScore?: number
    metricValue: number
  }
  playbookId: string | null     // 적용된 플레이북 (없으면 null)
  action: string                // 'scale-4vcpu' | 'restart-batcher' | 'failover-l1' | ...
  outcome: 'success' | 'failure' | 'partial' | 'timeout'
  resolutionMs: number          // 이상 감지 → 정상화까지 걸린 시간
  verificationPassed: boolean
  failureReason?: string
}
```

### 2.4 PatternMiner

```typescript
// 렛저에서 반복 패턴 추출
// 패턴 = (trigger 조건, action) 쌍의 반복

interface PatternCandidate {
  triggerSignature: string      // 정규화된 트리거 패턴 (해시)
  action: string
  occurrences: number           // 발생 횟수
  successRate: number           // 0.0–1.0
  avgResolutionMs: number
  samples: OperationRecord[]    // 근거 샘플 (최대 10개)
}

// 패턴 추출 조건:
// - 동일 (triggerSignature, action) 쌍이 3회 이상 발생
// - 최근 30일 이내 데이터
// - instanceId 스코프 격리 (인스턴스별 독립 학습)
```

### 2.5 Confidence 생명주기

```
[초기 상태]
새 인스턴스 → 범용 플레이북으로 시작 (confidence: 0.5)

[confidence 변화 규칙]
성공 1회: +0.05
실패 1회: -0.20  (실패는 성공보다 4배 빠르게 감소)
partial:  +0.01
timeout:  -0.10

[confidence 임계값과 자율성 수준]
0.00 – 0.40  : draft         → 관찰만, 실행 안 함
0.40 – 0.70  : pending       → 팀/운영자에게 검토 요청 알림
0.70 – 0.90  : approved      → execute-with-approval (실행 전 확인 필요)
0.90 –  1.00  : trusted       → full-auto 승격 가능 (운영자 명시적 opt-in 필요)

[폐기 조건]
- confidence < 0.30으로 하락 + 최근 7일 사용 없음 → archived
- 5회 연속 실패 → 즉시 suspended + 팀 알림
```

---

## 3) 플레이북 DNA

각 플레이북은 정적 절차서가 아닌, 운영 경험이 축적된 살아있는 문서다.

```typescript
interface EvolvedPlaybook extends Playbook {
  // 학습 기반 필드
  confidence: number
  reviewStatus: 'draft' | 'pending' | 'approved' | 'trusted' | 'archived' | 'suspended'
  generatedFrom: 'hardcoded' | 'pattern' | 'ai-assisted'

  performance: {
    totalApplications: number
    successRate: number
    avgResolutionMs: number
    lastApplied: string
    lastOutcome: 'success' | 'failure' | 'partial'
  }

  evolution: {
    version: number                // 개정 횟수
    changelog: EvolutionEntry[]    // 언제 어떻게 바뀌었는지
  }
}

interface EvolutionEntry {
  version: number
  timestamp: string
  reason: string    // "5회 연속 성공으로 confidence 승격" | "실패율 증가로 단계 조정"
  confidenceDelta: number
  changedBy: 'system' | 'team' | 'operator'
}
```

---

## 4) 콜드 스타트 처리

신규 인스턴스는 운영 이력이 없다.

```
Day 0    : 온보딩 → 범용 기본 플레이북 적용 (confidence: 0.5, hardcoded)
Day 1–6  : 에이전트 루프 실행 → OperationLedger 데이터 누적
Day 7    : PatternMiner 첫 실행
           → 패턴 발견 시: draft 플레이북 자동 생성
           → 미발견 시: 다음 주까지 기본 플레이북 유지

신규 인스턴스 bootstrapping 옵션:
  1. 동일 프로토콜의 다른 인스턴스 패턴 참조 (cross-instance 학습)
  2. vector-store의 유사 환경 사례로 초기 confidence 부여
  3. 팀이 초기 플레이북 수동 설정 (Premium)
```

---

## 5) AI의 역할 재정의

이 아키텍처에서 AI는 생성자가 아닌 **가속기**다.

```
[AI 없이도 동작하는 것]
  - 패턴 발견 (통계 기반)
  - confidence 계산 (규칙 기반)
  - 자율성 수준 조정 (임계값 기반)

[AI가 가속하는 것]
  - 패턴의 의미 해석 ("txPool 급증 + 피어 감소 = L1 연결 불안정")
  - 플레이북 단계의 순서/조건 최적화 제안
  - 실패 원인 분석 및 플레이북 수정 제안
  - 새 이상 유형에 대한 초기 플레이북 초안 (통계 데이터 부족 시 보완)

→ AI가 느리거나 실패해도 학습·실행 루프는 중단되지 않는다.
```

---

## 6) VerifierAgent와의 통합

병렬 에이전트 구조(proposal C1)의 VerifierAgent가 이 시스템의 학습 데이터 생산자다.

```
VerifierAgent 현재 역할:
  실행 후 post-condition 확인 → 성공/실패 판단

VerifierAgent 확장 역할:
  성공/실패 판단 → OperationLedger.recordOutcome() 호출
                → PlaybookEvolver에 결과 전파
                → confidence 업데이트 트리거

// VerifierAgent가 없으면 학습이 없다.
// 실행 결과를 기록하지 않으면 시스템은 영원히 같은 실수를 반복한다.
```

---

## 7) 자율성 수준 자동 진화 흐름

```
[신규 인스턴스]
observe-only (기본 정책)
     ↓  7일 운영 + 첫 패턴 발견
draft 플레이북 생성
     ↓  3회 성공 (confidence ≥ 0.7)
팀/운영자에게 "플레이북 승격 대기" 알림
     ↓  팀 승인
execute-with-approval 활성화
     ↓  10회 이상 성공 (confidence ≥ 0.9) + 운영자 명시적 opt-in
full-auto 활성화 (해당 플레이북 한정)
```

---

## 8) API

```
GET  /api/v2/instances/{id}/playbooks
     → 플레이북 목록 (confidence, status, performance 포함)

GET  /api/v2/instances/{id}/playbooks/{playbookId}/history
     → 적용 이력 + 결과 + confidence 변화 타임라인

GET  /api/v2/instances/{id}/operation-ledger
     → 원시 실행 기록 (디버깅, 감사용)

POST /api/v2/instances/{id}/playbooks/{playbookId}/approve
     → 팀/운영자 승인 (pending → approved)

POST /api/v2/instances/{id}/playbooks/{playbookId}/promote
     → full-auto 수동 승격 (운영자 명시적 opt-in, confidence ≥ 0.9 조건)

POST /api/v2/instances/{id}/playbooks/{playbookId}/suspend
     → 즉시 중지 (이상 동작 감지 시)

POST /api/v2/instances/{id}/pattern-miner/run
     → PatternMiner 수동 트리거 (기본은 자동 실행)
```

---

## 9) 구현 조건 (Prerequisites)

| 조건 | 출처 | 상태 |
|------|------|------|
| VerifierAgent 구현 | Day 3 C1 (병렬 에이전트) | 30일 플랜 포함 |
| Redis 영속화 | 기존 `REDIS_URL` | 이미 지원 |
| vector-store | Day 2 B4 | 30일 플랜 포함 |
| RCA 이력 저장 | rca-engine.ts 확장 필요 | 미구현 |
| 인스턴스별 네임스페이스 격리 | Day 1 A2 | 30일 플랜 포함 |

→ **30일 플랜 완료 후 구현 가능. 단, RCA 이력 Redis 저장은 선행 필요.**

---

## 10) 기대 효과

| 관점 | 효과 |
|------|------|
| **대응 속도** | 경험이 쌓일수록 같은 이상에 빠르게 대응 (히스토리 기반 즉각 실행) |
| **오탐 감소** | 해당 노드 패턴에 최적화된 임계값 → 범용 Z-Score보다 정확 |
| **Premium 확장성** | 팀이 검토만 하면 됨 → 팀 1명이 감당 가능한 고객 수 10배 |
| **자율성 성장** | observe-only → full-auto까지 데이터로 증명하며 단계적 상승 |
| **투명성** | 모든 학습 결과가 로그·UI로 추적 가능 → 블랙박스 없음 |

---

## 11) Out of Scope

1. 실시간 플레이북 생성 (PatternMiner는 배치, 실시간 아님)
2. 크로스 인스턴스 자동 플레이북 공유 (참조는 가능, 자동 적용은 불가)
3. 비EVM 체인 (EVM 계열만)
4. 완전 무인 full-auto 기본 활성화 (운영자 명시적 opt-in 필수)
