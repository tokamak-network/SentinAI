# TODO: SentinAI Implementation (2026-02-16)

## Current Status

### In Progress (2026-02-21 Q1 Strategic Roadmap Documentation)
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
- [ ] Candidate generator LLM prompt/policy hardening and production tuning
- [x] Implement priority/suppression engine (`src/lib/goal-priority-engine.ts`)
- [x] Implement goal manager runtime and queue API (`src/lib/goal-manager.ts`, `src/app/api/goal-manager/route.ts`)
- [x] Integrate agent-loop tick -> autonomous goal queue -> goal planner dispatch
- [ ] Extend autonomy evaluation scenarios for goal generation quality gate

### In Progress (2026-02-22 Proposal 27 L1/L2 Core Ops Hardening Documentation)
- [x] Define analysis scope and baseline evidence for EVM L1 + L2 core operations
- [x] Create Proposal 27 document (`docs/todo/proposal-27-l1-l2-core-ops-hardening.md`)
- [x] Finalize gap matrix, phased roadmap, and API/type change proposals with acceptance criteria
- [x] Update TODO review and `docs/lessons.md` with documentation patterns from this task

### In Progress (2026-02-22 Proposal 28 Ethereum Network Diversity Strategy)
- [x] Revalidate network distribution/client concentration metrics with up-to-date public sources
- [x] Create Proposal 28 strategy document (`docs/todo/proposal-28-ethereum-network-diversity-sentinai-strategy.md`)
- [x] Map manifesto pillars to SentinAI product contribution points and KPI tree
- [x] Update TODO review and `docs/lessons.md` with strategy-documentation rules

### In Progress (2026-02-20 Proposal 10/15/19 MVP Start)
- [x] Proposal 19 Savings Plans Advisor type/analysis logic implementation (`src/types/savings-advisor.ts`, `src/lib/savings-advisor.ts`)
- [x] Savings Advisor API 추가 (`GET /api/savings-advisor`)
- [x] Savings Advice summary linked to Cost Report (`src/lib/cost-optimizer.ts`, `src/types/cost.ts`)
- [x] Proposal 15 Scheduled Scaling type/execution module implementation (`src/types/scheduled-scaling.ts`, `src/lib/scheduled-scaler.ts`)
- [x] Scheduler hourly reservation scaling task integration (`src/lib/scheduler.ts`)
- [x] Proposal 10 Derivation Lag type/monitor implementation (`src/types/derivation.ts`, `src/lib/derivation-lag-monitor.ts`)
- [x] Include derivation lag status in Metrics API (`src/app/api/metrics/route.ts`)
- [ ] Change file lint and smoke verification
- [ ] Subsequent update to the document/environment variable guide (reinforced in the next commit)

### In Progress (2026-02-20 Optimism Plugin Integration)
- [x] Check requirements based on `docs/todo/optimism-tutorial-integration.md`
- [x] `src/chains/optimism` chain plugin implementation (for tutorial OP Stack)
- [x] Extension of automatic loading of `CHAIN_TYPE` based plugins (`optimism`, `my-l2` alias)
- [x] Enhanced chain registry testing (`CHAIN_TYPE=optimism|my-l2`)
- [x] Document Optimism plugin environment variables in `.env.local.sample`.
- [x] Regression verification through lint and test execution (chain-plugin passes, tsc overall failure is an issue with existing test type mismatch)

### In Progress (2026-02-20 Optimism Metrics Smoke + Installer)
- [x] Add actual `/api/metrics` call smoke test script based on `CHAIN_TYPE=optimism`
- [x] Add npm run command (`smoke:metrics:optimism`)
- [x] Chain plugin selection and Optimism metadata settings reflected in `install.sh`
- [x] Smoke/script grammar verification

### In Progress (2026-02-20 Proposal 20 ZK Plugin + Dashboard)
- [x] `ChainPlugin` contract extension (`chainMode`, `capabilities`)
- [x] Added `src/chains/zkstack` plugin (`legacy-era` / `os-preview`)
- [x] `CHAIN_TYPE=zkstack` registry mapping and test enhancements
- [x] `/api/metrics` chain meta response (`chain`) and capability based field branching
- [x] Dashboard chain isolation rendering (dynamic EOA roles, OP Fault Proof hidden, ZK Proof/Settlement card added)
- [x] Re-verify lint/type/test and clean up residual type errors
- [x] Add `examples/zkstack` standard template (`.env`, probe response schema, usage guide)

