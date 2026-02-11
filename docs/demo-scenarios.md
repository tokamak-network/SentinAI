# SentinAI Demo Scenarios

Prerequisites, step-by-step demo scripts, and expected outcomes for verifying SentinAI features.

---

## Prerequisites

```bash
npm install
npm run dev          # http://localhost:3002
```

Minimum `.env.local`:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-...        # AI features (any one AI key)
```

All demos work with `SCALING_SIMULATION_MODE=true` (default) — no real K8s cluster required.

---

## Demo 1: Normal Operation Monitoring

**Goal**: Verify baseline metrics collection and dashboard rendering.

```bash
# Inject stable metrics (20 data points, ~1 min intervals)
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable

# Verify metrics response
curl -s http://localhost:3002/api/metrics | jq '{
  l2Block: .metrics.blockHeight,
  cpu: .metrics.cpuUsage,
  txPool: .metrics.txPoolCount,
  components: [.components[]?.name],
  cost: .cost.opGethMonthlyCost
}'
```

**Expected**:
- CPU: 15~25%
- TxPool: 10~30
- 4 components listed (L2 Client, Consensus Node, Batcher, Proposer)
- Cost calculated at current vCPU

**Dashboard**: Open browser — blocks increment, CPU gauge stable, green status indicators.

---

## Demo 2: Anomaly Detection Pipeline

**Goal**: Trigger and observe the 4-layer anomaly detection pipeline.

### Step 1 — Establish baseline

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
```

### Step 2 — Inject spike

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
```

### Step 3 — Trigger detection (poll metrics)

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[] | {metric, zScore, direction, description}],
  activeEventId: .activeAnomalyEventId
}'
```

**Expected**:
- `anomalyCount`: 1+ (cpuUsage, txPoolPending, or gasUsedRatio)
- `zScore`: > 2.5
- `activeEventId`: UUID string

### Step 4 — Check anomaly event history

```bash
curl -s http://localhost:3002/api/anomalies | jq '{
  total: .total,
  activeCount: .activeCount,
  latestEvent: .events[0] | {id, status, anomalyCount: (.anomalies | length), hasDeepAnalysis: (.deepAnalysis != null)}
}'
```

**Expected** (if AI key configured):
- `hasDeepAnalysis`: true (Layer 2 AI analysis completed)
- `status`: "active"

### Step 5 — Verify alert config

```bash
curl -s http://localhost:3002/api/anomalies/config | jq '.'
```

**Dashboard**: Anomaly Monitor panel shows detected anomalies with severity indicators.

---

## Demo 3: Predictive Scaling

**Goal**: Demonstrate AI-powered scaling prediction and recommendation.

### Step 1 — Inject rising load pattern

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising
```

### Step 2 — Check prediction

```bash
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  prediction: .prediction | (if . then {
    predictedVcpu,
    confidence: (.confidence * 100 | tostring + "%"),
    trend,
    reasoning,
    action: .recommendedAction
  } else "Not enough data (need 10+ points)" end),
  meta: .predictionMeta | {ready: .isReady, metricsCount, minRequired}
}'
```

**Expected**:
- `metricsCount` >= 10 (from seed injection)
- `trend`: "increasing"
- `predictedVcpu`: 2 or 4
- `confidence`: 60~95%

### Step 3 — Repeat with spike for high-confidence scale-up

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/scaler | jq '.prediction | {predictedVcpu, confidence, recommendedAction}'
```

**Dashboard**: Scaling Forecast panel shows predicted vCPU, trend direction, confidence level.

---

## Demo 4: NLOps Chat Interface

**Goal**: Demonstrate natural language operations control.

### Safe queries (no confirmation needed)

```bash
# Status query
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Show current status"}' | jq '{intent: .intent, response: .response[0:200]}'

# Log analysis
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Analyze recent logs"}' | jq '{intent: .intent, response: .response[0:200]}'

# Root cause analysis
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Run root cause analysis"}' | jq '{intent: .intent, response: .response[0:200]}'
```

### Dangerous action (requires confirmation)

```bash
# Scale request — returns confirmation prompt
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Scale to 4 vCPU"}' | jq '{intent, needsConfirmation, confirmationMessage}'
```

**Expected**:
- `intent`: "scale"
- `needsConfirmation`: true
- `confirmationMessage`: Description of action to confirm

**Dashboard**: Click chat toggle (bottom-right), type commands, confirm/cancel dangerous actions.

---

## Demo 5: Cost Optimization

**Goal**: Show cost tracking and AI-powered optimization recommendations.

```bash
# Inject usage data
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
sleep 1
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising

# Get cost report
curl -s http://localhost:3002/api/cost-report | jq '{
  currentCost: .currentMonthlyCost,
  optimizedCost: .optimizedMonthlyCost,
  savingsPercent: .savingsPercent,
  recommendations: [.recommendations[]? | .title]
}'
```

**Expected**:
- Cost calculated based on Fargate Seoul pricing
- Savings percentage vs fixed 4 vCPU baseline
- AI recommendations (if AI key configured)

---

## Demo 6: Root Cause Analysis

**Goal**: Demonstrate dependency graph traversal and fault propagation analysis.

