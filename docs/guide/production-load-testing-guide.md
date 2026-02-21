# Production Load Testing & Scaling Verification Guide

Real-world load injection guide to verify autonomous scaling of SentinAI on a live K8s cluster.

---

## Why can't I use the Seed API?

The seed API (`POST /api/metrics/seed`) is not available on production clusters:

1. **Blocked from production** — returns `405` when `NODE_ENV=production`
2. **Agent loop overwrites** — Every 30 seconds, the agent loop collects actual RPC metrics and replaces the injected data.
3. **Scaling uses real-time data** — Decision engine evaluates real-time metrics rather than stored seed data

**Solution**: Generate real L2 load, which naturally increases CPU, gas, and txPool metrics.

---

## Prerequisites

### Cluster access

```bash
# kubectl context verification
kubectl config current-context
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia

# Check SentinAI execution
curl -s http://<SENTINAI_HOST>:3002/api/health
```

### Wallet Settings

You will need an L2 wallet with testnet ETH to send transactions.

```bash
# Install Foundry (if not installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Check balance on L2
cast balance <YOUR_WALLET_ADDRESS> --rpc-url $L2_RPC_URL
```

### Preferences

You should have the following entry in `.env.local`:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-...

# IMPORTANT: You need to set these for actual scaling
SCALING_SIMULATION_MODE=false # Allow real K8s patches
AGENT_LOOP_ENABLED=true # Server-side autonomous loop
```

---

## Step 0: Pre-check

Verifies current status before load injection.

```bash
BASE=http://localhost:3002

# 1. Current scaling status
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  autoScaling: .autoScalingEnabled,
  simulationMode: .simulationMode,
  cooldown: .cooldownRemaining
}'

# 2. Agent loop state
curl -s $BASE/api/health

# 3. Verify Pod resource status
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
```

**Expected results**: `currentVcpu: 1`, `autoScaling: true`, `simulationMode: false`

### Enable autoscaling (if disabled)

```bash
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true, "simulationMode": false}'
```

---

## Step 1: Understand scaling triggers

The agent loop evaluates the **Hybrid Score (0–100)** every 30 seconds:

| element | weight | score calculation | maximum value |
|------|--------|-----------|--------|
| CPU utilization | 30% | `cpuUsage` (0–100%) | 100 |
| gas rate | 30% | `gasUsedRatio` × 100 | 100 |
| Waiting for TxPool | 20% | `txPoolPending / 200` × 100 | 100 |
| AI Severity | 20% | Severity Mapping | 100 |

**Scaling Threshold:**

| Score range | Target vCPU | label |
|-----------|---------|--------|
| 0 – 29 | 1 vCPU | Idle |
| 30 – 69 | 2 vCPU | Normal |
| 70 – 100 | 4 vCPU | High |

**Key Insight**: Scaling from 1 → 2 vCPU requires a hybrid score ≥ 30. Requires ≥ 70 to reach 4 vCPU.

### Score example

| Scenario | CPU | gas | TxPool | AI | score | target |
|---------|-----|------|--------|---|--------|------|
| Idle | 10% | 0.1 | 5 | — | 10×0.3 + 10×0.3 + 2.5×0.2 = 6.5 | 1 vCPU |
| Moderate | 50% | 0.5 | 100 | — | 50×0.3 + 50×0.3 + 50×0.2 = 40 | 2 vCPU |
| Heavy | 80% | 0.8 | 200 | high | 80×0.3 + 80×0.3 + 100×0.2 + 66×0.2 = 81.2 | 4 vCPU |

---

## Step 2: Actual load injection

### Method A: Burst transaction with `cast` (simplest)

Sending many transactions quickly to fill the txPool and increase gas usage.

```bash
#!/bin/bash
# load-burst.sh — Send burst transactions to L2
RPC_URL="${L2_RPC_URL}"
PRIVATE_KEY="${LOAD_TEST_PRIVATE_KEY}"
TO_ADDRESS="0x000000000000000000000000000000000000dead"

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
echo "Target: $RPC_URL"

Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
for i in $(seq 1 200); do
  cast send $TO_ADDRESS \
    --value 0.00001ether \
    --private-key $PRIVATE_KEY \
    --rpc-url $RPC_URL \
    --async \
    2>/dev/null &

