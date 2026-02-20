# TODO: SentinAI Implementation (2026-02-16)

## Current Status

### In Progress (2026-02-20 Proposal 10/15/19 MVP Start)
- [x] Proposal 19 Savings Plans Advisor 타입/분석 로직 구현 (`src/types/savings-advisor.ts`, `src/lib/savings-advisor.ts`)
- [x] Savings Advisor API 추가 (`GET /api/savings-advisor`)
- [x] Cost Report에 Savings Advice 요약 연동 (`src/lib/cost-optimizer.ts`, `src/types/cost.ts`)
- [x] Proposal 15 Scheduled Scaling 타입/실행 모듈 구현 (`src/types/scheduled-scaling.ts`, `src/lib/scheduled-scaler.ts`)
- [x] Scheduler 매시 정각 예약 스케일링 태스크 연동 (`src/lib/scheduler.ts`)
- [x] Proposal 10 Derivation Lag 타입/모니터 구현 (`src/types/derivation.ts`, `src/lib/derivation-lag-monitor.ts`)
- [x] Metrics API에 derivation lag 상태 포함 (`src/app/api/metrics/route.ts`)
- [ ] 변경 파일 lint 및 스모크 검증
- [ ] 문서/환경변수 가이드 후속 업데이트 (다음 커밋에서 보강)

### In Progress (2026-02-20 Optimism Plugin Integration)
- [x] `docs/todo/optimism-tutorial-integration.md` 기반 요구사항 확인
- [x] `src/chains/optimism` 체인 플러그인 구현 (튜토리얼 OP Stack용)
- [x] `CHAIN_TYPE` 기반 플러그인 자동 로딩 확장 (`optimism`, `my-l2` alias)
- [x] 체인 레지스트리 테스트 보강 (`CHAIN_TYPE=optimism|my-l2`)
- [x] `.env.local.sample`에 Optimism 플러그인 환경 변수 문서화
- [x] lint 및 테스트 실행으로 회귀 검증 (chain-plugin 통과, tsc 전체 실패는 기존 테스트 타입 불일치 이슈)

### In Progress (2026-02-20 Optimism Metrics Smoke + Installer)
- [x] `CHAIN_TYPE=optimism` 기준 실제 `/api/metrics` 호출 스모크 테스트 스크립트 추가
- [x] npm 실행 커맨드 추가 (`smoke:metrics:optimism`)
- [x] `install.sh`에 체인 플러그인 선택 및 Optimism 메타데이터 설정 반영
- [x] 스모크/스크립트 문법 검증

### In Progress (2026-02-16 Refresh Audit)
- [x] **Codebase Refresh Audit P0-P2 진행 완료** (`docs/todo/codebase-audit-2026-02-16-refresh.md`)
  - P0: Seed `blockInterval` 덮어쓰기 수정 + 8 vCPU 메모리 타입 정합(16GiB) ✅
  - P1: `/api/metrics` txpool 타임아웃 + source 메타데이터 정확화 ✅
  - P2: 미들웨어 경로 매칭 강화 + 운영 코드 lint warning 정리 + ESLint ignore 현대화 ✅

### Completed (2026-02-16)
- [x] **Proposal 1-8 fully implemented (100%)**
- [x] Unit Tests 719 (100% passing, 31 files, Vitest)
- [x] E2E Verification script (`scripts/verify-e2e.sh`)
- [x] Redis State Store (Proposal 7)
- [x] **Auto-Remediation Engine (Proposal 8)** — 5 Playbooks + Circuit Breaker
- [x] **L1 RPC Rate Limit Mitigation** — 95% call reduction
- [x] **5-min Demo Materials** — 3 artifacts:
  - `scripts/demo-5min.sh` (429 lines) — automated demo script
  - `DEMO_GUIDE.md` (323 lines) — demo guide + observation points
  - `PRESENTATION_SCRIPT.md` (540 lines) — 5-stage narration script
- [x] L2 Nodes L1 RPC Status display — operator visibility
- [x] **Modular Chain Plugin System** — ChainPlugin interface + ThanosPlugin
  - `src/chains/` — types, registry, Thanos plugin (8 new files, ~1,060 LOC)
  - 20 existing modules refactored to plugin-based
- [x] **Codebase Audit P0-P3 Remediation** (`docs/todo/codebase-audit-2026-02-16.md`)
  - P0: Fixed seed metrics contaminating live data + Redis activeCount pagination bug
  - P1: Added API key auth guard (`SENTINAI_API_KEY` + `x-api-key` middleware)
  - P2: Unified scaling policy (1/2/4/8), removed dead code, fixed 10 lint warnings
  - P3: Updated docs, lint 0 errors / 40 warnings (was 51), 719 tests passing
