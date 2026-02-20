# Proposal 20: ZK Stack / ZK 기반 L2 플러그인 확장 계획

> **작성일**: 2026-02-20  
> **상태**: Planning  
> **선행 조건**: `src/chains` 플러그인 시스템(Thanos/Optimism) 유지

---

## 1. 목표

SentinAI의 체인 플러그인 시스템을 확장해 다음 범주의 네트워크를 지원한다.

- **ZK Stack 계열**: ZKsync Stack 기반 체인
- **일반 ZK L2 계열**: Scroll, Linea, Polygon zkEVM 등 OP Stack이 아닌 ZK 롤업

핵심 목표는 "코드 포크 없이 플러그인 추가만으로 지원 체인 확장"이다.

### 1.1 운영 원칙: Strict Chain Isolation

운영자 경험은 체인별로 완전히 분리한다.

- ZK 운영자 화면에는 OP 전용 정보를 노출하지 않는다.
- OP 운영자 화면에는 ZK 전용 정보를 노출하지 않는다.
- "미지원 항목 N/A" 남발 대신, 섹션 자체를 렌더링하지 않는다.
- 통합은 백엔드 플러그인 아키텍처 레벨에서만 수행하고, UI는 체인 전용 콘솔로 제공한다.

### 1.2 ZKsync 공식 문서 분석 반영 (2026-02-20)

ZKsync 문서 기준으로 Proposal 20에 다음 사실을 반영한다.

- ZK Stack 주요 구성요소: `ZKsync OS`, `ZKsync OS Server(Sequencer)`, `Airbender Prover`, `Explorer`, `Portal`, `Fee Withdrawer`
- ZKsync OS 아키텍처: execution/proving 분리 + 단일 Rust 코드베이스를 `x86(실행)` / `RISC-V(증명)`로 컴파일
- OS Server 핵심 서브시스템: `Sequencer`, `RPC API`, `Batcher(배치/증명/L1 제출 경로)`
- Gateway: ZKsync 체인(rollup/validium)에서 선택적으로 사용하는 settlement/aggregation 레이어
- 문서상 현시점 주의사항: `zkstack` CLI quickstart는 "ZKsync OS 미반영(legacy EraVM chain)" 경로가 존재

따라서 구현 시 `zkstack` 플러그인은 단일 모드가 아니라, **`legacy-era` / `os-preview` 운영 모드 분리**를 기본 정책으로 둔다.

---

## 2. 범위

### 2.1 In Scope

- `ChainPlugin` 인터페이스 확장(필요 최소 항목)
- ZK 계열 공통 메타/프로브 모델 정의
- `zkstack` 플러그인 1종 우선 구현
- ZK 범용 템플릿 플러그인(`zkl2-generic`) 추가
- `/api/metrics`, `/api/health`, `/api/scaler` 호환성 검증
- 대시보드 네트워크 표기/컴포넌트 표시 동적화

### 2.2 Out of Scope (Phase 1 제외)

- 체인별 고급 시퀀서 내부 메트릭 전부 지원
- 체인별 자동 remediation playbook 완전 분화
- 멀티체인 동시 수집 오케스트레이터

---

## 3. 현재 구조와 갭

현재 강점:

- `src/chains` 기반 플러그인 레지스트리 존재
- `CHAIN_TYPE` 기반 로딩 가능
- Thanos/Optimism에서 공통 경로 검증 완료

현재 갭:

- ZK 체인 특화 메트릭(증명 지연, 배치 게시 지연, finality 신호) 표준화 부족
- OP Stack 가정이 남아있는 모듈 존재 가능
- 문서/환경변수 템플릿이 OP 계열 중심

---

## 4. 타겟 아키텍처

### 4.1 플러그인 계층

```text
src/chains/
  types.ts
  registry.ts
  thanos/
  optimism/
  zkstack/          # 신규: ZK Stack 전용 (legacy-era / os-preview 모드)
  zkl2-generic/     # 신규: ZK L2 공통 템플릿
```

### 4.2 메트릭 프로파일

체인 플러그인이 아래 프로파일을 선언하도록 통일한다.

- `execution`: block height, block time, txpool
- `settlement`: L1 posting lag, finalized/verified status
- `proof`: proof generation lag, proof queue depth (가능한 체인만)

지원 불가 항목은 `null` 허용 + UI에서 `N/A` 렌더링.

`zkstack` 플러그인 추가 규칙:

- `execution`은 기본 필수
- `settlement`는 배처/L1 제출 경로가 확인될 때 활성
- `proof`는 prover 연동이 확인될 때만 활성

### 4.3 UI 렌더링 규칙 (필수)

