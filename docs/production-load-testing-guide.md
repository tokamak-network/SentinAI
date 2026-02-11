# Production Load Testing & Scaling Verification Guide

Real load injection guide for verifying SentinAI's autonomous scaling on a live K8s cluster.

---

## Why Not Seed API?

The seed API (`POST /api/metrics/seed`) cannot be used on production clusters:

1. **Blocked in production** — Returns `405` when `NODE_ENV=production`
2. **Agent loop overwrites** — Every 30 seconds, the agent loop collects real RPC metrics, replacing any injected data
3. **Scaling uses live data** — The decision engine evaluates real-time metrics, not stored seed data

**Solution**: Generate real L2 load to naturally increase CPU, gas, and txPool metrics.

---

## Prerequisites

### Cluster Access

```bash
# Verify kubectl context
kubectl config current-context
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia

# Verify SentinAI is running
curl -s http://<SENTINAI_HOST>:3002/api/health
```

### Wallet Setup

You need an L2 wallet with testnet ETH for sending transactions.

```bash
# Install foundry (if not installed)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Check balance on L2
cast balance <YOUR_WALLET_ADDRESS> --rpc-url $L2_RPC_URL
```

### Environment Configuration

Ensure your `.env.local` has:

```bash
L2_RPC_URL=https://your-l2-rpc-endpoint.com
ANTHROPIC_API_KEY=sk-ant-...

# CRITICAL: These must be set for real scaling
SCALING_SIMULATION_MODE=false    # Allow real K8s patches
AGENT_LOOP_ENABLED=true          # Server-side autonomous loop
```

---

## Step 0: Pre-Flight Check

Verify current state before injecting load.

```bash
BASE=http://localhost:3002

# 1. Current scaling state
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  autoScaling: .autoScalingEnabled,
  simulationMode: .simulationMode,
  cooldown: .cooldownRemaining
}'

# 2. Agent loop status
curl -s $BASE/api/health

# 3. Verify pod resource state
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
```

**Expected**: `currentVcpu: 1`, `autoScaling: true`, `simulationMode: false`

### Enable Auto-Scaling (if disabled)

```bash
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": true, "simulationMode": false}'
```

---

## Step 1: Understand Scaling Triggers

The agent loop evaluates a **hybrid score (0–100)** every 30 seconds:

| Factor | Weight | Score Calculation | Max |
|--------|--------|-------------------|-----|
| CPU Usage | 30% | `cpuUsage` (0–100%) | 100 |
| Gas Ratio | 30% | `gasUsedRatio` × 100 | 100 |
| TxPool Pending | 20% | `txPoolPending / 200` × 100 | 100 |
| AI Severity | 20% | severity mapping | 100 |

**Scaling thresholds:**

| Score Range | Target vCPU | Label |
|-------------|-------------|-------|
| 0 – 29 | 1 vCPU | Idle |
| 30 – 69 | 2 vCPU | Normal |
| 70 – 100 | 4 vCPU | High |

**Key insight**: To trigger a scale-up from 1 → 2 vCPU, you need a hybrid score ≥ 30. To reach 4 vCPU, you need ≥ 70.

### Score Examples

| Scenario | CPU | Gas | TxPool | AI | Score | Target |
|----------|-----|-----|--------|----|----|--------|
| Idle | 10% | 0.1 | 5 | — | 10×0.3 + 10×0.3 + 2.5×0.2 = 6.5 | 1 vCPU |
| Moderate | 50% | 0.5 | 100 | — | 50×0.3 + 50×0.3 + 50×0.2 = 40 | 2 vCPU |
| Heavy | 80% | 0.8 | 200 | high | 80×0.3 + 80×0.3 + 100×0.2 + 66×0.2 = 81.2 | 4 vCPU |

---

## Step 2: Inject Real Load

### Method A: Burst Transactions with `cast` (Simplest)

Send many transactions rapidly to fill the txPool and increase gas usage.

```bash
#!/bin/bash
# load-burst.sh — Send burst transactions to L2
RPC_URL="${L2_RPC_URL}"
PRIVATE_KEY="${LOAD_TEST_PRIVATE_KEY}"
TO_ADDRESS="0x000000000000000000000000000000000000dead"

echo "=== Starting burst load test ==="
echo "Target: $RPC_URL"

# Send 200 transactions (fills txPool to trigger scaling)
for i in $(seq 1 200); do
  cast send $TO_ADDRESS \
    --value 0.00001ether \
    --private-key $PRIVATE_KEY \
    --rpc-url $RPC_URL \
    --async \
    2>/dev/null &

  # Batch 20 at a time
  if (( i % 20 == 0 )); then
    wait
    echo "Sent $i / 200 transactions"
  fi
done
wait
echo "=== Burst complete ==="
```

**Why this works**: 200+ pending transactions → txPoolScore = 100 → contributes 20 points. Combined with gas usage from processing → triggers scale-up.

### Method B: Sustained Load with `viem` Script

Create a Node.js script for sustained, configurable load.

