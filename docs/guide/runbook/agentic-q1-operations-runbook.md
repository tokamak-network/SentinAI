# SentinAI Q1 Operations Runbook (Proposal 22-24)

## Scope

- Guardian Agent v2 cycle operation (`observe -> detect -> analyze -> plan -> act -> verify`)
- Agent memory / decision trace inspection and replay
- Adaptive model routing policy operation and rollback

## 1. Guardian Agent v2

### 1.1 Health Checks

1. Check Agent loop status
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.scheduler, .lastCycle.phase, .lastCycle.decisionId'
```
2. Check phase trace
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.phaseTrace'
```
3. Check verification
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.verification'
```

### 1.2 Degraded Incident Handling

1. Check whether degraded
```bash
curl -s http://localhost:3002/api/agent-loop | jq '.lastCycle.degraded'
```
2. When `observe-fallback:last-safe-metrics` occurs
- First, check the L2 RPC status.
- If recently collected metrics are stale, check the seed/live data sources.
3. When `act-failed:*` occurs
- Check orchestrator (k8s/docker) permissions/connectivity.
- Compare the verify result with the actual vCPU state.

## 2. Agent Memory / Decision Trace

### 2.1 Retrieve recent memory

```bash
curl -s "http://localhost:3002/api/agent-memory?limit=20" | jq '.total, .entries[0]'
```

### 2.2 Retrieve Decision Trace

1. Recent trace list
```bash
curl -s "http://localhost:3002/api/agent-decisions?limit=20" | jq '.total, .traces[0].decisionId'
```
2. Retrieve a single trace
```bash
curl -s "http://localhost:3002/api/agent-decisions?decisionId=<decisionId>" | jq '.trace'
```

### 2.3 Incident Replay: standard procedure

1. Obtain the `decisionId` for a failed or high-risk cycle.
2. Review the trace fields: `reasoningSummary`, `evidence`, `verification`.
3. Compare the activity log and phase trace for the same time window.
4. If it recurs, query similar cases using memory query filters (`component`, `severity`, `fromTs`).

## 3. Adaptive Routing Policy

### 3.1 Check status

```bash
curl -s http://localhost:3002/api/ai-routing/status | jq '.policy, .budget, .circuitStates, .counters'
```

Inspection items:
- `budget.exceeded`: Whether the daily budget is exceeded
- `circuitStates[].isOpen`: Whether the provider circuit is open
- `counters.fallbackRecovered`: Number of successful fallback recoveries

### 3.2 Change policy (admin)

Policy changes are allowed only when `SENTINAI_API_KEY` is set.

```bash
curl -s -X POST http://localhost:3002/api/ai-routing/policy \
  -H "content-type: application/json" \
  -H "x-api-key: ${SENTINAI_API_KEY}" \
  -d '{"name":"balanced","enabled":true,"abPercent":25,"budgetUsdDaily":80}' | jq
```

### 3.3 Rollback checklist

1. Immediately revert to static behavior
- `AI_ROUTING_ENABLED=false`
2. Reset policy
- `AI_ROUTING_POLICY=balanced`
- `AI_ROUTING_AB_PERCENT=0`
3. Preserve status/traces for incident analysis
- `/api/ai-routing/status`
- `/api/agent-decisions`

## 4. Environment Defaults

- `AGENT_MEMORY_ENABLED=true`
- `AGENT_MEMORY_RETENTION_DAYS=30`
- `AI_ROUTING_ENABLED=true`
- `AI_ROUTING_POLICY=balanced`
- `AI_ROUTING_AB_PERCENT=10`
- `AI_ROUTING_BUDGET_USD_DAILY=50`