- UI는 `plugin.capabilities`에 선언된 섹션만 렌더링한다.
- capability가 없는 섹션은 숨긴다(비활성/N/A 카드 금지).
- API는 체인 타입에 맞는 스키마만 반환한다(OP 전용 필드의 ZK 반환 금지).
- 액션 버튼(`scale`, `restart`, `failover`)은 capability + chain guard를 모두 만족할 때만 노출한다.

---

## 5. 구현 단계 (Phase Plan)

### Phase 1: 인터페이스 보강 (0.5~1일)

1. `ChainPlugin`에 capability 선언 추가
2. ZK 전용 optional probe 계약 추가
3. `chainMode` 필드 추가 (`legacy-era` | `os-preview` | `generic`)
3. 기존 Thanos/Optimism 플러그인 회귀 수정

산출물:

- `src/chains/types.ts` 업데이트
- `src/chains/*` 컴파일/테스트 통과

### Phase 2: `zkstack` 플러그인 구현 (1~2일)

1. `src/chains/zkstack/index.ts` 생성
2. env 매핑 규칙 정의 (`CHAIN_TYPE=zkstack`)
3. 모드 분기 추가:
   - `ZKSTACK_MODE=legacy-era` (기본)
   - `ZKSTACK_MODE=os-preview`
4. metrics adapter 연결 (`/api/metrics` 경로 유지)
5. health 계산에서 ZK capability 반영

산출물:

- `src/chains/zkstack/*`
- `src/chains/__tests__/zkstack-plugin.test.ts`

### Phase 3: `zkl2-generic` 템플릿 구현 (1일)

1. Scroll/Linea/Polygon zkEVM 대응 가능한 공통 플러그인
2. 최소 필수 env와 선택 env 분리
3. 체인별 override 포인트 명시

산출물:

- `src/chains/zkl2-generic/*`
- 샘플 env 문서 업데이트

### Phase 4: API/UI 통합 점검 (1일)

1. `/api/metrics`, `/api/health`, `/api/scaler` 체인 독립성 점검
2. 대시보드 라벨/컴포넌트 이름 capability 기반 렌더링 정리
3. Strict Chain Isolation 검증 (타 체인 정보 미노출)

산출물:

- 회귀 테스트 + 스냅샷 업데이트

### Phase 5: 대시보드 UI 기본 설계 반영 (1일)

1. 체인별 전용 IA(Information Architecture) 정의
2. 공통 컴포넌트 + 체인 전용 컴포넌트 경계 확정
3. 운영자 액션 플로우(확인/가드/실행/감사로그) 통일

산출물:

- `Dashboard UI Basic Design` 섹션 확정
- 구현 대상 컴포넌트 목록/우선순위

### Phase 6: 운영 경로 검증 (0.5일)

1. `legacy-era` 모드 로컬 실행 점검 (`zkstack` CLI quickstart 경로)
2. `os-preview` 모드 메트릭 매핑 점검 (지원 필드만 노출)
3. Gateway 사용 여부(`on`/`off`)에 따른 settlement 카드 노출 검증

산출물:

- 모드별 호환성 매트릭스 문서

---

## 6. 환경변수 설계

공통:

- `CHAIN_TYPE=zkstack | zkl2-generic`
- `L2_RPC_URL=...`
- `L1_RPC_URLS=...`

ZK 선택:

- `ZKSTACK_MODE=legacy-era|os-preview` (default: `legacy-era`)
- `ZK_PROOF_RPC_URL=...` (optional)
- `ZK_BATCHER_STATUS_URL=...` (optional)
- `ZK_FINALITY_MODE=confirmed|finalized|verified`
- `ZK_SETTLEMENT_LAYER=l1|gateway` (default: `l1`)

원칙:

- 필수 최소 2개(`CHAIN_TYPE`, `L2_RPC_URL`)로 기동
- 나머지는 비어도 서버/대시보드가 실패하지 않아야 함
- `CHAIN_TYPE`은 워크스페이스 단위로 고정(런타임 사용자 토글 금지)
- `ZKSTACK_MODE`가 `os-preview`여도 미지원 probe는 자동 비활성

---

## 7. 대시보드 UI 기본 설계 (Strict Chain Isolation)

### 7.1 정보 구조 (IA)

공통 프레임:

1. `Overview` 탭: 체인 공통 핵심 상태
2. `Execution` 탭: 실행 계층 상태
3. `Settlement` 탭: L1 정산/게시 상태
4. `Incidents` 탭: 이상탐지/RCA 타임라인
5. `Actions` 탭: 실행 가능한 운영 액션 + 최근 실행 이력

체인별 분기:

- OP Stack: `Sequencer / Batcher / Proposer` 중심 패널
- ZK L2s: `Sequencer / Prover / Proof Queue / Verification` 중심 패널