### In Progress (2026-02-16 Refresh Audit)
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

- [x] Fixed dashboard Row 2 card height (`Activity Log`, `Components`)
- [x] Added `Activity Log` past log navigation slider (moves sections when logs are accumulated)
- [x] Apply scrolling inside the `Components` card (maintain height outside the card)
- [x] Verification path augmentation: Add option to allow scaler writing in read-only mode (`SENTINAI_ALLOW_SCALER_WRITE_IN_READONLY`)
- [x] Seed scenario TTL consistency (Redis/InMemory `setSeedScenario` default 80 seconds)
- [x] When determining Agent Loop scaling, use actual runtime vCPU instead of seed `currentVcpu`

---

## Review (2026-02-20 Optimism Plugin Integration)

- Minimize the scope of change by adding `OptimismPlugin` and reusing Thanos common configuration to distribute the standard OP Stack tutorial.
- Extended to automatically map `optimism`/`my-l2` by interpreting `CHAIN_TYPE` in the registry.
- Prevent default (thanos) regression by verifying the loading path for each `CHAIN_TYPE` in the test.

## Review (2026-02-20 Optimism Metrics Smoke + Installer)

- Added a smoke test that verifies the Optimism mode API response by actually launching the dev server and calling `/api/metrics?stress=true`.
- Enter/verify/save `CHAIN_TYPE` in the installation script and expand to configure `L2_CHAIN_*` and `L1_CHAIN` default values ​​when Optimism is selected.

## Review (2026-02-20 Proposal 10/15/19 MVP Start)

- Add Savings Plans Advisor as an independent module/dedicated API and configure it for immediate consumption by connecting a summary field to the `cost-report` response.
- Scheduled Scaling runs as a cron every hour, and completes the minimum operation MVP with safety guards including cooldown/autoscaling status/real-time CPU override.
- Add Derivation Lag Monitor based on `optimism_syncStatus` and secure observation path by including lag level and L1 health information in `/api/metrics` response.

## Review (2026-02-22 Proposal 21-24 MCP + Goal Planner)

- Expanded MCP handler to support both legacy tool methods and standard MCP methods through a single guard path so approval/read-only policy stays consistent.
- Added goal-plan create/execute/history API and guarded execution steps (`collect/anomaly/rca/scale/restart/routing`) to establish a practical autonomous-ops MVP path.
- Verified with full regression (`37 test files / 791 tests`), type check pass, and lint pass with one pre-existing unrelated warning.

## Review (2026-02-22 Proposal 25 Priority 1 MCP stdio bridge)

- Added a transport bridge layer so Claude Code can use stdio MCP while SentinAI keeps HTTP `/api/mcp` as backend.
- Separated bridge concerns into testable modules (HTTP client vs stdio framing/parser) and kept script entrypoint thin.
- Verified with dedicated unit tests, `tsc --noEmit`, and lint (existing unrelated warning only).

## Review (2026-02-22 Proposal 25 Priority 3 Policy/Approval Engine)

- Moved MCP/API write guard logic into reusable policy module with reason codes, reducing branch duplication and keeping authorization semantics consistent.
- Extracted approval ticket lifecycle (issue/validate/consume/hash) into a dedicated engine and refactored MCP server to consume it.
- Added coverage for policy decisions and approval mismatch/expiry paths, then re-verified with full regression (`41 files / 815 tests`).

## Review (2026-02-22 Proposal 25 Priority 2/4/5/6 Completion)

- Added LLM planning adapter + validator with bounded replan and deterministic fallback, and extended `GoalPlan` metadata (`planVersion`, `replanCount`, `failureReasonCode`) for traceable planning outcomes.
- Introduced reusable operation control contracts (verification + rollback) and wired them into MCP write tools, goal-plan write steps, and agent-loop verification path so failed post-conditions are not silently treated as success.
- Expanded MCP operational surface with guarded tools (`restart_batcher`, `restart_proposer`, `switch_l1_rpc`, `update_proxyd_backend`, `run_health_diagnostics`) backed by dedicated operator modules.
- Added autonomy replay scorecard stack (`autonomy-scorecard`, `autonomy-eval` script, scheduled workflow, report template) and verified end-to-end with strict mode report generation.
- Re-verified with full regression (`48 files / 843 tests`), `tsc --noEmit` pass, lint pass (existing unrelated warning 1).

