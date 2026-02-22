# Proposal 28: Minority Client Share Expansion and Tokamak L1 Ops Burden Reduction

> Created: 2026-02-22  
> Revised: 2026-02-22  
> Status: Planned  
> Target Window: 2026-Q2 (12 weeks)

---

## 1. Why This Proposal Exists

이 문서는 아래 두 가지 결과를 만들기 위한 실행전략에 집중한다.

1. 마이너 클라이언트 점유율을 실질적으로 끌어올린다.
2. Tokamak 자체 L1 클라이언트 운영 부담(인력, 장애 대응, 릴리즈 리스크)을 구조적으로 낮춘다.

즉, SentinAI의 역할은 **관측 대시보드**가 아니라 **전환 속도 + 운영 자동화 엔진**이다.

---

## 2. Strategy Outcomes (North-Star)

## 2.1 Business/Adoption Outcomes

1. SentinAI 관리군 내 minority client 운영 비중을 분기 내 유의미하게 증가
2. 파트너 온보딩 시 “Geth only” 기본 경로를 “client diversity by default” 경로로 전환

## 2.2 Operations Outcomes

1. 클라이언트 전환 1건당 수작업 시간 감소
2. 전환 실패 시 자동 복구 성공률 증가
3. Tokamak L1 client 운영에 필요한 인력/야간 대응 부담 감소

---

## 3. Core Thesis

“점유율 확대”는 캠페인이 아니라 운영 생산성 문제다.

점유율을 올리려면:

1. 전환 비용(마이그레이션, 튜닝, 장애대응)을 낮춰야 한다.
2. 전환 리스크(컷오버 실패, 롤백 실패)를 제어해야 한다.
3. Tokamak client 운영을 별도 전문팀 의존이 아닌 표준화된 런타임으로 바꿔야 한다.

SentinAI는 이 3가지를 제품 기능으로 만든다.

---

## 4. SentinAI Strategic Pillars

## Pillar A — Migration Factory (Share Uplift Engine)

목표:
- Geth -> Nethermind/Besu/Erigon/Reth 전환을 “프로젝트”가 아니라 “반복 가능한 작업”으로 만든다.

핵심 기능:
1. 사전진단(precheck) 자동화
2. shadow sync -> canary cutover -> full cutover 파이프라인
3. 실패 시 자동 rollback + 원인 번들 생성

기대효과:
1. 마이너 클라이언트 도입 장벽 급감
2. 전환 속도 증가로 점유율 확대 가속

## Pillar B — Ops Abstraction Layer (Burden Offload)

목표:
- 클라이언트별 운영 차이를 SentinAI가 흡수해 운영자가 동일한 인터페이스로 다루게 한다.

핵심 기능:
1. 통합 액션 모델(`restart`, `resync`, `rpc-switch`, `health-diagnose`)
2. 클라이언트별 파라미터/명령 차이 어댑터화
3. 공통 verifier/rollback 계약 강제

기대효과:
1. 팀 숙련도 편차 감소
2. 온콜 대응 시간 단축

## Pillar C — Tokamak Client Operator Shield

목표:
- Tokamak L1 클라이언트 운영을 “전용 전문가 수동 운영”에서 “표준 런타임 + 자동 안전장치”로 전환한다.

핵심 기능:
1. 기본 배포 프로파일(안전 기본값)
2. 릴리즈 게이트(compatibility, sync integrity, RPC correctness)
3. 장애 시 자동 격리/복구 플레이북

기대효과:
1. Tokamak client 운영 부담(인력/장애 비용) 절감
2. 신규 클라이언트 릴리즈 속도와 안정성 동시 확보

---

## 5. Product Workstreams (Execution-Oriented)

## Workstream 1: Client Migration Orchestrator

제안 산출물:
1. `src/lib/client-migration-orchestrator.ts`
2. `src/types/client-ops.ts`
3. `src/app/api/client-ops/migrations/*`

핵심 시나리오:
1. dry-run migration plan
2. staged cutover
3. rollback on verification failure

## Workstream 2: Unified Client Operations API

제안 산출물:
1. `src/lib/client-ops-adapter.ts`
2. `src/app/api/client-ops/actions/route.ts`
3. MCP 확장 도구(클라이언트 독립 액션)

핵심 시나리오:
1. restart/resync/diagnostics 공통 실행
2. client-specific adapter에서 실제 명령 분기

## Workstream 3: Tokamak Client Burden Reduction Pack

제안 산출물:
1. `src/lib/tokamak-client-guardrails.ts`
2. `src/lib/tokamak-release-gate.ts`
3. `docs/guide/tokamak-client-ops-runbook.md`

핵심 시나리오:
1. 릴리즈 전 자동 체크
2. 장애 패턴별 자동 조치
3. 운영 인수인계 문서 자동화

## Workstream 4: Partner Adoption Enablement

제안 산출물:
1. `docs/guide/minority-client-migration-playbook.md`
2. `docs/guide/partner-diversity-onboarding.md`

