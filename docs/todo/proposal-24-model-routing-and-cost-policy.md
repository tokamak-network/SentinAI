# Proposal 24: Adaptive Model Routing and Cost Policy (Q1 2026)

> Created: 2026-02-21  
> Status: Completed (Q1 scope implemented on 2026-02-22)  
> Quarter: Q1 (2026-03 ~ 2026-05)

---

## 1. Goal

Evolve current tier-based model selection into policy-driven adaptive routing using cost, latency, reliability, and task criticality.

### Success Metrics (Q1)

| KPI | Current | Target |
|---|---:|---:|
| Routing mode | static tier preference | adaptive policy |
| Critical task fallback time | not measured | < 5s |
| Cost variance control | not measured | <= +10% budget band |
| A/B experiment coverage | 0% | 10~20% traffic |

---

## 2. Scope

### In Scope

1. Routing policy engine around existing AI gateway client
2. Real-time scorecard (latency/error/cost)
3. Fallback routing matrix by task class
4. A/B experiment framework for routing policy
5. Operational APIs for policy status and update

### Out of Scope

1. Full reinforcement-learning policy optimization
2. Per-tenant custom routing policy (Phase 3)
3. On-device SLM inference (local model rollout in later phase)

---

## 3. Current Baseline

Current code already supports model tiers and provider fallback:

- client: `src/lib/ai-client.ts`
- benchmark/tooling: `scripts/benchmark-models.ts`
- stress scenarios: `src/lib/__tests__/llm-stress-test/*`

Missing capabilities for Q1:

1. Runtime policy object with explicit constraints
2. Decision logging with comparable scorecards
3. Safe runtime policy update API

---

## 4. Routing Policy Design

### 4.1 Task Classes

1. `realtime-critical`: fast response, high reliability (agent loop detect/analyze)
2. `analysis-standard`: balanced quality/cost (rca/report)
3. `deep-critical`: high quality preferred (incident deep RCA)

### 4.2 Score Formula

`totalScore = wLatency * latencyScore + wError * reliabilityScore + wCost * costScore + wCriticality * taskScore`

### 4.3 Fallback Rules

1. provider timeout -> next ranked model
2. provider 5xx/429 burst -> temporary circuit break for provider
3. budget breach -> switch to constrained-cost policy

---

## 5. Public Interfaces and Types

### 5.1 New Types

File: `src/types/ai-routing.ts` (new)

- `RoutingPolicy`
- `ModelScoreCard`
- `RoutingDecision`
- `RoutingExperimentConfig`

### 5.2 API Additions

1. `GET /api/ai-routing/status`
- returns active policy, scorecard summary, fallback counts

2. `POST /api/ai-routing/policy`
- updates policy (admin only, authenticated)

### 5.3 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AI_ROUTING_ENABLED` | `true` | Enable adaptive routing |
| `AI_ROUTING_POLICY` | `balanced` | `latency-first` \| `balanced` \| `quality-first` \| `cost-first` |
| `AI_ROUTING_AB_PERCENT` | `10` | traffic percentage for experiment |
| `AI_ROUTING_BUDGET_USD_DAILY` | `50` | daily budget guardrail |

---

## 6. Implementation Plan (Q1)

### Week 9

1. Introduce policy and scorecard types
2. Implement scoring module with provider health cache
3. Add routing decision logging hook

### Week 10

1. Integrate scoring into `ai-client` selection path
2. Implement fallback circuit break behavior
3. Add cost guardrail checks

### Week 11

1. Add status/policy APIs with auth guard
2. Add A/B experiment assignment logic
3. Add dashboard/internal report exposure

### Week 12

1. Validate policy outcomes against baseline
2. Tune default weights for Q1 target KPIs
3. Publish operational runbook and rollback checklist

---

## 7. Test Plan

### Unit Tests

1. Score calculation monotonicity and weight normalization
2. Fallback ordering logic
3. Budget guardrail trigger behavior
4. A/B assignment determinism

### Integration Tests

1. End-to-end request uses expected model under each policy
2. Provider failure reroutes without user-visible crash
3. `/api/ai-routing/status` reflects real routing counters
4. Unauthorized policy update request is denied

### Acceptance Scenarios

1. Critical tasks choose best available model under 5s fallback budget
2. Non-critical tasks stay within configured cost band
3. Policy switch is visible and auditable through API/logs

---

## 8. Rollout and Rollback

### Rollout

1. Shadow score mode (log-only, no routing change)
2. 10% A/B traffic with constrained guardrail
3. 100% rollout after KPI validation

### Rollback

1. Set `AI_ROUTING_ENABLED=false`
2. Revert to existing tier-based static selection path
3. Preserve routing logs for postmortem and tuning

---

## 9. Assumptions and Defaults

1. Existing AI gateway contracts remain stable during Q1
2. No model provider lock-in assumptions are introduced
3. Routing decision logging is mandatory for all AI calls
4. Budget guardrails prioritize reliability for critical tasks over pure cost minimization
