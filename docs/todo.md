# TODO: SentinAI Implementation

> **Last Updated:** 2026-02-25

## Current Status

### Done (2026-02-24 Network Stack Dashboard/Feature Differences Guide)
- [x] 스택별 차이 기준(ChainPlugin capability + adapter action) 정리
- [x] 신규 운영 가이드 작성 (`docs/guide/network-stack-dashboard-feature-differences.md`)
- [x] 문서 인덱스/연계 링크 반영 (`docs/README.md`, `docs/guide/autonomy-cockpit-user-guide.md`)
- [x] 배포 환경별 차이(로컬 Docker/K8s/EKS, simulation/production/auth 가드) 섹션 추가
- [x] 스택 축 + 배포환경 축 단일 의사결정 매트릭스 문서 추가 (`docs/guide/stack-environment-operations-decision-matrix.md`)
- [x] `.env.local` 기반 즉시 판정표 문서 추가 (`docs/guide/env-based-operations-profile-quick-decider.md`)
- [x] `.env.local` 자동 판정 스크립트 추가 (`scripts/check-ops-profile.sh`, `package.json` scripts)
- [x] Agent Loop only vs Loop+Goal Manager 비교 실습 runbook 추가 (`docs/guide/agent-loop-vs-goal-manager-hands-on-runbook.md`)
- [x] 발표/고객 데모용 15분 축약 runbook 추가 (`docs/guide/agent-loop-vs-goal-manager-demo-15min.md`)
- [x] 발표자 멘트 스크립트 추가 (`docs/guide/agent-loop-vs-goal-manager-demo-speaker-script.md`)

### Done (2026-02-24 Multi-Stack Autonomous Ops Capability Layer)
- [x] Autonomous operations domain types 추가 (`src/types/autonomous-ops.ts`)
- [x] 체인별 autonomous adapter 추가 (`src/lib/autonomous/adapters/*`)
- [x] `ChainPlugin`/`ChainCapabilities` 계약 확장 및 플러그인 구현 동기화 (`src/chains/types.ts`, `src/chains/*/index.ts`)
- [x] `goal-planner`를 adapter 기반 step 생성으로 확장 (`src/lib/goal-planner.ts`)
- [x] `action-executor`에 `executeAutonomousAction` 진입점 추가 (`src/lib/action-executor.ts`)
- [x] `operation-verifier`에 autonomous verify 경로 추가 (`src/lib/operation-verifier.ts`)
- [x] autonomous 서비스/API 추가 (`src/lib/autonomous/service.ts`, `src/app/api/autonomous/*`)
- [x] MCP 도구 확장 (`src/types/mcp.ts`, `src/lib/mcp-server.ts`)
- [x] 검증 문서 추가 및 인덱스 연결 (`docs/guide/multistack-autonomous-ops-validation.md`, `docs/README.md`, `docs/guide/api-reference.md`)
- [x] 검증 실행 (`npm run lint`, `npx tsc --noEmit`, `npm run test:run -- src/lib/__tests__/autonomous-service.test.ts src/lib/__tests__/goal-planner.test.ts src/lib/__tests__/mcp-server.test.ts`)

### Done (2026-02-24 Arbitrum Orbit Example Onboarding)
- [x] Arbitrum 공식 Orbit 예제(`create-rollup-eth`) 레퍼런스 확인 및 파일 구조 수집
- [x] `examples/arbitrum-orbit/create-rollup-eth` 예제 코드/환경 템플릿 추가 (`README.md`, `.env.example`, `index.ts`, `low_level.ts`, `package.json`, `tsconfig.json`)
- [x] 문서 인덱스 링크 추가 (`docs/README.md`)
- [x] 예제 단위 검증 실행 (`npm install --package-lock=false`, `npm run typecheck`, `npm run lint -- examples/arbitrum-orbit/create-rollup-eth/index.ts examples/arbitrum-orbit/create-rollup-eth/low_level.ts`)

### Done (2026-02-24 Remove Lighthouse/Playwright CI)
- [x] Lighthouse 전용 scheduled CI 제거 (`.github/workflows/prod-gate-tier2.yml`)
- [x] Playwright/LHCI 포함 scheduled CI 제거 (`.github/workflows/prod-gate-tier3.yml`)
- [x] 워크플로우 참조 확인 (`rg -n "prod-gate-tier2|prod-gate-tier3|playwright|lighthouse"`)

### Done (2026-02-24 Agent Loop Heartbeat Guardrail)
- [x] Redis state store에 agent loop heartbeat 저장/조회 메서드 추가 (`src/types/redis.ts`, `src/lib/redis-store.ts`)
- [x] Scheduler가 agent cycle마다 heartbeat를 갱신하도록 연결 (`src/lib/scheduler.ts`)
- [x] `/api/health`에 `agentLoop.heartbeatLagSec` 및 `stale` 상태를 노출 (`src/app/api/health/route.ts`)
- [x] stale 감시 스크립트/cron 예시 추가 (`scripts/check-agent-heartbeat.mjs`, `scripts/agent-heartbeat.cron.example`, `package.json`)
- [x] 검증 실행 (`npm run lint`, `npx tsc --noEmit`, `npm run test:run -- src/lib/__tests__/redis-store.test.ts src/lib/__tests__/scheduler.test.ts src/app/api/health/route.test.ts`)

### Done (2026-02-24 ARCHITECTURE.md Codebase Alignment)
- [x] 기존 아키텍처 문서의 구현 불일치 영역 식별 (기본 체인, scheduler 간격, state store 구조, MCP/goal/runtime 정책)
- [x] 코드 기준으로 문서 전면 재구성 (`ARCHITECTURE.md`)
- [x] 최신 런타임 흐름 반영 (agent loop + heartbeat watchdog + recovery, MCP policy, goal orchestrator)
- [x] quick file reference 섹션 추가로 코드 추적 경로 고정

### Done (2026-02-24 Agent Heartbeat Alert Hookup)
- [x] heartbeat 검사 결과(exit code 2) 기반 webhook 알림 래퍼 스크립트 추가 (`scripts/monitor-agent-heartbeat-alert.mjs`)
- [x] npm 실행 엔트리 추가 (`monitor:agent-heartbeat:alert`) 및 cron 예시를 alert 래퍼 기준으로 갱신 (`package.json`, `scripts/agent-heartbeat.cron.example`)
- [x] 검증 실행 (`npm run lint`, `npx tsc --noEmit`, `node scripts/monitor-agent-heartbeat-alert.mjs`)

### Done (2026-02-24 In-Process Heartbeat Watchdog Autorecovery)
- [x] scheduler 내부에 heartbeat watchdog 루프 추가 (stale/read-write 실패 감지 + 알림 + recovery cycle 자동 시도) (`src/lib/scheduler.ts`)
- [x] 서버 헬스/상태 API에 watchdog 상태 필드 노출 (`src/app/api/health/route.ts`, `src/app/api/agent-loop/route.ts`)
- [x] 운영 환경변수 샘플 업데이트 (`.env.local.sample`)
- [x] scheduler 상태 테스트 보강 (`src/lib/__tests__/scheduler.test.ts`)
- [x] 검증 실행 (`npm run lint -- src/lib/scheduler.ts src/app/api/health/route.ts src/app/api/agent-loop/route.ts src/lib/__tests__/scheduler.test.ts`, `npx tsc --noEmit`, `npm run test:run -- src/lib/__tests__/scheduler.test.ts src/app/api/health/route.test.ts`)

