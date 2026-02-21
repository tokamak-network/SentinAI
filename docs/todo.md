# TODO: SentinAI Implementation (2026-02-16)

## Current Status

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

---

**Updated:** 2026-02-19
