# Proposal 33: Multi-Operator Marketplace (Q2 2026)

> Date: 2026-03-18
> Owner: SentinAI Core
> Status: Draft — Roadmap 등록, 구현 미착수
> Scope: 현재 1 인스턴스 = 1 운영자 구조를 다중 운영자 지원으로 점진적 확장

---

## 1. Goal

SentinAI agent marketplace가 여러 독립 운영자의 서비스를 집계하고 노출할 수 있도록 아키텍처를 확장한다.

**현재 상태**: 1 SentinAI 인스턴스 = 1 운영자. `OPERATOR_ADDRESS`, `OPERATOR_NAME`, `NEXT_PUBLIC_BASE_URL` 등 운영자 정보가 환경 변수 1개 세트에 고정.

**목표 상태**:
- **외부 에이전트/클라이언트**가 여러 운영자의 서비스를 단일 진입점에서 탐색·비교·구매할 수 있어야 한다.
- **운영자**는 자신의 SentinAI 인스턴스를 독립적으로 운영하면서 공통 레지스트리에 등록할 수 있어야 한다.

---

## 2. Scope

### In-Scope
- ERC8004 레지스트리 기반 다중 운영자 디스커버리
- Website (sentinai-xi.vercel.app) 집계 뷰 — 여러 운영자 비교
- 운영자별 격리된 데이터 레이어 설계
- 마이그레이션 계획 (기존 단일 운영자 배포 호환)

### Out-of-Scope (이 Proposal)
- 크로스-운영자 결제 중계 (별도 x402 facilitator 설계 필요)
- 운영자 간 SLA 보증 또는 분쟁 중재
- K8s 클러스터 공유 (각 운영자 인프라는 독립 유지)

---

## 3. Current Baseline

### 3.1 단일 운영자 가정 컴포넌트 (22개)

아래 컴포넌트가 현재 단일 운영자를 전제한다.

| # | 파일 | 단일 운영자 가정 |
|---|------|----------------|
| 1 | `src/app/api/agent-marketplace/agent.json/route.ts` | `OPERATOR_ADDRESS` 환경 변수 단일 값 |
| 2 | `src/app/api/agent-marketplace/ops/register/route.ts` | 단일 지갑 서명 |
| 3 | `src/app/api/agent-marketplace/ops/register-ops/route.ts` | 단일 `agentURI` 등록 |
| 4 | `src/app/api/agent-marketplace/ops/save-registration/route.ts` | 단일 `operatorAddress` 캐시 |
| 5 | `src/app/api/agent-marketplace/ops/registration-status/route.ts` | 단일 주소 기준 조회 |
| 6 | `src/app/api/agent-marketplace/ops/disputes/route.ts` | 단일 운영자 분쟁 |
| 7 | `src/app/api/agent-marketplace/ops/batches/route.ts` | 단일 인스턴스 배치 이력 |
| 8 | `src/app/api/agent-marketplace/ops/summary/route.ts` | 단일 인스턴스 메트릭 |
| 9 | `src/app/api/agent-marketplace/ops-snapshot.json/route.ts` | 단일 인스턴스 스냅샷 |
| 10 | `src/app/api/agent-marketplace/catalog/route.ts` | 단일 카탈로그 |
| 11 | `src/app/api/agent-marketplace/incident-summary/route.ts` | 단일 인스턴스 사건 |
| 12 | `src/app/api/agent-marketplace/batch-submission-status/route.ts` | 단일 배치 상태 |
| 13 | `src/app/api/agent-marketplace/sequencer-health/route.ts` | 단일 시퀀서 |
| 14 | `src/lib/agent-marketplace/catalog.ts` | 하드코딩된 단일 서비스 목록 |
| 15 | `src/lib/agent-marketplace/catalog-response.ts` | 단일 manifest 생성 |
| 16 | `src/lib/agent-marketplace/ops-snapshot.ts` | 단일 인스턴스 집계 |
| 17 | `src/lib/agent-marketplace/x402-middleware.ts` | 단일 수신 지갑 주소 |
| 18 | `src/types/agent-marketplace.ts` | `operatorAddress?: string` — 단일 값 |
| 19 | `website/src/app/marketplace/page.tsx` | 단일 운영자 UI |
| 20 | `website/src/components/ServiceCard.tsx` | 단일 운영자 정보 표시 |
| 21 | `website/src/components/RegistrationWizard.tsx` | 단일 지갑 연결 흐름 |
| 22 | `website/src/app/admin/page.tsx` | 단일 운영자 관리 대시보드 |

### 3.2 이미 다중 운영자를 지원하는 부분