# Place 20 each
  if (( i % 20 == 0 )); then
    wait
echo "Send: $i / 200 transactions"
  fi
done
wait
echo "=== Burst completed ==="
```

**How ​​it works**: 200+ pending transactions → txPoolScore = 100 → 20 points contributed. → Expansion uptrigger with gas usage from processing.

### Method B: Continuous load with `viem` script

Write Node.js scripts for persistent, composable loading.

```typescript
// scripts/load-test.ts
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimismSepolia } from 'viem/chains'; // or L2 chain

const RPC_URL = process.env.L2_RPC_URL!;
const PRIVATE_KEY = process.env.LOAD_TEST_PRIVATE_KEY as `0x${string}`;
const TARGET = '0x000000000000000000000000000000000000dead' as const;

// setting
const TPS = 10;          // transactions per second
const DURATION_SEC = 120; // 2 minutes of sustained load
const VALUE = parseEther('0.00001');

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });

  let nonce = await publicClient.getTransactionCount({ address: account.address });
  let sent = 0;
  const startTime = Date.now();

console.log(`Start sustained load: ${TPS} TPS for ${DURATION_SEC}s`);

  const interval = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed >= DURATION_SEC) {
      clearInterval(interval);
console.log(`\nCompleted: ${sent} transaction in ${elapsed.toFixed(0)}s`);
      return;
    }

// batch transfer
    const promises = [];
    for (let i = 0; i < TPS; i++) {
      promises.push(
        client.sendTransaction({
          to: TARGET,
          value: VALUE,
          nonce: nonce++,
}).catch(() => {}) // Ignore individual failures
      );
    }
    await Promise.allSettled(promises);
    sent += TPS;
process.stdout.write(`\r  전송: ${sent} txs | 경과: ${elapsed.toFixed(0)}s`);
  }, 1000);
}

main().catch(console.error);
```

```bash
# Run as ts-node or tsx
npx tsx scripts/load-test.ts
```

### Method C: Heavy computation (gas maximization)

Deploy a contract that performs heavy calculations to maximize `gasUsedRatio`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract GasBurner {
    uint256 public counter;

// consumes approximately `iterations * 20000` gas
    function burn(uint256 iterations) external {
        for (uint256 i = 0; i < iterations; i++) {
            counter = uint256(keccak256(abi.encodePacked(counter, i, block.timestamp)));
        }
    }
}
```

```bash
# distribution
forge create GasBurner --rpc-url $L2_RPC_URL --private-key $LOAD_TEST_PRIVATE_KEY

# Repeated calls to burn() (high gas consumption)
CONTRACT=<deployed_address>
for i in $(seq 1 50); do
  cast send $CONTRACT "burn(uint256)" 500 \
    --rpc-url $L2_RPC_URL \
    --private-key $LOAD_TEST_PRIVATE_KEY \
    --async &
done
wait
```

---

## Step 3: Monitor agent loop responses

Once the load is injected, the agent loop should detect the change within 30 to 60 seconds.

### Server log monitoring

```bash
# If running locally
npm run dev 2>&1 | grep -E '\[AgentLoop\]|\[Detection\]'

# Expected log progress:
# [AgentLoop] Cycle complete — score: 45.2, target: 2 vCPU
# [AgentLoop] Predictive override: 1 → 2 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### Polling the Scaler API

```bash
# Run in a loop every 10 seconds
while true; do
  echo "--- $(date +%H:%M:%S) ---"
  curl -s $BASE/api/scaler | jq '{
    vcpu: .currentVcpu,
    autoScaling: .autoScalingEnabled,
    simulation: .simulationMode,
    cooldown: .cooldownRemaining,
    prediction: (if .prediction then {
      trend: .prediction.trend,
      predicted: .prediction.predictedVcpu,
      confidence: .prediction.confidence,
      action: .prediction.recommendedAction
    } else "waiting for data" end)
  }'
  sleep 10
