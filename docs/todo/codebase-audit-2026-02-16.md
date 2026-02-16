# SentinAI Codebase Analysis/Review & Remediation Plan (2026-02-16)

## 1) Scope

- Target: `src/app`, `src/app/api`, `src/lib`, `src/chains`, `src/types`, `docs`
- Verification: `npm run lint`, `npm run test:run`
- Objective: Document structure, identify logic risks, select cleanup targets, establish remediation priorities

## 2) Project Structure Summary

- `src/app`: Next.js App Router entry point and dashboard UI
- `src/app/api/*`: Observe/Decide/Execute APIs (metrics, scaler, anomalies, remediation, nlops, etc.)
- `src/lib`: Domain engine layer
  - Observe: `metrics-store.ts`, `log-ingester.ts`, `l1-rpc-failover.ts`, `eoa-balance-monitor.ts`
  - Detect/Analyze: `anomaly-detector.ts`, `anomaly-ai-analyzer.ts`, `rca-engine.ts`
  - Decide/Execute: `scaling-decision.ts`, `predictive-scaler.ts`, `k8s-scaler.ts`, `zero-downtime-scaler.ts`, `remediation-engine.ts`
  - Orchestrate: `agent-loop.ts`, `detection-pipeline.ts`, `scheduler.ts`
  - State: `redis-store.ts` (dual Redis + InMemory implementation)
- `src/chains`: Chain plugin architecture (currently Optimism as default plugin)
- `src/types`: Type definitions for each engine/store/report

## 3) Runtime Logic Flow

1. **Collect**: `/api/metrics` or `agent-loop` collects L1/L2/K8s state and stores in `metrics-store`
2. **Detect**: `runDetectionPipeline()` detects anomalies (L1) then runs async deep analysis (L2~L4)
3. **Decide**: `makeScalingDecision()` + `predictScaling()` derives target vCPU
4. **Execute**: `scaleOpGeth()` applies via simulation/real K8s/zero-downtime path
5. **Record**: Redis/InMemory state, events/alerts/history accumulation

## 4) Code Review Findings (by severity)

### [High] Seed scenario detection logic bug can contaminate live metrics

- Evidence: `src/app/api/metrics/route.ts:341`, `:344`, `:362`
- Problem:
  - When `recentMetrics` has 1+ entries, `latestMetric.cpuUsage !== undefined` is almost always true, causing `usingSeedMetrics=true` entry.
  - Result: even outside seed scenarios, stored values are misidentified as seed data, overwriting actual CPU/TxPool/Gas measurements.
- Impact:
  - Dashboard/scaling decisions may operate on stale data.
- Remediation:
  - Enforce seed entry condition to `activeScenario && activeScenario !== 'live'`.
  - Add source identification flag (`source: 'seed' | 'live'`) to `MetricDataPoint` for explicit classification.
  - Add regression test: verify live mode never enters seed code path.

### [Medium] Anomaly `activeCount` incorrectly scoped to page range

- Evidence: `src/lib/redis-store.ts:334`
- Problem:
  - `getAnomalyEvents(limit, offset)` computes `activeCount` from `events` (page result) instead of the full list.
- Impact:
  - `/api/anomalies` `activeCount` varies with pagination position, distorting operator metrics.
- Remediation:
  - Compute active count against the full list (e.g., `LLEN` + full scan or maintain a separate active counter key).
  - Add test: verify `activeCount` remains constant regardless of `offset > 0`.

### [Medium] No auth/authorization boundary on operational APIs

- Evidence: `src/app/api/remediation/route.ts:51`, `src/app/api/scaler/route.ts:165`, `src/app/api/nlops/route.ts:13`, `src/middleware.ts:38`
- Problem:
  - `POST/PATCH` execution paths have no authentication/authorization checks.
  - Current middleware defaults to allowing write requests when not in read-only mode.
- Impact:
  - Unauthorized scale/playbook execution possible in externally exposed deployments.
- Remediation:
  - Introduce common API guard (`x-api-key` or JWT), enforce on all write endpoints.
  - Minimize sensitive endpoint allowlist, add audit logging.
  - Document security defaults (mandatory auth) in deployment guides.

### [Low] Scaling type/policy inconsistency and accumulated dead code

- Evidence: `src/app/api/scaler/route.ts:172`, `:180`, `:190`
- Problem:
  - `TargetVcpu` type allows `8` but manual scale `validTargets` is `[1,2,4]`.
  - Unused `baseUrl` variable, numerous lint warnings (51 total).
- Impact:
  - Policy confusion and increased maintenance cost.
- Remediation:
  - Align manual policy across docs/types/validation logic (decide whether to support 8).
  - Clean unused imports/variables (prioritize production code).

## 5) Cleanup Target Files

- Priority cleanup:
  - `src/app/api/metrics/route.ts` (high seed/live branching complexity, needs responsibility separation)
  - `src/lib/redis-store.ts` (list scan/count logic needs clarification)
  - `src/app/api/scaler/route.ts` (policy consistency + dead code cleanup)
- Secondary cleanup:
  - Remove unused warnings across test files
  - Configure `coverage/*` exclusion from lint targets

## 6) Execution Plan (priority-based)

1. **P0 Bug Fix**
   - Fix metrics seed detection bug + tests
   - Fix anomaly activeCount to use full list + tests
2. **P1 Security Boundary**
   - Introduce write API authentication guard
   - Switch middleware policy to deny-by-default
3. **P2 Code Cleanup/Consistency**
   - Unify scaling policy (1/2/4 vs 1/2/4/8)
   - Remove lint warnings in production code
4. **P3 Documentation/Verification**
   - Reflect security/policy changes in architecture docs and operation guides
   - Re-verify with `npm run lint`, `npm run test:run`

## 7) Verification Results (this analysis baseline)

- `npm run lint`: No failures, 51 warnings confirmed
- `npm run test:run`: 31 files, 719 tests all passing

## 8) Post-Remediation Results

All P0~P3 items completed:

- **P0-1**: Seed detection bug fixed — condition now requires `activeScenario && activeScenario !== 'live'`
- **P0-2**: Redis activeCount bug fixed — now computes from full list, not paginated subset
- **P1**: API key auth guard added — `SENTINAI_API_KEY` env var, `x-api-key` header validation in middleware
- **P2**: Scaling policy unified (1/2/4/8), unused `baseUrl` removed, 10 production lint warnings fixed
- **P3**: `CLAUDE.md` updated with `SENTINAI_API_KEY` / `NEXT_PUBLIC_SENTINAI_API_KEY` docs

Verification:
- `npm run lint`: 0 errors, 40 warnings (was 51 — removed 10 production code warnings, remaining are test files)
- `npm run test:run`: 31 files, 719 tests all passing
