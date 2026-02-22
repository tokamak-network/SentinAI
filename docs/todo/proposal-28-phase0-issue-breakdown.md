# Proposal 28 Phase 0 Issue Breakdown (Share Uplift + Ops Burden Lock)

> Created: 2026-02-22  
> Revised: 2026-02-22  
> Scope: Proposal 28 / Phase 0 (Week 1-2)

---

## 1. Phase 0 Objective

Phase 0의 목적은 다양성 “측정 계약”이 아니라 아래 두 가지 실행축을 코드 단위 작업으로 고정하는 것이다.

1. 마이너 클라이언트 전환 속도를 높이는 마이그레이션 실행 계약
2. Tokamak L1 클라이언트 운영 부담을 줄이는 운영 자동화/가드레일 계약

완료 기준:

1. 전환 파이프라인(precheck -> shadow -> canary -> cutover -> verify -> rollback) 계약이 타입/API/테스트로 고정됨
2. 운영부담 KPI(수작업 시간, 수동개입 빈도, 전환 실패율) 수집 계약이 정의됨
3. Tokamak client release gate와 운영 runbook 자동화 요구사항이 코드 백로그로 확정됨

---

## 2. Issue Board (Decision Complete)

| ID | Priority | Title | Output |
|---|---|---|---|
| OPS-001 | P0 | Client Ops Domain Contract 추가 | `src/types/client-ops.ts` |
| OPS-002 | P0 | Migration Orchestrator 계약 정의 | `src/lib/client-migration-orchestrator.ts` |
| OPS-003 | P0 | Unified Client Action Adapter 계약 정의 | `src/lib/client-ops-adapter.ts` |
| OPS-004 | P0 | Migration Verification/Rollback 규칙 추가 | `src/lib/client-migration-verifier.ts` |
| OPS-005 | P0 | Ops Burden KPI Collector 계약 정의 | `src/lib/ops-burden-tracker.ts` |
| OPS-006 | P0 | Tokamak Client Release Gate 계약 정의 | `src/lib/tokamak-release-gate.ts` |
| OPS-007 | P1 | API Skeleton (Migration + Actions + Burden) | `src/app/api/client-ops/*` |
| OPS-008 | P1 | 실행 스펙/런북 문서 고정 | `docs/spec/client-ops-contract.md`, `docs/guide/tokamak-client-ops-runbook.md` |

---

## 3. Ticket Details

## OPS-001 — Client Ops Domain Contract 추가

목적:
- 클라이언트 전환/운영/복구를 공통으로 표현하는 타입 계약 고정

대상 파일:
1. `src/types/client-ops.ts` (new)

필수 타입:
1. `ExecutionClientType`
2. `ClientMigrationPlan`
3. `ClientMigrationStage`
4. `ClientOpsAction`
5. `ClientOpsResult`
6. `OpsBurdenMetric`

Acceptance Criteria:
1. 전환 단계와 결과 상태가 enum/union으로 고정됨
2. verifier/rollback 결과 필드가 필수 포함됨
3. Tokamak client(`tokamak-el`)가 first-class type으로 포함됨

테스트:
1. `npx tsc --noEmit` strict 타입 검증

의존성:
- 없음

---

## OPS-002 — Migration Orchestrator 계약 정의

목적:
- 전환 시나리오를 재현 가능한 단계형 파이프라인으로 고정

대상 파일:
1. `src/lib/client-migration-orchestrator.ts` (new)
2. `src/lib/__tests__/client-migration-orchestrator.test.ts` (new)

핵심 인터페이스:
1. `planMigration(input): ClientMigrationPlan`
2. `runMigrationStep(planId, stage): ClientOpsResult`
3. `runFullMigration(planId): MigrationExecutionSummary`

Acceptance Criteria:
1. 단계 건너뛰기/역순 실행 차단
2. canary/cutover 전 단계 precondition 검증
3. 실패 시 rollback stage로 자동 전환 가능

테스트:
1. happy path 전구간 성공
2. verify 실패 -> rollback 분기
3. idempotency(같은 단계 재실행) 검증

의존성:
- OPS-001

---

## OPS-003 — Unified Client Action Adapter 계약 정의

목적:
- 클라이언트별 운영 차이를 adapter로 격리해 운영자 인터페이스 통일

대상 파일:
1. `src/lib/client-ops-adapter.ts` (new)
2. `src/lib/client-adapters/geth-adapter.ts` (new)
3. `src/lib/client-adapters/nethermind-adapter.ts` (new)
4. `src/lib/client-adapters/reth-adapter.ts` (new)
5. `src/lib/client-adapters/tokamak-el-adapter.ts` (new)

핵심 인터페이스:
1. `restart()`
2. `resync()`
3. `diagnostics()`
4. `switchRpc()`