done
```

### Metric + anomaly polling

```bash
curl -s $BASE/api/metrics | jq '{
  cpu: .metrics.cpuUsage,
  gas: .metrics.gasUsedRatio,
  txPool: .metrics.txPoolCount,
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[]? | {metric, zScore: (.zScore | . * 100 | round / 100)}]
}'
```

---

## Step 4: Verify actual K8s scaling

After the agent loop triggers scaling, it verifies that the StatefulSet has been patched.

```bash
# Check StatefulSet resources
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq .

# Expected after expansion:
# {
#   "limits": { "cpu": "2", "memory": "4Gi" },
#   "requests": { "cpu": "2", "memory": "4Gi" }
# }

# Monitor Pod Rollout
kubectl rollout status statefulset/sepolia-thanos-stack-op-geth -n thanos-sepolia

# Check Pod status
kubectl get pods -n thanos-sepolia -l app=op-geth -o wide
```

### Verification via SentinAI API

```bash
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastScaling: .lastScalingTime,
  history: [.history[]? | {time: .timestamp, from: .fromVcpu, to: .toVcpu, trigger: .triggeredBy}]
}'
```

---

## Step 5: Extension Down Verification (Recovery)

After the load is interrupted, the system must scale down after a cooldown period (300 seconds).

```bash
# 1. Stop load injection (exit script)

# 2. Wait for cooldown (5 minutes)
echo "Waiting for 5 minutes cooldown..."
sleep 300

# 3. Check — agent loop should detect low load and scale back
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastDecision: .lastDecision | {score, reason, targetVcpu}
}'

# 4. Verify K8s status
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
# Expected: "1" (collapsed)
```

---

## Step 6: Complete E2E Verification Script

Automation script to run the entire flow:

```bash
#!/bin/bash
# scripts/verify-scaling-e2e.sh
set -euo pipefail

BASE="${SENTINAI_URL:-http://localhost:3002}"
RPC_URL="${L2_RPC_URL:?L2_RPC_URL required}"
PRIVATE_KEY="${LOAD_TEST_PRIVATE_KEY:?LOAD_TEST_PRIVATE_KEY required}"
TO="0x000000000000000000000000000000000000dead"

echo "========================================="
echo " SentinAI Scaling E2E Verification"
echo "========================================="

# Phase 0: Pre-inspection
echo ""
echo "=== Phase 0: Pre-check ==="
STATE=$(curl -s $BASE/api/scaler)
VCPU=$(echo $STATE | jq -r '.currentVcpu')
SIM=$(echo $STATE | jq -r '.simulationMode')
AUTO=$(echo $STATE | jq -r '.autoScalingEnabled')

echo "Current vCPU: $VCPU"
echo " Simulation: $SIM"
echo "Autoscaling: $AUTO"

if [ "$SIM" = "true" ]; then
echo " [!] Simulation mode on. Activating real mode..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"simulationMode": false, "autoScalingEnabled": true}' > /dev/null
echo " [OK] Real mode enabled"
fi

if [ "$AUTO" = "false" ]; then
echo " [!] Autoscaling disabled. Enabling..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"autoScalingEnabled": true}' > /dev/null
echo " [OK] Autoscaling enabled"
fi

INITIAL_VCPU=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
echo "Initial vCPU: $INITIAL_VCPU"

# Phase 1: Load injection
echo ""
echo "=== Phase 1: Load Injection (200 transactions) ==="
for i in $(seq 1 200); do
  cast send $TO --value 0.00001ether --private-key $PRIVATE_KEY --rpc-url $RPC_URL --async 2>/dev/null &
  if (( i % 50 == 0 )); then
    wait
echo "Send: $i / 200"
  fi
done
wait
echo " [OK] Load injection complete"

# Phase 2: Wait for agent loop
echo ""
echo "=== Phase 2: Wait for agent loop (maximum 120 seconds) ==="
TIMEOUT=120
ELAPSED=0
SCALED=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  CURRENT=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
  echo "  [$ELAPSED s] vCPU: $CURRENT"

  if [ "$CURRENT" != "$INITIAL_VCPU" ]; then
echo " [OK] Extension up detected: $INITIAL_VCPU → $CURRENT vCPU"
    SCALED=true
    break
  fi