### Done (2026-02-24 Codebase Directory Structure Documentation)
- [x] 저장소 디렉토리 구조 수집 (`find`, `ls`)
- [x] 전체 트리 문서 신규 작성 (`docs/guide/codebase-directory-structure.md`)
- [x] 주요 디렉토리/주요 루트 파일 설명 섹션 추가 (`docs/guide/codebase-directory-structure.md`)
- [x] 문서 인덱스에 링크 추가 (`docs/README.md`)
- [x] 검증 실행 (`npm run lint`, `npx tsc --noEmit`)

### Done (2026-02-22 Dashboard Autonomy Cockpit MVP)
- [x] 대시보드에 자율 에이전트 인지용 `Autonomy Cockpit` 패널 추가 (`src/app/page.tsx`)
- [x] `goal-manager`/`autonomy policy` 상태 polling 연결
- [x] 데모 컨트롤(시나리오 주입, goal tick, dry-run dispatch) UI/액션 연결
- [x] 검증 실행 (`npm run lint -- src/app/page.tsx`, `npx tsc --noEmit`)
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Dashboard Autonomy Policy Level Control Expansion)
- [x] 자율 레벨(`A0~A5`) 런타임 변경 버튼을 `Autonomy Cockpit`에 추가 (`src/app/page.tsx`)
- [x] 정책 변경 API(`POST /api/policy/autonomy-level`) 연동 및 성공/실패 피드백 메시지 연결
- [x] 정책 변경 중/데모 액션 실행 중 상호 배타 disable 처리로 동시 실행 충돌 방지
- [x] 임계치(`minConfidenceDryRun`, `minConfidenceWrite`)를 패널에 노출해 현재 정책 상태 가시화
- [x] 검증 실행 (`npm run lint -- src/app/page.tsx`, `npx tsc --noEmit`)

### Done (2026-02-22 Autonomy Cockpit E2E + Level Tooltip)
- [x] 정책 레벨 버튼에 권한/가드레일 툴팁 추가 (`src/app/page.tsx`)
- [x] 정책 레벨/피드백 영역에 e2e 안정 셀렉터(`data-testid`) 추가
- [x] Playwright 실행 환경에 테스트용 정책 API key 주입 및 webServer build/start 일원화 (`playwright.config.ts`)
- [x] 정책 레벨 변경 성공 피드백 + 툴팁 노출 e2e 시나리오 추가 (`e2e/autonomy-cockpit.spec.ts`)
- [x] 검증 실행 (`npm run lint -- src/app/page.tsx e2e/autonomy-cockpit.spec.ts playwright.config.ts`, `npx tsc --noEmit`, `npx playwright test e2e/autonomy-cockpit.spec.ts`)

### Done (2026-02-22 Autonomy Cockpit User Guide Documentation)
- [x] 대시보드 `Autonomy Cockpit` UI 요소/액션/API 매핑 확인 (`src/app/page.tsx`, `src/app/api/*`)
- [x] 신규 사용자 가이드 작성 (`docs/guide/autonomy-cockpit-user-guide.md`)
- [x] 문서 인덱스 갱신 및 삭제된 ENV 가이드 링크 정리 (`docs/README.md`)
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 L2 Ops vs MCP Comparison Section)
- [x] 통합 MCP 가이드에 기존 L2 운영과 MCP 기반 운영 비교 섹션 추가
- [x] 운영 관점 비교 항목(진입 방식/흐름/안전 제어/속도/추적/적용 범위) 표로 정리
- [x] OP Stack 권고 및 ZK Stack 비활성화 정책을 비교 표에 동기화
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 MCP Value + OP-Only Policy Update)
- [x] MCP 사용 효용성 섹션 추가 (`docs/guide/sentinai-mcp-user-guide.md`)
- [x] 지원 체인 정책을 OP Stack 권고 / ZK Stack 비활성화로 명시
- [x] 빠른 시작/문제 해결/체크리스트를 OP 전용 운영 기준으로 정리
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 MCP Prompt Natural Language Conversion)
- [x] MCP 사용자 가이드의 프롬프트 예시에서 tool 이름 직접 호출 문구 식별
- [x] 프롬프트 예시를 자연어 의도 중심 문장으로 일괄 치환
- [x] 운영 체크리스트/문제해결 문구에서도 tool 이름 의존 표현 최소화
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Docs Reference Hygiene)
- [x] `docs/**/*.md` 로컬 링크 무결성 재검사 및 깨진 링크 0건 확인
- [x] 누락된 과거 감사 경로 스텁 추가 (`docs/todo/codebase-audit-2026-02-16.md`)
- [x] Proposal 28 참조 경로용 Draft 스텁 문서 4건 생성 (guide/spec)
- [x] 통합 안내 문서(`claude-code-mcp-*`)를 클릭 가능한 링크 기반으로 정리

