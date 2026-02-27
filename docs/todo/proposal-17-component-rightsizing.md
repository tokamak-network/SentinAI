# 제안 17: 멀티 컴포넌트 라이트사이징

## 1. 개요

### 문제 정의

현재 SentinAI의 자동 스케일링 대상은 **op-geth**(`sepolia-thanos-stack-op-geth`) 중심이다.
그러나 실제 EKS 클러스터는 4개 이상의 Optimism 계열 컴포넌트를 상시 운영하며, 컴포넌트별 리소스 특성이 크게 다르다.

| 컴포넌트 | CPU 특성 | 현재 할당 | 실제 필요 | 낭비 수준 |
|---|---|---|---|---|
| op-geth | 블록 실행, I/O 집약 | 1-4 vCPU (자동) | 1-4 vCPU | 이미 최적화 |
| op-node | 유도(derivation), 주기성 부하 | 1 vCPU, 2 GiB | 0.25-0.5 vCPU | 유휴 비율 높음 |
| op-batcher | 2-5분 주기 L1 제출 | 1 vCPU, 2 GiB | 0.25 vCPU | 유휴 비율 높음 |
| op-proposer | 상태 제안, 경량 부하 | 0.5 vCPU, 1 GiB | 0.125 vCPU | 유휴 비율 높음 |

고정 리소스 할당으로 24/7 운영되면서 월 약 $50 수준의 과할당 비용이 발생한다.

### 해결 요약

**Component Resource Analyzer**를 도입해 아래를 수행한다.

1. `kubectl top pod`로 전체 L2 컴포넌트 CPU/메모리 수집
2. 컴포넌트별 사용 이력 유지(48시간 관측)
3. 20% 안전 마진을 포함한 권장 리소스 계산
4. `kubectl patch statefulset`으로 라이트사이징 적용
5. 컴포넌트별 독립 쿨다운으로 op-geth 스케일링과 간섭 방지

### 목표

- op-node/op-batcher/op-proposer를 실제 사용량 기반으로 라이트사이징
- 월 약 $50 비용 절감
- 기존 op-geth 스케일링 엔진과 독립 운영
- 최소 안전 임계값으로 OOM/CPU 스로틀링 방지

### 비목표

- op-geth 스케일링(기존 엔진 유지)
- 수평 스케일(레플리카 증감)
- Proxyd 스케일링
- 컴포넌트 간 종속성 분석 자동화

### 월 절감 추정

| 컴포넌트 | 현재 | 라이트사이징 후 | 월 절감 |
|---|---|---|---|
| op-node | 1 vCPU, 2 GiB | 0.5 vCPU, 1 GiB | 약 $17 |
| op-batcher | 1 vCPU, 2 GiB | 0.25 vCPU, 0.5 GiB | 약 $25 |
| op-proposer | 0.5 vCPU, 1 GiB | 0.25 vCPU, 0.5 GiB | 약 $8 |
| 합계 |  |  | **약 $50/월** |

---

## 2. 아키텍처

### 데이터 흐름

1. Agent Loop(30초 주기)에서 신규 단계로 `collectComponentMetrics()` 실행
2. `kubectl top pod`로 대상 컴포넌트 사용량 수집
3. `ComponentResourceAnalyzer`가 이력 저장
4. 6시간마다 `evaluateRightSizing()` 실행
5. `currentAlloc > recommended × 1.2` 조건이면 패치 적용

### 통합 지점

| 모듈 | 파일 | 용도 |
|---|---|---|
| K8s Config | `src/lib/k8s-config.ts` | `runK8sCommand()`로 top/patch 실행 |
| Agent Loop | `src/lib/agent-loop.ts` | 신규 단계 통합 |
| Daily Accumulator | `src/lib/daily-accumulator.ts` | 라이트사이징 이벤트 기록 |
| State Store | `src/lib/redis-store.ts` | 사용량 이력 영속화 |

### 상태 관리

`IStateStore` 확장 항목:

- `getComponentUsageHistory(component)`
- `pushComponentUsage(component, point)`
- `getComponentRightSizingState()`
- `setComponentRightSizingState(state)`

---

## 3. 상세 설계

### 3.1 신규 타입

신규 파일: `src/types/component-rightsizing.ts`

핵심 타입:

1. `L2Component`: `op-node | op-batcher | op-proposer`
2. `ComponentUsagePoint`: 시점별 CPU(millicores), Memory(MiB)
3. `ComponentResources`: 할당 리소스
4. `RightSizingRecommendation`: 현재/권장 리소스, 피크/평균, 신뢰도, 절감액
5. `RightSizingResult`: 실행 결과, 스킵 사유, 타임스탬프
6. `ComponentRightSizingConfig`: 관측 창, 평가 주기, 쿨다운, 안전 마진, 최소치

