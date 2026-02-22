# Proposal 27: SentinAI L1/L2 Core Operations Infrastructure Hardening (EVM Focus)

> Created: 2026-02-22  
> Status: Planned  
> Target Window: Q2-Q3 (12 weeks)

---

## 1. Goal

SentinAI를 `EVM L1 클라이언트 + L2 롤업(OP Stack/ZK Stack)` 공통 운영 인프라로 확장하기 위해, 현재 코드베이스의 구조적 갭을 정리하고 구현 가능한 단계별 보완 로드맵을 정의한다.

핵심 목표:

1. 단일 네트워크 중심 구조를 멀티 네트워크 운영 구조로 확장한다.
2. MCP/API/Agent 경로의 정책·승인·감사 규칙을 단일 표준으로 통합한다.
3. L1/L2 공통 운영 SLI/SLO와 장애 복구 표준을 도입한다.

### Success Metrics

| KPI | Current | Target |
|---|---:|---:|
| 동시에 관리 가능한 네트워크 수 | 1 (process당 active plugin 1개) | 5+ (scope 기반 동시 운영) |
| 쓰기 액션 표준 정책 적용률 | 부분 적용 (MCP/Goals 중심) | 100% (MCP + REST + Agent) |
| 운영 액션 감사 추적 가능률 | 부분 적용 | 100% (`operationId`/`requestId`/`scope`) |
| 표준 헬스/SLO 응답 | 미정의 (기본 health only) | 전 네트워크 공통 스키마 제공 |

---

## 2. Scope

### In Scope

1. EVM L1 + L2 운영 컨트롤플레인 관점의 구조 보완점 문서화
2. 파일 레벨 영향도, API/타입 변경 제안, 테스트/롤아웃 계획
3. 구현 우선순위(Phase)와 완료 기준(DoD) 정의

### Out of Scope

1. 비-EVM 체인 어댑터 구현
2. 실제 코드 리팩터링/마이그레이션 실행
3. 대시보드 UI 재디자인

---

## 3. Current Baseline (Code Evidence)

### 3.1 Chain Runtime Model

1. 체인 플러그인은 `ChainPlugin` 인터페이스로 추상화되어 있음: `src/chains/types.ts`
2. 하지만 런타임 활성 플러그인은 글로벌 singleton 1개: `src/chains/registry.ts`
3. `CHAIN_TYPE`로 단일 체인 선택 방식이라 동시 다중 네트워크 운영 모델은 부재

### 3.2 Metrics and State

1. 메트릭 타입 `MetricDataPoint`는 scope 식별자(tenant/network/cluster)가 없음: `src/types/prediction.ts`
2. 상태 저장 키는 글로벌 prefix + 고정 키 패턴 중심: `src/lib/redis-store.ts`
3. `/api/metrics`는 단일 네트워크 응답 구조를 전제로 함: `src/app/api/metrics/route.ts`

### 3.3 Control Plane and Safety

1. MCP는 비교적 성숙한 제어면(정책/승인/검증/롤백) 보유: `src/lib/mcp-server.ts`, `src/lib/policy-engine.ts`, `src/lib/approval-engine.ts`, `src/lib/operation-verifier.ts`
2. REST 경로(`scaler`, `remediation`)는 MCP 수준의 세밀한 reason code/operation lifecycle 표준이 아직 통합되지 않음: `src/app/api/scaler/route.ts`, `src/app/api/remediation/route.ts`
3. 미들웨어 보호는 전역 API key + read-only 기반이며 네트워크 단위 RBAC는 없음: `src/middleware.ts`

### 3.4 L1/L2 Operations

1. L1 failover 모듈은 단일 state를 관리하는 구조: `src/lib/l1-rpc-failover.ts`, `src/types/l1-failover.ts`
2. `/api/health`는 최소 상태 응답만 제공 (`status`, `timestamp`): `src/app/api/health/route.ts`
3. Goal planner/agent loop는 고도화되었으나 네트워크 스코프 표준 계약은 없음: `src/types/goal-planner.ts`, `src/lib/agent-loop.ts`

---

## 4. Gap Matrix

