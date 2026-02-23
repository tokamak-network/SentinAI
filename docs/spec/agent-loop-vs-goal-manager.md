# Agent Loop vs Goal Manager: Functional Comparison

> SentinAI 자율 에이전트 시스템 비교 — 언제 무엇이 작동하는가

**작성일:** 2026-02-23
**대상 독자:** Operator, Developer

---

## 개요

SentinAI에는 두 가지 독립적이지만 상호보완적인 자율 에이전트 시스템이 공존합니다.

| | Agent Loop | Goal Manager |
|--|-----------|-------------|
| **역할** | 반응형 즉각 대응 | 계획형 목표 기반 실행 |
| **철학** | "지금 무슨 일이 일어나고 있는가?" | "앞으로 무엇을 해야 하는가?" |
| **비유** | 소방관 (즉시 진화) | 전략가 (우선순위 판단 후 실행) |

두 시스템은 같은 메트릭 저장소와 Agent Memory를 공유하며, cooldown을 통해 충돌 없이 협력합니다.

---

## 핵심 동작 방식

### Agent Loop

매 60초마다 자동 실행되는 6단계 파이프라인:

```
observe → detect → analyze → plan → act → verify
```

1. **Observe** — L1/L2 RPC에서 블록 높이, TxPool, 가스율, EOA 잔액 수집
2. **Detect** — 3계층 이상 탐지 (Z-Score → AI 분석 → Slack 알림)
3. **Analyze** — 로그 AI 분석으로 심각도 판단 (`low` / `medium` / `high` / `critical`)
4. **Plan** — 스케일링 점수 계산 + 예측 스케일링 override
5. **Act** — K8s 스케일링 실행, L1 RPC failover 실행
6. **Verify** — 실행 결과 검증, 실패 시 자동 rollback

### Goal Manager

Agent Loop이 매 cycle마다 `tickGoalManager()`를 호출하면 작동:

```
Signal Collection → Candidate Generation → Prioritization → Queue → Dispatch
```

1. **Signal Collection** — 6개 신호원(메트릭, 이상, failover, 비용, 메모리, 정책) 통합 snapshot 생성
2. **Candidate Generation** — 신호 패턴에서 목표 후보 자동 생성 (최대 6개)
3. **Prioritization** — 4가지 요소(impact, urgency, confidence, policyFit) 점수 계산
4. **Queue** — 점수 기준 정렬, 중복/정책 위반 자동 억제(suppression)
5. **Dispatch** — 최우선 goal 선택 후 plan-and-execute (기본값: dry-run)

---

## 케이스별 커버 가능 여부

### 즉각 대응 (Real-time Response)

| 시나리오 | Agent Loop | Goal Manager | 비고 |
|---------|:---------:|:------------:|------|
| L2 블록 지연 즉시 감지 | ✅ | ⏳ | Loop은 60초 내 탐지, GM은 큐 대기 후 실행 |
| CPU 급증 시 즉시 스케일업 | ✅ | ⏳ | Loop이 K8s 패치 직접 실행 |
| L1 RPC 장애 즉시 failover | ✅ | ❌ | Loop 전담 기능 |
| 이상 탐지 즉시 Slack 알림 | ✅ | ❌ | Loop 전담 (3계층 파이프라인) |
| 실행 결과 검증 + 자동 rollback | ✅ | ❌ | Loop의 verify 단계 |

### 계획적 대응 (Deliberative Response)

| 시나리오 | Agent Loop | Goal Manager | 비고 |
|---------|:---------:|:------------:|------|
| 다수 신호 종합 후 우선순위 결정 | ❌ | ✅ | 6개 신호원 통합 분석 |
| "비용 최적화" 같은 복합 목표 수행 | ❌ | ✅ | `optimize` intent 기반 goal 생성 |
| 반복 실패 시 재시도 + 지수 백오프 | ❌ | ✅ | 최대 2회, 최대 5분 대기 |
| 실패한 goal 격리 후 수동 재실행 | ❌ | ✅ | Dead Letter Queue (DLQ) 지원 |
| 복수 이상 동시 발생 시 순서 보장 | ❌ | ✅ | critical > high > medium 우선순위 |

### 안전 제어 (Safety Controls)

| 시나리오 | Agent Loop | Goal Manager | 비고 |
|---------|:---------:|:------------:|------|
| cooldown 중 중복 스케일링 방지 | ✅ | ✅ | 공유 cooldown 확인 |
| 분산 환경 동시 실행 충돌 방지 | ❌ | ✅ | Lease 기반 분산 잠금 (120초) |
| 같은 goal 중복 실행 방지 | ❌ | ✅ | Idempotency key (1시간) |
| dry-run으로 안전하게 테스트 | ⚠️ 부분 | ✅ | GM은 기본값이 dry-run |
| 낮은 신뢰도 goal 자동 억제 | ❌ | ✅ | score < 30이면 suppressed 처리 |
| read-only 정책 시 쓰기 차단 | ❌ | ✅ | `policyFit` 점수로 반영 |

### 학습 및 자기 개선 (Learning & Self-Improvement)

| 시나리오 | Agent Loop | Goal Manager | 비고 |
|---------|:---------:|:------------:|------|
| 의사결정 전 과정 trace 기록 | ✅ | ⚠️ | Loop 전담, GM은 goal 실행 기록만 |
| 이전 사이클 메모리 참조해 결정 | ✅ | ✅ | AgentMemory 공유 |
| 실행 결과 학습 에피소드로 저장 | ❌ | ✅ | ML 파인튜닝용 데이터 축적 |
| 성공/실패율 기반 알고리즘 개선 | ❌ | ✅ | `GoalPriorityScore` 피드백 루프 |

