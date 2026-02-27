# 제안 26: 자율 목표 생성 엔진 (Phase 2)

> 작성일: 2026-02-22  
> 상태: 계획  
> 분기: Q2-Q3 (2026-03 ~ 2026-08)

---

## 1. 배경

현재 SentinAI는 아래 기반을 갖추고 있다.

1. Claude Code MCP 브리지 + 가드된 도구 실행
2. LLM 보조 목표 계획 + validator/replan fallback
3. 주요 write 액션 검증/롤백
4. 결정론적 자율성 평가 및 스코어카드

완전 자율까지 남은 갭:

1. 목표 생성이 사용자 트리거/고정 루프 중심
2. 에이전트가 스스로 목표를 지속 생성/우선순위화하지 못함
3. 장기 시계열 목표 관리가 1급 기능이 아님

---

## 2. 완전 자율까지 남은 작업

우선순위 백로그:

1. Goal Generation Engine (본 제안)
2. 내구성 실행 오케스트레이터(큐/체크포인트/재시도/타임아웃)
3. verifier/rollback 계약의 전 도구 커버리지
4. 위험 등급 기반 자율 정책(A0-A5) 및 적응형 승인
5. 통합 상태 그래프와 신뢰도 기반 인과 추론
6. 리플레이/사고 데이터 기반 학습 루프
7. 운영 등급 shadow/canary 자율 게이트
8. 보안/거버넌스 강화(최소권한, 불변 감사, 킬스위치)

---

## 3. 목표

다음을 지속 수행하는 자율 Goal Generation Engine을 구축한다.

1. 다중 신호(메트릭/이상/페일오버/비용/결정 메모리) 수집
2. 운영 목표 후보 생성
3. 정책/위험 제약을 반영한 점수화·우선순위화
4. 실행 가능한 목표를 관리 큐에 게시

성공 기준:

1. 사용자 프롬프트 없이 목표를 생성
2. 동일 입력에서 결정론적 목표 정렬
3. 위험/저신뢰 목표를 실행 전에 필터링

---

## 4. 범위 및 비목표

In scope:

1. 목표 후보 생성 및 큐 수명주기
2. 우선순위 점수화 및 suppression/dedup 규칙
3. 기존 `goal-planner`/`agent-loop`와 연동

Out of scope:

1. 멀티에이전트 협상/합의 프로토콜
2. 온라인 학습 기반 완전 자가 정책 튜닝
3. 크로스 클러스터 분산 스케줄러

---

## 5. 아키텍처 계획

## 5.1 신규 타입

`src/types/goal-manager.ts` 추가:

1. `AutonomousGoalSource` (`metrics`, `anomaly`, `policy`, `cost`, `failover`, `memory`)
2. `AutonomousGoalStatus` (`candidate`, `queued`, `scheduled`, `running`, `completed`, `failed`, `suppressed`, `expired`)
3. `AutonomousGoalRisk` (`low`, `medium`, `high`, `critical`)
4. `AutonomousGoalCandidate`, `AutonomousGoalQueueItem`, `GoalPriorityScore`
5. `GoalSuppressionReasonCode` (`duplicate_goal`, `low_confidence`, `policy_blocked`, `cooldown_active`, `stale_signal`)

## 5.2 신규 모듈

1. `src/lib/goal-signal-collector.ts`
2. `src/lib/goal-candidate-generator.ts`
3. `src/lib/goal-priority-engine.ts`
4. `src/lib/goal-manager.ts`

책임 분리:

1. signal-collector: 런타임 신호 정규화 수집
2. candidate-generator: 규칙+LLM 하이브리드 후보 생성
3. priority-engine: 영향도/긴급도/신뢰도/위험도/정책 적합 점수화
4. goal-manager: dedup/suppress/queue 수명주기 및 dispatch

## 5.3 데이터 및 큐

기존 `redis-store` 추상화 활용:

1. 후보 링버퍼(`goal:candidate:*`)
2. 우선순위 큐(`goal:queue`)
3. 활성 목표 포인터(`goal:active`)
4. suppression 이력(`goal:suppression:*`)

큐 불변식:

1. 활성 창(기본 30분) 내 중복 시그니처 금지
2. high/critical 위험 목표는 명시 정책 경로 필요
3. 만료 목표 자동 정리

## 5.4 연동 지점

1. `agent-loop`: detect/analyze 이후 `goal-manager.tick()` 호출
2. `goal-planner`: 큐의 목표 텍스트를 실행 계획으로 변환
3. `policy-engine`: 스케줄 전 목표 위험/쓰기 자격 판정

