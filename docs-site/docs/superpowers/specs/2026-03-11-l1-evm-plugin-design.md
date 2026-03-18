# L1 EVM Node Plugin Design

**Date**: 2026-03-11
**Status**: Approved
**Scope**: Standalone L1 EVM node monitoring via new `l1-evm` chain plugin

---

## Problem

SentinAI currently requires an L2 network (`L2_RPC_URL`) to function. There is no mode for monitoring a standalone L1 EVM node (Geth, Reth, Nethermind, Besu). All existing L1 playbooks are embedded within L2 chain plugins and assume L2 components as downstream dependencies.

## Goal

Enable SentinAI to connect to any EVM-compatible L1 node and apply the full monitoring stack — anomaly detection, RCA, auto-remediation, NLOps — without an L2 network.

---

## Architecture

### Approach: New `l1-evm` ChainPlugin

A new `L1EVMPlugin` implements the existing `ChainPlugin` interface. Setting `CHAIN_TYPE=l1-evm` loads this plugin. All existing engine modules (`anomaly-detector`, `rca-engine`, `remediation-engine`, `nlops-engine`) consume the plugin via `getChainPlugin()` and require no changes.

### File Structure

```
[new]     src/chains/l1-evm/
              ├── components.ts     # l1-execution + system, dependency graph
              ├── metrics.ts        # client-adaptive L1 metric collection
              ├── playbooks.ts      # 5 L1-specific playbooks
              ├── prompts.ts        # AI prompts for L1 context
              └── index.ts          # L1EVMPlugin class

[new]     src/lib/l1-node-metrics.ts   # collectL1NodeMetrics()

[modify]  src/chains/types.ts
              nodeLayer: 'l1' | 'l2' | 'both'   (new field)
              l2Chain?: Chain                     (optional)
              expectedL2BlockIntervalSeconds?: number  (optional)

[modify]  src/lib/agent-loop.ts
              branch on chainPlugin.nodeLayer === 'l1'

[modify]  src/app/api/metrics/route.ts
              return L1 metrics when nodeLayer === 'l1'
```

---

## Environment Variables

```bash
CHAIN_TYPE=l1-evm                    # activates L1-only mode
L1_RPC_URL=http://your-node:8545     # monitored L1 node (single endpoint)
L1_CHAIN_ID=1                        # optional; auto-detected via eth_chainId
L1_DEPLOYMENT_TYPE=k8s|docker|external   # controls available remediation actions
K8S_L1_APP_LABEL=geth                # K8s pod label selector for l1-execution
```

`L1_RPC_URLS` (multi-endpoint failover) is not used in L1-only mode — the monitored node is the target, not a source to failover from.

---

## Client Detection and Metric Collection

### Connection Flow

```
L1_RPC_URL
    ↓
detectExecutionClient(url)          # existing client-detector.ts
    ↓
DetectedClient { family: 'geth' | 'reth' | 'nethermind' | 'besu' | ... }
    ↓
collectL1NodeMetrics(url, client, deploymentType)
    - only collects metrics supported by detected client
```

### L1NodeMetrics Interface

```typescript
interface L1NodeMetrics {
  blockHeight: number;
  blockInterval: number;       // seconds since last block
  peerCount: number;
  syncing: boolean;
  syncGap: number;             // highestBlock - currentBlock; 0 if synced
  txPoolPending: number;       // -1 if client does not support txpool namespace
  txPoolQueued: number;        // -1 if unsupported
  baseFee: bigint;             // wei
  cpuUsage: number;            // % (K8s/Docker only; 0 if external)
  memoryPercent: number;       // % (K8s/Docker only; 0 if external)
}
```

### Client Capability Matrix

| Metric | Geth | Reth | Nethermind | Besu |
|--------|------|------|------------|------|
| blockHeight | ✅ | ✅ | ✅ | ✅ |
| blockInterval | ✅ | ✅ | ✅ | ✅ |
| peerCount | ✅ | ✅ | ✅ | ✅ |
| syncStatus / syncGap | ✅ | ✅ | ✅ | ✅ |
| txPoolPending/Queued | ✅ txpool | ✅ txpool | ⚠️ parity | ⚠️ parity |
| baseFeePerGas | ✅ | ✅ | ✅ | ✅ |
| cpuUsage / memoryPercent | K8s/Docker | K8s/Docker | K8s/Docker | K8s/Docker |

---

## Component Topology

```typescript
components = ['l1-execution', 'system']
primaryExecutionClient = 'l1-execution'

dependencyGraph = {
  'l1-execution': { dependsOn: ['system'], feeds: [], criticality: 'critical' },
  'system':       { dependsOn: [],         feeds: ['l1-execution'], criticality: 'high' }
}
```