### 사람의 개입 필요 여부 (Human Intervention)

| 시나리오 | Agent Loop | Goal Manager | 비고 |
|---------|:---------:|:------------:|------|
| 스케일링 자동 실행 | ✅ 자동 | ❌ 수동 필요 | GM은 `allowWrites=true` 명시 필요 |
| L1 RPC 전환 자동 실행 | ✅ 자동 | ❌ 미지원 | |
| 목표 실행 전 승인 요구 | ❌ | ✅ | API key + `allowWrites` 필요 |
| DLQ 재실행 트리거 | N/A | ✅ 수동 | `POST /api/goal-manager/replay` |

---

## 스케일링 점수 계산 (Agent Loop)

하이브리드 점수 = CPU(0–30) + Gas(0–30) + TxPool(0–20) + AI Severity(0–20)

| 점수 범위 | 단계 | 목표 vCPU |
|----------|------|----------|
| < 30 | Idle | 1 vCPU |
| 30–69 | Normal | 2 vCPU |
| 70–76 | High | 4 vCPU |
| ≥ 77 | Emergency | 8 vCPU |

예측 스케일링이 활성화된 경우, AI 예측 신뢰도 ≥ 0.6이면 기본 점수를 override합니다.

---

## Goal 우선순위 점수 (Goal Manager)

| 요소 | 최대 점수 | 설명 |
|------|---------|------|
| `impact` | 40 | 비즈니스 임팩트 (anomaly 수, CPU 수준) |
| `urgency` | 25 | 시간 긴급도 (trend 방향, 심각도) |
| `confidence` | 20 | 신호 신뢰도 (0–1 스케일) |
| `policyFit` | 15 | 정책 준수 (auto-scaling 허용 여부) |
| **total** | **100** | 점수 높은 순으로 큐 정렬 |

### Suppression 조건

Goal이 큐에 들어가지 않는 경우:

| 코드 | 조건 |
|------|------|
| `duplicate_goal` | 같은 signature가 이미 큐에 존재 |
| `low_confidence` | 종합 점수 < 30 |
| `policy_blocked` | read-only 모드 활성 |
| `cooldown_active` | 스케일링 cooldown 진행 중 |
| `stale_signal` | 신호가 5분 이상 경과 |

---

## 두 시스템의 실행 흐름

```
타이머 (60초)
  │
  ▼
Agent Loop 사이클 시작
  ├── Phase 1: 메트릭 수집 (L1/L2 RPC)
  ├── Phase 2: 이상 탐지 파이프라인
  ├── Phase 3: AI 로그 분석
  │
  ├── Phase 3.5: tickGoalManager() ◄── Goal Manager 통합점
  │               ├── 신호 snapshot 수집
  │               ├── goal 후보 생성
  │               ├── 우선순위 정렬
  │               └── 큐 업데이트
  │
  ├── Phase 4: 스케일링 결정 (예측 override 포함)
  ├── Phase 5: K8s 실행 (cooldown 확인 후)
  └── Phase 6: 결과 검증 + 메모리 기록
                    │
                    ▼
              AgentMemory, DecisionTrace 저장
              (다음 사이클 + Goal Manager가 참조)
```

---

## 환경 변수로 제어하기

### Agent Loop 제어

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `AGENT_LOOP_ENABLED` | L2_RPC_URL 설정 시 자동 활성 | Agent Loop 활성화 여부 |
| `SCALING_SIMULATION_MODE` | `true` | K8s 변경 시뮬레이션 (실제 변경 없음) |
| `AUTO_REMEDIATION_ENABLED` | `false` | Layer 4 자동 복구 활성화 |

### Goal Manager 제어

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `GOAL_MANAGER_ENABLED` | `false` | Goal Manager 전체 활성화 |
| `GOAL_MANAGER_DISPATCH_ENABLED` | `false` | Goal 실행 활성화 |
| `GOAL_MANAGER_DISPATCH_DRY_RUN` | `true` | dry-run 모드 (실행 없음) |
| `GOAL_MANAGER_DISPATCH_ALLOW_WRITES` | `false` | 실제 쓰기 권한 허용 |
| `GOAL_CANDIDATE_LLM_ENABLED` | `false` | AI로 goal 문구 개선 활성화 |

---

## API 엔드포인트

### Agent Loop

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/agent-loop` | 최근 사이클 결과, 상태, 설정 조회 |
| GET | `/api/agent-decisions` | 의사결정 히스토리 |
| GET | `/api/agent-memory` | Agent Memory 엔트리 조회 |

### Goal Manager

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/goal-manager` | 큐, DLQ, 후보, 설정 조회 |
| POST | `/api/goal-manager/tick` | 수동으로 tick 실행 (신호 수집 + 큐 업데이트) |
| POST | `/api/goal-manager/dispatch` | 최우선 goal 즉시 실행 (auth 필요) |
| POST | `/api/goal-manager/replay` | DLQ에서 goal 재실행 (auth 필요) |

---

## 한 줄 요약

> **Agent Loop**은 지금 위험한 상황에 즉시 대응하고, **Goal Manager**는 여러 신호를 종합해 가장 중요한 것부터 계획적으로 처리합니다. 두 시스템은 협력하되 충돌하지 않습니다.