### Done (2026-02-22 SentinAI MCP User Guide Consolidation)
- [x] `claude-code-mcp-setup.md` + `claude-code-mcp-operations-guide.md` 통합 구조 설계
- [x] 통합 문서 신규 작성 (`docs/guide/sentinai-mcp-user-guide.md`)
- [x] 기존 setup/operations 문서를 통합 가이드 안내 문서로 정리
- [x] 문서 인덱스 및 회고 업데이트 (`docs/README.md`, `docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 L1 Client Operations Automation Documentation)
- [x] 요청 범위를 L1 운영 자동화 기술 요소 문서로 확정
- [x] 신규 가이드 작성 (`docs/guide/l1-client-operations-automation-guide.md`)
- [x] 문서 인덱스 링크 추가 (`docs/README.md`)
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Ethereum L1 Client Automation Expansion)
- [x] geth/ethrex/reth/besu/erigon 운영 시 필수 자동화 요소 확장 반영
- [x] L1 클라이언트 전용 자동화 매트릭스(항목/필요성/DoD) 추가
- [x] 클라이언트별 운영 포인트와 4주 MVP 우선순위 업데이트
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Minor Client Focused Documentation Refinement)
- [x] `geth` 제외 요청 반영 및 문서 범위 축소
- [x] `reth/besu/erigon/ethrex` 중심 전용 자동화 항목으로 재작성
- [x] 마이너 클라이언트 기준 MVP/체크리스트 재정의
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Multi-Client Project Analysis Driven Documentation Update)
- [x] `reth/besu/erigon/ethrex/nethermind` 공식 문서/릴리즈 기반 분석 추가
- [x] 분석 스냅샷(버전/운영특성/자동화 포인트) 섹션 신규 작성
- [x] 분석 결과를 반영한 자동화 매트릭스/클라이언트별 포인트/MVP/체크리스트 개선
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 L1 Client Incident Response Matrix)
- [x] L1 클라이언트 운영 이슈 목록을 우선순위(P1/P2/P3) 기준으로 정리
- [x] 이슈별 탐지 신호/즉시 대응/근본 해결 자동화 항목 추가
- [x] 표준 대응 흐름(탐지->격리->복구->검증->회고) 문서화
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 Full-Auto Recovery Actions + Safe Sudo Model)
- [x] 완전 자동화 가능 이슈별 AI Agent 액션 시퀀스 추가
- [x] `sudo`가 필요한 네트워크 조치(30303) 안전 실행 모델 추가
- [x] OpenClaw 유사 정책 기반 Action Broker 구조 반영
- [x] 작업 회고 반영 (`docs/todo.md`, `docs/lessons.md`)

### Done (2026-02-22 L1 RPC Path Separation)
- [x] SentinAI 내부 조회용 L1 RPC와 L2 노드 failover용 L1 RPC 경로 분리 설계 확정
- [x] `getSentinaiL1RpcUrl` 추가 및 내부 조회 경로 전환 (`metrics`, `EOA`, `goal-signal`, `component diagnostics`)
- [x] `L1_RPC_URLS`를 L2 노드 failover endpoint list 의미로 고정 (`src/lib/l1-rpc-failover.ts`)
- [x] `.env` 샘플/ENV 가이드 업데이트 및 관련 단위 테스트 보강

### Done (2026-02-21 Q1 Strategic Roadmap Documentation)
- [x] Q1 scope fixed to Phase 1 core only (MCP, Guardian v2, Memory/Trace, Model Routing)
- [x] Proposal 21 draft created: `docs/todo/proposal-21-mcp-control-plane.md`
- [x] Proposal 22 draft created: `docs/todo/proposal-22-guardian-agent-v2.md`
- [x] Proposal 23 draft created: `docs/todo/proposal-23-agent-memory-and-reasoning-trace.md`
- [x] Proposal 24 draft created: `docs/todo/proposal-24-model-routing-and-cost-policy.md`
- [x] Proposal 25 draft created: `docs/todo/proposal-25-claude-code-autonomous-ops.md`
- [x] Proposal 21 MCP baseline implementation start (`src/app/api/mcp/route.ts`, `src/lib/mcp-server.ts`, `src/types/mcp.ts`)
- [x] MCP approval token state store added (`src/types/redis.ts`, `src/lib/redis-store.ts`)
- [x] MCP baseline unit tests added (`src/lib/__tests__/mcp-server.test.ts`)
- [x] Proposal 22 Guardian v2 baseline start (`src/lib/agent-loop.ts` phase split + `decisionId` + verification + phase trace)
- [x] Proposal 23 Memory/Trace baseline start (`src/types/agent-memory.ts`, `src/lib/agent-memory.ts`, `/api/agent-memory`, `/api/agent-decisions`)
- [x] Proposal 24 Routing baseline start (`src/types/ai-routing.ts`, `src/lib/ai-routing.ts`, `/api/ai-routing/status`, `/api/ai-routing/policy`)
- [x] 22-24 baseline tests added/updated (`src/lib/__tests__/ai-routing.test.ts`, `src/lib/__tests__/redis-store.test.ts`, `src/lib/__tests__/agent-loop.test.ts`)
- [x] Proposal 22 runtime hardening (`observe` fallback to last-safe metrics, `act` failure degraded completion, activity log decision/verify/phase trace exposure)
- [x] Proposal 23 planning integration (memory retrieval hook connected to scaling plan reasoning)
- [x] Proposal 24 runtime hardening (multi-provider fallback retries, circuit-breaker, budget-constrained routing policy switch, routing status circuit/budget telemetry)
- [x] 22-24 hardening tests added (`agent-loop` degraded/fallback path, `ai-routing` circuit/budget path, `ai-client` provider fallback path)
- [x] Proposal 23 dashboard drill-down (`decisionId` click -> `/api/agent-decisions` trace modal)
- [x] Proposal 24 policy write auth guard (`POST /api/ai-routing/policy` admin key required + route test)
- [x] Proposal 22/24 runbook added (`docs/guide/agentic-q1-operations-runbook.md`)
- [x] Proposal 21 MCP compatibility expansion (`initialize`, `notifications/initialized`, `tools/call` in `src/lib/mcp-server.ts`)
- [x] Proposal 22 autonomous goal planning MVP (`src/types/goal-planner.ts`, `src/lib/goal-planner.ts`, `src/app/api/goals/route.ts`)
- [x] Read-only safe endpoint update with route-level write guard (`src/middleware.ts`, `src/app/api/goals/route.ts`)
- [x] Proposal 21-24 regression tests expanded (`src/lib/__tests__/mcp-server.test.ts`, `src/lib/__tests__/goal-planner.test.ts`, `src/app/api/goals/route.test.ts`)
- [x] Verification complete (`npm run test:run`, `npx tsc --noEmit`, `npm run lint`)
- [x] Proposal 25 Priority 1 implemented: MCP stdio bridge + HTTP bridge client (`src/lib/mcp-bridge-client.ts`, `src/lib/mcp-stdio-transport.ts`, `scripts/mcp-stdio-bridge.ts`)
- [x] Proposal 25 Priority 1 tests/docs added (`src/lib/__tests__/mcp-bridge-client.test.ts`, `src/lib/__tests__/mcp-stdio-transport.test.ts`, `docs/guide/claude-code-mcp-setup.md`)
- [x] Proposal 25 Priority 3 implemented: Central policy/approval engines (`src/types/policy.ts`, `src/lib/policy-engine.ts`, `src/lib/approval-engine.ts`)
- [x] Proposal 25 Priority 3 integration: MCP/Goals route guard refactor (`src/lib/mcp-server.ts`, `src/app/api/goals/route.ts`)
- [x] Proposal 25 Priority 3 tests added (`src/lib/__tests__/policy-engine.test.ts`, `src/lib/__tests__/approval-engine.test.ts`, `src/app/api/goals/route.test.ts`)
- [x] Proposal 25 Priority 2 implemented: LLM+validator goal planner with bounded replan fallback (`src/lib/goal-planner-llm.ts`, `src/lib/goal-plan-validator.ts`, `src/lib/goal-planner.ts`, `src/types/goal-planner.ts`)
- [x] Proposal 25 Priority 5 implemented: operation verification + rollback runner integrated to MCP/Goal Planner/Agent Loop (`src/types/operation-control.ts`, `src/lib/operation-verifier.ts`, `src/lib/rollback-runner.ts`, `src/lib/mcp-server.ts`, `src/lib/goal-planner.ts`, `src/lib/agent-loop.ts`)
- [x] Proposal 25 Priority 4 implemented: expanded MCP operational tools (`restart_batcher`, `restart_proposer`, `switch_l1_rpc`, `update_proxyd_backend`, `run_health_diagnostics`) with operator modules (`src/lib/component-operator.ts`, `src/lib/l1-rpc-operator.ts`)
- [x] Proposal 25 Priority 6 implemented: autonomy replay scorecard and CI workflow (`src/lib/autonomy-scorecard.ts`, `scripts/autonomy-eval.ts`, `.github/workflows/autonomy-eval.yml`, `docs/verification/proposal-25-autonomy-eval-report-template.md`)
- [x] Proposal 25 regression/full verification complete (`npm run test:run`, `npx tsc --noEmit`, `npm run lint`, `npm run autonomy:eval`)

### Planned (2026-02-22 Full Autonomous Agent - Next Phase)
- [x] Document full-autonomy remaining backlog in TODO docs
- [x] Create Proposal 26 document (`docs/todo/proposal-26-autonomous-goal-generation-engine.md`)
- [x] Implement Goal Manager types and store contract (`src/types/goal-manager.ts`, `src/lib/redis-store.ts`)
- [x] Implement signal collector and candidate generator (`src/lib/goal-signal-collector.ts`, `src/lib/goal-candidate-generator.ts`)
- [x] Candidate generator LLM prompt/policy hardening and production tuning
- [x] Implement priority/suppression engine (`src/lib/goal-priority-engine.ts`)
- [x] Implement goal manager runtime and queue API (`src/lib/goal-manager.ts`, `src/app/api/goal-manager/route.ts`)
- [x] Integrate agent-loop tick -> autonomous goal queue -> goal planner dispatch
- [x] Extend autonomy evaluation scenarios for goal generation quality gate
- [x] Implement durable orchestration (lease/checkpoint/idempotency/retry/DLQ + replay API)
- [x] Implement adaptive policy baseline (A0-A5 autonomy level + confidence thresholds + policy API)
- [x] Implement learning loop baseline (episode recording + offline threshold suggestion script)

### Done (2026-02-22 Proposal 27 L1/L2 Core Ops Hardening Documentation)
- [x] Define analysis scope and baseline evidence for EVM L1 + L2 core operations
- [x] Create Proposal 27 document (`docs/todo/proposal-27-l1-l2-core-ops-hardening.md`)
- [x] Finalize gap matrix, phased roadmap, and API/type change proposals with acceptance criteria
- [x] Update TODO review and `docs/lessons.md` with documentation patterns from this task

### Done (2026-02-22 Proposal 28 Ethereum Network Diversity Strategy)
- [x] Reconstruct Proposal 28 around share uplift and Tokamak L1 ops burden reduction
- [x] Rewrite Proposal 28 strategy document (`docs/todo/proposal-28-ethereum-network-diversity-sentinai-strategy.md`)
- [x] Replace observability-first framing with migration/automation-first execution pillars
- [x] Update TODO review and `docs/lessons.md` with outcome-first strategy-documentation rules

### Done (2026-02-22 Proposal 28 Phase 0 Issue Breakdown)
- [x] Decompose Phase 0 into implementation-ready issue units with IDs/dependencies
- [x] Create issue breakdown doc (`docs/todo/proposal-28-phase0-issue-breakdown.md`)
- [x] Freeze acceptance criteria and test scenarios per issue
- [x] Update TODO review and `docs/lessons.md` with issue-decomposition patterns

### Done (2026-02-20 Proposal 10/15/19 MVP Start)
- [x] Proposal 19 Savings Plans Advisor type/analysis logic implementation (`src/types/savings-advisor.ts`, `src/lib/savings-advisor.ts`)
- [x] Savings Advisor API 추가 (`GET /api/savings-advisor`)
- [x] Savings Advice summary linked to Cost Report (`src/lib/cost-optimizer.ts`, `src/types/cost.ts`)
- [x] Proposal 15 Scheduled Scaling type/execution module implementation (`src/types/scheduled-scaling.ts`, `src/lib/scheduled-scaler.ts`)
- [x] Scheduler hourly reservation scaling task integration (`src/lib/scheduler.ts`)
- [x] Proposal 10 Derivation Lag type/monitor implementation (`src/types/derivation.ts`, `src/lib/derivation-lag-monitor.ts`)
- [x] Include derivation lag status in Metrics API (`src/app/api/metrics/route.ts`)
- [ ] Change file lint and smoke verification
- [ ] Subsequent update to the document/environment variable guide (reinforced in the next commit)

### Done (2026-02-20 Optimism Plugin Integration)
- [x] Check requirements based on `docs/done/optimism-tutorial-integration.md`
- [x] `src/chains/optimism` chain plugin implementation (for tutorial OP Stack)
- [x] Extension of automatic loading of `CHAIN_TYPE` based plugins (`optimism`, `my-l2` alias)
- [x] Enhanced chain registry testing (`CHAIN_TYPE=optimism|my-l2`)
- [x] Document Optimism plugin environment variables in `.env.local.sample`.
- [x] Regression verification through lint and test execution (chain-plugin passes, tsc overall failure is an issue with existing test type mismatch)

### Done (2026-02-20 Optimism Metrics Smoke + Installer)
- [x] Add actual `/api/metrics` call smoke test script based on `CHAIN_TYPE=optimism`
- [x] Add npm run command (`smoke:metrics:optimism`)
- [x] Chain plugin selection and Optimism metadata settings reflected in `install.sh`
- [x] Smoke/script grammar verification

### Done (2026-02-20 Proposal 20 ZK Plugin + Dashboard)
- [x] `ChainPlugin` contract extension (`chainMode`, `capabilities`)
- [x] Added `src/chains/zkstack` plugin (`legacy-era` / `os-preview`)
- [x] `CHAIN_TYPE=zkstack` registry mapping and test enhancements
- [x] `/api/metrics` chain meta response (`chain`) and capability based field branching
- [x] Dashboard chain isolation rendering (dynamic EOA roles, OP Fault Proof hidden, ZK Proof/Settlement card added)
- [x] Re-verify lint/type/test and clean up residual type errors
- [x] Add `examples/zkstack` standard template (`.env`, probe response schema, usage guide)

### Done (2026-02-16 Refresh Audit)
- [x] **Codebase Refresh Audit P0-P2 progress completed** (`docs/todo/codebase-audit-2026-02-16-refresh.md`)
- P0: Fix Seed `blockInterval` overwrite + Match 8 vCPU memory type (16GiB) ✅
- P1: `/api/metrics` txpool timeout + source metadata accuracy ✅
- P2: Enhanced middleware path matching + Cleaned up operational code lint warnings + Modernized ESLint ignore ✅

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

## Algorithm Effectiveness Evaluation (2026-02-25)

Full algorithm audit by L1/L2 DevOps criteria: 23 core algorithms across 5 subsystems. Overall score: **7.4/10**.
Full report: [`docs/guide/algorithm-effectiveness-evaluation.md`](guide/algorithm-effectiveness-evaluation.md)

### Algorithm Maturity Matrix

| Subsystem | Design | Impl | Test | Production | Overall |
|-----------|--------|------|------|------------|---------|
| Scaling Engine | 9 | 9 | 8 | 7 | **8.3** |
| Anomaly Detection | 9 | 8 | 7 | 7 | **7.8** |
| RCA + Remediation | 8 | 8 | 6 | 5 | **6.8** |
| Agent Loop | 8 | 9 | 7 | 7 | **7.8** |
| Goal Manager | 9 | 8 | 5 | 3 | **6.3** |
| L1 RPC Failover | 8 | 9 | 7 | 8 | **8.0** |
| Cost Optimizer | 7 | 8 | 6 | 5 | **6.5** |

### Use Case Effectiveness Scores

| Use Case | Score | Key Finding |
|----------|-------|-------------|
| UC-1: CPU Spike Auto-Response | 8.2/10 | Most mature pipeline. Gas weight (30%) overweighted for OP Stack |
| UC-2: L1 RPC Failure Handling | 7.4/10 | Covers #1 OP Stack incident. Missing latency-based routing |
| UC-3: Sequencer Stall Detection + RCA | 8.3/10 | Strongest differentiator. BFS + AI dual analysis |
| UC-4: EOA Balance Depletion Prevention | 7.7/10 | Auto-refill works. Missing depletion rate prediction |
| UC-5: Cost Optimization | 7.5/10 | Savings Plans sim is practical. Missing L1 gas/blob cost |
| UC-6: Autonomous Goal Generation | 7.7/10 | Ambitious architecture. Over-engineered for single-process |

### Algorithm-Level Improvements (from evaluation)

#### Immediate (P0)
- [ ] **Adjust scaling weights per chain plugin** — Gas 30% is overweighted for OP Stack (sequencer sets near-constant gasUsedRatio). Allow chain plugin to override default weights
- [ ] **Widen High→Emergency tier gap** — Current 70-77 (7pt) is too narrow for 4→8 vCPU jump. Expand to 70-85 or add hysteresis band

#### Short-term (P1)
- [ ] **Add latency-based L1 RPC routing** — Current binary healthy/unhealthy. Add response time weighted selection for optimal endpoint choice
- [ ] **Add EOA depletion rate prediction** — Calculate burn rate from historical balance data to predict "N hours until depletion" proactively
- [ ] **Add partial degradation detection for L1 RPC** — Detect slow-but-alive endpoints (>2s response) not just failures

#### Medium-term (P2)
- [ ] **Simplify Goal Manager for single-process** — Lease/Idempotency/DLQ patterns are distributed-system constructs running in single process. Simplify or defer until multi-instance deployment
- [ ] **Add L1 gas + blob cost to cost optimizer** — Currently tracks only Fargate vCPU cost. L1 gas/blob costs dominate OP Stack total OpEx
- [ ] **Add learning-based scoring weight adjustment** — Use goal learning episodes to dynamically tune scaling weights and priority scores

---

## Codebase Completeness Review (2026-02-25)

Full codebase analysis: 56,224 LOC TypeScript, 67 lib modules, 33 API routes, 941 tests (100% pass), 4 chain plugins. Overall score: **8.6/10**.

### P0: High Priority Improvements

- [ ] **Dashboard component extraction** — `src/app/page.tsx` (2,608 LOC) monolithic single-file component. Extract into 8-10 domain components:
  - `MetricsPanel`, `ComponentHealth`, `ScalingState`, `AnomalyEvents`, `AgentLoopStatus`, `AutonomyCockpit`, `NLOpsChat`, `CostPanel`
  - 15+ `useState` hooks across features → difficult to test, reason about, and maintain
  - Related: adopt state management (Zustand/Jotai) to centralize polling and reduce state sprawl

- [ ] **lib/ directory reorganization** — 67 files in flat `src/lib/` structure. Group by domain:
  ```
  src/lib/scaling/     (scaling-decision, k8s-scaler, zero-downtime-scaler, predictive-scaler, scheduled-scaler)
  src/lib/anomaly/     (anomaly-detector, anomaly-ai-analyzer, alert-dispatcher, detection-pipeline, anomaly-event-store)
  src/lib/autonomous/  (goal-manager, goal-orchestrator, goal-planner, autonomy-policy, action-executor)
  src/lib/rca/         (rca-engine, playbook-matcher, remediation-engine)
  src/lib/ai/          (ai-client, ai-routing, ai-response-parser, nlops-engine, nlops-responder)
  src/lib/monitoring/  (eoa-balance-monitor, l1-rpc-cache, l1-rpc-failover, metrics-store, derivation-lag-monitor)
  src/lib/reporting/   (daily-report-generator, daily-accumulator, cost-optimizer, usage-tracker, savings-advisor)
  src/lib/infra/       (k8s-config, docker-orchestrator, redis-store, state-store, scheduler)
  ```

- [ ] **CI/CD automated deployment pipeline** — Currently manual deployment only. Add:
  - Docker image build + push to ECR on merge to main
  - Staging cluster auto-deploy from image
  - Smoke tests on staging
  - Manual approval gate for production
  - Auto-deploy to production post-approval

### P1: Medium Priority Improvements

- [ ] **Missing core module tests** — 15/67 modules (22.4%) without tests. Priority additions:
  - `remediation-engine.test.ts` — auto-remediation logic with 5 safety gates
  - `action-executor.test.ts` — scaling/remediation action dispatch
  - `nlops-responder.test.ts` — NLOps response generation
  - `playbook-matcher.test.ts` — remediation playbook matching
  - `scheduled-scaler.test.ts` — time-based scaling execution

- [ ] **Test utilities centralization** — Common fixtures duplicated across 8+ test files. Create `src/lib/__tests__/test-utils.ts`:
  - `createMetrics(overrides)`, `generateHistory(length, baseValues)`, `createAnomalyEvent(overrides)`
  - Shared mock factories for viem, K8s, AI providers

- [ ] **Log aggregation integration** — Console-only logging, no structured output. Add:
  - Structured JSON logging format
  - CloudWatch / ELK integration path
  - Log retention policy

- [ ] **Secret management** — Environment variables only. Add:
  - AWS Secrets Manager integration path
  - Vault support documentation
  - Rotation policy guidance

- [ ] **E2E tests in CI** — `scripts/verify-e2e.sh` exists but not gated in CI. Add E2E verification to CI pipeline

### P2: Low Priority Improvements

- [ ] **`/api/metrics` endpoint decomposition** — Single mega-endpoint returns all dashboard data (~2000 fields). Split into domain-specific endpoints:
  - `/api/metrics/core` (block heights, CPU, gas, txpool)
  - `/api/metrics/components` (pod details, health)
  - `/api/metrics/anomalies` (detection results)
  - `/api/metrics/cost` (cost tracking)

- [ ] **WebSocket real-time updates** — Currently 60s polling (intentional for L1 RPC quota). Consider WebSocket for post-detection push notifications

- [ ] **External monitoring integration** — No Prometheus/Datadog/New Relic integration. Add metrics export endpoint (`/metrics` Prometheus format)

- [ ] **Helm charts / Terraform IaC** — Manual K8s deployment. Add:
  - Helm chart for K8s deployment
  - Terraform module for EKS cluster provisioning

- [ ] **Container security scanning** — No SAST/container scanning in CI. Add Trivy or Snyk scanning

- [ ] **Dark mode toggle** — CSS variables set for dark mode (`prefers-color-scheme`) but no manual toggle button in UI

### Known Technical Debt

- `memoryUsage: 2048` hardcoded in metrics API (not reading real container memory)
- `syncLag: 0` hardcoded (derivation lag monitor exists but not fully wired)
- `agent-loop.ts` (988 LOC) — metric collection logic could be extracted to separate module
- `l1-rpc-failover.ts` (1,165 LOC) — Proxyd backend logic could be split into `proxyd-backend.ts`
- Progress tracking table below needs update to reflect current state (941 tests, 10 proposals)

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
**ZK Expansion Plan:** `docs/todo/proposal-20-zk-l2-plugin-expansion.md`

**Estimate:** 5-7 days (1-2 days per plugin)

---

## Completed Work Summary (2026-02-25)

### Snapshot Overview by Date

**2026-02-25**: Algorithm audit (7.4/10 score, 23 algorithms) + Codebase completeness review (P0-P2 map)

**2026-02-24**: Agent loop heartbeat guardrail + watchdog autorecovery + network stack docs + codebase structure guide + ARCHITECTURE realignment

**2026-02-22**: Dashboard Autonomy Cockpit MVP + policy controls + MCP guide consolidation + L1 ops automation + incident response matrix + Proposals 27-28

**2026-02-21**: Q1 strategic roadmap documentation (Proposals 21-24)

**2026-02-20**: Plugin system (Optimism/ZK Stack/Arbitrum) + MVP features (derivation lag, scheduled scaling, savings advisor)

**2026-02-16**: Codebase refresh audit (P0-P2 fixes)

---

## Progress Tracking (Legacy)

| Category | Completed | Total | Progress |
|----------|-----------|-------|----------|
| Proposals | 10 (1-8 + 25-26) | 28 | 36% |
| Source Code | 56,224 LOC | — | 67 lib modules |
| API Routes | 33 | 33 | 100% |
| Chain Plugins | 4 (Thanos, Optimism, ZK Stack, Arbitrum) | 4 | 100% |
| Unit Tests | 941 | 941 | 100% pass |
| Test Coverage | 52/67 modules | 67 | 77.6% |
| E2E Tests | verify-e2e.sh | — | 6-phase |
| Demo Materials | 3 | 3 | 100% |
| Documentation | 102 files | — | Comprehensive |
| CI/CD | 5 workflows | 5 | 100% |
| Production Deploy | Done | — | Manual only |

---

## Detailed Review (2026-02-20 Optimism Plugin Integration)

- Minimize the scope of change by adding `OptimismPlugin` and reusing Thanos common configuration to distribute the standard OP Stack tutorial.
- Extended to automatically map `optimism`/`my-l2` by interpreting `CHAIN_TYPE` in the registry.
- Prevent default (thanos) regression by verifying the loading path for each `CHAIN_TYPE` in the test.

## Detailed Review (2026-02-20 Optimism Metrics Smoke + Installer)

- Added a smoke test that verifies the Optimism mode API response by actually launching the dev server and calling `/api/metrics?stress=true`.
- Enter/verify/save `CHAIN_TYPE` in the installation script and expand to configure `L2_CHAIN_*` and `L1_CHAIN` default values ​​when Optimism is selected.

## Detailed Review (2026-02-20 Proposal 10/15/19 MVP Start)

- Add Savings Plans Advisor as an independent module/dedicated API and configure it for immediate consumption by connecting a summary field to the `cost-report` response.
- Scheduled Scaling runs as a cron every hour, and completes the minimum operation MVP with safety guards including cooldown/autoscaling status/real-time CPU override.
- Add Derivation Lag Monitor based on `optimism_syncStatus` and secure observation path by including lag level and L1 health information in `/api/metrics` response.

## Detailed Review (2026-02-22 Proposal 21-24 MCP + Goal Planner)

- Expanded MCP handler to support both legacy tool methods and standard MCP methods through a single guard path so approval/read-only policy stays consistent.
- Added goal-plan create/execute/history API and guarded execution steps (`collect/anomaly/rca/scale/restart/routing`) to establish a practical autonomous-ops MVP path.
- Verified with full regression (`37 test files / 791 tests`), type check pass, and lint pass with one pre-existing unrelated warning.

## Detailed Review (2026-02-22 Proposal 25 Priority 1 MCP stdio bridge)

- Added a transport bridge layer so Claude Code can use stdio MCP while SentinAI keeps HTTP `/api/mcp` as backend.
- Separated bridge concerns into testable modules (HTTP client vs stdio framing/parser) and kept script entrypoint thin.
- Verified with dedicated unit tests, `tsc --noEmit`, and lint (existing unrelated warning only).

## Detailed Review (2026-02-22 Proposal 25 Priority 3 Policy/Approval Engine)

- Moved MCP/API write guard logic into reusable policy module with reason codes, reducing branch duplication and keeping authorization semantics consistent.
- Extracted approval ticket lifecycle (issue/validate/consume/hash) into a dedicated engine and refactored MCP server to consume it.
- Added coverage for policy decisions and approval mismatch/expiry paths, then re-verified with full regression (`41 files / 815 tests`).

## Detailed Review (2026-02-22 Proposal 25 Priority 2/4/5/6 Completion)

- Added LLM planning adapter + validator with bounded replan and deterministic fallback, and extended `GoalPlan` metadata (`planVersion`, `replanCount`, `failureReasonCode`) for traceable planning outcomes.
- Introduced reusable operation control contracts (verification + rollback) and wired them into MCP write tools, goal-plan write steps, and agent-loop verification path so failed post-conditions are not silently treated as success.
- Expanded MCP operational surface with guarded tools (`restart_batcher`, `restart_proposer`, `switch_l1_rpc`, `update_proxyd_backend`, `run_health_diagnostics`) backed by dedicated operator modules.
- Added autonomy replay scorecard stack (`autonomy-scorecard`, `autonomy-eval` script, scheduled workflow, report template) and verified end-to-end with strict mode report generation.
- Re-verified with full regression (`48 files / 843 tests`), `tsc --noEmit` pass, lint pass (existing unrelated warning 1).

## Detailed Review (2026-02-22 Proposal 26 Phase A Foundation)

- Added autonomous-goal domain contracts (`src/types/goal-manager.ts`) and expanded store interface with candidate/queue/active/suppression lifecycle methods.
- Implemented Redis/InMemory goal-manager storage paths in `src/lib/redis-store.ts` with bounded ring/list sizes and deterministic queue ordering by score/risk/time.
- Implemented deterministic multi-source signal snapshot collector (`src/lib/goal-signal-collector.ts`) with per-source fallback guards.
- Added coverage for signal normalization/fallback/determinism and store lifecycle (`src/lib/__tests__/goal-signal-collector.test.ts`, `src/lib/__tests__/redis-store.test.ts`).
- Verified with targeted tests + type check + lint (existing unrelated warning only).

## Detailed Review (2026-02-22 Proposal 26 Phase B Candidate Generator)

- Added `src/lib/goal-candidate-generator.ts` with deterministic rule-based autonomous goal generation for pressure/failover/cost/memory/policy signals.
- Added optional LLM phrasing enhancer path (env/option gated) with strict fallback to rule output when provider unavailable or parse fails.
- Added targeted coverage for rule generation, fallback candidate, LLM enhancement, and fail-open behavior in `src/lib/__tests__/goal-candidate-generator.test.ts`.
- Re-verified with targeted test + `tsc --noEmit` + lint (existing unrelated warning only).

## Detailed Review (2026-02-22 Proposal 26 Phase C Priority/Suppression)

- Added `src/lib/goal-priority-engine.ts` implementing deterministic score formula (`impact+urgency+confidence+policyFit`) and queue ordering.
- Added suppression rules for duplicate signatures, low confidence, cooldown active, policy blocked(read-only), and stale signals.
- Added suppression audit persistence helper (`persistSuppressionRecords`) to write suppression traces into state store.
- Added coverage in `src/lib/__tests__/goal-priority-engine.test.ts` and re-verified with targeted tests + `tsc --noEmit` + lint (existing unrelated warning only).

## Detailed Review (2026-02-22 Proposal 26 Phase D Runtime + API)

- Added runtime orchestrator `src/lib/goal-manager.ts` for tick lifecycle (collect -> generate -> prioritize -> queue) and dispatch lifecycle (`scheduled/running/completed/failed/expired`).
- Added Goal Manager APIs:
  - `GET /api/goal-manager` status/queue/candidate/suppression view
  - `POST /api/goal-manager/tick` manual tick trigger
  - `POST /api/goal-manager/dispatch` admin-key guarded dispatch trigger
- Integrated `agent-loop` with best-effort goal manager tick/dispatch path (`src/lib/agent-loop.ts`) so failures do not break scaling loop and are tracked as degraded reasons.
- Added coverage for runtime + API routes (`src/lib/__tests__/goal-manager.test.ts`, `src/app/api/goal-manager/*.test.ts`) and re-verified with targeted tests + `tsc --noEmit` + lint.

## Detailed Review (2026-02-22 Proposal 26 Phase E Eval Extension)

- Extended `scripts/autonomy-eval.ts` scenario set with goal-generation quality gates (`G01`~`G04`) covering queue generation and suppression paths (duplicate/low-confidence/stale).
- Added deterministic synthetic goal-signal snapshots to evaluate candidate/prioritization behavior without external runtime dependency.
- Updated evaluation report template (`docs/verification/proposal-25-autonomy-eval-report-template.md`) to include goal-generation scenarios.

## Detailed Review (2026-02-22 Full Autonomy Follow-up: Durability/Policy/Learning)

- Added durable dispatch orchestrator (`src/lib/goal-orchestrator.ts`) with lease acquisition, idempotency key registration, checkpoint updates, retry backoff, DLQ transition, and replay support.
- Extended state store contracts/implementations for orchestration state (`lease/checkpoint/dlq/idempotency`) and learning episodes (`src/types/redis.ts`, `src/lib/redis-store.ts`).
- Added DLQ replay endpoint and status surfacing:
  - `POST /api/goal-manager/replay`
  - `GET /api/goal-manager` includes `dlq`
- Added adaptive autonomy policy baseline:
  - runtime policy state module (`src/lib/autonomy-policy.ts`)
  - policy API (`src/app/api/policy/autonomy-level/route.ts`)
  - `evaluateGoalExecutionPolicy` risk/confidence/autonomy-level decision path (`src/lib/policy-engine.ts`)
- Added learning loop baseline:
  - episode type + recorder/suggester (`src/types/goal-learning.ts`, `src/lib/goal-learning.ts`)
  - offline suggestion script (`scripts/train-goal-policy.ts`, `npm run goal:train-policy`)
- Verified with targeted tests, `npx tsc --noEmit`, `npm run lint`, `npm run goal:train-policy`.

## Detailed Review (2026-02-22 Proposal 27 L1/L2 Core Ops Hardening Documentation)

- L1/L2 공통 운영 인프라 확장을 위해 현재 코드베이스를 체인 런타임, 상태 저장, 제어면 정책, 헬스/복구 축으로 분해해 갭을 정리했다.
- 각 갭은 코드 근거 파일을 연결하고 `P0/P1/P2` 우선순위와 단계별 DoD를 함께 정의해 실행 가능한 로드맵으로 고정했다.
- API/타입 변경 제안(`NetworkScope`, `OperationRecord`, `CoreHealthReport`)과 검증 시나리오를 함께 명시해 후속 구현 시 결정 공백을 최소화했다.

## Detailed Review (2026-02-22 Proposal 28 Ethereum Network Diversity Strategy)

- 사용자 피드백을 반영해 Proposal 28을 “지표 관측 중심”에서 “점유율 확대 + 운영부담 절감 실행전략”으로 전면 재구성했다.
- SentinAI 기여 포인트를 `Migration Factory`, `Ops Abstraction Layer`, `Tokamak Client Operator Shield` 3개 축으로 고정했다.
- 핵심 KPI를 대시보드 수치가 아닌 전환 성공률/수작업시간/롤백율/온콜부담 중심으로 재정의했다.

## Detailed Review (2026-02-22 Proposal 28 Phase 0 Issue Breakdown)

- Proposal 28의 Phase 0를 `OPS-001 ~ OPS-008`로 분해해 전환 오케스트레이션/운영 어댑터/릴리즈 게이트 중심 backlog로 재정렬했다.
- 기존 metric-contract 중심 분해를 제거하고, migration 단계 계약과 verifier/rollback 경로를 먼저 고정하도록 순서를 바꿨다.
- Tokamak client 운영부담 절감을 위해 `release gate`, `ops burden tracker`, `partner runbook`를 Phase 0부터 의무 산출물로 포함했다.

## Detailed Review (2026-02-22 L1 Client Operations Automation Documentation)

- L1 운영 자동화 요청을 실행 가능한 문서로 전환하기 위해 12개 기술 요소를 `영역/기술요소/DoD/KPI` 표로 고정했다.
- 아키텍처를 `수집 -> 분류 -> 오케스트레이션 -> 실행 -> 검증/이관` 흐름으로 표준화해 구현 순서를 명확히 했다.
- 즉시 적용 가능하도록 4주 MVP 우선순위와 운영 시작 체크리스트를 문서에 포함했다.

## Detailed Review (2026-02-22 Ethereum L1 Client Automation Expansion)

- geth/ethrex/reth/besu/erigon 공통 운영 리스크를 기준으로 L1 전용 자동화 항목 12개를 추가해 문서의 실행 밀도를 높였다.
- 단순 기술 나열 대신 각 항목을 `필요성 + 최소 DoD`로 고정해 구현팀이 바로 백로그로 분해할 수 있도록 정리했다.
- 클라이언트별 운영 포인트와 업그레이드/복구 중심 MVP 우선순위를 함께 반영해 실운영 적용성을 강화했다.

## Detailed Review (2026-02-22 Minor Client Focused Documentation Refinement)

- 사용자 요청에 맞춰 `geth`를 문서 범위에서 제외하고 `reth/besu/erigon/ethrex` 중심으로 재구성했다.
- 전용 자동화 항목을 마이너 클라이언트 운영 리스크(호환성 계약, 카나리, JVM/DB 특화 운영) 중심으로 재정렬했다.
- 운영 체크리스트에 `geth` 전용 플래그/명령 의존성 제거 항목을 추가해 실행팀 혼선을 줄였다.

## Detailed Review (2026-02-22 Multi-Client Project Analysis Driven Documentation Update)

- `reth/besu/erigon/ethrex/nethermind`의 공식 문서와 최신 릴리즈를 기준으로 분석 섹션을 추가해 문서 근거성을 강화했다.
- 분석 결과를 `릴리즈 인텔리전스`, `저장소/리소스 모드 인지 운영`, `health webhook 연계`, `deprecated 설정 탐지` 같은 실행 항목으로 변환했다.
- 기존 일반론 중심 항목을 클라이언트 특성 기반 DoD로 재정의해 구현 백로그 분해 가능성을 높였다.

## Detailed Review (2026-02-22 L1 Client Incident Response Matrix)

- L1 운영 현장에서 자주 발생하는 장애를 `우선순위/탐지신호/즉시대응/근본해결` 구조로 정리해 온콜 대응 속도를 높였다.
- 동기화 지연, EL-CL 단절, 정합성 불일치, 디스크/DB 장애 등 핵심 이슈를 P1 중심으로 재배치했다.
- 대응 절차를 `탐지 -> 격리 -> 복구 -> 검증 -> 회고` 흐름으로 표준화해 자동화/수동 대응 간 경계를 명확히 했다.

## Detailed Review (2026-02-22 Full-Auto Recovery Actions + Safe Sudo Model)

- 완전 자동화 가능한 이슈에 대해 AI Agent의 액션 시퀀스와 안전 가드레일을 문서에 명시해 무인 복구 범위를 구체화했다.
- `피어 급감 -> 30303 임시 차단` 시나리오를 예시로 추가하고, TTL 기반 자동 원복 조건을 함께 고정했다.
- `sudo` 사용은 직접 명령 실행이 아니라 정책 엔진 + 액션 브로커 + 제한된 privileged wrapper를 거치도록 설계 원칙을 명문화했다.

## Detailed Review (2026-02-22 SentinAI MCP User Guide Consolidation)

- MCP 설정 문서와 운영 문서를 단일 사용자 가이드로 통합해 설정-운영-장애대응 진입점을 하나로 정리했다.
- 기존 문서 경로는 삭제하지 않고 통합 문서 안내 링크로 유지해 기존 참조 링크의 호환성을 보존했다.
- 문서 인덱스를 통합 가이드 기준으로 갱신해 신규 사용자가 중복 문서를 탐색하지 않도록 했다.

## Detailed Review (2026-02-22 MCP Prompt Natural Language Conversion)

- MCP 사용자 가이드 프롬프트 예시를 tool 호출명 중심에서 자연어 의도 중심 문장으로 일괄 전환했다.
- 스모크 테스트/운영 절차/사후 검증 예시에서 내부 도구명을 몰라도 실행 가능한 표현을 고정했다.
- 문제 해결/운영 체크리스트 문구의 tool 이름 의존도를 낮춰 운영자 관점 가독성을 개선했다.

## Detailed Review (2026-02-22 MCP Value + OP-Only Policy Update)

- MCP 사용 시 운영자가 얻는 효용성(자연어 운영, 정책 일관성, 대응 속도, 추적 용이성)을 가이드 상단에 명시했다.
- 체인 지원 정책을 `2026-02-22 기준 OP Stack 권고 / ZK Stack 비활성화`로 고정해 모호성을 제거했다.
- 빠른 시작·문제 해결·체크리스트를 OP Stack 운영 기준으로 재정렬해 실행 기준을 명확히 했다.

## Detailed Review (2026-02-22 L2 Ops vs MCP Comparison Section)

- 통합 가이드에 기존 L2 운영과 MCP 기반 운영을 한눈에 비교할 수 있는 표를 추가했다.
- 비교 축을 `진입 방식/실행 흐름/안전 제어/운영 속도/감사 추적/적용 범위`로 고정해 의사결정 기준을 명확히 했다.
- OP Stack 권고 및 ZK Stack 비활성화 정책을 비교 섹션에 직접 반영해 정책 일관성을 유지했다.

## Detailed Review (2026-02-22 Dashboard Autonomy Cockpit MVP)

- 기존 Agent Loop 패널 상단에 `Autonomy Cockpit`을 추가해 자율 엔진/큐/가드레일 상태를 한 눈에 확인할 수 있게 구성했다.
- `goal-manager`와 `autonomy policy`를 주기 polling으로 연결해 큐 깊이, suppression, DLQ, 자율 레벨 정보를 실시간 반영했다.
- 시나리오 주입, goal tick, dry-run dispatch를 대시보드 버튼으로 제공해 프롬프트 없이도 자율 흐름 데모가 가능해졌다.

## Detailed Review (2026-02-22 Dashboard Autonomy Policy Level Control Expansion)

- 대시보드에서 자율 정책 레벨을 `A0~A5`로 즉시 변경할 수 있게 해 자율 에이전트 데모의 제어 가능성을 시각적으로 강화했다.
- 정책 레벨 변경과 데모 액션 실행 간 동시 실행을 차단해 UI 상태 경합과 오동작 가능성을 줄였다.
- 임계치 값을 함께 노출하고 변경 결과를 즉시 피드백해 사용자가 정책 상태 변화를 즉시 인지할 수 있게 했다.

## Detailed Review (2026-02-22 Autonomy Cockpit E2E + Level Tooltip)

- 정책 레벨 버튼별 권한/가드레일 툴팁을 추가해 사용자가 자율 레벨 의미를 UI에서 즉시 이해할 수 있게 했다.
- 정책 레벨 배지/버튼/피드백 영역에 테스트 셀렉터를 고정해 UI 구조 변경에도 e2e 안정성을 높였다.
- Playwright에서 테스트 전용 API key로 정책 변경 성공 경로를 재현하고, 레벨 변경 성공 피드백까지 자동 검증하도록 시나리오를 확장했다.

## Detailed Review (2026-02-22 Autonomy Cockpit User Guide Documentation)

- `Autonomy Cockpit` 패널의 실동작을 기준으로 운영자 관점 사용자 가이드를 신규 작성했다.
- 버튼 단위로 `UI 액션 -> API -> 인증 조건 -> 모드 제약` 매핑을 명시해 데모/운영 시 혼선을 줄였다.
- `docs/README.md`에서 삭제된 `ENV_GUIDE.md` 참조를 제거하고 새 가이드 진입 링크를 추가해 문서 내비게이션을 복구했다.

## Detailed Review (2026-02-22 Docs Reference Hygiene)

- `docs/**/*.md` 링크 무결성 기준으로 재검사해 실제 네비게이션 깨짐을 제거했다.
- 과거 감사 문서와 Proposal 28의 예정 산출물 경로에 Draft 스텁을 추가해 참조 유실을 방지했다.
- 통합 안내 스텁 문서를 링크형으로 정리해 문서 이동 시 사용자가 즉시 본문으로 진입할 수 있게 개선했다.

## Detailed Review (2026-02-24 Agent Loop Heartbeat Guardrail)

- Agent loop가 멈춰도 원인을 빠르게 식별할 수 있도록 Redis heartbeat 키(`sentinai:agent:last_heartbeat`)를 추가하고 scheduler cycle마다 갱신하도록 연결했다.
- `/api/health` 응답에 `agentLoop.heartbeatLagSec`, `stale`, `lastCycleAt`를 포함해 외부 모니터링이 stale 상태를 즉시 판단할 수 있게 했다.
- cron에 바로 연결 가능한 stale 검사 스크립트(`scripts/check-agent-heartbeat.mjs`)와 예시 크론 엔트리(`scripts/agent-heartbeat.cron.example`)를 추가했다.

## Detailed Review (2026-02-24 Agent Heartbeat Alert Hookup)

- heartbeat 검사(exit code 2)를 그대로 유지하면서 webhook 알림을 붙이기 위해 래퍼 스크립트(`scripts/monitor-agent-heartbeat-alert.mjs`)를 추가했다.
- 알림 URL은 `AGENT_HEARTBEAT_ALERT_WEBHOOK_URL` 우선, 미설정 시 `ALERT_WEBHOOK_URL` fallback으로 해 운영 일관성을 맞췄다.
- `.env.local` 자동 로더가 빈 문자열 오버라이드를 덮지 않도록 보강해, 알림 비활성화/테스트 시나리오를 안전하게 지원하도록 수정했다.

## Detailed Review (2026-02-24 In-Process Heartbeat Watchdog Autorecovery)

- 외부 cron 없이 서버 기동만으로 heartbeat 감시가 실행되도록 scheduler 내부에 watchdog task를 추가했다.
- watchdog이 `heartbeat stale` 또는 Redis heartbeat read/write 실패를 감지하면 Slack webhook으로 알리고, 동일 프로세스에서 recovery cycle을 자동 시도하도록 연결했다.
- `/api/health`와 `/api/agent-loop`에서 watchdog 상태(실패 횟수, 최근 오류, 최근 복구 상태)를 조회할 수 있어 운영자가 즉시 동작 여부를 확인할 수 있게 했다.

## Detailed Review (2026-02-24 Codebase Directory Structure Documentation)

- 코드베이스 전체를 빠르게 파악할 수 있도록 루트~핵심 서브디렉토리 기준의 트리 문서를 신규 작성했다.
- 런타임/생성 디렉토리(`node_modules`, `.next`, `coverage`)를 별도 구분해 소스 탐색 시 혼선을 줄였다.
- `docs/README.md`에 문서 링크를 연결해 온보딩 시 바로 접근할 수 있게 했다.
- 요청에 따라 주요 디렉토리와 주요 루트 파일의 역할/수정 시점을 표로 추가해, 구조 문서를 실사용 가이드로 확장했다.

## Detailed Review (2026-02-24 ARCHITECTURE.md Codebase Alignment)

- 과거 제안 중심/가정 중심 설명을 제거하고 실제 코드 경로(`src/lib/scheduler.ts`, `src/lib/agent-loop.ts`, `src/lib/redis-store.ts`) 기준으로 아키텍처 문서를 재작성했다.
- 기본 체인(Thanos), 스케줄 주기(60s agent + 30s watchdog), dual-state 모델(Redis + process-local store) 등 현재 동작을 반영했다.
- 운영자가 즉시 코드로 이동할 수 있도록 Quick File References 섹션을 추가했다.

---

## Detailed Review (2026-02-25 Algorithm Effectiveness Evaluation)

- Conducted full algorithm audit (23 algorithms across 5 subsystems) from 20-year L1/L2 DevOps perspective, scoring overall 7.4/10.
- Mapped each algorithm to 6 concrete use cases (CPU spike, L1 RPC failure, sequencer stall, EOA depletion, cost optimization, autonomous goals) with per-step scoring.
- Identified 3 P0 improvements (scaling weight per-chain override, High→Emergency tier gap expansion), 3 P1 improvements (latency-based L1 routing, EOA depletion prediction, partial degradation detection), and 3 P2 items (Goal Manager simplification, L1 gas/blob cost, learning-based weight tuning).
- Published full evaluation report at `docs/guide/algorithm-effectiveness-evaluation.md` and linked from `docs/README.md` and `docs/todo.md`.

---

**Updated:** 2026-02-25