- [x] **Deployment Enhancements** — `NEXT_PUBLIC_BASE_PATH`, Docker multi-tenant support, install.sh overhaul
- [x] **LLM Benchmark Framework** — Markdown-only output, 5 prompts, multi-provider comparison
- [x] **Production Deployment** — 2-day plan executed, infrastructure + application deployed
- [x] **CI/CD Pipeline** — 3 GitHub Actions workflows (unit-tests, lint, build)

---

## Future Tasks

### P1: Multi-Chain Plugin Implementations (Low Priority)

**Status:** Foundation complete (ChainPlugin system), additional plugins needed

**Foundation:** `src/chains/` modular plugin system (Phase 1-4 complete)
- [x] `ChainPlugin` interface + registry
- [x] `ThanosPlugin` default implementation
- [x] 20 engine modules refactored to plugin-based

**Remaining:** Additional chain plugins (4 files each)
- [ ] `src/chains/arbitrum/` — Arbitrum (Nitro) plugin
- [ ] `src/chains/zkstack/` — ZK Stack plugin
- [ ] Multi-chain dashboard UI dynamic rendering (Phase 5)

**Docs:** `docs/todo/universal-blockchain-platform.md`
**ZK 확장 계획:** `docs/todo/proposal-20-zk-l2-plugin-expansion.md`

**Estimate:** 5-7 days (1-2 days per plugin)

---

## Progress Tracking

| Category | Completed | Total | Progress |
|----------|-----------|-------|----------|
| Proposals | 8 | 13+ | 62% |
| Unit Tests | 719 | — | 100% pass |
| E2E Tests | verify-e2e.sh | — | 6-phase |
| Demo Materials | 3 | 3 | 100% |
| Codebase Audit | P0-P3 done | P0-P3 | 100% |
| CI/CD | 3 workflows | 3 workflows | 100% |
| Production Deploy | Done | — | 100% |

---

## Recent Changes (2026-02-16)

- **Production Deployment** — Infrastructure setup + application deployment completed
- **CI/CD Pipeline** — Unit test, lint, build workflows operational
- **Codebase Audit** — Full P0-P3 remediation (seed bug, activeCount, API auth, lint cleanup)
- **API Security** — `x-api-key` middleware guard for write endpoints
- **Benchmark** — Simplified to Markdown-only output (removed CSV)
- **Deployment** — `NEXT_PUBLIC_BASE_PATH` for multi-tenant subpath support

---

## Recent Changes (2026-02-19)

- [x] 대시보드 Row 2 카드 높이 고정 (`Activity Log`, `Components`)
- [x] `Activity Log` 과거 로그 탐색 슬라이더 추가 (로그 누적 시 구간 이동)
- [x] `Components` 카드 내부 스크롤 적용 (카드 외곽 높이 유지)
- [x] 검증 경로 보강: read-only 모드에서 스케일러 쓰기 허용 옵션 추가 (`SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY`)
- [x] seed 시나리오 TTL 정합화 (Redis/InMemory `setSeedScenario` 기본 80초)
- [x] Agent Loop 스케일링 판단 시 seed `currentVcpu` 대신 실제 런타임 vCPU 사용

---

## Review (2026-02-20 Optimism Plugin Integration)

- 표준 OP Stack 튜토리얼 배포를 위해 `OptimismPlugin` 추가 및 Thanos 공통 구성 재사용으로 변경 범위를 최소화함
- 레지스트리에서 `CHAIN_TYPE`를 해석해 `optimism`/`my-l2`를 자동 매핑하도록 확장함
- 테스트에서 `CHAIN_TYPE`별 로딩 경로를 검증해 기본값(thanos) 회귀를 방지함

## Review (2026-02-20 Optimism Metrics Smoke + Installer)

- dev 서버를 실제로 띄운 뒤 `/api/metrics?stress=true`를 호출해 Optimism 모드 API 응답을 검증하는 스모크 테스트를 추가함
- 설치 스크립트에서 `CHAIN_TYPE`를 입력/검증/저장하고, Optimism 선택 시 `L2_CHAIN_*`, `L1_CHAIN` 기본값까지 함께 구성하도록 확장함

## Review (2026-02-20 Proposal 10/15/19 MVP Start)

- Savings Plans Advisor를 독립 모듈/전용 API로 추가하고 `cost-report` 응답에 요약 필드를 연결해 즉시 소비 가능하게 구성함
- Scheduled Scaling은 매시 정각 cron으로 실행되며, 쿨다운/오토스케일링 상태/실시간 CPU override를 포함한 안전 가드로 최소 동작 MVP를 완성함
- Derivation Lag Monitor를 `optimism_syncStatus` 기반으로 추가하고 `/api/metrics` 응답에 lag 레벨 및 L1 헬스 정보를 포함해 관측 경로를 확보함

---

**Updated:** 2026-02-19