```typescript
// scripts/load-test.ts
import { createWalletClient, createPublicClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { optimismSepolia } from 'viem/chains'; // or your L2 chain

const RPC_URL = process.env.L2_RPC_URL!;
const PRIVATE_KEY = process.env.LOAD_TEST_PRIVATE_KEY as `0x${string}`;
const TARGET = '0x000000000000000000000000000000000000dead' as const;

// Configuration
const TPS = 10;          // Transactions per second
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

  console.log(`Starting sustained load: ${TPS} TPS for ${DURATION_SEC}s`);

  const interval = setInterval(async () => {
    const elapsed = (Date.now() - startTime) / 1000;
    if (elapsed >= DURATION_SEC) {
      clearInterval(interval);
      console.log(`\nComplete: ${sent} transactions in ${elapsed.toFixed(0)}s`);
      return;
    }

    // Send batch
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
    process.stdout.write(`\r  Sent: ${sent} txs | Elapsed: ${elapsed.toFixed(0)}s`);
  }, 1000);
}

main().catch(console.error);
```

```bash
# Run with ts-node or tsx
npx tsx scripts/load-test.ts
```

### Method C: Heavy Computation (Maximize Gas)

Deploy a contract that performs heavy computation to maximize `gasUsedRatio`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract GasBurner {
    uint256 public counter;

    // Burns approximately `iterations * 20000` gas
    function burn(uint256 iterations) external {
        for (uint256 i = 0; i < iterations; i++) {
            counter = uint256(keccak256(abi.encodePacked(counter, i, block.timestamp)));
        }
    }
}
```

```bash
# Deploy
forge create GasBurner --rpc-url $L2_RPC_URL --private-key $LOAD_TEST_PRIVATE_KEY

# Call burn() repeatedly (high gas consumption)
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

## Step 3: Monitor Agent Loop Response

Once load is injected, the agent loop should detect the change within 30–60 seconds.

### Watch Server Logs

```bash
# If running locally
npm run dev 2>&1 | grep -E '\[AgentLoop\]|\[Detection\]'

# Expected log progression:
# [AgentLoop] Cycle complete — score: 45.2, target: 2 vCPU
# [AgentLoop] Predictive override: 1 → 2 vCPU
# [AgentLoop] Scaling executed: 1 → 2 vCPU
```

### Poll Scaler API

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

### Poll Metrics + Anomalies

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

## Step 4: Verify Actual K8s Scaling

After the agent loop triggers scaling, verify the StatefulSet was patched.

```bash
# Check StatefulSet resources
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources}' | jq .

# Expected after scale-up:
# {
#   "limits": { "cpu": "2", "memory": "4Gi" },
#   "requests": { "cpu": "2", "memory": "4Gi" }
# }

# Watch pod rollout
kubectl rollout status statefulset/sepolia-thanos-stack-op-geth -n thanos-sepolia

# Check pod status
kubectl get pods -n thanos-sepolia -l app=op-geth -o wide
```

### Verify via SentinAI API

```bash
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastScaling: .lastScalingTime,
  history: [.history[]? | {time: .timestamp, from: .fromVcpu, to: .toVcpu, trigger: .triggeredBy}]
}'
```

---

## Step 5: Verify Scale-Down (Recovery)

After load stops, the system should scale down after the cooldown period (300 seconds).

```bash
# 1. Stop load injection (kill the script)

# 2. Wait for cooldown (5 minutes)
echo "Waiting 5 minutes for cooldown..."
sleep 300

# 3. Check — agent loop should detect low load and scale down
curl -s $BASE/api/scaler | jq '{
  currentVcpu: .currentVcpu,
  lastDecision: .lastDecision | {score, reason, targetVcpu}
}'

# 4. Verify K8s state
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}'
echo ""
# Expected: "1" (scaled back down)
```

---

## Step 6: Full E2E Verification Script

Automated script that runs the entire flow:

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

# Phase 0: Pre-flight
echo ""
echo "=== Phase 0: Pre-flight ==="
STATE=$(curl -s $BASE/api/scaler)
VCPU=$(echo $STATE | jq -r '.currentVcpu')
SIM=$(echo $STATE | jq -r '.simulationMode')
AUTO=$(echo $STATE | jq -r '.autoScalingEnabled')

echo "  Current vCPU: $VCPU"
echo "  Simulation:   $SIM"
echo "  Auto-scaling: $AUTO"

if [ "$SIM" = "true" ]; then
  echo "  [!] Simulation mode is ON. Enabling real mode..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"simulationMode": false, "autoScalingEnabled": true}' > /dev/null
  echo "  [OK] Real mode enabled"
fi

if [ "$AUTO" = "false" ]; then
  echo "  [!] Auto-scaling disabled. Enabling..."
  curl -sX PATCH $BASE/api/scaler \
    -H "Content-Type: application/json" \
    -d '{"autoScalingEnabled": true}' > /dev/null
  echo "  [OK] Auto-scaling enabled"
fi

INITIAL_VCPU=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
echo "  Initial vCPU: $INITIAL_VCPU"

