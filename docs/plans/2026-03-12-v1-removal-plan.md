# SentinAI V1 Removal Plan (V2 단일화)

Date: 2026-03-12
Owner: Dexter
Priority: P0

## 목표
V1 serial agent-loop 경로를 제거하고 V2 orchestrator 경로로 단일화한다.

## 배경
현재 코드베이스는 V1(`src/lib/agent-loop.ts`)과 V2(`src/core/agent-orchestrator.ts`)가 공존한다. 공존 상태는 운영/디버깅 복잡도를 증가시키므로, V2 기준으로 실행 경로를 단순화한다.

---

## 1) 제거 대상 (확정)

### A. V1 핵심 코드
- `src/lib/agent-loop.ts`

### B. V1 테스트
- `src/lib/__tests__/agent-loop.test.ts`
- `src/lib/__tests__/agent-loop-version-detection.test.ts`

### C. V1 API 네임스페이스 (`src/app/v1/*`)
- `src/app/v1/agent/decisions/route.ts`
- `src/app/v1/agent/loop/route.ts`
- `src/app/v1/anomalies/route.ts`
- `src/app/v1/cost/report/route.ts`
- `src/app/v1/network/l1-failover/route.ts`
- `src/app/v1/network/metrics/route.ts`
- `src/app/v1/nlops/route.ts`
- `src/app/v1/ops/execute/route.ts`
- `src/app/v1/ops/jobs/[jobId]/route.ts`
- `src/app/v1/ops/plan/route.ts`
- `src/app/v1/ops/rollback/route.ts`
- `src/app/v1/ops/status/route.ts`
- `src/app/v1/ops/verify/route.ts`
- `src/app/v1/policy/autonomy-level/route.ts`
- `src/app/v1/scaling/status/route.ts`
- `src/app/v1/scaling/trigger/route.ts`

---

## 2) 참조 차단 대상 (수정 필요)

### A. `src/lib/scheduler.ts`
- V1 동적 import 제거:
  - `getRunAgentCycle()`
  - `import('@/lib/agent-loop')`
- `AGENT_V2` 분기 제거(또는 V2 고정)
- 운영 기준: 오케스트레이터만 기동

### B. `src/lib/cycle-store.ts`
- V1 fallback 제거:
  - `getLastCycle/getCycleHistory/getCycleCount`의 V1 경로 삭제
- V2 source (`core/compat/v2-cycle-adapter`) 고정

### C. `/api/agent-loop` 계열 호환
- `src/app/api/agent-loop/route.ts`는 유지(대시보드 호환용)
- 단, 내부 데이터 소스는 V2-only로 단일화

---

## 3) 유지 대상 (호환/안정성)
- `src/types/agent-cycle.ts` (UI/API 응답 계약)
- `src/core/compat/v2-cycle-adapter.ts` (V2→기존 계약 어댑터)
- `src/app/api/agent-loop/route.ts` (기존 클라이언트 호환)

---

## 4) Atomic Commit Plan (롤백 가능)

### Commit 1 — V2 단일 실행 경로 고정
- `scheduler.ts`에서 V1 실행 경로 제거
- V2 orchestrator 기동 경로만 남김
- 목적: 런타임에서 V1 실행 차단

### Commit 2 — Cycle Store V2-only 전환
- `cycle-store.ts`의 V1 import/fallback 제거
- `/api/health`, `/api/agent-loop`, `/api/agent-fleet` 경로 회귀 확인

### Commit 3 — V1 코드/테스트 제거
- `src/lib/agent-loop.ts` 삭제
- 관련 V1 테스트 2개 삭제
- 타입/참조 오류 정리

### Commit 4 — `src/app/v1/*` API 제거
- v1 네임스페이스 라우트 일괄 제거
- 라우팅 영향(404 기대) 확인

### Commit 5 — 문서/운영 가이드 갱신
- README/ARCHITECTURE/운영 문서에서 V1 언급 제거
- V2 기본 운영 방법 명시

---

## 5) 검증 체크리스트

### 빌드/테스트
- [ ] `npm run build`
- [ ] `npm run test:run`
- [ ] 핵심 API 스모크
  - [ ] `/api/health`
  - [ ] `/api/agent-loop`
  - [ ] `/api/agent-fleet`
  - [ ] `/api/metrics`

### 런타임
- [ ] AGENT_V2=true 환경에서 인스턴스 부팅 확인
- [ ] Agent statuses 정상 노출 확인
- [ ] anomaly → executor 경로 동작 확인

### 회귀
- [ ] 대시보드 메인 페이지(`src/app/page.tsx`) 정상 렌더
- [ ] V1 의존 import 잔존 여부 0건

---

## 6) 위험요소 및 대응

1. API 응답 계약 깨짐
- 대응: `types/agent-cycle.ts` + `v2-cycle-adapter.ts` 유지

2. scheduler 초기화 경로 누락
- 대응: Commit 1에서 헬스체크와 함께 검증

3. 숨은 V1 참조 잔존
- 대응: grep 기반 참조 스캔 + TS compile 에러 정리

4. 운영 중 롤백 필요
- 대응: 5개 atomic commit으로 단계별 롤백 가능

---

## 7) 최종 완료 정의
- V1 코드/분기/API 제거 완료
- V2 경로로 핵심 API/대시보드 정상
- 테스트/빌드 통과
- 문서 갱신 및 main 반영 완료
