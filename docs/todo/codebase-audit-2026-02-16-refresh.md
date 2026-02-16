# SentinAI 코드베이스 재감사 및 수정 계획 (2026-02-16 Refresh)

## 1. 감사 범위 및 기준

- 범위: `src/app`, `src/app/api`, `src/lib`, `src/types`, `src/chains`, `docs`
- 실행 검증:
  - `npm run lint` (결과: 0 errors, 45 warnings)
  - `npm run test:run` (결과: 31 files, 719 tests passed)
- 목표:
  - 현재 코드 기준 구조/리스크 재확인
  - 실제 버그 후보 및 정리 대상 파일 식별
  - 우선순위 기반 수정 계획 문서화

## 2. 구조 요약

- `src/app`: 대시보드 UI와 App Router 엔트리
- `src/app/api/*`: 관측/분석/스케일링/복구 API
- `src/lib`: 핵심 도메인 로직
  - 수집/저장: `metrics-store.ts`, `redis-store.ts`, `daily-accumulator.ts`
  - 판단/실행: `scaling-decision.ts`, `predictive-scaler.ts`, `k8s-scaler.ts`, `agent-loop.ts`
  - 운영 지원: `l1-rpc-failover.ts`, `eoa-detector.ts`, `playbook-matcher.ts`
- `src/chains`: 체인 플러그인 추상화 및 Thanos 구현
- `src/types`: 도메인 타입/계약

## 3. 리뷰 결과 (심각도 순)

### [High] Seed 메트릭 `blockInterval`이 실시간 계산으로 덮어써짐

- 근거:
  - `src/app/api/metrics/route.ts:387`
  - `src/app/api/metrics/route.ts:484`
- 문제:
  - Seed 경로에서 `seedMetricData.blockInterval`을 할당한 뒤, 아래에서 `blockInterval = 2.0`으로 재초기화하고 실시간 블록 간격 계산 로직을 재실행함.
  - 결과적으로 seed 시나리오에서 입력한 블록 간격이 응답/저장 단계에서 일관되게 유지되지 않을 수 있음.
- 영향:
  - 시뮬레이션/데모 데이터 신뢰도 저하, 예측 입력 왜곡 가능.
- 수정 방향:
  - `usingSeedMetrics`일 때 블록 간격 재계산 경로를 건너뛰고 seed 값을 그대로 사용.
  - seed/live 분기 단위로 메트릭 계산 함수를 분리해 재초기화 부작용 차단.

### [High] 스케일링 메모리 타입 단언이 `8 vCPU => 16GiB`를 타입에서 누락

- 근거:
  - `src/lib/scaling-decision.ts:149`
  - `src/lib/agent-loop.ts:354`
  - `src/app/api/scaler/route.ts:237`
- 문제:
  - 런타임은 `targetVcpu * 2`를 사용해 `16`이 생성될 수 있으나, 타입 단언은 `2 | 4 | 8`로 제한.
  - 타입 시스템이 실제 런타임 계약을 제대로 표현하지 못해 추후 리팩터링 시 결함 은닉 가능.
- 영향:
  - 타입 안정성 저하, 회귀 버그 위험 증가.
- 수정 방향:
  - 공통 타입 유틸(예: `TargetMemoryGiB = 2 | 4 | 8 | 16`)로 통일.
  - 3개 위치 단언을 동일 타입으로 치환하고 단위 테스트에 `8->16` 케이스 명시.

### [Medium] Metrics API의 txpool RPC fetch에 타임아웃 부재

- 근거:
  - `src/app/api/metrics/route.ts:340`
  - (비교 기준) `src/lib/agent-loop.ts:205`는 `AbortController` 사용
- 문제:
  - `/api/metrics`는 `txpool_status` 호출 시 타임아웃이 없어 RPC 지연/행 시 요청이 오래 붙잡힐 수 있음.
- 영향:
  - 대시보드 응답 지연, API tail latency 악화.
- 수정 방향:
  - `agent-loop`과 동일한 타임아웃 패턴(`AbortController`) 적용.
  - 실패 시 현재 fallback(`block.transactions.length`) 유지.

### [Medium] Seed 사용 시 응답 source 메타데이터가 항상 실데이터로 표시됨

- 근거:
  - `src/app/api/metrics/route.ts:387`
  - `src/app/api/metrics/route.ts:545`
