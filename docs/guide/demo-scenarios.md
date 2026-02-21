# SentinAI demo scenario

Prerequisites, step-by-step demo scripts, and expected results to validate SentinAI functionality.

---

## Prerequisites

```bash
npm install
npm run dev          # http://localhost:3002
```

Minimum `.env.local` settings:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-... # AI function (API key of AI provider to use)
```

All demos work with `SCALING_SIMULATION_MODE=true` (default). No need for a physical K8s cluster.

---

## Demo 1: Normal operation monitoring

**Goal**: Collect basic metrics and validate dashboard rendering.

```bash
# Stable metric injection (20 data points, ~1 minute interval)
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable

# Validate metric response
curl -s http://localhost:3002/api/metrics | jq '{
  l2Block: .metrics.blockHeight,
  cpu: .metrics.cpuUsage,
  txPool: .metrics.txPoolCount,
  components: [.components[]?.name],
  cost: .cost.opGethMonthlyCost
}'
```

**Expected results**:
- CPU: 15~25%
- TxPool: 10~30
- Displays 4 components (L2 Client, Consensus Node, Batcher, Proposer)
- Cost calculated based on current vCPU

**Dashboard**: Open browser — blocks increase, CPU gauge stable, green status indicator displayed.

---

## Demo 2: Anomaly Detection Pipeline

**Goal**: Trigger and observe a layer 4+ detection pipeline.

### Step 1 — Establish a baseline

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
```

### Step 2 — Spike Injection

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
```

### Step 3 — Detection Trigger (Metric Polling)

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[] | {metric, zScore, direction, description}],
  activeEventId: .activeAnomalyEventId
}'
```

**Expected results**:
- `anomalyCount`: 1 or more (cpuUsage, txPoolPending or gasUsedRatio)
- `zScore`: > 2.5
- `activeEventId`: UUID string

### Step 4 — Check abnormal event history

```bash
curl -s http://localhost:3002/api/anomalies | jq '{
  total: .total,
  activeCount: .activeCount,
  latestEvent: .events[0] | {id, status, anomalyCount: (.anomalies | length), hasDeepAnalysis: (.deepAnalysis != null)}
}'
```

**Expected results** (if AI Key is enabled):
- `hasDeepAnalysis`: true (Layer 2 AI analysis completed)
- `status`: "active"

### Step 5 — Verify notification settings

```bash
curl -s http://localhost:3002/api/anomalies/config | jq '.'
```

**Dashboard**: Anomaly monitor panel displays detected anomalies and severity indicators.

---

## Demo 3: Predictive Scaling

**Goal**: Demonstrate AI-based scaling predictions and recommendations.

### Step 1 — Inject rising load pattern

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising
```

### Step 2 — Check predictions

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

**Expected results**:
- `metricsCount` >= 10 (from seed injection)
- `trend`: "increasing"
- `predictedVcpu`: 2 or 4
- `confidence`: 60~95%

### Step 3 — Repeat with spikes to increase scale-up confidence

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/scaler | jq '.prediction | {predictedVcpu, confidence, recommendedAction}'
```

**Dashboard**: Scaling prediction panel displays predicted vCPUs, trend direction, and confidence level.

---

## Demo 4: NLOps Chat Interface

**Goal**: Demonstrate natural language operational control.

### Safe queries (no confirmation required)

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
# Scaling request — return confirmation prompt
curl -sX POST http://localhost:3002/api/nlops \
  -H "Content-Type: application/json" \
  -d '{"message": "Scale to 4 vCPU"}' | jq '{intent, needsConfirmation, confirmationMessage}'
```

**Expected results**:
- `intent`: "scale"
- `needsConfirmation`: true
- `confirmationMessage`: Description of action to confirm

**Dashboard**: Click the chat toggle (bottom right), enter commands, and confirm/cancel dangerous actions.

---

## Demo 5: Cost Optimization

**Goal**: Track costs and display AI-based optimization recommendations.

```bash
# Inject usage data
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=stable
sleep 1
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=rising

# View cost report
curl -s http://localhost:3002/api/cost-report | jq '{
  currentCost: .currentMonthlyCost,
  optimizedCost: .optimizedMonthlyCost,
  savingsPercent: .savingsPercent,
  recommendations: [.recommendations[]? | .title]
}'
```

**Expected results**:
- Cost calculated based on Fargate Seoul price
- Savings compared to fixed 4 vCPU baseline
- AI recommendations (if AI key is set)

---

## Demo 6: Root Cause Analysis (RCA)

**Goal**: Demonstrate dependency graph exploration and failure propagation analysis.

### Step 1 — Abnormal Injection

```bash
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike
sleep 2
curl -s http://localhost:3002/api/metrics > /dev/null # trigger detection
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

**Expected results**:
- `rootCause`: Identified component (e.g. "op-geth resource exhaustion")
- `affectedComponents`: dependency chain (op-geth → op-node → ...)
- `remediationAdvice`: actionable steps