No L2 components. No downstream consumers. RCA traces faults from `system` → `l1-execution`.

---

## Anomaly Detection

The 4-layer pipeline is unchanged. L1 metrics map to existing `MetricDataPoint` fields:

| L1NodeMetrics field | MetricDataPoint field | Detection method |
|---------------------|-----------------------|-----------------|
| blockHeight | blockHeight | stagnant (plateau rule) |
| blockInterval | blockInterval | Z-Score |
| peerCount | peerCount | == 0 (rule-based) |
| syncGap | syncLag | increasing trend (slope) |
| txPoolPending | txPoolPending | Z-Score > 3.0 |
| baseFee | gasUsedRatio | > guardGwei (rule-based) |
| cpuUsage | cpuUsage | > 90 (rule-based) |
| memoryPercent | memoryPercent | > 85 (rule-based) |

### Agent Loop Branch

```typescript
const isL1Only = chainPlugin.nodeLayer === 'l1';

// Observe phase
const metrics = isL1Only
  ? await collectL1NodeMetrics(L1_RPC_URL, detectedClient, deploymentType)
  : await collectL2Metrics();   // existing path

// Detect / Decide / Act phases: unchanged
```

---

## Playbooks

### L1-Specific Playbooks (new — `src/chains/l1-evm/playbooks.ts`)

| Name | Trigger | Actions | Safety |
|------|---------|---------|--------|
| `l1-resource-pressure` | cpuUsage > 90% OR memoryPercent > 85 OR OOM log | `scale_up` → `health_check`; fallback: `restart_pod` | guarded |
| `l1-sync-lag` | syncGap increasing over 3+ cycles | `collect_logs` → `restart_pod` → `health_check`; fallback: escalate | guarded |
| `l1-mempool-spike` | txPoolPending Z-Score spike | `collect_logs` → `escalate_operator` (medium) | safe |
| `l1-disk-pressure` | disk usage > 90% log pattern | `collect_logs` → `escalate_operator` (high) | safe |
| `l1-chain-reorg` | reorg depth > 2 log pattern | `collect_logs` → `escalate_operator` (critical) | safe |

### Shared L1 Playbooks (existing — spread from `l1-playbooks.ts`)

| Name | Summary |
|------|---------|
| `l1-rpc-failover` | RPC stagnant → switch_l1_rpc |
| `l1-sync-stall` | Self-hosted node stuck → restart_pod |
| `l1-peer-isolation` | peerCount == 0 → diagnose + escalate |
| `l1-high-gas` | gas > guardGwei → alert operator |

**Total: 9 playbooks** (`L1_EVM_PLAYBOOKS` + `L1_PLAYBOOKS`)

### Deployment Type Action Gating

```typescript
// action-executor.ts
if (deploymentType === 'external' && action.safetyLevel === 'guarded') {
  return { skipped: true, reason: 'external: no pod control' };
}

// docker mode: restart_pod → docker restart <container>
if (deploymentType === 'docker' && action.type === 'restart_pod') {
  return await dockerRestart(action.target);
}
```

| Action type | k8s | docker | external |
|-------------|-----|--------|----------|
| scale_up | ✅ | ❌ skip | ❌ skip |
| restart_pod | ✅ | ✅ docker restart | ❌ skip |
| collect_logs | ✅ | ✅ | ❌ skip |
| health_check | ✅ | ✅ | ✅ RPC probe |
| escalate_operator | ✅ | ✅ | ✅ |

---

## ChainPlugin Interface Changes

```typescript
// src/chains/types.ts (minimal diff)
interface ChainPlugin {
  nodeLayer: 'l1' | 'l2' | 'both';           // NEW — all existing plugins add 'l2'
  l2Chain?: Chain;                             // optional (was required)
  expectedL2BlockIntervalSeconds?: number;     // optional (was required)
  // all other fields unchanged
}
```

Existing plugins (`thanos`, `optimism`, `arbitrum`, `zkstack`, `zkl2-generic`) add `nodeLayer: 'l2'` with no other changes.

---

## Testing

- `src/lib/__tests__/l1-node-metrics.test.ts` — metric collection per client family
- `src/chains/__tests__/l1-evm-plugin.test.ts` — plugin interface contract
- `src/lib/__tests__/scenarios/S-L1EVM.test.ts` — end-to-end scenario tests (resource pressure, sync lag, peer isolation, mempool spike, reorg)
- Existing scenario tests (`S-L1.test.ts`) remain unchanged