- 문제:
  - CPU source는 `seed`로 표시하지만, 응답의 `metrics.source`는 항상 `"REAL_K8S_CONFIG"`로 고정.
  - 데이터 출처가 상충되어 운영자가 진짜 관측치와 seed 재생 데이터를 구분하기 어려움.
- 영향:
  - 운영/데모 판단 혼선, 추적성 저하.
- 수정 방향:
  - `metrics.source`를 `REAL_K8S_CONFIG | SEED_SCENARIO` 등으로 분기.
  - 필요 시 `MetricDataPoint`에 `source` 필드 추가해 저장 계층까지 일관화.

### [Low] 미들웨어 인증 면제 경로가 `startsWith` 기반

- 근거:
  - `src/middleware.ts:51`
- 문제:
  - `pathname.startsWith('/api/metrics/seed')` 형태는 의도치 않은 하위 경로까지 면제될 수 있음.
- 영향:
  - 면제 범위 오인 가능성.
- 수정 방향:
  - 정확 일치 또는 명시적 allowlist(정규화된 경로 비교)로 전환.

## 4. 정리 대상 파일 (Clean-up Candidates)

- `src/app/page.tsx`
  - 미사용 import/state (`ArrowUpRight`, `Database`, `prediction`, `preStressVcpuRef`) 경고 정리 필요.
- `src/lib/eoa-detector.ts`
  - 호환성용 미사용 파라미터 3개 경고 처리(의도 명시 또는 시그니처 정리).
- `src/lib/playbook-matcher.ts`
  - placeholder 함수 미사용 인자 경고 정리.
- `scripts/benchmark/reporter.ts`, `scripts/benchmark/runner.ts`
  - 미사용 변수 정리.
- lint 설정
  - `.eslintignore` 경고 대응: flat config `ignores`로 이관 필요.
  - `coverage/*` lint 대상 제외 명시 필요.

## 5. 실행 계획 (우선순위)

1. P0 안정성/타입 정합
   - seed `blockInterval` 덮어쓰기 수정
   - 메모리 타입 단언 통합 (`2|4|8|16`)
   - 테스트 추가: seed 시 blockInterval 보존, 8->16 메모리 케이스
2. P1 관측 신뢰성/성능
   - `/api/metrics` txpool fetch 타임아웃 적용
   - `metrics.source` 실제 출처 반영
3. P2 보안/정리
   - 미들웨어 면제 경로 strict 매칭
   - 운영 코드 lint warning 우선 제거
   - ESLint ignore 설정 현대화

## 6. 검증 체크리스트 (수정 후)

- `npm run lint` 경고/오류 재확인 (최소 운영 코드 경고 0 목표)
- `npm run test:run` 전체 통과 확인
- API 스모크:
  - `/api/metrics` seed/live 각각 source 및 blockInterval 확인
  - `/api/scaler` 8 vCPU 경로에서 memory 16GiB 타입/응답 일치 확인
  - 인증 면제 경로 정확성 확인

## 7. 진행 현황

- [x] P0 안정성/타입 정합 (완료)
  - seed block interval 보존 로직 적용 (`resolveBlockInterval`)
  - `TargetMemoryGiB` 타입 도입 및 16GiB 포함 통일
  - 단위 테스트 추가:
    - `src/lib/__tests__/block-interval.test.ts`
    - `src/lib/__tests__/scaling-decision.test.ts` (8 vCPU/16GiB 케이스)
- [x] P1 관측 신뢰성/성능 (완료)
  - `/api/metrics` txpool RPC 타임아웃 적용 (`AbortController`, 15s)
  - 응답 `metrics.source`를 seed/live 실제 데이터 출처로 분기
- [x] P2 보안/정리 (완료)
  - 미들웨어 인증 면제 경로를 exact match로 강화 (`startsWith` 제거)
  - 운영 코드 lint warning 정리 (dashboard/scripts/lib)
  - `.eslintignore` 제거 및 `eslint.config.mjs` `globalIgnores`로 완전 이관
  - 테스트 파일 포함 전체 lint warning 정리 완료 (0 warnings)

## 8. 최종 검증 결과

- `npm run lint`: 0 errors, 0 warnings
- `npm run test:run`: 31 files, 719 tests passed