| 파일 | 내용 |
|------|------|
| `src/app/api/agent-marketplace/registry-browse/route.ts` | ERC8004 레지스트리에서 여러 운영자 목록 조회 가능 |
| `src/lib/erc8004/registry-client.ts` | `getAllOperators()` 메서드 구현됨 |
| `website/src/app/marketplace/page.tsx` | Registry Browse 탭 존재 (온체인 운영자 목록 열람) |

---

## 4. Architecture Options

### Path A: Federated — 운영자별 독립 인스턴스 + 디스커버리 집계

```
[Operator A Instance]           [Operator B Instance]
  SentinAI on k8s A               SentinAI on k8s B
  /api/agent-marketplace/*        /api/agent-marketplace/*
  ops-snapshot.json               ops-snapshot.json
         |                               |
         └──────── ERC8004 Registry ─────┘
                        |
              [Website / Discovery Layer]
                sentinai-xi.vercel.app
                  /marketplace (aggregated)
```

**장점**:
- 운영자 간 완전한 데이터 격리
- 기존 배포 구조 유지 (운영자마다 자체 인스턴스)
- 온체인 레지스트리가 신뢰 앵커 역할
- 점진적 마이그레이션 가능 (현재 단일 인스턴스 → 멀티 인스턴스 집계)

**단점**:
- Website가 각 운영자 엔드포인트를 개별 fetch해야 함 (레이턴시, 가용성 의존)
- 운영자가 오프라인이면 해당 서비스 목록 누락
- 크로스-운영자 통계 집계가 복잡

### Path B: Multi-Tenant — 단일 인스턴스, 운영자별 데이터 격리

```
[Single SentinAI Instance]
  /api/agent-marketplace/?operator=0xABC
  /api/agent-marketplace/?operator=0xDEF
  Redis: operator:0xABC:snapshot, operator:0xDEF:snapshot
  K8s Namespace: sentinai-abc, sentinai-def
```

**장점**:
- 단일 엔드포인트로 전체 카탈로그 서빙
- 크로스-운영자 비교/집계 용이
- Website 구현 단순

**단점**:
- 현재 아키텍처 대대적 리팩토링 필요
- 운영자별 K8s 자격증명 관리 복잡
- 단일 인스턴스 장애가 모든 운영자에 영향

### 비교 테이블

| 항목 | Path A (Federated) | Path B (Multi-Tenant) |
|------|-------------------|----------------------|
| 데이터 격리 | ✅ 완전 격리 | ⚠️ 논리 격리만 |
| 현재 구조 호환 | ✅ 유지 가능 | ❌ 대규모 리팩토링 |
| Website 집계 | ⚠️ 복잡 (다중 fetch) | ✅ 단순 |
| 장애 격리 | ✅ 운영자별 독립 | ❌ 단일 장애점 |
| 구현 난이도 | 낮음 (점진적) | 높음 |
| 권장 시점 | Q2 2026 | Q3-Q4 2026 이후 |

### 권장: Path A 우선 → Path B 점진적 전환

Q2는 Path A로 Discovery & Website Aggregation 강화, 시장 검증 이후 Path B 전환 검토.

---

## 5. Detailed Design (Path A)

### Phase 1: Discovery 강화 (Q2 2026 — 4주)

**목표**: ERC8004 레지스트리에서 다중 운영자를 읽고 Website에 집계해서 보여준다.

**신규/변경 파일**:

```
website/src/app/marketplace/
  operators/page.tsx            # 전체 운영자 목록 (신규)
  operators/[address]/page.tsx  # 개별 운영자 상세 (신규)

website/src/lib/
  operator-aggregator.ts        # 여러 운영자 엔드포인트 병렬 fetch + 캐시 (신규)
  operator-health.ts            # 운영자 엔드포인트 가용성 확인 (신규)

src/app/api/agent-marketplace/
  public-catalog/route.ts       # 운영자 주소 파라미터 지원 (기존 catalog 확장)
```

**데이터 흐름**:
1. Website → `registry-browse` API로 온체인 운영자 목록 조회
2. 각 운영자의 `agentURI` + `/ops-snapshot.json` 병렬 fetch
3. 집계 결과 캐시 (5분 TTL, 실패 운영자는 `status: offline` 표시)
4. Operators 페이지에 카드 형태로 렌더링

**수정 없이 재사용 가능한 것**:
- `src/lib/erc8004/registry-client.ts` — `getAllOperators()` 그대로 사용
- 각 운영자 인스턴스의 `/api/agent-marketplace/ops-snapshot.json`
- `website/src/components/ServiceCard.tsx` — `operatorAddress` prop 추가만

---

### Phase 2: Operator-Scoped Data Layer (Q2 2026 말 — 2주)