done

if [ "$SCALED" = "false" ]; then
echo " [FAIL] No scaling within ${TIMEOUT} seconds"
echo "Check server log: grep '[AgentLoop]' in console output"
  exit 1
fi

# Phase 3: K8s patch verification
echo ""
echo "=== Phase 3: K8s StatefulSet Verification ==="
K8S_CPU=$(kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || echo "unknown")
echo "K8s CPU request: $K8S_CPU"

ROLLOUT=$(kubectl rollout status statefulset/sepolia-thanos-stack-op-geth \
  -n thanos-sepolia --timeout=120s 2>&1 || echo "timeout")
echo "Rollout: $ROLLOUT"

# Phase 4: Confirmation of anomaly detection
echo ""
echo "=== Phase 4: Anomaly detection status ==="
curl -s $BASE/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[]? | {metric, zScore: (.zScore * 100 | round / 100)}]
}'

# Phase 5: Summary
echo ""
echo "========================================="
echo "Result"
echo "========================================="
FINAL_STATE=$(curl -s $BASE/api/scaler)
echo "Initial vCPU: $INITIAL_VCPU"
echo "  최종 vCPU:    $(echo $FINAL_STATE | jq -r '.currentVcpu')"
echo " Last scaling: $(echo $FINAL_STATE | jq -r '.lastScalingTime')"
echo " simulation: $(echo $FINAL_STATE | jq -r '.simulationMode')"
echo ""
echo "To verify scale down: wait 5 minutes and recheck vCPU"
echo "========================================="
```

```bash
chmod +x scripts/verify-scaling-e2e.sh
SENTINAI_URL=http://localhost:3002 \
  L2_RPC_URL=https://your-rpc.com \
  LOAD_TEST_PRIVATE_KEY=0xabc... \
  bash scripts/verify-scaling-e2e.sh
```

---

## Safety & Rollback

### Emergency rollback

```bash
# 1. Disable autoscaling on the fly
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": false}'

# 2. Re-enable simulation mode
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": true}'

#3. Manual K8s rollback (if necessary)
kubectl patch statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  --type='json' -p='[
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"2Gi"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"2Gi"}
  ]'
```

### Safety Checklist

| Item | OK |
|------|------|
| Load test wallet has limited funds | Avoiding accidental cost overruns |
| `maxVcpu: 4` scaling settings | Prevent unlimited expansion-ups |
| Cooldown: 300 seconds | Prevent rapid vibration |
| K8s resource quota set | Cluster-level protection |
| Monitoring enabled | Watching `kubectl top pods` during testing |

### Cost recognition

| vCPU | memory | Fargate Cost (Seoul) |
|------|--------|---------------------|
| 1 | 2 GiB | $0.057/hour |
| 2 | 4 GiB | $0.114/hour |
| 4 | 8 GiB | $0.227/hour |

Scaling from 1 → 4 vCPU increases the cost per hour by ~4x. Make sure the extension download is verified.

---

## Troubleshooting

### Scaling is not triggered

```bash
# Check hybrid score calculation
curl -s $BASE/api/scaler | jq '.lastDecision | {score, reason, breakdown}'
```

- **Score < 30**: Insufficient load. Increase transaction volume.
- **Score ≥ 30 but no scaling**: Check `autoScalingEnabled`, `simulationMode` and cooldown.

### Agent loop does not run

```bash
# Check cron initialization in server log
# 찾기: [Scheduler] Agent loop started (every 30s)

# Environment verification
echo $AGENT_LOOP_ENABLED # Must be "true" or L2_RPC_URL must be set
```

### K8s patch failed

```bash
# Test kubectl access manually
kubectl auth can-i patch statefulsets -n thanos-sepolia

# RBAC check
kubectl get clusterrolebinding | grep sentinai
```

### Transaction failed

```bash
# Check wallet balance
cast balance $WALLET_ADDRESS --rpc-url $L2_RPC_URL

#Check Nonce
cast nonce $WALLET_ADDRESS --rpc-url $L2_RPC_URL

# Check chain ID
cast chain-id --rpc-url $L2_RPC_URL
```