---

## Demo 7: Automatic self-healing engine

**Goal**: Verify playbook matching, safety gates, and self-healing execution.

### Step 1 — Check self-recovery status

```bash
curl -s http://localhost:3002/api/remediation | jq '{
  enabled: .config.enabled,
  circuitBreakers: .circuitBreakers,
  recentExecutions: (.recentExecutions | length)
}'
```

### Step 2 — Activation and Trigger (Simulation Mode)

```bash
# Enable automatic self-recovery
curl -sX PATCH http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Trigger the playbook manually
curl -sX POST http://localhost:3002/api/remediation \
  -H "Content-Type: application/json" \
  -d '{"playbookName": "op-geth-resource-exhaustion"}' | jq '{
  status: .status,
  playbook: .playbook,
  actionsExecuted: .actionsExecuted,
  escalationLevel: .escalationLevel
}'
```

**Expected results** (simulation mode):
- `status`: "completed" 또는 "simulated"
- Actions are logged but not executed on actual K8s

---

## Demo 8: Agent Loop (Autonomous Operation)

**Goal**: Verify server-side autonomous observation-detection-decision-execution cycle.

### Verify agent loop execution

```bash
# Check scheduler status
curl -s http://localhost:3002/api/health

# Watch agent loop log on server console (every 30 seconds):
# [AgentLoop] Cycle complete — score: 15.2, target: 1 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### Autonomous scaling trigger

```bash
# 1. Enable autoscaling
curl -sX PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true}'

#2. High load injection
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=spike

# 3. Wait for next agent cycle (~30 seconds), check scaling status
sleep 35
curl -s http://localhost:3002/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  simulationMode: .simulationMode,
  lastScaling: .lastScalingTime
}'
```

**Expected results**: Increase `currentVcpu` (state update in simulation mode, no actual K8s patch).

---

## Demo 9: Full Pipeline (End-to-End)

**Goal**: Execute a complete pipeline of normal → abnormal → detection → scaling → self-healing → recovery.

```bash
#!/bin/bash
BASE=http://localhost:3002

echo "=== Phase 1: Baseline ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
sleep 2

echo "=== Phase 2: Increase load ==="
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

echo "=== Phase 6: Self-Recovery ==="
curl -s $BASE/api/remediation | jq '{executions: (.recentExecutions | length)}'

echo "=== Phase 7: Recovery ==="
curl -sX POST $BASE/api/metrics/seed?scenario=falling
sleep 2
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'

echo "=== Phase 8: Stability ==="
curl -sX POST $BASE/api/metrics/seed?scenario=stable
curl -s $BASE/api/metrics | jq '{cpu: .metrics.cpuUsage, anomalies: (.anomalies | length)}'
echo "=== completed ==="
```

**Expected flow**:
1. Baseline: CPU ~20%, 0 above
2. Rising: predicted trend “increasing”
3. Spike: Anomaly detection (cpuUsage, txPoolPending)
4. Scaling: Predicted vCPU increase
5. RCA: Root cause identified
6. Self-healing: Playbook matched (if enabled)
7. Descent: Troubleshooting
8. Stability: Return to normal state, 0 abnormalities

---

## Demo 10: Stress Mode (Dashboard UI)

**Goal**: Visual demonstration of high load conditions without physical infrastructure.

1. Open `http://localhost:3002`
2. Click the **STRESS MODE** toggle (top)
3. Observation:
- CPU jumps to 96.5%
- Shows vCPU 8 (maximum scale)
- Component displays “Scaling Up” status
- Cost reflects 8 vCPU Fargate price
4. Click the toggle again to return to normal

---

## Automated test commands

| command | range | Running time |
|--------|------|----------|
| `npm run test:run` | 559 unit tests | ~1 second |
| `npm run test:coverage` | Unit Tests + Coverage Reports | ~3 seconds |
| `npm run verify` | All 6 Steps E2E | 5-10 minutes |
| `npm run lint` | Check ESLint | ~5 seconds |

---

## See Seed scenario

| Scenario | CPU range | TxPool | point | Use cases |
|---------|---------|--------|--------|----------|
| `stable` | 15-25% | 10~30 | 20 | Baseline, normal operation |
| `rising` | 15→50% | 10→80 | 20 | Predictive Scaling Demo |
| `spike` | ~95% | 5000+ | 20 | Anomaly Detection Demo |
| `falling` | 80→20% | Declining | 20 | Recovery Demo |
| `live` | Real-time data | Real-time data | change | Production-like (requires cumulative data) |

```bash
# Inject all scenarios
curl -sX POST http://localhost:3002/api/metrics/seed?scenario=<name>
```

---

## Production Cluster Testing

The seed API is not available in production (`NODE_ENV=production`). For real-world K8s scaling verification using real-time load injection, see:

**[Production Load Testing Guide](./production-load-testing-guide.md)**