# Phase 1: Inject load
echo ""
echo "=== Phase 1: Injecting load (200 transactions) ==="
for i in $(seq 1 200); do
  cast send $TO --value 0.00001ether --private-key $PRIVATE_KEY --rpc-url $RPC_URL --async 2>/dev/null &
  if (( i % 50 == 0 )); then
    wait
    echo "  Sent $i / 200"
  fi
done
wait
echo "  [OK] Load injection complete"

# Phase 2: Wait for agent loop detection
echo ""
echo "=== Phase 2: Waiting for agent loop (max 120s) ==="
TIMEOUT=120
ELAPSED=0
SCALED=false

while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 10
  ELAPSED=$((ELAPSED + 10))
  CURRENT=$(curl -s $BASE/api/scaler | jq -r '.currentVcpu')
  echo "  [$ELAPSED s] vCPU: $CURRENT"

  if [ "$CURRENT" != "$INITIAL_VCPU" ]; then
    echo "  [OK] Scale-up detected: $INITIAL_VCPU → $CURRENT vCPU"
    SCALED=true
    break
  fi
done

if [ "$SCALED" = "false" ]; then
  echo "  [FAIL] No scaling occurred within ${TIMEOUT}s"
  echo "  Check server logs: grep '[AgentLoop]' in console output"
  exit 1
fi

# Phase 3: Verify K8s patch
echo ""
echo "=== Phase 3: Verifying K8s StatefulSet ==="
K8S_CPU=$(kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.template.spec.containers[0].resources.requests.cpu}' 2>/dev/null || echo "unknown")
echo "  K8s CPU request: $K8S_CPU"

ROLLOUT=$(kubectl rollout status statefulset/sepolia-thanos-stack-op-geth \
  -n thanos-sepolia --timeout=120s 2>&1 || echo "timeout")
echo "  Rollout: $ROLLOUT"

# Phase 4: Check anomaly detection
echo ""
echo "=== Phase 4: Anomaly Detection Status ==="
curl -s $BASE/api/metrics | jq '{
  anomalyCount: (.anomalies | length),
  anomalies: [.anomalies[]? | {metric, zScore: (.zScore * 100 | round / 100)}]
}'

# Phase 5: Summary
echo ""
echo "========================================="
echo " Results"
echo "========================================="
FINAL_STATE=$(curl -s $BASE/api/scaler)
echo "  Initial vCPU:  $INITIAL_VCPU"
echo "  Final vCPU:    $(echo $FINAL_STATE | jq -r '.currentVcpu')"
echo "  Last scaling:  $(echo $FINAL_STATE | jq -r '.lastScalingTime')"
echo "  Simulation:    $(echo $FINAL_STATE | jq -r '.simulationMode')"
echo ""
echo "  To verify scale-down: wait 5 min, then re-check vCPU"
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

### Emergency Rollback

```bash
# 1. Disable auto-scaling immediately
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"autoScalingEnabled": false}'

# 2. Re-enable simulation mode
curl -sX PATCH $BASE/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": true}'

# 3. Manual K8s rollback (if needed)
kubectl patch statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  --type='json' -p='[
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/requests/memory","value":"2Gi"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/cpu","value":"1"},
    {"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"2Gi"}
  ]'
```

### Safety Checklist

| Item | Check |
|------|-------|
| Load test wallet has limited funds | Prevents accidental cost overrun |
| `maxVcpu: 4` in scaling config | Prevents unbounded scale-up |
| Cooldown: 300 seconds | Prevents rapid oscillation |
| K8s resource quotas set | Cluster-level protection |
| Monitoring active | Watch `kubectl top pods` during test |

### Cost Awareness

| vCPU | Memory | Fargate Cost (Seoul) |
|------|--------|---------------------|
| 1 | 2 GiB | $0.057/hour |
| 2 | 4 GiB | $0.114/hour |
| 4 | 8 GiB | $0.227/hour |

Scale-up from 1 → 4 vCPU increases hourly cost by ~4×. Ensure scale-down is verified.

---

## Troubleshooting

### Scaling not triggered

```bash
# Check hybrid score calculation
curl -s $BASE/api/scaler | jq '.lastDecision | {score, reason, breakdown}'
```

- **Score < 30**: Load not high enough. Increase transaction volume.
- **Score ≥ 30 but no scaling**: Check `autoScalingEnabled`, `simulationMode`, and cooldown.

### Agent loop not running

```bash
# Check server logs for cron initialization
# Look for: [Scheduler] Agent loop started (every 30s)

# Verify env
echo $AGENT_LOOP_ENABLED  # Should be "true" or L2_RPC_URL must be set
```

### K8s patch failed

```bash
# Test kubectl access manually
kubectl auth can-i patch statefulsets -n thanos-sepolia

# Check RBAC
kubectl get clusterrolebinding | grep sentinai
```

### Transactions failing

```bash
# Check wallet balance
cast balance $WALLET_ADDRESS --rpc-url $L2_RPC_URL

# Check nonce
cast nonce $WALLET_ADDRESS --rpc-url $L2_RPC_URL

# Check chain ID
cast chain-id --rpc-url $L2_RPC_URL
```