### Step 1 — Inject anomaly

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/metrics > /dev/null  # Trigger detection
```

### Step 2 — Run RCA

```bash
curl -sX POST http://localhost:3002/api/rca \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{
  rootCause: .result.rootCause,
  affectedComponents: .result.affectedComponents,
  severity: .result.severity,
  remediationAdvice: [.result.remediationAdvice[]? | .action]
}'
```

**Expected**:
- `rootCause`: Identified component (e.g., "op-geth resource exhaustion")
- `affectedComponents`: Dependency chain (op-geth → op-node → ...)
- `remediationAdvice`: Actionable steps

---

## Demo 7: Auto-Remediation Engine

**Goal**: Verify playbook matching, safety gates, and remediation execution.

### Step 1 — Check remediation status

```bash
curl -s http://localhost:3002/api/remediation | jq '{
  enabled: .config.enabled,
  circuitBreakers: .circuitBreakers,
  recentExecutions: (.recentExecutions | length)
}'
```

### Step 2 — Enable and trigger (simulation mode)

```bash
# Enable auto-remediation
curl -sX PATCH http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Trigger a playbook manually
curl -sX POST http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"playbookName": "op-geth-resource-exhaustion"}' | jq '{
  status: .status,
  playbook: .playbook,
  actionsExecuted: .actionsExecuted,
  escalationLevel: .escalationLevel
}'
```

**Expected** (simulation mode):
- `status`: "completed" or "simulated"
- Actions logged but not executed against real K8s

---

## Demo 8: Agent Loop (Autonomous Operation)

**Goal**: Verify the server-side autonomous observe-detect-decide-act cycle.

### Verify agent loop is running

```bash
# Check scheduler status
curl -s http://localhost:3002/api/health

# Watch server console for agent loop logs (every 30s):
# [AgentLoop] Cycle complete — score: 15.2, target: 1 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### Trigger autonomous scaling

```bash
# 1. Enable auto-scaling
curl -sX PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true}'

# 2. Inject high load
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike

# 3. Wait for next agent cycle (~30s), then check scaling state
sleep 35
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  simulationMode: .simulationMode,
  lastScaling: .lastScalingTime
}'
```

**Expected**: `currentVcpu` increased (in simulation mode, state updated without real K8s patch).

---

## Demo 9: Full Pipeline (End-to-End)

**Goal**: Run the complete pipeline from normal → anomaly → detection → scaling → remediation → recovery.

```bash
#!/bin/bash
BASE=http://localhost:3002

echo "=== Phase 1: Baseline ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
sleep 2

echo "=== Phase 2: Load Increase ==="
curl -sX POST $BASE/api/metrics/seed?scenario=rising
curl -s $BASE/api/scaler | jq '{prediction: .prediction.trend, confidence: .prediction.confidence}'
sleep 2

echo "=== Phase 3: Spike (Anomaly Trigger) ==="
curl -sX POST $BASE/api/metrics/seed?scenario=spike
sleep 1
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: [.anomalies[] | .metric]}'

echo "=== Phase 4: Scaling Decision ==="
curl -s $BASE/api/scaler | jq '{current: .currentVcpu, predicted: .prediction.predictedVcpu}'

echo "=== Phase 5: Root Cause Analysis ==="
curl -sX POST $BASE/api/rca | jq '{cause: .result.rootCause, severity: .result.severity}'

echo "=== Phase 6: Remediation ==="
curl -s $BASE/api/remediation | jq '{executions: (.recentExecutions | length)}'

echo "=== Phase 7: Recovery ==="
curl -sX POST $BASE/api/metrics/seed?scenario=falling
sleep 2
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'

echo "=== Phase 8: Stable ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
echo "=== Complete ==="
```

**Expected flow**:
1. Baseline: CPU ~20%, 0 anomalies
2. Rising: Prediction trend "increasing"
3. Spike: Anomalies detected (cpuUsage, txPoolPending)
4. Scaling: Predicted vCPU increase
5. RCA: Root cause identified
6. Remediation: Playbook matched (if enabled)
7. Falling: Anomalies clearing
8. Stable: Back to normal, 0 anomalies

---

## Demo 10: Stress Mode (Dashboard UI)

**Goal**: Visual demonstration of high-load state without real infrastructure.

1. Open `http://localhost:3002`
2. Click **STRESS MODE** toggle (top area)
3. Observe:
   - CPU jumps to 96.5%
   - vCPU shows 8 (maximum scale)
   - Components show "Scaling Up" status
   - Cost reflects 8 vCPU Fargate pricing
4. Click toggle again to return to normal

---

## Automated Test Commands

| Command | Scope | Duration |
|---------|-------|----------|
| `npm run test:run` | 559 unit tests | ~1s |
| `npm run test:coverage` | Unit tests + coverage report | ~3s |
| `npm run verify` | Full 6-phase E2E | 5~10min |
| `npm run lint` | ESLint check | ~5s |

---

## Seed Scenario Reference

| Scenario | CPU Range | TxPool | Points | Use Case |
|----------|-----------|--------|--------|----------|
| `stable` | 15~25% | 10~30 | 20 | Baseline, normal ops |
| `rising` | 15→50% | 10→80 | 20 | Predictive scaling demo |
| `spike` | ~95% | 5000+ | 20 | Anomaly detection demo |
| `falling` | 80→20% | decreasing | 20 | Recovery demo |
| `live` | real data | real data | varies | Production-like (requires accumulated data) |

```bash
# Inject any scenario
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=<name>
```

---

## Production Cluster Testing

The seed API is unavailable in production (`NODE_ENV=production`). For real K8s scaling verification with live load injection, see:

**[Production Load Testing Guide](./production-load-testing-guide.md)**