| 영역 | 현재 상태 | 주요 리스크 | 목표 상태 | 우선순위 |
|---|---|---|---|---|
| 네트워크 스코프 모델 | 단일 active plugin (`src/chains/registry.ts`) | 멀티 네트워크 동시 운영 불가 | `NetworkScope` 기반 멀티 네트워크 런타임 | P0 |
| 상태 저장 분리 | 글로벌 키 중심 (`src/lib/redis-store.ts`) | 데이터 혼선/오염 가능성 | scope-aware key namespace | P0 |
| 운영 API 표준화 | 경로별 응답/에러 계약 상이 | 자동화 클라이언트 구현 복잡도 증가 | 공통 `OperationResult` + reason code | P0 |
| 정책/승인 일관성 | MCP 중심으로 성숙, REST는 부분 적용 | 우회 경로 발생 가능 | MCP/REST/Agent 단일 policy 엔진 적용 | P0 |
| 헬스/SLO 모델 | `/api/health` 최소 응답 | 장애 조기감지/온콜 기준 불명확 | L1/L2 표준 `HealthReport` + SLO 상태 | P1 |
| 감사 추적 | 일부 경로에만 `audit`/`decisionId` | 변경 이력 추적 누락 | 모든 write action에 `operationId` 의무화 | P1 |
| 복구 표준 | verifier/rollback coverage가 경로별 상이 | 실패 액션 후 불완전 상태 지속 | write action 전부 post-check + rollback 계약 | P1 |
| 권한 모델 | 단일 `x-api-key` + read-only | 팀/환경 분리 운영 어려움 | role/environment 기반 권한 계층 | P2 |
| 운영 가시성 | 대시보드/로그가 단일 네트워크 중심 | 멀티 네트워크 triage 시간 증가 | scope 집계 대시보드 + drill-down API | P2 |

---

## 5. Target Architecture (Core Additions)

### 5.1 Scope-Aware Control Plane

모든 read/write 요청은 `scope`를 필수 컨텍스트로 전달한다.

```ts
export interface NetworkScope {
  tenantId: string;
  environment: 'dev' | 'staging' | 'prod';
  chainFamily: 'ethereum-l1' | 'op-stack' | 'zkstack';
  networkId: string;
  clusterId?: string;
}
```

### 5.2 Unified Operation Lifecycle

모든 write action을 `plan -> authorize -> execute -> verify -> rollback(optional) -> audit` 공통 흐름으로 통일한다.

```ts
export interface OperationRecord {
  operationId: string;
  scope: NetworkScope;
  action: string;
  status: 'planned' | 'running' | 'verified' | 'rollback_succeeded' | 'failed';
  reasonCode: string;
  requestId: string;
  decisionId?: string;
  startedAt: string;
  completedAt?: string;
}
```

### 5.3 Standard Health/SLO Contract

```ts
export interface CoreHealthReport {
  scope: NetworkScope;
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  checks: Array<{ name: string; status: 'pass' | 'warn' | 'fail'; detail?: string }>;
  sli: {
    l1RpcSuccessRate: number;
    l2BlockLag: number;
    actionFailureRate: number;
  };
  updatedAt: string;
}
```

---

## 6. Public API / Interface Changes

### 6.1 New API Endpoints (Proposed)

1. `GET /api/networks`
- 등록된 운영 scope 목록, chain capability, health summary 반환

2. `GET /api/networks/:networkId/health`
- 표준 `CoreHealthReport` 반환

3. `POST /api/ops/execute`
- scope + action 기반 표준 write 실행 (MCP/REST 공통 백엔드 재사용)

4. `GET /api/ops/:operationId`
- operation lifecycle, verification, rollback, audit 상태 조회

### 6.2 MCP Contract Alignment

1. write 도구 입력에 `scope` 필드 의무화(기본값 fallback은 단계적 제거)
2. 표준 에러 reason code를 MCP/REST 동일 규격으로 맞춤
3. `run_health_diagnostics`를 scope 기반으로 확장

### 6.3 Backward Compatibility

1. 기존 `/api/metrics`, `/api/scaler`, `/api/remediation`는 Phase 1에서 유지
2. `default scope` fallback을 제공하되 deprecation 로그를 남김
3. Phase 2 종료 시점에 신규 표준 API를 기본 경로로 승격

---

## 7. Phased Roadmap (Decision Complete)

### Phase 0 (Week 1-2): Safety Baseline Consolidation

목표:

1. write 경로 전수 목록화 및 정책/검증 미적용 경로 식별
2. 공통 operation envelope와 reason code 표준 정의

