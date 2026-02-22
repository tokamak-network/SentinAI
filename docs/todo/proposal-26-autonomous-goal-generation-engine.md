# Proposal 26: Autonomous Goal Generation Engine (Phase 2)

> Created: 2026-02-22  
> Status: Planned  
> Quarter: Q2-Q3 (2026-03 ~ 2026-08)

---

## 1. Background

SentinAI now supports:

1. Claude Code MCP bridge and guarded tool execution.
2. LLM-assisted goal planning with validator/replan fallback.
3. Verification and rollback for major write actions.
4. Deterministic autonomy evaluation and scorecard.

Current gap to full autonomy:

1. Goals are still mostly user-triggered or fixed-loop-triggered.
2. Agent does not continuously create and rank operational goals on its own.
3. Long-horizon objective management is not yet first-class.

---

## 2. Remaining Work for Full Autonomy

Priority backlog to reach full autonomous agent behavior:

1. Goal Generation Engine (this proposal)
2. Durable execution orchestrator (queue, checkpoint, retry, timeout)
3. Full tool coverage for verifier/rollback contracts
4. Risk-tiered autonomy policy (A0-A5) and adaptive approvals
5. Unified state graph and confidence-aware causal reasoning
6. Learning loop from replay/incidents into planning policy
7. Production-grade shadow/canary autonomy gate
8. Security/governance hardening (least privilege, immutable audit, kill-switch)

---

## 3. Objective

Build an autonomous Goal Generation Engine that continuously:

1. Ingests multi-source signals (metrics, anomalies, failover events, cost, decision memory).
2. Generates candidate operational goals.
3. Scores and prioritizes goals with policy/risk constraints.
4. Publishes executable goals into a managed queue for planner/executor consumption.

Success criteria:

1. Agent can create goals without explicit user prompt.
2. Goal ranking is deterministic under same input state.
3. Unsafe/low-confidence goals are filtered before execution.

---

## 4. Scope and Non-Goals

In scope:

1. Goal candidate generation and queue lifecycle.
2. Priority scoring and suppression/dedup rules.
3. Integration point to existing `goal-planner` and `agent-loop`.

Out of scope (for this phase):

1. Multi-agent negotiation/consensus protocol.
2. Fully self-tuning policy via online learning.
3. Cross-cluster distributed scheduler.

---

## 5. Architecture Plan

## 5.1 New Types

Add `src/types/goal-manager.ts`:

1. `AutonomousGoalSource` (`metrics`, `anomaly`, `policy`, `cost`, `failover`, `memory`)
2. `AutonomousGoalStatus` (`candidate`, `queued`, `scheduled`, `running`, `completed`, `failed`, `suppressed`, `expired`)
3. `AutonomousGoalRisk` (`low`, `medium`, `high`, `critical`)
4. `AutonomousGoalCandidate`, `AutonomousGoalQueueItem`, `GoalPriorityScore`
5. `GoalSuppressionReasonCode` (`duplicate_goal`, `low_confidence`, `policy_blocked`, `cooldown_active`, `stale_signal`)

## 5.2 New Modules

1. `src/lib/goal-signal-collector.ts`
2. `src/lib/goal-candidate-generator.ts`
3. `src/lib/goal-priority-engine.ts`
4. `src/lib/goal-manager.ts`

Responsibilities:

1. `goal-signal-collector`: collect normalized runtime signals.
2. `goal-candidate-generator`: hybrid rule + LLM goal candidate generation.
3. `goal-priority-engine`: score goals (impact, urgency, confidence, risk, policy fit).
4. `goal-manager`: dedup/suppress/queue lifecycle and dispatch.

## 5.3 Data and Queue

Use existing store abstraction (`redis-store`) for:

1. Candidate ring buffer (`goal:candidate:*`)
2. Priority queue (`goal:queue`)
3. Active goal pointer (`goal:active`)
4. Suppression history (`goal:suppression:*`)

Queue invariants:

1. No duplicate goal signature in active window (default 30 min).
2. High/critical risk goals require explicit policy path.
3. Expired goals are auto-pruned.

## 5.4 Integration Points

