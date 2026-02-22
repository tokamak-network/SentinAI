# Proposal 25: Claude Code Natural-Language L2 Operations (Priority Roadmap)

> Created: 2026-02-22  
> Status: Planned  
> Quarter: Q2 (2026-03 ~ 2026-05)

---

## 1. Goal

Enable practical natural-language L2 operations from Claude Code while preserving production safety:

1. Claude Code can discover and call SentinAI tools through MCP without custom manual RPC wrappers.
2. Goal execution can reason, validate, and re-plan with policy constraints.
3. Autonomous loops can verify outcomes and rollback failed actions automatically.

### Success Metrics (Q2)

| KPI | Current | Target |
|---|---:|---:|
| Claude Code MCP direct compatibility | Partial (HTTP JSON-RPC only) | Full (`initialize`, `tools/list`, `tools/call`, stdio bridge) |
| Goal completion rate (bounded tasks) | N/A | >= 85% |
| Unsafe write attempts blocked by policy | N/A | 100% |
| Auto-verification coverage for write actions | Partial | 100% |
| Production incidents caused by autonomous action | N/A | 0 (during staged rollout) |

---

## 2. Priority Order

Execution order is fixed and must not be reshuffled:

1. Priority 1: Claude Code MCP transport adapter (`stdio`/SSE bridge)
2. Priority 3: Central policy and approval engine
3. Priority 2: LLM+validator goal planner with re-planning
4. Priority 5: Closed-loop verification and rollback automation
5. Priority 4: Expanded operational action toolset
6. Priority 6: Evaluation environment and autonomy scorecard

---

## 3. Current Baseline

Implemented baseline before this proposal:

1. MCP HTTP endpoint and tool routing exist (`src/app/api/mcp/route.ts`, `src/lib/mcp-server.ts`).
2. Goal planning and execution exist but are mainly rule-based (`src/lib/goal-planner.ts`).
3. Agent loop has phase trace and verification, focused on scaling path (`src/lib/agent-loop.ts`).
4. Write tools already require approval/read-only guards in MCP server.

Main gaps:

1. Claude Code native MCP transport path is not packaged.
2. Policy logic is embedded mostly inside MCP server, not reusable across APIs/agent.
3. Goal planning is keyword/rule-driven and lacks model-driven decomposition + re-planning.
4. Verification/rollback is not a first-class action framework across all write tools.

---

## 4. Implementation Plan by Priority

## 4.1 Priority 1 — Claude Code MCP Transport Adapter

### Objective

Provide a runnable MCP bridge process for Claude Code that translates stdio MCP calls into SentinAI `/api/mcp` calls with secure context propagation.

### Deliverables

1. `src/lib/mcp-bridge-client.ts` (bridge client for HTTP transport)
2. `scripts/mcp-stdio-bridge.ts` (stdio MCP server adapter process)
3. `package.json` script: `mcp:bridge:stdio`
4. Setup guide: `docs/guide/claude-code-mcp-setup.md`

### API/Contract

1. Supports `initialize`, `tools/list`, `tools/call`, `notifications/initialized`
2. Preserves `x-api-key`, `x-request-id`, optional approval token path
3. Normalizes MCP error codes from SentinAI into stdio response format

### Verification

1. Unit: stdio frame parsing/serialization and error mapping
2. Integration: local bridge -> `/api/mcp` roundtrip tool calls
3. Smoke: Claude Code config can list tools and run `get_metrics`

### Exit Criteria

1. No manual curl wrapper required for Claude Code usage
2. Tool discovery/call success rate >= 99% in local test runs

---

## 4.2 Priority 3 — Central Policy and Approval Engine

### Objective

Move authorization and safety decisions to a reusable policy module so MCP/API/agent all enforce the same write constraints.

### Deliverables

1. `src/types/policy.ts`
2. `src/lib/policy-engine.ts`
3. `src/lib/approval-engine.ts` (ticket lifecycle and multi-step approval)
4. Refactor callers:
   - `src/lib/mcp-server.ts`
   - `src/app/api/goals/route.ts`
   - `src/lib/agent-loop.ts` (for future write actions beyond scaling)

### Policy Model

1. Inputs: actor, tool/action, risk level, read-only mode, env flags, chain context
2. Outputs: `allow | deny | require_approval | require_multi_approval`
3. Deterministic reason code for every decision (audit-safe)

### Verification

1. Unit: matrix tests by action/risk/mode
2. Regression: existing MCP tests must pass with policy engine enabled
3. Security: token replay/expiry/tampered-params rejection tests

### Exit Criteria

1. No direct guard duplication outside policy module
2. Every denied/approved write has machine-readable policy reason code

---

## 4.3 Priority 2 — LLM+Validator Goal Planner with Re-Planning

### Objective

Upgrade goal planning from keyword rules to constrained model planning with deterministic validation and bounded re-planning loops.

### Deliverables

1. `src/lib/goal-planner-llm.ts` (LLM planning adapter)
2. `src/lib/goal-plan-validator.ts` (schema + policy + precondition checks)
3. `src/types/goal-planner.ts` extension:
   - `planVersion`
   - `replanCount`
   - `failureReasonCode`
4. Integrate into `src/lib/goal-planner.ts`

### Planning Pipeline

1. Intent extraction -> candidate step graph generation
2. Validation:
   - schema validity
   - policy compatibility
   - runtime preconditions (metrics/anomalies/cooldown)