주요 작업:

1. write API inventory 문서화 (`/api/scaler`, `/api/remediation`, `/api/mcp`, `/api/goals`)
2. `OperationRecord`/`NetworkScope` 타입 초안 정의
3. 정책 엔진 확장 설계서(MCP + REST + Agent 공통 입력 모델)

DoD:

1. 모든 write 경로의 현재 가드/승인/검증 상태 표 존재
2. 표준 에러/감사 필드가 문서로 고정됨

### Phase 1 (Week 3-5): Scope-Aware Data and APIs

목표:

1. 상태 저장과 주요 API를 scope-aware 구조로 전환할 설계 고정
2. 멀티 네트워크 읽기 API 계약을 확정

주요 작업:

1. Redis key namespace 전략 정의 (`<prefix>:<scope>:<domain>`)
2. 메트릭/액션/감사 데이터에 scope 필드 추가 설계
3. `GET /api/networks`, `GET /api/networks/:id/health` API 스펙 확정

DoD:

1. key migration 시나리오(dual-write/read fallback) 정의 완료
2. scope 누락 요청의 처리 규칙(deny/fallback/deprecate) 확정

### Phase 2 (Week 6-8): Unified Execution and Policy Convergence

목표:

1. MCP/REST/Agent write 실행 경로를 단일 operation pipeline으로 수렴
2. 검증/롤백 계약을 전 write action에 적용 가능한 상태로 정리

주요 작업:

1. `POST /api/ops/execute` 표준 실행 경로 설계
2. route 별 개별 가드 로직을 policy engine 호출 기반으로 통일
3. action별 verifier/rollback 매핑 표준화

DoD:

1. 신규 액션은 단일 policy+approval+operation-control 경로만 허용
2. 모든 write 결과에 `operationId` + verification 결과 포함

### Phase 3 (Week 9-12): Reliability, SLO, and Rollout Governance

목표:

1. 운영 품질 기준(SLO)과 롤아웃/롤백 정책을 실운영 수준으로 문서화
2. 온콜 대응 기준과 진단 자동화를 표준화

주요 작업:

1. `CoreHealthReport` + SLI 계산 규칙 확정
2. 카나리/섀도우 배포 기준, 실패 임계치, 자동 롤백 규칙 정의
3. 장애 훈련 시나리오(runbook) 작성

DoD:

1. “배포 전/배포 중/배포 후” 체크리스트가 문서로 완결
2. 온콜 triage 절차가 scope + operationId 기준으로 추적 가능

---

## 8. Test and Verification Plan

### Unit Tests

1. scope 파싱/검증 (`NetworkScope` validation)
2. policy reason code 매핑 일관성 (MCP/REST/Agent 공통)
3. operation lifecycle 상태 전이 검증 (`planned -> verified/failed/rollback`)

### Integration Tests

1. 동일 write action을 MCP와 REST로 호출했을 때 동일 policy decision 보장
2. scope 분리 저장소에서 데이터 누수(교차 조회) 방지
3. L1 failover + L2 복구 액션 연계 시 감사 레코드 연결 검증

### Failure Scenarios

1. approval token 재사용/만료/파라미터 불일치
2. verify 실패 후 rollback 성공/실패 분기
3. read-only 환경에서 경로별 우회 시도 차단

---

## 9. Rollout and Rollback Strategy

### Rollout

1. Shadow mode: 신규 operation envelope만 로그 기록
2. Canary: 네트워크 일부(scope subset)에 신규 정책 적용
3. Full: 표준 API/정책 경로를 기본값으로 승격

### Rollback

1. feature flag로 scope-aware 경로 즉시 비활성화
2. legacy endpoint/fallback path로 자동 복귀
3. 장애 구간 operation/audit 데이터로 원인 역추적

---

## 10. Assumptions and Defaults

1. EVM 범위에서 L1은 Ethereum 계열, L2는 OP Stack/ZK Stack으로 한정한다.
2. 기존 단일 네트워크 사용자 호환성을 위해 Phase 2 완료 전까지 default scope fallback을 유지한다.
3. 정책 엔진의 단일 소스 원칙을 유지하며, route별 ad-hoc write guard 증설은 금지한다.
4. 문서 기준 우선순위는 운영 안정성(P0/P1) > 확장성(P2) 순으로 고정한다.