핵심 시나리오:
1. 파트너별 전환 체크리스트
2. 전환 후 안정화 기준 통일

---

## 6. Public Interfaces / Types (Proposed)

```ts
export type ExecutionClientType =
  | 'geth'
  | 'nethermind'
  | 'besu'
  | 'erigon'
  | 'reth'
  | 'tokamak-el';

export interface ClientMigrationPlan {
  migrationId: string;
  fromClient: ExecutionClientType;
  toClient: ExecutionClientType;
  stage: 'precheck' | 'shadow' | 'canary' | 'cutover' | 'verify' | 'rollback';
  dryRun: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface ClientOpsResult {
  operationId: string;
  client: ExecutionClientType;
  action: 'restart' | 'resync' | 'diagnostics' | 'switch_rpc';
  status: 'success' | 'failed' | 'rollback_succeeded' | 'rollback_failed';
  verificationPassed: boolean;
  reasonCode?: string;
  executedAt: string;
}

export interface OpsBurdenReport {
  measuredAt: string;
  migrationLeadTimeMinutes: number;
  manualInterventionCount: number;
  oncallPagesPerWeek: number;
  rollbackRatePct: number;
}
```

---

## 7. 12-Week Roadmap (Reconstructed)

### Phase 0 (Week 1-2): Burden Model Lock

목표:
1. 운영부담을 수치화할 공통 지표와 책임 경계를 고정
2. “점유율 상승”을 전환 파이프라인 KPI로 연결

완료 기준:
1. migration/ops burden KPI 계약 확정
2. client migration 단계 모델(precheck->cutover->rollback) 확정

### Phase 1 (Week 3-5): Migration Factory MVP

목표:
1. minority client 전환 MVP 구현
2. 자동 검증/롤백 기본 경로 확보

완료 기준:
1. staging 전환 시나리오 2개 이상 성공
2. 실패 주입 시 롤백 자동화 검증 통과

### Phase 2 (Week 6-8): Unified Ops + Tokamak Shield

목표:
1. 클라이언트별 운영 차이를 API/adapter로 흡수
2. Tokamak client 릴리즈/장애 대응 부담 절감 기능 적용

완료 기준:
1. 공통 액션 API로 3개 이상 클라이언트 운영 가능
2. Tokamak client 릴리즈 게이트 체크리스트 자동 실행

### Phase 3 (Week 9-12): Adoption Scaling

목표:
1. 파트너 온보딩을 전환 패키지로 표준화
2. 점유율 상승과 운영비 절감을 동시 추적

완료 기준:
1. 파트너 전환 런북 재사용 가능 상태
2. 월간 보고에서 share uplift + burden reduction 동시 제시

---

## 8. KPI Framework (Outcome-First)

North-star:
1. SentinAI 관리군 내 minority client 비중(%)
2. Tokamak client 운영 단위당 인력시간(시간/주)

Leading:
1. 월간 전환 완료 건수
2. 전환 성공률
3. 자동 rollback 성공률
4. 전환 후 7일 안정화 성공률

Guardrail:
1. 컷오버 장애율
2. 운영 중단 시간
3. 정책 우회/수동 긴급개입 빈도

---

## 9. Test and Acceptance Scenarios

1. **Migration success path**
- precheck -> shadow -> canary -> cutover -> verify 전 구간 성공

2. **Migration failure path**
- verify 실패 시 rollback 자동 수행 및 복구 확인

3. **Multi-client ops consistency**
- 동일 액션이 client adapter별로 일관된 결과 계약 반환

4. **Tokamak burden reduction**
- 릴리즈 전 체크 자동화로 수동 점검 항목 감소가 확인됨

5. **Operational resilience**
- optional module 실패가 core loop를 중단시키지 않음

---

## 10. Risks and Mitigations

1. **지표 과최적화 위험**
- 완화: 대시보드 지표보다 전환 성공/운영시간 절감 지표를 우선

2. **클라이언트별 특성 차이 과소평가**
- 완화: adapter 패턴 + client-specific safety rule 분리

3. **Tokamak client 초기 안정성 부담**
- 완화: release gate + staged rollout + automatic rollback

4. **현장 채택 저항**
- 완화: playbook 템플릿 + one-command migration 경로 제공

---

## 11. Assumptions and Defaults

1. 본 제안의 우선순위는 “점유율 상승”과 “운영부담 절감”이다.
2. diversity 측정은 보조 수단이며, 주요 성과지표가 아니다.
3. 초기 범위는 EVM execution client(`geth`, `nethermind`, `besu`, `erigon`, `reth`, `tokamak-el`)로 제한한다.
4. 기존 MCP/policy/approval/verifier 자산을 재사용하고, 새 체계를 별도로 중복 구축하지 않는다.

---

## 12. Source Notes

정량 baseline은 2026-02-22 기준 Etherscan/Ethernodes/ethereum.org를 참조했으나, 본 문서의 핵심은 **측정 체계 자체가 아니라 실행 전략**이다.
