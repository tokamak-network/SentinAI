# 제안 20: ZK Stack / ZK 계열 L2 플러그인 확장 계획

> **작성일**: 2026-02-20  
> **상태**: 계획  
> **전제**: `src/chains` 플러그인 시스템(Thanos/Optimism) 유지

---

## 1. 목표

SentinAI 체인 플러그인 시스템을 아래 네트워크 범주까지 확장한다.

- **ZK Stack 계열**: ZKsync Stack 기반 체인
- **일반 ZK L2 계열**: Scroll, Linea, Polygon zkEVM 등 OP Stack 비계열

핵심 목표는 **코드 포크 없이 플러그인 추가만으로 지원 체인을 확장**하는 것이다.

### 1.1 운영 원칙: 엄격한 체인 격리(Strict Chain Isolation)

운영자 경험은 체인별로 완전히 분리한다.

1. OP 전용 정보는 ZK 화면에 노출하지 않는다.
2. ZK 전용 정보는 OP 화면에 노출하지 않는다.
3. `N/A` 남발 대신, 미지원 섹션은 아예 렌더링하지 않는다.
4. 통합은 백엔드 플러그인 레벨에서만 수행하고, UI는 체인별 콘솔로 제공한다.

### 1.2 ZKsync 공식 문서 분석 반영 (2026-02-20)

반영 사항:

1. ZK Stack 핵심 컴포넌트: `ZKsync OS`, `OS Server(Sequencer)`, `Prover`, `Explorer`, `Portal`, `Fee Withdrawer`
2. 실행/증명 분리 아키텍처
3. OS Server 핵심 서브시스템: `Sequencer`, `RPC API`, `Batcher`
4. Gateway는 정산/집계 계층으로 선택적 사용
5. `zkstack` CLI quickstart에 레거시 경로 존재

따라서 `zkstack` 플러그인은 단일 모드가 아니라
**`legacy-era` / `os-preview` 이중 모드**를 기본 정책으로 둔다.

---

## 2. 범위

### 2.1 In Scope

1. `ChainPlugin` 인터페이스 확장(최소 필수)
2. ZK 계열 공통 메타/프로브 모델 정의
3. `zkstack` 플러그인 1종 우선 구현
4. ZK 범용 템플릿 플러그인(`zkl2-generic`) 추가
5. `/api/metrics`, `/api/health`, `/api/scaler` 호환성 검증
6. 대시보드 네트워크 표기/컴포넌트 동적 렌더링 검증

### 2.2 Out of Scope (1단계 제외)

1. 체인별 고급 내부 메트릭 완전 지원
2. 체인별 완전 분화 자동 복구 플레이북
3. 멀티체인 동시 수집 오케스트레이터

---

## 3. 현재 구조와 갭

현재 강점:

1. `src/chains` 기반 플러그인 레지스트리 보유
2. `CHAIN_TYPE` 기반 로딩 가능
3. Thanos/Optimism 공통 경로 검증 완료

현재 갭:

1. ZK 전용 메트릭(증명 지연/배치 제출 지연/최종성 신호) 표준화 부족
2. 일부 모듈에 OP Stack 가정이 남아 있을 가능성
3. 문서/환경변수 템플릿이 OP 중심

---

## 4. 목표 아키텍처

### 4.1 플러그인 레이어

```text
src/chains/
  types.ts
  registry.ts
  thanos/
  optimism/
  zkstack/       # 신규: ZK Stack 전용 (legacy-era / os-preview)
  zkl2-generic/ # 신규: ZK L2 공통 템플릿
```

### 4.2 메트릭 프로파일

모든 체인 플러그인이 아래 프로파일 선언을 공통 지원하도록 한다.

1. `execution`: block height, block time, txpool
2. `settlement`: L1 posting lag, finalized/verified 상태
3. `proof`: proof generation lag, proof queue depth (지원 체인만)

미지원 항목은 `null` 허용 + UI `N/A` 처리 가능.

`zkstack` 규칙:

1. `execution`은 기본 필수
2. `settlement`는 batcher/L1 제출 경로 확인 시 활성화
3. `proof`는 prover 연동 확인 시에만 활성화

### 4.3 UI 렌더링 규칙 (필수)

1. UI는 `plugin.capabilities`로 선언된 섹션만 렌더링
2. 미지원 capability 섹션은 숨김
3. API는 체인 타입에 맞는 스키마만 반환(OP 전용 필드의 ZK 반환 금지)
4. 액션 버튼(`scale`, `restart`, `failover`)은 capability + chain guard 동시 충족 시에만 노출

---

## 5. 구현 단계 (Phase Plan)

### Phase 1: 인터페이스 강화 (0.5~1일)

1. `ChainPlugin` capability 선언 확장
2. ZK 전용 optional probe 계약 추가
3. `chainMode` 필드 추가(`legacy-era | os-preview | generic`)
4. 기존 Thanos/Optimism 회귀 검증

산출물:

- `src/chains/types.ts` 업데이트
- `src/chains/*` 컴파일/테스트 통과

### Phase 2: `zkstack` 플러그인 구현 (1~2일)

1. `src/chains/zkstack/index.ts` 생성
2. `CHAIN_TYPE=zkstack` 매핑 규칙 정의
3. 모드 분기(`ZKSTACK_MODE=legacy-era|os-preview`)
4. metrics adapter 연동(`/api/metrics` 경로 유지)
5. health 계산에 ZK capability 반영