기본값 권장:

- `enabled=false`
- `observationWindowHours=48`
- `evaluationIntervalHours=6`
- `cooldownHours=12`
- `safetyMarginPct=20`
- `minCpuMillicores=125`
- `minMemoryMiB=256`

### 3.2 코어 모듈

신규 파일: `src/lib/component-rightsizer.ts`

핵심 책임:

1. 대상 컴포넌트별 현재 사용량 수집
2. 히스토리 버퍼 관리(최대 포인트 제한)
3. 권장 리소스 산출(피크 + 안전 마진)
4. 현재 할당과 비교해 적용 여부 결정
5. 조건 충족 시 StatefulSet patch 실행
6. 결과 로그/이력 기록

### 3.3 Agent Loop 연동

- 감지/분석/계획/행동 단계 이후 라이트사이징 수집 단계를 추가
- 평가 실행은 6시간 주기로 제한
- 스케일링 충돌 방지를 위해 컴포넌트별 쿨다운/락 적용

### 3.4 API 엔드포인트

권장 API:

1. `GET /api/component-rightsizing/status`
2. `POST /api/component-rightsizing/evaluate`
3. `POST /api/component-rightsizing/apply`

응답은 컴포넌트별 권장값, 실행 여부, 스킵 사유, 예상 절감액 포함.

### 3.5 환경 변수

- `COMPONENT_RIGHTSIZING_ENABLED`
- `COMPONENT_RIGHTSIZING_OBSERVATION_HOURS`
- `COMPONENT_RIGHTSIZING_EVALUATION_HOURS`
- `COMPONENT_RIGHTSIZING_COOLDOWN_HOURS`
- `COMPONENT_RIGHTSIZING_SAFETY_MARGIN_PCT`
- `COMPONENT_RIGHTSIZING_MIN_CPU_MILLICORES`
- `COMPONENT_RIGHTSIZING_MIN_MEMORY_MIB`

---

## 4. 구현 가이드

### 파일 변경 목록

신규:

- `src/types/component-rightsizing.ts`
- `src/lib/component-rightsizer.ts`
- `src/app/api/component-rightsizing/status/route.ts`
- `src/app/api/component-rightsizing/evaluate/route.ts`
- `src/lib/__tests__/component-rightsizer.test.ts`

수정:

- `src/lib/agent-loop.ts`
- `src/lib/redis-store.ts`
- `src/types/redis.ts` (스토어 계약 확장)

### 재사용 함수

- `runK8sCommand()`
- `getNamespace()`
- `getAppPrefix()`

### 구현 순서

1. 타입/스토어 계약 확정
2. 수집기 구현 + 단위 테스트
3. 추천 엔진 구현 + 단위 테스트
4. 패치 실행기 구현 + 통합 테스트
5. Agent Loop 연동
6. API/대시보드 노출

---

## 5. 테스트 명세

### Mock 전략

- `kubectl top` 출력 mock
- `kubectl patch` 성공/실패 mock
- 시간 경과(쿨다운/평가 주기) mock
- 저장소 read/write mock

### 테스트 케이스

1. 사용량 데이터 누적 및 히스토리 상한 유지
2. 샘플 부족 시 `insufficient-data` 스킵
3. 쿨다운 중 `cooldown` 스킵
4. 이미 최적 범위면 `already-optimal` 스킵
5. 권장치 산출 정확성(피크+마진, 최소치 반영)
6. 패치 성공 시 상태 업데이트/이벤트 기록
7. 패치 실패 시 오류 처리 및 재시도 가능 상태 유지
8. 시뮬레이션 모드에서 실행 차단

### 최소 커버리지

- 라인 커버리지 85% 이상
- 핵심 의사결정 분기 100%

---

## 6. 검증

### Step 1: Build

- `npm run lint`
- `npx tsc --noEmit`

### Step 2: Unit Tests

- `npm run test:run -- component-rightsizer`

### Step 3: 통합 테스트 (라이브 클러스터 필요)

1. 48시간 관측 전에는 적용되지 않는지 확인
2. 관측 후 권장치 생성 확인
3. 수동 evaluate/apply 호출 시 StatefulSet 리소스 변경 확인
4. 변경 후 Pod 재기동/안정성 확인

### Step 4: 전체 테스트

- `npm run test:run`

