# Proposal 22: Autonomous Guardian Agent v2 (Q1 2026)

> Created: 2026-02-21  
> Status: Completed (Q1 scope implemented on 2026-02-22)  
> Quarter: Q1 (2026-03 ~ 2026-05)

---

## 1. Goal

Upgrade current agent loop into a deterministic autonomous execution pipeline:
`observe -> detect -> analyze -> plan -> act -> verify`.

### Success Metrics (Q1)

| KPI | Current | Target |
|---|---:|---:|
| Agent phase granularity | 4~5 | 6+ |
| Action verification coverage | partial | 100% |
| Degraded-mode completion rate | not measured | >= 95% |
| Activity log trace completeness | partial | 100% per cycle |

---

## 2. Scope

### In Scope

1. Agent cycle phase model expansion
2. Decision envelope (`decisionId`, confidence, evidence)
3. Verification step after each action
4. Degraded execution policy (partial failures tolerated)
5. API and dashboard contract extension for richer cycle data

### Out of Scope

1. Multi-agent consensus (Q2)
2. Policy learning from historical rewards (Q2+)
3. Full OpenTelemetry migration (Q2)

---

## 3. Current Baseline

Current loop (`src/lib/agent-loop.ts`) already collects metrics, detects anomalies, computes scaling, and executes actions.

Known gaps:

1. Phase semantics are coarse for incident audit
2. Post-action verification is not normalized as a first-class step
3. Decision confidence/evidence schema is not standardized

---

## 4. Target Runtime Model

```text
observe: collect l1/l2 metrics + runtime state
  -> detect: anomaly and health checks
  -> analyze: ai/log/rca synthesis
  -> plan: choose action candidate + confidence
  -> act: execute or dry-run
  -> verify: confirm effect, else fallback/escalate
```

### Failure Policy

1. Observe failure: continue with last known safe metrics when available
2. Analyze failure: fallback to rule-based scoring
3. Act failure: mark cycle degraded, force verify with no-op expectation
4. Verify failure: escalate to alert channel and block repeated action by cooldown

---

## 5. Public Interfaces and Types

### 5.1 `AgentCycleResult` Extension

File: `src/lib/agent-loop.ts`, `src/types/*` (new shared type if needed)

Add fields:

- `decisionId: string`
- `confidence: number` (0-1)
- `phaseTrace: Array<{ phase: string; startedAt: string; endedAt: string; ok: boolean; error?: string }>`
- `verification: { expected: string; observed: string; passed: boolean; details?: string }`

### 5.2 API Contract Update

File: `src/app/api/agent-loop/route.ts`

- `lastCycle.phase` enum:
  - `observe | detect | analyze | plan | act | verify | complete | error`
- include `decisionId`, `confidence`, `verification`

### 5.3 Activity Log Mapping

File: `src/app/page.tsx`

- map each phase transition into activity entries
- include `decisionId` and verification result badge

---

## 6. Implementation Plan (Q1)

### Week 5

1. Refactor cycle state machine and phase trace model
2. Add deterministic `decisionId` generator
3. Add analyze/plan split from existing decision stage

### Week 6

1. Add verify step contract and execution hooks
2. Add fallback/degraded policies and cooldown coupling
3. Add type-safe API response updates

### Week 7

1. Dashboard activity log extension for phase trace
2. Regression fixes for failover and scaling events
3. Add chain-plugin compatibility checks

### Week 8

1. End-to-end tests (normal/failure/degraded)
2. Operational runbook updates
3. KPI capture hooks for Q1 review

---

## 7. Test Plan

### Unit Tests

1. Phase transitions are ordered and terminal state is deterministic
2. Confidence normalization (0-1) and floor/ceiling handling
3. Verification pass/fail parser
4. Degraded mode trigger conditions

### Integration Tests

1. `runAgentCycle` success path includes all phase traces
2. Analyze failure falls back to rule engine
3. Action failure still emits verify stage and activity event
4. API response schema remains backward-compatible for old fields

### Acceptance Scenarios

1. Every cycle has one `decisionId` and one final verification record
2. Operator can inspect phase-level outcome from dashboard
3. No silent failure when one subsystem is unavailable

---

## 8. Rollout and Rollback

### Rollout

1. Feature flag: `AGENT_LOOP_V2_ENABLED`
2. Shadow mode: generate v2 trace while keeping v1 action path
3. Cutover after 7-day stability window

### Rollback

1. Disable `AGENT_LOOP_V2_ENABLED`
2. Keep storage compatibility by optional fields
3. Reuse existing v1 cycle logic immediately

---

## 9. Assumptions and Defaults

1. Existing scheduler cadence (30s) is retained in Q1
2. Verify stage is mandatory even for no-op actions
3. Read-only mode keeps planning/verification active but blocks act execution
4. Rule-based fallback is always available without LLM dependency