Acceptance Criteria:
1. 동일 액션 입력이 client별로 동일 결과 스키마 반환
2. unsupported action은 명시적 reasonCode로 실패
3. adapter 실패가 orchestrator 전체 크래시로 이어지지 않음

테스트:
1. adapter contract conformance test
2. unsupported/timeout/error path test

의존성:
- OPS-001

---

## OPS-004 — Migration Verification/Rollback 규칙 추가

목적:
- “전환 성공”을 선언이 아니라 검증 규칙으로 강제

대상 파일:
1. `src/lib/client-migration-verifier.ts` (new)
2. `src/lib/client-migration-rollback.ts` (new)
3. `src/lib/__tests__/client-migration-verifier.test.ts` (new)

핵심 규칙:
1. post-cutover health check 필수
2. sync integrity check 필수
3. RPC correctness check 필수

Acceptance Criteria:
1. verifier 실패 시 rollback 트리거 규칙 고정
2. rollback 결과도 재검증 수행
3. false-positive success 방지

테스트:
1. verifier pass/fail 경계
2. rollback success/failure 분기

의존성:
- OPS-001
- OPS-002

---

## OPS-005 — Ops Burden KPI Collector 계약 정의

목적:
- “운영부담 감소”를 주관적 주장 대신 실행 KPI로 추적

대상 파일:
1. `src/lib/ops-burden-tracker.ts` (new)
2. `src/types/client-ops.ts` (extend)
3. `src/lib/__tests__/ops-burden-tracker.test.ts` (new)

필수 KPI:
1. `migrationLeadTimeMinutes`
2. `manualInterventionCount`
3. `oncallPagesPerWeek`
4. `rollbackRatePct`

Acceptance Criteria:
1. KPI 계산식과 수집 윈도우(일/주)가 고정됨
2. migration 이벤트와 KPI 집계가 연결됨
3. 누락 데이터 처리 기본값 정의

테스트:
1. KPI 산식 단위 테스트
2. 결측값 처리 테스트

의존성:
- OPS-001
- OPS-002

---

## OPS-006 — Tokamak Client Release Gate 계약 정의

목적:
- Tokamak client 운영 부담의 핵심 원인(릴리즈 위험)을 게이트화해 선제 차단

대상 파일:
1. `src/lib/tokamak-release-gate.ts` (new)
2. `src/lib/__tests__/tokamak-release-gate.test.ts` (new)

필수 게이트:
1. compatibility check
2. sync health check
3. RPC conformance check
4. rollback readiness check

Acceptance Criteria:
1. 게이트 실패 시 배포 차단 reasonCode 제공
2. 배포 승인 경로가 테스트 가능
3. emergency override는 별도 정책 플래그로만 허용

테스트:
1. gate pass/fail matrix
2. override policy test

의존성:
- OPS-001
- OPS-003
- OPS-004

---

## OPS-007 — API Skeleton (Migration + Actions + Burden)

목적:
- Phase 1 구현 전에 API 계약을 고정

대상 파일:
1. `src/app/api/client-ops/migrations/route.ts` (new)
2. `src/app/api/client-ops/actions/route.ts` (new)
3. `src/app/api/client-ops/burden/route.ts` (new)
4. `src/app/api/client-ops/*.test.ts` (new)

Acceptance Criteria:
1. plan/execute/status API 계약 고정
2. burden KPI 조회 API 계약 고정
3. 정책/승인/감사 필드 포함

테스트:
1. route contract snapshot
2. unauthorized/read-only rejection path

의존성:
- OPS-001 ~ OPS-006

---

## OPS-008 — 실행 스펙/런북 문서 고정

목적:
- 구현/운영/BD가 같은 용어와 절차를 사용하도록 표준 문서 확정

대상 파일:
1. `docs/spec/client-ops-contract.md` (new)
2. `docs/guide/tokamak-client-ops-runbook.md` (new)
3. `docs/guide/minority-client-migration-playbook.md` (new)

Acceptance Criteria:
1. 코드 타입/API와 문서 용어 일치
2. 전환 실패/복구 절차가 단계별로 명시
3. 파트너 온보딩 체크리스트 포함

의존성:
- OPS-007

---

## 4. Execution Order

고정 순서:

1. OPS-001
2. OPS-002 + OPS-003 (병렬 가능)
3. OPS-004
4. OPS-005 + OPS-006 (부분 병렬 가능)
5. OPS-007
6. OPS-008

---

## 5. Definition of Done (Phase 0)

1. share uplift와 ops burden reduction을 직접 유도하는 계약이 코드 백로그로 확정됨
2. migration/rollback/verification 흐름이 이슈 단위로 구현 가능 상태
3. Tokamak client 운영부담 절감(릴리즈 게이트 + runbook 자동화) 항목이 명확히 정의됨
4. Phase 1 구현자가 추가 설계 판단 없이 착수 가능함