**목표**: 현재 단일 운영자 API에 `operatorAddress` 파라미터를 추가해 여러 운영자 데이터를 구별한다. (Path B 준비 단계)

**변경 파일**:

```
src/types/agent-marketplace.ts
  - OperatorContext 타입 추가: { address: string; name: string; agentURI: string }
  - 각 응답 타입에 operatorAddress 필드 표준화

src/lib/agent-marketplace/catalog.ts
  - getCatalog(operatorAddress?: string) 시그니처
  - Redis 키: catalog:{operatorAddress} (현재: catalog:default)

src/lib/agent-marketplace/ops-snapshot.ts
  - getOpsSnapshot(operatorAddress?: string)
  - Redis 키: ops-snapshot:{operatorAddress}
```

**하위 호환성**: `operatorAddress` 미전달 시 `OPERATOR_ADDRESS` 환경 변수 fallback → 기존 배포 영향 없음.

---

### Phase 3: Full Multi-Tenant (Q3 2026 이후)

**목표**: 단일 SentinAI 인스턴스에서 여러 운영자의 K8s 클러스터를 관리한다.

이 단계는 다음이 선행 조건:
- Phase 1, 2 완료 후 시장 피드백 수집
- K8s multi-namespace RBAC 설계
- 운영자별 자격증명 Vault 통합
- 결제 격리 (운영자 지갑 별도 설정)

**주요 설계 결정** (Phase 3 시작 전 확정 필요):
1. 운영자 온보딩 방식 — 셀프 서비스 vs 수동 승인
2. 공유 인프라 비용 배분 모델
3. 운영자 데이터 삭제/오프보딩 정책

---

## 6. Migration Plan

### 기존 단일 운영자 배포 호환성

| 환경 변수 | Phase 1 | Phase 2 | Phase 3 |
|----------|---------|---------|---------|
| `OPERATOR_ADDRESS` | 그대로 사용 | fallback으로 사용 | Vault로 이전 |
| `NEXT_PUBLIC_BASE_URL` | 그대로 사용 | `agentURI` 자동 생성 | 레지스트리에서 읽음 |
| `OPERATOR_NAME` | 그대로 사용 | 레지스트리 온체인 데이터 우선 | 온체인 only |

### 기존 운영자 등록 재작업 불필요
- ERC8004 레지스트리에 이미 등록된 운영자는 Phase 1에서 자동으로 집계됨
- 신규 필드(`name`, `serviceCount`)는 온체인 optional metadata로 점진적 추가

---

## 7. Verification

### Phase 1 완료 기준
- [ ] `website/marketplace/operators` 페이지에서 ERC8004 레지스트리의 2개 이상 운영자 표시
- [ ] 오프라인 운영자는 `status: offline` 표시, 페이지 전체 오류 없음
- [ ] 기존 단일 운영자 대시보드 (`/admin`) 기능 영향 없음
- [ ] 빌드 오류 없음 (`npm run build` 성공)

### Phase 2 완료 기준
- [ ] `GET /api/agent-marketplace/catalog?operator=0xABC` 운영자별 카탈로그 반환
- [ ] `operatorAddress` 미전달 시 기존 동작 유지 (하위 호환)
- [ ] Redis 키 충돌 없음 (운영자별 네임스페이스 분리 확인)
- [ ] 기존 테스트 전부 통과

### Phase 3 완료 기준 (별도 Proposal 예정)
- [ ] 2개 이상 운영자 K8s 클러스터 독립 관리
- [ ] 운영자 간 메트릭/로그 데이터 격리 검증
- [ ] 결제 격리 (운영자 A 수익이 운영자 B 지갑으로 유입되지 않음)

---

## 8. Affected Components Summary

22개 단일 운영자 가정 컴포넌트는 **Phase 2에서 점진적으로 수정**되며, Phase 1은 신규 파일 추가만으로 기존 컴포넌트를 건드리지 않는다.

```
Phase 1 (신규 추가, 기존 수정 없음):
  website/src/app/marketplace/operators/page.tsx
  website/src/app/marketplace/operators/[address]/page.tsx
  website/src/lib/operator-aggregator.ts
  website/src/lib/operator-health.ts

Phase 2 (기존 파일 점진적 수정, 하위 호환 유지):
  src/types/agent-marketplace.ts         — OperatorContext 추가
  src/lib/agent-marketplace/catalog.ts   — operatorAddress 파라미터
  src/lib/agent-marketplace/ops-snapshot.ts — 네임스페이스 분리
  src/lib/agent-marketplace/x402-middleware.ts — 운영자별 수신 주소

Phase 3 (대규모 리팩토링, 별도 계획):
  나머지 18개 컴포넌트 순차 수정
```