1. `agent-loop`: after detect/analyze phase, call `goal-manager.tick()`.
2. `goal-planner`: consume queued goal text and produce executable plan.
3. `policy-engine`: evaluate goal risk and write eligibility before scheduling.

---

## 6. Implementation Plan (Goal Generation Engine)

Execution order for implementation:

## Phase A: Foundation (Week 1)

1. Add `goal-manager` types and store contracts.
2. Implement signal collector with deterministic snapshot schema.
3. Add unit tests for signal normalization and schema guards.

Deliverables:

1. `src/types/goal-manager.ts`
2. `src/lib/goal-signal-collector.ts`
3. `src/lib/__tests__/goal-signal-collector.test.ts`

## Phase B: Candidate Generation (Week 2)

1. Implement rule-based candidate generator baseline.
2. Add optional LLM enhancer for goal phrasing and decomposition hints.
3. Add fallback path when LLM unavailable.

Deliverables:

1. `src/lib/goal-candidate-generator.ts`
2. `src/lib/__tests__/goal-candidate-generator.test.ts`

## Phase C: Priority and Suppression (Week 3)

1. Implement priority engine scoring formula:
   - `score = impact(0-40) + urgency(0-25) + confidence(0-20) + policyFit(0-15)`
2. Implement dedup/suppression rules:
   - same signature suppression window
   - cooldown-aware suppression
   - low-confidence cutoff
3. Persist suppression reasons to audit trail.

Deliverables:

1. `src/lib/goal-priority-engine.ts`
2. `src/lib/__tests__/goal-priority-engine.test.ts`

## Phase D: Goal Manager Runtime (Week 4)

1. Implement queue lifecycle manager (`enqueue`, `dequeue`, `ack`, `fail`, `expire`).
2. Integrate with `agent-loop` tick and `goal-planner` dispatch.
3. Add read API for dashboard/operator visibility.

Deliverables:

1. `src/lib/goal-manager.ts`
2. `src/app/api/goal-manager/route.ts`
3. `src/lib/__tests__/goal-manager.test.ts`

## Phase E: Safety and Verification (Week 5)

1. Add policy gate on queued goals.
2. Add end-to-end test: signal -> candidate -> queue -> plan dispatch.
3. Add replay scenarios for false-goal and stale-goal suppression.

Deliverables:

1. `src/lib/__tests__/goal-manager-e2e.test.ts`
2. `scripts/autonomy-eval.ts` scenario extension (goal generation coverage)

---

## 7. API and Observability Plan

API additions:

1. `GET /api/goal-manager` (queue/candidate/suppression summary)
2. `POST /api/goal-manager/tick` (manual trigger in staging)
3. `POST /api/goal-manager/dispatch` (force dispatch top goal, admin only)

Metrics:

1. `goal_candidates_total`
2. `goal_suppressed_total{reason}`
3. `goal_queue_depth`
4. `goal_dispatch_latency_ms`
5. `goal_execution_success_rate`

Logs:

1. candidate creation trace
2. suppression reason trace
3. dispatch/ack/fail trace

---

## 8. Verification Strategy

Unit:

1. signal normalization stability
2. scoring determinism
3. suppression dedup/cooldown rules

Integration:

1. agent-loop tick to queue insertion
2. queue to goal planner dispatch
3. policy block and suppression path

Acceptance:

1. Autonomous goal creation works without user prompt.
2. Duplicate/noisy goals are suppressed deterministically.
3. Unsafe goals are blocked before execution.

---

## 9. Rollout Plan

Stage A:

1. observe-only mode (`GOAL_MANAGER_ENABLED=true`, dispatch disabled)

Stage B:

1. dispatch dry-run mode (goal queue active, execution dry-run only)

Stage C:

1. bounded write mode with approval requirement

Stage D:

1. autonomous dispatch expansion by score gate

Rollback:

1. disable `GOAL_MANAGER_ENABLED`
2. clear dispatch path while retaining candidate telemetry

---

## 10. Exit Criteria

1. Goal manager generates and ranks goals continuously in staging.
2. At least 80% of generated goals are actionable after validation.
3. False-goal suppression rate is stable under replay scenarios.
4. Production rollout gate includes goal-generation score metrics.