### 7.2 화면 컴포넌트

공통 컴포넌트:

- `NetworkHeader`: chain name, health, latest block, sync
- `HealthScoreCard`: 0-100 점수 + 변화 추이
- `IncidentTimeline`: severity, domain(execution/settlement/proof), ack 상태
- `ActionPanel`: 체인별 허용 액션만 노출

OP 전용 컴포넌트:

- `BatchSubmissionStatusCard`
- `ProposerWindowCard`

ZK 전용 컴포넌트:

- `ProofGenerationLagCard`
- `ProofQueueDepthCard`
- `VerificationFinalityCard`
- `BatcherToSettlementCard` (L1/Gateway 제출 상태)

### 7.3 사용자 흐름

1. 로그인/접속 시 워크스페이스의 `CHAIN_TYPE` 확인
2. 체인 전용 네비게이션/컴포넌트만 마운트
3. 이상 발생 시 `Incidents`에서 원인/영향 범위 확인
4. `Actions`에서 chain-guard 통과한 액션만 실행
5. 모든 액션은 감사로그(`who/when/what/result`) 기록

### 7.4 가용성/사용성 가드

- 잘못된 체인 필드 파싱 방지를 위해 스키마 단위 validation 적용
- probe 실패 시 해당 카드만 degradation 처리(전체 페이지 장애 전파 금지)
- 액션 실행 전 preflight 체크(권한, cooldown, state consistency) 필수
- 모바일(360px)에서는 핵심 상태/인시던트/액션 3개 영역 우선 노출
- 모드 불일치(`legacy-era` vs `os-preview`) 감지 시 경고 배너 + 자동 readonly

---

## 8. 테스트/게이트

### Unit

- 플러그인 로딩/메타데이터 테스트
- capability 매트릭스 테스트
- fallback/null metric 처리 테스트

### Integration

- `CHAIN_TYPE=zkstack`로 `/api/metrics` smoke
- `CHAIN_TYPE=zkl2-generic`로 `/api/health` smoke
- `CHAIN_TYPE=zkstack,ZKSTACK_MODE=legacy-era` smoke
- `CHAIN_TYPE=zkstack,ZKSTACK_MODE=os-preview` smoke
- OP 모드에서 ZK 전용 필드 미노출 검증
- ZK 모드에서 OP 전용 필드 미노출 검증

### Production Gate 반영

- Tier 1: lint/type/build
- Tier 2: Lighthouse (기존)
- Tier 3: coverage/e2e/bundle/cwv (기존)

신규 플러그인 머지 조건:

- 플러그인 테스트 90%+ pass
- 기존 OP 체인 회귀 0건

---

## 9. 리스크 및 대응

- 리스크: 체인별 RPC 스펙 편차
  - 대응: capability + optional probe로 strict 의존 제거
- 리스크: ZKsync 문서/릴리스 변화로 모드별 필드가 빠르게 변동
  - 대응: 플러그인 버전 태그 + weekly compatibility 테스트
- 리스크: UI가 OP 메트릭을 강가정
  - 대응: 표시 조건 분기 + N/A 전략 통일
- 리스크: 운영자가 env를 과설정/누락
  - 대응: 부트 시 config validation 요약 로그 제공

---

## 10. 작업 체크리스트

- [ ] `ChainPlugin` capability 확장
- [ ] `chainMode` (`legacy-era`/`os-preview`/`generic`) 계약 추가
- [ ] `zkstack` 플러그인 구현
- [ ] `zkl2-generic` 플러그인 구현
- [ ] API 경로 호환성 검증 (`metrics/health/scaler`)
- [ ] `ZK_SETTLEMENT_LAYER` (`l1`/`gateway`) 분기 반영
- [ ] Strict Chain Isolation UI 적용 (타 체인 정보 미노출)
- [ ] `.env.local.sample` + `docs/guide/ENV_GUIDE.md` 갱신
- [ ] 플러그인 단위/통합 테스트 추가
- [ ] Tier 1~3 게이트 통과

---

## 11. 완료 기준 (Definition of Done)

- `CHAIN_TYPE=zkstack`로 로컬 구동 + 주요 API 정상 응답
- `CHAIN_TYPE=zkl2-generic`로 로컬 구동 + 주요 API 정상 응답
- `zkstack`의 `legacy-era` / `os-preview` 모드 각각 스모크 통과
- 기존 `thanos`, `optimism` 회귀 없음
- OP 모드에서 ZK 정보가 UI/API에 노출되지 않음
- ZK 모드에서 OP 정보가 UI/API에 노출되지 않음
- 운영 문서(환경변수/테스트 가이드) 갱신 완료
- CI 게이트(Tier1~3) 통과