## Review (2026-02-22 Proposal 26 Phase A Foundation)

- Added autonomous-goal domain contracts (`src/types/goal-manager.ts`) and expanded store interface with candidate/queue/active/suppression lifecycle methods.
- Implemented Redis/InMemory goal-manager storage paths in `src/lib/redis-store.ts` with bounded ring/list sizes and deterministic queue ordering by score/risk/time.
- Implemented deterministic multi-source signal snapshot collector (`src/lib/goal-signal-collector.ts`) with per-source fallback guards.
- Added coverage for signal normalization/fallback/determinism and store lifecycle (`src/lib/__tests__/goal-signal-collector.test.ts`, `src/lib/__tests__/redis-store.test.ts`).
- Verified with targeted tests + type check + lint (existing unrelated warning only).

## Review (2026-02-22 Proposal 26 Phase B Candidate Generator)

- Added `src/lib/goal-candidate-generator.ts` with deterministic rule-based autonomous goal generation for pressure/failover/cost/memory/policy signals.
- Added optional LLM phrasing enhancer path (env/option gated) with strict fallback to rule output when provider unavailable or parse fails.
- Added targeted coverage for rule generation, fallback candidate, LLM enhancement, and fail-open behavior in `src/lib/__tests__/goal-candidate-generator.test.ts`.
- Re-verified with targeted test + `tsc --noEmit` + lint (existing unrelated warning only).

## Review (2026-02-22 Proposal 26 Phase C Priority/Suppression)

- Added `src/lib/goal-priority-engine.ts` implementing deterministic score formula (`impact+urgency+confidence+policyFit`) and queue ordering.
- Added suppression rules for duplicate signatures, low confidence, cooldown active, policy blocked(read-only), and stale signals.
- Added suppression audit persistence helper (`persistSuppressionRecords`) to write suppression traces into state store.
- Added coverage in `src/lib/__tests__/goal-priority-engine.test.ts` and re-verified with targeted tests + `tsc --noEmit` + lint (existing unrelated warning only).

## Review (2026-02-22 Proposal 26 Phase D Runtime + API)

- Added runtime orchestrator `src/lib/goal-manager.ts` for tick lifecycle (collect -> generate -> prioritize -> queue) and dispatch lifecycle (`scheduled/running/completed/failed/expired`).
- Added Goal Manager APIs:
  - `GET /api/goal-manager` status/queue/candidate/suppression view
  - `POST /api/goal-manager/tick` manual tick trigger
  - `POST /api/goal-manager/dispatch` admin-key guarded dispatch trigger
- Integrated `agent-loop` with best-effort goal manager tick/dispatch path (`src/lib/agent-loop.ts`) so failures do not break scaling loop and are tracked as degraded reasons.
- Added coverage for runtime + API routes (`src/lib/__tests__/goal-manager.test.ts`, `src/app/api/goal-manager/*.test.ts`) and re-verified with targeted tests + `tsc --noEmit` + lint.

## Review (2026-02-22 Proposal 27 L1/L2 Core Ops Hardening Documentation)

- L1/L2 공통 운영 인프라 확장을 위해 현재 코드베이스를 체인 런타임, 상태 저장, 제어면 정책, 헬스/복구 축으로 분해해 갭을 정리했다.
- 각 갭은 코드 근거 파일을 연결하고 `P0/P1/P2` 우선순위와 단계별 DoD를 함께 정의해 실행 가능한 로드맵으로 고정했다.
- API/타입 변경 제안(`NetworkScope`, `OperationRecord`, `CoreHealthReport`)과 검증 시나리오를 함께 명시해 후속 구현 시 결정 공백을 최소화했다.

## Review (2026-02-22 Proposal 28 Ethereum Network Diversity Strategy)

- Etherscan/Ethernodes/ethereum.org 최신 수치를 `2026-02-22` 기준으로 재검증해 선언문의 문제정의를 정량 근거로 고정했다.
- Tokamak 슬로건의 4개 명제를 SentinAI 기능(관측/정책/마이그레이션 자동화/incident feedback/GTM KPI)으로 직접 매핑해 실행전략으로 전환했다.
- `10% 목표`를 북극성 지표와 선행지표로 분리하고 12주 단계별 DoD를 명시해 실행팀이 바로 backlog 분해 가능한 상태로 정리했다.

---

**Updated:** 2026-02-22