3. If invalid: bounded re-plan (`maxReplans=2`)
4. Fallback: current rule-based planner if model path fails

### Verification

1. Unit: malformed plan rejection and repair
2. Integration: `execute_goal_plan` with re-plan success/failure paths
3. Cost/latency budget tests for `fast` and `best` tiers

### Exit Criteria

1. At least 4 standard goal classes produce valid executable plans
2. Re-plan loop prevents invalid write plans from execution

---

## 4.4 Priority 5 — Closed-Loop Verification and Rollback

### Objective

Make every write action verifiable with post-condition checks and automatic rollback playbooks when verification fails.

### Deliverables

1. `src/types/operation-control.ts`
2. `src/lib/operation-verifier.ts`
3. `src/lib/rollback-runner.ts`
4. Integrations:
   - `src/lib/mcp-server.ts` write tools
   - `src/lib/goal-planner.ts` write steps
   - `src/lib/agent-loop.ts` verify/rollback trace

### Control Flow

1. Execute action (or dry-run)
2. Run action-specific verifier
3. If failed and rollback available:
   - run rollback playbook
   - verify rollback outcome
4. Persist control result to decision trace/activity logs

### Verification

1. Unit: verifier rules per action type
2. Integration: forced-failure scenarios trigger rollback
3. Reliability: rollback success ratio metric and alerting thresholds

### Exit Criteria

1. 100% of write actions have verifier definitions
2. Failed verification never silently returns success

---

## 4.5 Priority 4 — Expanded Operational Action Toolset

### Objective

Expand actionable tool surface for real L2 operations while keeping every action guarded, dry-runnable, and rollback-aware.

### Deliverables

1. MCP tool additions in `src/types/mcp.ts`, `src/lib/mcp-server.ts`:
   - `restart_batcher`
   - `restart_proposer`
   - `switch_l1_rpc`
   - `update_proxyd_backend`
   - `run_health_diagnostics`
2. Operational executor modules:
   - `src/lib/l1-rpc-operator.ts`
   - `src/lib/component-operator.ts`

### Rules

1. Every new write tool requires:
   - policy check
   - approval path
   - verifier + rollback hint
2. Read-only mode behavior must be explicit per tool

### Verification

1. Unit: tool parameter validation and policy mapping
2. Integration: tool call -> action -> verification -> audit trace
3. Regression: legacy tools unchanged behavior

### Exit Criteria

1. At least 5 new operational tools available through MCP
2. All new write tools pass guarded execution tests

---

## 4.6 Priority 6 — Evaluation Environment and Autonomy Scorecard

### Objective

Establish repeatable evaluation before production rollout so autonomy quality is measured, not assumed.

### Deliverables

1. `scripts/autonomy-eval.ts` (scenario replay runner)
2. `src/lib/autonomy-scorecard.ts`
3. `docs/verification/proposal-25-autonomy-eval-report-template.md`
4. CI workflow for scheduled eval (`.github/workflows/autonomy-eval.yml`)

### Metrics

1. Goal completion rate
2. False-action rate
3. Policy violation count
4. Rollback success rate
5. Median time-to-stability

### Verification

1. Replay at least 10 deterministic incident scenarios
2. Compare dry-run vs write-run outcomes
3. Gate production rollout on minimum score thresholds

### Exit Criteria

1. Scorecard generated automatically for each release candidate
2. Release blocked when critical safety thresholds are unmet

---

## 5. Milestone Timeline (10 Weeks)

1. Week 1-2: Priority 1 complete
2. Week 3-4: Priority 3 complete
3. Week 5-6: Priority 2 complete
4. Week 7: Priority 5 complete
5. Week 8: Priority 4 complete
6. Week 9-10: Priority 6 complete + staged rollout prep

---

## 6. Test Strategy

### Unit

1. Bridge protocol compatibility
2. Policy decision matrix
3. Plan validation/re-planning
4. Verifier/rollback contracts

### Integration

1. Claude Code bridge end-to-end call flow
2. Goal execution with policy + approval + verification
3. Agent loop interaction with policy and rollback modules

### Acceptance

1. Natural-language operation from Claude Code works without manual RPC handling
2. No unsafe write action bypasses policy or approval
3. Failed actions are verified and rolled back or escalated

---

## 7. Rollout and Rollback

### Rollout

1. Stage A: Bridge + read tools only
2. Stage B: Guarded write tools in dry-run default
3. Stage C: Limited write rollout with approval and rollback enabled
4. Stage D: Autonomous mode expansion by scored confidence gates

### Rollback

1. Disable bridge entrypoint (`mcp:bridge:stdio`)
2. Force `dryRun=true` for all write-capable tools
3. Disable autonomous act path while preserving observe/detect/analyze

---

## 8. Risks and Mitigations

1. Risk: transport incompatibility with Claude Code MCP updates  
   Mitigation: protocol compatibility tests + version pinning + fallback HTTP adapter

2. Risk: over-aggressive autonomous actions  
   Mitigation: central policy engine, approval requirements, verification+rollback mandatory

3. Risk: planner hallucination or invalid action graph  
   Mitigation: strict schema validation, bounded re-planning, rule-based fallback

4. Risk: low reproducibility of safety claims  
   Mitigation: deterministic replay eval and release score gating