산출물:

- `src/chains/zkstack/*`
- `src/chains/__tests__/zkstack-plugin.test.ts`

### Phase 3: `zkl2-generic` 템플릿 구현 (1일)

1. Scroll/Linea/Polygon zkEVM 호환 공통 플러그인
2. 최소 필수 env와 optional env 분리
3. 체인별 override 포인트 명시

### Phase 4: API/UI 연동 점검 (1일)

1. `/api/metrics`, `/api/health`, `/api/scaler`의 체인 독립성 점검
2. capability 기반 대시보드 렌더링 점검
3. Strict Chain Isolation 검증

### Phase 5: 대시보드 기본 설계 반영 (1일)

1. 체인별 IA(정보 구조) 정의
2. 공통 컴포넌트/체인 전용 컴포넌트 경계 확정
3. 액션 흐름(확인/가드/실행/감사로그) 표준화

### Phase 6: 운영 경로 검증 (0.5일)

1. `legacy-era` 로컬 실행 확인
2. `os-preview` 모드에서 지원 필드만 노출 확인
3. gateway 사용 여부(`on/off`)에 따른 settlement 카드 노출 확인

---

## 6. 환경 변수 설계

공통:

- `CHAIN_TYPE=zkstack | zkl2-generic`
- `L2_RPC_URL=...`
- `L1_RPC_URLS=...`

ZK 전용:

- `ZKSTACK_MODE=legacy-era|os-preview` (기본: `legacy-era`)
- `ZK_PROOF_RPC_URL=...` (옵션)
- `ZK_BATCHER_STATUS_URL=...` (옵션)
- `ZK_FINALITY_MODE=confirmed|finalized|verified`
- `ZK_SETTLEMENT_LAYER=l1|gateway` (기본: `l1`)

원칙:

1. 필수 최소 2개(`CHAIN_TYPE`, `L2_RPC_URL`)만으로 부팅 가능
2. 나머지 값이 비어 있어도 서버/대시보드는 실패하지 않아야 함
3. `CHAIN_TYPE`는 워크스페이스 단위 고정(런타임 토글 금지)
4. `os-preview` 모드에서도 미지원 probe는 자동 비활성화

---

## 7. 대시보드 UI 기본 설계 (Strict Chain Isolation)

### 7.1 정보 구조(IA)

공통 탭:

1. `Overview`
2. `Execution`
3. `Settlement`
4. `Incidents`
5. `Actions`

체인 분기:

- OP Stack: `Sequencer / Batcher / Proposer`
- ZK L2: `Sequencer / Prover / Proof Queue / Verification`

### 7.2 화면 컴포넌트

공통 컴포넌트:

- `NetworkHeader`
- `HealthScoreCard`
- `IncidentTimeline`
- `ActionPanel`

OP 전용:

- `BatchSubmissionStatusCard`
- `ProposerWindowCard`

ZK 전용:

- `ProofGenerationLagCard`
- `ProofQueueDepthCard`
- `VerificationFinalityCard`
- `BatcherToSettlementCard`

### 7.3 사용자 흐름

1. 로그인/연결 시 워크스페이스 `CHAIN_TYPE` 확인
2. 체인 전용 네비게이션/컴포넌트만 마운트
3. 이상 발생 시 `Incidents`에서 원인/영향 범위 확인
4. `Actions`에서 chain-guard 통과 액션만 실행
5. 모든 액션은 감사로그(`who/when/what/result`) 저장

### 7.4 가용성/사용성 가드

1. 지원되지 않는 액션은 노출하지 않음
2. 미지원 지표는 화면 자체를 숨김(불필요한 N/A 제거)
3. 오류 메시지는 체인 맥락을 포함해 가이드 제공

---

## 8. 테스트/게이트

### Unit

1. 플러그인 capability 선언 검증
2. 모드 분기(`legacy-era`, `os-preview`) 검증
3. 스키마 가드 및 null-safe 처리 검증

### Integration

1. `CHAIN_TYPE=zkstack` 경로 전체 호출 테스트
2. `zkl2-generic` 템플릿 체인 매핑 테스트
3. API 응답의 체인 격리 규칙 검증

### Production Gate

1. 회귀 테스트 통과
2. 모드별 호환성 매트릭스 통과
3. 체인 격리 UI 검증 완료

---

## 9. 리스크 및 대응

1. ZK 체인별 API 편차 → capability 기반 단계적 지원
2. OP 가정 코드 잔존 → 체인 가드 + 스냅샷 회귀 강화
3. UI 복잡도 증가 → 공통 프레임 + 체인 전용 패널 분리

---

## 10. 작업 체크리스트

- [ ] `ChainPlugin` 인터페이스 확장
- [ ] `zkstack` 플러그인 구현
- [ ] `zkl2-generic` 템플릿 구현
- [ ] API/UI 체인 독립성 점검
- [ ] 모드별 호환성 매트릭스 문서화
- [ ] 테스트/회귀 통과

---

## 11. 완료 기준 (Definition of Done)

1. 플러그인 추가만으로 ZK 계열 체인이 동작한다.
2. OP/ZK 간 정보 노출이 완전히 분리된다.
3. 모드별(`legacy-era`, `os-preview`) 동작 차이가 명확히 검증된다.
4. 핵심 API/대시보드 경로가 회귀 없이 동작한다.