---

## 6. 구현 계획 (Goal Generation Engine)

## Phase A: Foundation (1주차)

1. goal-manager 타입/스토어 계약 추가
2. 결정론적 스냅샷 스키마 기반 signal collector 구현
3. 신호 정규화/스키마 가드 단위 테스트 추가

산출물:

1. `src/types/goal-manager.ts`
2. `src/lib/goal-signal-collector.ts`
3. `src/lib/__tests__/goal-signal-collector.test.ts`

## Phase B: Candidate Generation (2주차)

1. 규칙 기반 후보 생성기 베이스라인 구현
2. 목표 문구/분해 힌트용 LLM enhancer 추가(옵션)
3. LLM 불가 시 fallback 경로 구현

산출물:

1. `src/lib/goal-candidate-generator.ts`
2. `src/lib/__tests__/goal-candidate-generator.test.ts`

## Phase C: Priority and Suppression (3주차)

1. 우선순위 점수식 구현
- `score = impact(0-40) + urgency(0-25) + confidence(0-20) + policyFit(0-15)`
2. dedup/suppression 규칙 구현
- 동일 시그니처 suppression window
- cooldown 인지 suppression
- 저신뢰도 컷오프
3. suppression 사유를 감사 로그에 기록

산출물:

1. `src/lib/goal-priority-engine.ts`
2. `src/lib/__tests__/goal-priority-engine.test.ts`

## Phase D: Goal Manager Runtime (4주차)

1. 큐 수명주기(`enqueue`, `dequeue`, `ack`, `fail`, `expire`) 구현
2. `agent-loop` tick + `goal-planner` dispatch 연동
3. 운영자 가시성을 위한 read API 추가

산출물:

1. `src/lib/goal-manager.ts`
2. `src/app/api/goal-manager/route.ts`
3. `src/lib/__tests__/goal-manager.test.ts`

## Phase E: Safety and Verification (5주차)

1. 큐잉 목표에 정책 게이트 적용
2. E2E 테스트: signal → candidate → queue → plan dispatch
3. false/stale goal suppression replay 시나리오 추가

산출물:

1. `src/lib/__tests__/goal-manager-e2e.test.ts`
2. `scripts/autonomy-eval.ts` 시나리오 확장

---

## 7. API 및 관측성 계획

API 추가:

1. `GET /api/goal-manager` (queue/candidate/suppression 요약)
2. `POST /api/goal-manager/tick` (스테이징 수동 트리거)
3. `POST /api/goal-manager/dispatch` (관리자 강제 dispatch)

메트릭:

1. `goal_candidates_total`
2. `goal_suppressed_total{reason}`
3. `goal_queue_depth`
4. `goal_dispatch_latency_ms`
5. `goal_execution_success_rate`

로그:

1. 후보 생성 추적
2. suppression 사유 추적
3. dispatch/ack/fail 추적

---

## 8. 검증 전략

Unit:

1. 신호 정규화 안정성
2. 점수화 결정론
3. suppression dedup/cooldown 규칙

Integration:

1. agent-loop tick → queue 삽입
2. queue → goal planner dispatch
3. policy block 및 suppression 경로

Acceptance:

1. 사용자 프롬프트 없이 자율 목표 생성
2. 중복/노이즈 목표 결정론적 억제
3. 위험 목표 실행 전 차단

---

## 9. 롤아웃 계획

Stage A:

1. observe-only (`GOAL_MANAGER_ENABLED=true`, dispatch 비활성)

Stage B:

1. dispatch dry-run (큐 활성, 실행은 dry-run)

Stage C:

1. 승인 필수 bounded write 모드

Stage D:

1. 점수 게이트 기반 자율 dispatch 확대

Rollback:

1. `GOAL_MANAGER_ENABLED` 비활성화
2. dispatch 경로 차단(후보 텔레메트리는 유지)

---

## 10. 종료 기준

1. 프롬프트 없이 목표를 안정적으로 생성/큐잉한다.
2. 동일 입력에서 목표 우선순위 결과가 결정론적으로 재현된다.
3. 저신뢰/위험 목표는 정책 단계에서 실행 전 차단된다.
4. 운영 대시보드/API에서 큐/억제/디스패치 상태를 추적할 수 있다.
5. E2E 시나리오에서 신호→목표→계획→실행 경로가 검증된다.

