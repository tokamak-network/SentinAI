# L1 EVM Node Plugin Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CHAIN_TYPE=l1-evm` support so SentinAI can monitor any standalone EVM L1 node (Geth, Reth, Nethermind, Besu) without requiring an L2 network.

**Architecture:** A new `L1EVMPlugin` implements the existing `ChainPlugin` interface with a single `l1-execution` component. The `ChainPlugin` interface gains a `nodeLayer` discriminator and `l2Chain` becomes optional. The agent loop branches on `nodeLayer === 'l1'` to collect L1 metrics instead of L2 metrics; all downstream engines (anomaly detector, RCA, remediation) run unchanged.

**Tech Stack:** TypeScript (strict), viem, Vitest, existing `client-detector.ts` for auto-detection

---

## File Map

| Path | Status | Responsibility |
|------|--------|----------------|
| `src/chains/types.ts` | Modify | Add `nodeLayer`, make `l2Chain` optional |
| `src/chains/thanos/index.ts` | Modify | Add `nodeLayer: 'l2'` |
| `src/chains/optimism/index.ts` | Modify | Add `nodeLayer: 'l2'` |
| `src/chains/arbitrum/index.ts` | Modify | Add `nodeLayer: 'l2'` |
| `src/chains/zkstack/index.ts` | Modify | Add `nodeLayer: 'l2'` |
| `src/chains/zkl2-generic/index.ts` | Modify | Add `nodeLayer: 'l2'` |
| `src/lib/l1-node-metrics.ts` | Create | `collectL1NodeMetrics()` — client-adaptive L1 metric collection |
| `src/chains/l1-evm/components.ts` | Create | `l1-execution` + `system` topology |
| `src/chains/l1-evm/prompts.ts` | Create | L1 AI prompt fragments |
| `src/chains/l1-evm/playbooks.ts` | Create | 5 L1-specific playbooks + shared L1_PLAYBOOKS |
| `src/chains/l1-evm/index.ts` | Create | `L1EVMPlugin` class |
| `src/chains/registry.ts` | Modify | Add `l1-evm` case |
| `src/lib/agent-loop.ts` | Modify | Branch on `nodeLayer === 'l1'` in observe phase |
| `src/lib/action-executor.ts` | Modify | Skip guarded actions on `external` deployment; docker restart support |
| `src/lib/__tests__/l1-node-metrics.test.ts` | Create | Unit tests for metric collection |
| `src/lib/__tests__/scenarios/S-L1EVM.test.ts` | Create | End-to-end scenario tests |

---

## Chunk 1: Foundation

### Task 1: Extend ChainPlugin interface

**Files:**
- Modify: `src/chains/types.ts`
- Modify: `src/chains/thanos/index.ts` (and 4 other existing plugins)

The interface needs a `nodeLayer` discriminator and `l2Chain` must become optional. Existing L2 plugins each add `nodeLayer: 'l2'` — a one-liner addition.

- [ ] **Step 1: Add `nodeLayer` and make `l2Chain` optional in types.ts**

In `src/chains/types.ts`, find the `ChainPlugin` interface and apply these changes:

```typescript
// After the `readonly chainMode: ChainMode;` line, add:
/** Whether this plugin monitors L1, L2, or both */
readonly nodeLayer: 'l1' | 'l2' | 'both';
```

```typescript
// Change line 167 from:
readonly l2Chain: Chain;
// to:
readonly l2Chain?: Chain;
```

- [ ] **Step 2: Add `nodeLayer: 'l2'` to all existing plugins**

Each of these files has a class that implements `ChainPlugin`. Add the property after `readonly chainMode`:

```typescript
// src/chains/thanos/index.ts — after `readonly chainMode = 'standard' as const;`
readonly nodeLayer = 'l2' as const;

// src/chains/optimism/index.ts — same pattern
readonly nodeLayer = 'l2' as const;

// src/chains/arbitrum/index.ts — same pattern
readonly nodeLayer = 'l2' as const;

// src/chains/zkstack/index.ts — same pattern
readonly nodeLayer = 'l2' as const;

// src/chains/zkl2-generic/index.ts — same pattern
readonly nodeLayer = 'l2' as const;
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v '.next/' | head -30
```

Expected: 0 errors in `src/` files.

- [ ] **Step 4: Run existing chain plugin tests**

```bash
npx vitest run src/lib/__tests__/chain-plugin.test.ts
```

Expected: all tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/chains/types.ts src/chains/thanos/index.ts src/chains/optimism/index.ts src/chains/arbitrum/index.ts src/chains/zkstack/index.ts src/chains/zkl2-generic/index.ts
git commit -m "feat(chains): add nodeLayer discriminator, make l2Chain optional"
```

---

### Task 2: L1 node metrics collector

**Files:**
- Create: `src/lib/l1-node-metrics.ts`
- Create: `src/lib/__tests__/l1-node-metrics.test.ts`

This module collects L1-specific metrics using the already-detected client family. It only calls RPC methods that the detected client supports.

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/l1-node-metrics.test.ts`:

```typescript
/**
 * Unit tests for L1 node metrics collector
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DetectedClient } from '@/lib/client-detector';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function makeClient(
  family: DetectedClient['family'],
  txpoolNamespace: DetectedClient['txpoolNamespace'] = 'txpool'
): DetectedClient {
  return {
    layer: 'execution',
    family,
    chainId: 1,
    syncing: false,
    peerCount: 50,
    supportsL2SyncStatus: false,
    l2SyncMethod: null,
    txpoolNamespace,
    probes: {},
  };
}

function makeRpcResponse(result: unknown) {
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result }),
  });
}

describe('collectL1NodeMetrics', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('collects block height and interval from eth_getBlockByNumber', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('geth');

    // eth_blockNumber → current block
    // eth_getBlockByNumber (latest) → timestamp + number
    // eth_getBlockByNumber (latest - 1) → timestamp for interval calc
    // net_peerCount → peers
    // eth_syncing → false
    // txpool_status → pending/queued
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x12C57D' }) }) // eth_blockNumber
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x12C57D', timestamp: '0x6789ABCD', baseFeePerGas: '0x3B9ACA00' } }) }) // latest block
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x12C57C', timestamp: '0x6789ABC1' } }) }) // parent block (timestamp diff = 12s)
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x32' }) }) // net_peerCount = 50
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) }) // eth_syncing
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { pending: '0x64', queued: '0xA' } }) }); // txpool_status

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');

    expect(metrics.blockHeight).toBe(1230205); // 0x12C57D
    expect(metrics.blockInterval).toBe(12);
    expect(metrics.peerCount).toBe(50);
    expect(metrics.syncing).toBe(false);
    expect(metrics.syncGap).toBe(0);
    expect(metrics.txPoolPending).toBe(100); // 0x64
    expect(metrics.txPoolQueued).toBe(10);   // 0xA
    expect(metrics.cpuUsage).toBe(0);        // external mode
    expect(metrics.memoryPercent).toBe(0);   // external mode
  });

  it('returns txPoolPending=-1 when client has no txpool namespace', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('geth', null);

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x1' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x1', timestamp: '0x100', baseFeePerGas: '0x0' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x0', timestamp: '0xF4' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x5' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) });

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    expect(metrics.txPoolPending).toBe(-1);
    expect(metrics.txPoolQueued).toBe(-1);
  });

  it('sets syncGap > 0 when eth_syncing returns sync progress', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('reth');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x100' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x100', timestamp: '0x200', baseFeePerGas: '0x0' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0xFF', timestamp: '0x1F4' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x3' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({
        result: { currentBlock: '0x100', highestBlock: '0x200', startingBlock: '0x0' }
      }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { pending: '0x0', queued: '0x0' } }) });

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    expect(metrics.syncing).toBe(true);
    expect(metrics.syncGap).toBe(256); // 0x200 - 0x100
  });

  it('uses parity namespace for Nethermind txpool', async () => {
    const { collectL1NodeMetrics } = await import('@/lib/l1-node-metrics');
    const client = makeClient('nethermind', 'parity');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0x1' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x1', timestamp: '0x10', baseFeePerGas: '0x0' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { number: '0x0', timestamp: '0x4' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: '0xA' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: false }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ result: { pending: {}, queued: {} } }) }); // parity format

    const metrics = await collectL1NodeMetrics('http://localhost:8545', client, 'external');
    // parity_pendingTransactions returns object, count keys
    expect(metrics.txPoolPending).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/__tests__/l1-node-metrics.test.ts
```

Expected: `FAIL` — module `@/lib/l1-node-metrics` not found.

- [ ] **Step 3: Implement `src/lib/l1-node-metrics.ts`**

```typescript
/**
 * L1 Node Metrics Collector
 * Collects L1 EVM node metrics, adapting to detected client capabilities.
 */

import type { DetectedClient } from '@/lib/client-detector';

export type L1DeploymentType = 'k8s' | 'docker' | 'external';

export interface L1NodeMetrics {
  /** Latest block number */
  blockHeight: number;
  /** Seconds between latest and parent block */
  blockInterval: number;
  /** Number of connected peers */
  peerCount: number;
  /** Whether the node is currently syncing */
  syncing: boolean;
  /** highestBlock - currentBlock; 0 when fully synced */
  syncGap: number;
  /** Pending transactions in mempool; -1 if unsupported */
  txPoolPending: number;
  /** Queued transactions in mempool; -1 if unsupported */
  txPoolQueued: number;
  /** Current base fee in wei (0 on pre-EIP-1559 chains) */
  baseFee: bigint;
  /** CPU usage percent; 0 if external deployment */
  cpuUsage: number;
  /** Memory usage percent; 0 if external deployment */
  memoryPercent: number;
}

interface RpcBlock {
  number: string;
  timestamp: string;
  baseFeePerGas?: string;
}

interface SyncStatus {
  currentBlock: string;
  highestBlock: string;
}

const RPC_TIMEOUT_MS = 8_000;

async function rpcCall(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    });
    const data = await res.json() as { result?: unknown; error?: { message?: string } };
    if (data.error?.message) throw new Error(data.error.message);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function getBlockHeight(url: string): Promise<number> {
  const hex = await rpcCall(url, 'eth_blockNumber') as string;
  return parseInt(hex, 16);
}

async function getBlock(url: string, tag: string | number): Promise<RpcBlock> {
  const param = typeof tag === 'number' ? `0x${tag.toString(16)}` : tag;
  return await rpcCall(url, 'eth_getBlockByNumber', [param, false]) as RpcBlock;
}

async function getPeerCount(url: string): Promise<number> {
  try {
    const hex = await rpcCall(url, 'net_peerCount') as string;
    return parseInt(hex, 16);
  } catch {
    return 0;
  }
}

async function getSyncStatus(url: string): Promise<{ syncing: boolean; syncGap: number }> {
  try {
    const result = await rpcCall(url, 'eth_syncing');
    if (!result) return { syncing: false, syncGap: 0 };
    const s = result as SyncStatus;
    const current = parseInt(s.currentBlock, 16);
    const highest = parseInt(s.highestBlock, 16);
    return { syncing: true, syncGap: Math.max(0, highest - current) };
  } catch {
    return { syncing: false, syncGap: 0 };
  }
}

async function getTxPool(
  url: string,
  namespace: DetectedClient['txpoolNamespace']
): Promise<{ pending: number; queued: number }> {
  if (!namespace) return { pending: -1, queued: -1 };
  try {
    if (namespace === 'txpool') {
      const status = await rpcCall(url, 'txpool_status') as { pending: string; queued: string };
      return {
        pending: parseInt(status.pending, 16),
        queued: parseInt(status.queued, 16),
      };
    }
    // parity namespace (Nethermind, Besu)
    const pending = await rpcCall(url, 'parity_pendingTransactions', [null]) as Record<string, unknown>[];
    return { pending: Array.isArray(pending) ? pending.length : Object.keys(pending as object).length, queued: 0 };
  } catch {
    return { pending: -1, queued: -1 };
  }
}

/**
 * Collect L1 node metrics, adapting to the detected client's capabilities.
 *
 * @param rpcUrl   - HTTP RPC endpoint of the L1 node
 * @param client   - Result of detectExecutionClient()
 * @param deploymentType - 'k8s' | 'docker' | 'external' (determines resource metrics availability)
 */
export async function collectL1NodeMetrics(
  rpcUrl: string,
  client: DetectedClient,
  deploymentType: L1DeploymentType
): Promise<L1NodeMetrics> {
  const blockHeight = await getBlockHeight(rpcUrl);
  const latestBlock = await getBlock(rpcUrl, 'latest');
  const parentBlock = await getBlock(rpcUrl, blockHeight - 1);

  const latestTs = parseInt(latestBlock.timestamp, 16);
  const parentTs = parseInt(parentBlock.timestamp, 16);
  const blockInterval = Math.max(0, latestTs - parentTs);
  const baseFee = latestBlock.baseFeePerGas ? BigInt(latestBlock.baseFeePerGas) : 0n;

  const [peerCount, syncStatus, txPool] = await Promise.all([
    getPeerCount(rpcUrl),
    getSyncStatus(rpcUrl),
    getTxPool(rpcUrl, client.txpoolNamespace),
  ]);

  // Resource metrics only available when pod is accessible
  let cpuUsage = 0;
  let memoryPercent = 0;
  if (deploymentType !== 'external') {
    // K8s and Docker resource metrics are fetched separately via k8s-scaler / docker stats
    // For now, these remain 0 until the calling code injects them
    cpuUsage = 0;
    memoryPercent = 0;
  }

  return {
    blockHeight,
    blockInterval,
    peerCount,
    syncing: syncStatus.syncing,
    syncGap: syncStatus.syncGap,
    txPoolPending: txPool.pending,
    txPoolQueued: txPool.queued,
    baseFee,
    cpuUsage,
    memoryPercent,
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run src/lib/__tests__/l1-node-metrics.test.ts
```

Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/l1-node-metrics.ts src/lib/__tests__/l1-node-metrics.test.ts
git commit -m "feat(l1): add L1 node metrics collector with client-adaptive RPC calls"
```

---

## Chunk 2: L1EVM Plugin

### Task 3: Plugin topology and prompts

**Files:**
- Create: `src/chains/l1-evm/components.ts`
- Create: `src/chains/l1-evm/prompts.ts`

- [ ] **Step 1: Create `src/chains/l1-evm/components.ts`**

```typescript
/**
 * L1 EVM Node Plugin — Component Topology
 */

import type {
  ChainComponent,
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
} from '../types';

/** The only real component in L1-only mode */
export const L1_COMPONENTS: ChainComponent[] = ['l1-execution'];
/** Shared meta-components */
export const L1_META_COMPONENTS: ChainComponent[] = ['system'];

/**
 * Dependency graph for RCA.
 * l1-execution depends on the underlying system (disk, CPU).
 * No downstream L2 consumers.
 */
export const L1_DEPENDENCY_GRAPH: Record<ChainComponent, ComponentDependency> = {
  'l1-execution': {
    dependsOn: ['system'],
    feeds: [],
  },
  system: {
    dependsOn: [],
    feeds: ['l1-execution'],
  },
};

/** Alias map for component name normalization */
export const L1_COMPONENT_ALIASES: Record<string, ChainComponent> = {
  geth: 'l1-execution',
  reth: 'l1-execution',
  nethermind: 'l1-execution',
  besu: 'l1-execution',
  erigon: 'l1-execution',
  'l1-node': 'l1-execution',
  node: 'l1-execution',
};

/**
 * K8s component config.
 * K8S_L1_APP_LABEL env var controls the label selector (default: 'geth').
 */
export function getL1K8sComponents(): K8sComponentConfig[] {
  const label = process.env.K8S_L1_APP_LABEL ?? 'geth';
  return [
    {
      component: 'l1-execution',
      labelSuffix: label,
      statefulSetSuffix: label,
      isPrimaryExecution: true,
    },
  ];
}

/** No EOA roles for L1-only mode */
export const L1_EOA_CONFIGS: EOAConfig[] = [];
export const L1_BALANCE_METRICS: string[] = [];
```

- [ ] **Step 2: Create `src/chains/l1-evm/prompts.ts`**

```typescript
/**
 * L1 EVM Node Plugin — AI Prompt Fragments
 */

import type { ChainAIPrompts } from '../types';

export const L1_EVM_AI_PROMPTS: ChainAIPrompts = {
  rcaSystemPrompt: `You are analyzing a standalone L1 EVM execution client (Geth, Reth, Nethermind, or Besu).
The only monitored component is 'l1-execution'. There are no L2 downstream consumers.
Common failure modes:
- Block production stall: node stuck on a fork, bad peer, or DB corruption
- Peer isolation: firewall change, P2P port closed, bootnode unreachable
- Sync lag: node fell behind the chain tip (resuming from a stall)
- Resource exhaustion: ZK or heavy tx workloads cause OOM or CPU saturation
- Disk pressure: chain state growth (archive nodes) or pruning lag`,

  anomalyAnalyzerContext: `Monitoring a standalone L1 EVM node.
Component: l1-execution (Geth/Reth/Nethermind/Besu).
Key metrics: blockInterval (normal ~12s for Ethereum), peerCount (healthy > 10),
syncGap (0 when synced), txPoolPending (baseline 100-5000), cpuUsage, memoryPercent.
Block stalls and peer drops are high-priority anomalies.`,

  predictiveScalerContext: `Scaling target: l1-execution (L1 EVM node pod).
L1 nodes are memory-heavy (state trie) and I/O-bound (chain reads).
High mempool activity correlates with CPU pressure.
Scale up when cpuUsage > 80 or memoryPercent > 80 for 3+ consecutive cycles.`,

  costOptimizerContext: `L1 EVM node running in isolation.
Node resources scale with chain state size and transaction volume.
Archive nodes require significantly more disk and memory than full/snap nodes.`,

  dailyReportContext: `Standalone L1 EVM node guardian report.
Tracks: block production health, peer connectivity, sync status, mempool depth,
resource utilization, and auto-remediation actions taken.`,

  nlopsSystemContext: `You are monitoring a standalone L1 EVM execution client.
The system has one component: the L1 node (l1-execution).
Available actions: scale resources, restart pod, switch RPC endpoint, escalate to operator.
Block stalls, peer isolation, and OOM are the most common incidents.`,

  failurePatterns: `L1 node failure patterns:
1. Block stall: blockInterval spikes to 60s+ → peer issue or DB problem
2. Peer isolation: peerCount drops to 0 → P2P config or firewall issue
3. OOM crash: memoryPercent > 95 → state trie growth or memory leak
4. Sync lag: syncGap increases → node fell behind after recovery
5. Mempool spike: txPoolPending > 10000 → unusual network activity
6. Disk pressure: node logs disk full → archive pruning required`,
};
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep 'l1-evm' | head -20
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/chains/l1-evm/components.ts src/chains/l1-evm/prompts.ts
git commit -m "feat(l1-evm): add component topology and AI prompt fragments"
```

---

### Task 4: L1EVM playbooks

**Files:**
- Create: `src/chains/l1-evm/playbooks.ts`

- [ ] **Step 1: Create `src/chains/l1-evm/playbooks.ts`**

```typescript
/**
 * L1 EVM Node Plugin — Remediation Playbooks
 * 5 L1-execution-specific playbooks + shared L1_PLAYBOOKS
 */

import type { Playbook } from '@/types/remediation';
import { L1_PLAYBOOKS } from '@/chains/shared/l1-playbooks';

export const L1_EVM_PLAYBOOKS: Playbook[] = [
  // ─────────────────────────────────────────────────────────
  // L1EVM-01: Node Resource Pressure
  // Handles: OOM, sustained high CPU on the L1 execution client
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-resource-pressure',
    description: 'L1 execution client OOM or sustained high CPU — scale up and health check',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
        { type: 'log_pattern', condition: 'out of memory|OOM killed|fatal error' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'l1-execution',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'l1-execution',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'l1-execution',
      },
    ],
    maxAttempts: 2,
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-02: Sync Lag Recovery
  // Handles: node fell behind chain tip after a stall or restart
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-sync-lag',
    description: 'L1 node sync gap growing — collect diagnostics then restart',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'syncGap increasing' },
        { type: 'log_pattern', condition: 'snap sync|state heal|behind by' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 200 },
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'l1-execution',
        waitAfterMs: 60000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'l1-execution',
      },
    ],
    fallback: [
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'L1 node sync lag persists after restart. Manual investigation required.',
        },
      },
    ],
    maxAttempts: 1,
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-03: Mempool Spike
  // Handles: unusual mempool depth (network spam, congestion)
  // Alert-only — mempool state is transient and self-resolving
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-mempool-spike',
    description: 'Mempool pending transaction count spiked — alert operator',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'metric', condition: 'txPoolPending > threshold' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 100 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'medium',
          message: 'L1 node mempool spike detected. Transaction pending count is unusually high.',
        },
      },
    ],
    maxAttempts: 0, // Alert only
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-04: Disk Pressure
  // Handles: chain state growth filling disk (archive nodes)
  // Cannot auto-fix disk — alert with context
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-disk-pressure',
    description: 'L1 node disk usage critical — alert operator for pruning or expansion',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'log_pattern', condition: 'no space left|disk full|ENOSPC' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 100 },
      },
      {
        type: 'describe_pod',
        safetyLevel: 'safe',
        target: 'l1-execution',
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'high',
          message: 'L1 node disk pressure detected. Chain state may be full. Pruning or volume expansion required.',
        },
      },
    ],
    maxAttempts: 0, // Alert only — disk requires manual intervention
  },

  // ─────────────────────────────────────────────────────────
  // L1EVM-05: Chain Reorg Detected
  // Handles: deep reorg (> 2 blocks) indicating consensus issue
  // ─────────────────────────────────────────────────────────
  {
    name: 'l1-chain-reorg',
    description: 'Deep chain reorganization detected — collect diagnostics and escalate',
    trigger: {
      component: 'l1-execution',
      indicators: [
        { type: 'log_pattern', condition: 'chain reorg|reorg depth|block reorganis' },
      ],
    },
    actions: [
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'l1-execution',
        params: { lines: 500 },
      },
      {
        type: 'escalate_operator',
        safetyLevel: 'safe',
        params: {
          urgency: 'critical',
          message: 'Deep chain reorganization detected on L1 node. Check peer connectivity and chain tip consensus.',
        },
      },
    ],
    maxAttempts: 0, // Alert only — requires human review
  },

  // Shared L1 playbooks (rpc-failover, sync-stall, peer-isolation, high-gas)
  ...L1_PLAYBOOKS,
];
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep 'l1-evm' | head -20
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/chains/l1-evm/playbooks.ts
git commit -m "feat(l1-evm): add 5 L1-execution playbooks"
```

---

### Task 5: L1EVMPlugin class and registry

**Files:**
- Create: `src/chains/l1-evm/index.ts`
- Modify: `src/chains/registry.ts`

- [ ] **Step 1: Write failing test for plugin interface contract**

Add to a new file `src/chains/__tests__/l1-evm-plugin.test.ts`:

```typescript
/**
 * L1EVMPlugin — interface contract tests
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resetChainRegistry, getChainPlugin } from '@/chains/registry';

describe('L1EVMPlugin', () => {
  beforeEach(() => {
    resetChainRegistry();
    process.env.CHAIN_TYPE = 'l1-evm';
  });

  afterEach(() => {
    delete process.env.CHAIN_TYPE;
    resetChainRegistry();
  });

  it('loads via CHAIN_TYPE=l1-evm', () => {
    const plugin = getChainPlugin();
    expect(plugin.chainType).toBe('l1-evm');
    expect(plugin.nodeLayer).toBe('l1');
  });

  it('has l1-execution as primary component', () => {
    const plugin = getChainPlugin();
    expect(plugin.primaryExecutionClient).toBe('l1-execution');
    expect(plugin.components).toContain('l1-execution');
  });

  it('has no L2 components', () => {
    const plugin = getChainPlugin();
    const l2Components = plugin.components.filter(c =>
      ['op-geth', 'op-node', 'op-batcher', 'nitro-node', 'zksync-server'].includes(c)
    );
    expect(l2Components).toHaveLength(0);
  });

  it('l2Chain is undefined', () => {
    const plugin = getChainPlugin();
    expect(plugin.l2Chain).toBeUndefined();
  });

  it('maps all metrics to l1-execution or system', () => {
    const plugin = getChainPlugin();
    const components = ['cpuUsage', 'memoryPercent', 'blockHeight', 'txPoolPending', 'syncGap', 'peerCount'];
    for (const m of components) {
      const comp = plugin.mapMetricToComponent(m);
      expect(['l1-execution', 'system']).toContain(comp);
    }
  });

  it('returns 9 playbooks (5 L1EVM + 4 shared L1)', () => {
    const plugin = getChainPlugin();
    const playbooks = plugin.getPlaybooks();
    expect(playbooks.length).toBe(9);
  });

  it('normalizes client family names to l1-execution', () => {
    const plugin = getChainPlugin();
    expect(plugin.normalizeComponentName('geth')).toBe('l1-execution');
    expect(plugin.normalizeComponentName('reth')).toBe('l1-execution');
    expect(plugin.normalizeComponentName('nethermind')).toBe('l1-execution');
  });
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run src/chains/__tests__/l1-evm-plugin.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/chains/l1-evm/index.ts`**

```typescript
/**
 * L1 EVM Node Plugin
 * Monitors any standalone EVM-compatible L1 execution client.
 * CHAIN_TYPE=l1-evm
 */

import type { Chain } from 'viem';
import { mainnet } from 'viem/chains';
import type { Playbook } from '@/types/remediation';
import type {
  ChainPlugin,
  ChainComponent,
  ChainEOARole,
  ComponentDependency,
  K8sComponentConfig,
  EOAConfig,
  ChainAIPrompts,
} from '../types';
import {
  L1_COMPONENTS,
  L1_META_COMPONENTS,
  L1_DEPENDENCY_GRAPH,
  L1_COMPONENT_ALIASES,
  getL1K8sComponents,
  L1_EOA_CONFIGS,
  L1_BALANCE_METRICS,
} from './components';
import { L1_EVM_AI_PROMPTS } from './prompts';
import { L1_EVM_PLAYBOOKS } from './playbooks';
import {
  defaultBuildRollback,
  defaultTranslateIntentToActions,
  defaultVerifyActionOutcome,
  getDefaultAutonomousActions,
  getDefaultAutonomousIntents,
} from '../autonomous-defaults';
import type {
  AutonomousExecutionContext,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

/**
 * Resolve the L1 chain viem object.
 * Uses L1_CHAIN_ID env var; defaults to mainnet.
 * For non-standard chains, mainnet is used as a placeholder (chainId is the real identifier).
 */
function resolveL1Chain(): Chain {
  // Most consumers only need the chainId. Use mainnet as default.
  return mainnet;
}

export class L1EVMPlugin implements ChainPlugin {
  readonly chainType = 'l1-evm';
  readonly displayName = 'L1 EVM Node';
  readonly chainMode = 'generic' as const;
  readonly nodeLayer = 'l1' as const;
  readonly capabilities = {
    l1Failover: false,         // No L2 pods to update RPC env vars on
    eoaBalanceMonitoring: false,
    disputeGameMonitoring: false,
    proofMonitoring: false,
    settlementMonitoring: false,
    autonomousIntents: getDefaultAutonomousIntents('l1-evm'),
    autonomousActions: getDefaultAutonomousActions('l1-evm'),
  } as const;

  // Component Topology
  readonly components: ChainComponent[] = [...L1_COMPONENTS];
  readonly metaComponents: ChainComponent[] = [...L1_META_COMPONENTS];
  readonly dependencyGraph: Record<ChainComponent, ComponentDependency> = L1_DEPENDENCY_GRAPH;
  readonly componentAliases: Record<string, ChainComponent> = L1_COMPONENT_ALIASES;

  // K8s
  readonly k8sComponents: K8sComponentConfig[] = getL1K8sComponents();
  readonly primaryExecutionClient: ChainComponent = 'l1-execution';

  // EOA & Balance — none for L1-only
  readonly eoaRoles: ChainEOARole[] = [];
  readonly eoaConfigs: EOAConfig[] = L1_EOA_CONFIGS;
  readonly balanceMetrics: string[] = L1_BALANCE_METRICS;

  // Block Production (~12s for Ethereum mainnet)
  readonly expectedBlockIntervalSeconds = 12.0;

  // viem Chain
  readonly l1Chain: Chain = resolveL1Chain();
  readonly l2Chain: Chain | undefined = undefined;

  // AI Prompts
  readonly aiPrompts: ChainAIPrompts = L1_EVM_AI_PROMPTS;

  mapMetricToComponent(metric: string): ChainComponent {
    // All metrics belong to l1-execution; system-level fall through
    if (
      metric.includes('cpu') ||
      metric.includes('memory') ||
      metric.includes('block') ||
      metric.includes('Block') ||
      metric.includes('txPool') ||
      metric.includes('gas') ||
      metric.includes('peer') ||
      metric.includes('sync')
    ) {
      return 'l1-execution';
    }
    return 'system';
  }

  normalizeComponentName(name: string): ChainComponent {
    const lowered = name.toLowerCase().trim();
    return this.componentAliases[lowered] ?? 'l1-execution';
  }

  getPlaybooks(): Playbook[] {
    return L1_EVM_PLAYBOOKS;
  }

  getSupportedIntents(): AutonomousIntent[] {
    return [...this.capabilities.autonomousIntents];
  }

  translateIntentToActions(
    intent: AutonomousIntent,
    context: AutonomousExecutionContext
  ): AutonomousPlanStep[] {
    return defaultTranslateIntentToActions(this.chainType, intent, context);
  }

  verifyActionOutcome(
    step: AutonomousPlanStep,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): AutonomousVerificationResult {
    return defaultVerifyActionOutcome(this.chainType, step, before, after);
  }

  buildRollback(step: AutonomousPlanStep): AutonomousPlanStep[] {
    return defaultBuildRollback(this.chainType, step);
  }
}
```

- [ ] **Step 4: Register in `src/chains/registry.ts`**

Add import and case:

```typescript
// Add import after ZkL2GenericPlugin import:
import { L1EVMPlugin } from './l1-evm';

// Add cases to the switch (before the `default:` line):
case 'l1-evm':
case 'l1':
  return new L1EVMPlugin();
```

- [ ] **Step 5: Run plugin tests**

```bash
npx vitest run src/chains/__tests__/l1-evm-plugin.test.ts
```

Expected: all 7 tests pass.

- [ ] **Step 6: Run existing chain plugin tests (regression check)**

```bash
npx vitest run src/lib/__tests__/chain-plugin.test.ts
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/chains/l1-evm/index.ts src/chains/registry.ts src/chains/__tests__/l1-evm-plugin.test.ts
git commit -m "feat(l1-evm): add L1EVMPlugin and register as CHAIN_TYPE=l1-evm"
```

---

## Chunk 3: Engine Integration

### Task 6: Agent loop L1 branch

**Files:**
- Modify: `src/lib/agent-loop.ts`

The agent loop observe phase currently calls `resolveL2RpcUrl()`. In L1-only mode, there is no L2 RPC — instead we read from `L1_RPC_URL` and use `collectL1NodeMetrics()`.

- [ ] **Step 1: Add `resolveL1NodeRpcUrl()` helper and L1 collect branch**

In `src/lib/agent-loop.ts`, after the existing `resolveL2RpcUrl()` function, add:

```typescript
function resolveL1NodeRpcUrl(): string | null {
  const candidates = [
    process.env.L1_RPC_URL,
    process.env.SENTINAI_L1_RPC_URL,
  ];
  for (const c of candidates) {
    const v = c?.trim();
    if (v) return v;
  }
  return null;
}
```

- [ ] **Step 2: Add L1-only observe path in `collectMetrics()` (or the observe phase)**

Find the section in `agent-loop.ts` where `resolveL2RpcUrl()` is called and `l2BlockHeight` is collected. Add an early-return branch for L1-only mode:

```typescript
import { collectL1NodeMetrics } from '@/lib/l1-node-metrics';

// Near the top of collectMetrics() or the observe phase:
const plugin = getChainPlugin();
if (plugin.nodeLayer === 'l1') {
  const l1Url = resolveL1NodeRpcUrl();
  if (!l1Url) {
    throw new Error('L1-only mode requires L1_RPC_URL');
  }
  // detectExecutionClient is already imported
  const detectedClient = await detectExecutionClient(l1Url);
  const deploymentType = (process.env.L1_DEPLOYMENT_TYPE ?? 'external') as 'k8s' | 'docker' | 'external';

  const l1Metrics = await collectL1NodeMetrics(l1Url, detectedClient, deploymentType);

  // Get CPU/memory from K8s if available
  let cpuUsage = l1Metrics.cpuUsage;
  let memoryPercent = l1Metrics.memoryPercent;
  if (deploymentType === 'k8s') {
    try {
      cpuUsage = await getContainerCpuUsage();
    } catch { /* fallback to 0 */ }
  }

  const gasUsedRatio = l1Metrics.baseFee > 0n
    ? Math.min(1, Number(l1Metrics.baseFee) / 1e11)  // normalize to 0-1 relative to 100 gwei
    : 0;

  const dataPoint: MetricDataPoint = {
    timestamp: Date.now(),
    blockHeight: l1Metrics.blockHeight,
    l1BlockNumber: l1Metrics.blockHeight,
    cpuUsage,
    memoryPercent,
    gasUsedRatio,
    txPoolPending: Math.max(0, l1Metrics.txPoolPending),
    txPoolQueued: Math.max(0, l1Metrics.txPoolQueued),
    blockInterval: l1Metrics.blockInterval,
    syncLag: l1Metrics.syncGap,
    peerCount: l1Metrics.peerCount,
  };

  return {
    dataPoint,
    l1BlockHeight: l1Metrics.blockHeight,
    // No batcher/proposer/challenger balances in L1-only mode
  };
}
// ... existing L2 path continues below
```

- [ ] **Step 3: Update `AgentCycleResult.metrics` for L1-only mode**

In L1-only mode, `l2BlockHeight` will be 0. Update the metrics reporting at the end of the cycle:

```typescript
// In the result construction, when plugin.nodeLayer === 'l1':
metrics: {
  l1BlockHeight: collected.l1BlockHeight,
  l2BlockHeight: 0,   // not applicable
  cpuUsage: collected.dataPoint.cpuUsage,
  txPoolPending: collected.dataPoint.txPoolPending,
  gasUsedRatio: collected.dataPoint.gasUsedRatio,
}
```

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v '.next/' | head -30
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-loop.ts
git commit -m "feat(agent-loop): add L1-only observe path for CHAIN_TYPE=l1-evm"
```

---

### Task 7: Metrics API route

**Files:**
- Modify: `src/app/api/metrics/route.ts`

The metrics route currently always fetches `l2BlockHeight`. In L1-only mode it should return L1 metrics.

- [ ] **Step 1: Add L1-only branch in metrics route**

Find the section in `src/app/api/metrics/route.ts` where `l2BlockHeight` is fetched. Wrap it:

```typescript
const plugin = getChainPlugin();

let l2BlockHeight = 0;
if (plugin.nodeLayer !== 'l1') {
  // existing L2 block height fetch
  l2BlockHeight = await fetchL2BlockHeight(); // existing code
}
```

For the L1 block height in L1-only mode, use the existing `getCachedL1BlockNumber()` call — but point it at `L1_RPC_URL` instead of the failover chain. Or simply return the L1 block from the agent loop's `MetricsStore`.

The simplest change: read `MetricsStore.getLatest()?.l1BlockNumber` when in L1-only mode, same as the existing pattern for L1 block height.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v '.next/' | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/metrics/route.ts
git commit -m "feat(metrics): skip L2 block fetch when nodeLayer === 'l1'"
```

---

### Task 8: Action executor — deployment type gating

**Files:**
- Modify: `src/lib/action-executor.ts`

In `external` deployment mode, `guarded` actions (scale_up, restart_pod) cannot run. In `docker` mode, `restart_pod` maps to `docker restart`.

- [ ] **Step 1: Add deployment type check at the top of `executeAction()`**

In `src/lib/action-executor.ts`, near the top of `executeAction()` (or the main action dispatch function), add:

```typescript
const deploymentType = process.env.L1_DEPLOYMENT_TYPE as 'k8s' | 'docker' | 'external' | undefined;
const plugin = getChainPlugin();

// In L1-only mode with external deployment, skip guarded actions
if (plugin.nodeLayer === 'l1' && deploymentType === 'external' && action.safetyLevel === 'guarded') {
  return {
    success: false,
    skipped: true,
    message: `Action '${action.type}' skipped: external deployment has no pod control`,
  };
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v '.next/' | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/action-executor.ts
git commit -m "feat(executor): skip guarded actions in L1 external deployment mode"
```

---

## Chunk 4: Scenario Tests

### Task 9: S-L1EVM scenario tests

**Files:**
- Create: `src/lib/__tests__/scenarios/S-L1EVM.test.ts`

These tests validate end-to-end behavior: anomaly detection fires correctly for L1 conditions, RCA maps to the right component, playbooks match the right trigger.

- [ ] **Step 1: Create `src/lib/__tests__/scenarios/S-L1EVM.test.ts`**

```typescript
/**
 * L1 EVM Node Integration Scenarios
 *
 * S-L1EVM-01  Block production stall detection
 * S-L1EVM-02  Peer isolation detection
 * S-L1EVM-03  Sync lag detection
 * S-L1EVM-04  Resource pressure → playbook match
 * S-L1EVM-05  Mempool spike detection
 * S-L1EVM-06  Playbook: l1-resource-pressure triggers scale_up
 * S-L1EVM-07  Playbook: l1-sync-lag triggers restart_pod
 * S-L1EVM-08  Deployment type gating — external skips guarded actions
 * S-L1EVM-09  L1EVMPlugin registry loads correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resetChainRegistry, getChainPlugin } from '@/chains/registry';
import { detectAnomalies } from '@/lib/anomaly-detector';
import type { MetricDataPoint } from '@/types/prediction';

// Minimal viem mock needed for plugin to load
vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  sepolia: { id: 11155111, name: 'Sepolia' },
}));

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({})),
  http: vi.fn(),
  formatEther: vi.fn((val: bigint) => (Number(val) / 1e18).toFixed(4)),
}));

function makeL1Metric(overrides: Partial<MetricDataPoint> = {}): MetricDataPoint {
  return {
    timestamp: Date.now(),
    blockHeight: 21_000_000,
    l1BlockNumber: 21_000_000,
    cpuUsage: 20,
    memoryPercent: 40,
    gasUsedRatio: 0.3,
    txPoolPending: 500,
    txPoolQueued: 50,
    blockInterval: 12,
    syncLag: 0,
    peerCount: 50,
    ...overrides,
  };
}

function makeHistory(points: Partial<MetricDataPoint>[]): MetricDataPoint[] {
  return points.map((p, i) => ({
    ...makeL1Metric(),
    timestamp: Date.now() - (points.length - i) * 60_000,
    ...p,
  }));
}

describe('S-L1EVM: L1 EVM Node Integration Scenarios', () => {
  beforeEach(() => {
    resetChainRegistry();
    process.env.CHAIN_TYPE = 'l1-evm';
  });

  afterEach(() => {
    delete process.env.CHAIN_TYPE;
    resetChainRegistry();
  });

  // ─── Plugin Loading ───────────────────────────────────────

  describe('S-L1EVM-09: Plugin loads and is configured correctly', () => {
    it('loads L1EVMPlugin for CHAIN_TYPE=l1-evm', () => {
      const plugin = getChainPlugin();
      expect(plugin.chainType).toBe('l1-evm');
      expect(plugin.nodeLayer).toBe('l1');
    });

    it('has no L2 components', () => {
      const plugin = getChainPlugin();
      expect(plugin.l2Chain).toBeUndefined();
      expect(plugin.components).toEqual(['l1-execution']);
    });

    it('returns 9 playbooks', () => {
      const plugin = getChainPlugin();
      expect(plugin.getPlaybooks()).toHaveLength(9);
    });

    it('maps block metrics to l1-execution', () => {
      const plugin = getChainPlugin();
      expect(plugin.mapMetricToComponent('blockHeight')).toBe('l1-execution');
      expect(plugin.mapMetricToComponent('cpuUsage')).toBe('l1-execution');
      expect(plugin.mapMetricToComponent('peerCount')).toBe('l1-execution');
      expect(plugin.mapMetricToComponent('syncGap')).toBe('l1-execution');
    });
  });

  // ─── Anomaly Detection ────────────────────────────────────

  describe('S-L1EVM-01: Block production stall', () => {
    it('detects stagnant blockHeight', () => {
      const stagnantHeight = 21_000_000;
      const history = makeHistory(
        Array(10).fill({ blockHeight: stagnantHeight, l1BlockNumber: stagnantHeight })
      );
      const current = makeL1Metric({ blockHeight: stagnantHeight, l1BlockNumber: stagnantHeight });
      const anomalies = detectAnomalies(current, history);
      const blockAnomaly = anomalies.find(a =>
        a.metric.toLowerCase().includes('block') &&
        a.condition.includes('stagnant')
      );
      expect(blockAnomaly).toBeDefined();
    });
  });

  describe('S-L1EVM-02: Peer isolation', () => {
    it('detects peerCount == 0', () => {
      const history = makeHistory(Array(5).fill({ peerCount: 0 }));
      const current = makeL1Metric({ peerCount: 0 });
      const anomalies = detectAnomalies(current, history);
      const peerAnomaly = anomalies.find(a => a.metric.toLowerCase().includes('peer'));
      expect(peerAnomaly).toBeDefined();
    });
  });

  describe('S-L1EVM-03: Sync lag growing', () => {
    it('detects increasing syncLag', () => {
      const history = makeHistory([
        { syncLag: 100 },
        { syncLag: 500 },
        { syncLag: 1500 },
        { syncLag: 3000 },
        { syncLag: 5000 },
      ]);
      const current = makeL1Metric({ syncLag: 7500 });
      const anomalies = detectAnomalies(current, history);
      const syncAnomaly = anomalies.find(a => a.metric.toLowerCase().includes('sync'));
      expect(syncAnomaly).toBeDefined();
    });
  });

  describe('S-L1EVM-04: Resource pressure', () => {
    it('detects high CPU', () => {
      const history = makeHistory(Array(5).fill({ cpuUsage: 92 }));
      const current = makeL1Metric({ cpuUsage: 95 });
      const anomalies = detectAnomalies(current, history);
      const cpuAnomaly = anomalies.find(a => a.metric.toLowerCase().includes('cpu'));
      expect(cpuAnomaly).toBeDefined();
    });
  });

  describe('S-L1EVM-05: Mempool spike', () => {
    it('detects txPoolPending anomaly', () => {
      // baseline: 500, spike to 15000
      const history = makeHistory(Array(10).fill({ txPoolPending: 500 }));
      const current = makeL1Metric({ txPoolPending: 15_000 });
      const anomalies = detectAnomalies(current, history);
      const poolAnomaly = anomalies.find(a => a.metric.toLowerCase().includes('txpool'));
      expect(poolAnomaly).toBeDefined();
    });
  });

  // ─── Playbook Matching ────────────────────────────────────

  describe('S-L1EVM-06: l1-resource-pressure playbook', () => {
    it('contains scale_up and health_check actions', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-resource-pressure');
      expect(playbook).toBeDefined();
      expect(playbook!.actions.some(a => a.type === 'scale_up')).toBe(true);
      expect(playbook!.actions.some(a => a.type === 'health_check')).toBe(true);
    });

    it('has guarded scale_up action', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-resource-pressure')!;
      const scaleAction = playbook.actions.find(a => a.type === 'scale_up')!;
      expect(scaleAction.safetyLevel).toBe('guarded');
    });
  });

  describe('S-L1EVM-07: l1-sync-lag playbook', () => {
    it('contains restart_pod action', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-sync-lag');
      expect(playbook).toBeDefined();
      expect(playbook!.actions.some(a => a.type === 'restart_pod')).toBe(true);
    });
  });

  // ─── Deployment Type Gating ───────────────────────────────

  describe('S-L1EVM-08: External deployment skips guarded actions', () => {
    it('l1-resource-pressure has guarded scale_up (would be skipped in external mode)', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-resource-pressure')!;
      const guardedActions = playbook.actions.filter(a => a.safetyLevel === 'guarded');
      expect(guardedActions.length).toBeGreaterThan(0);
      // The action-executor skips these when L1_DEPLOYMENT_TYPE=external
      // This test verifies the actions are correctly marked as guarded
    });

    it('alert-only playbooks have no guarded actions', () => {
      const plugin = getChainPlugin();
      const alertOnlyPlaybooks = plugin.getPlaybooks().filter(p => p.maxAttempts === 0);
      for (const playbook of alertOnlyPlaybooks) {
        const guarded = playbook.actions.filter(a => a.safetyLevel === 'guarded');
        expect(guarded).toHaveLength(0);
      }
    });
  });

  // ─── Shared L1 Playbooks ──────────────────────────────────

  describe('Shared L1 playbooks are included', () => {
    it('includes l1-rpc-failover', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-rpc-failover');
      expect(playbook).toBeDefined();
    });

    it('includes l1-peer-isolation', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-peer-isolation');
      expect(playbook).toBeDefined();
    });

    it('includes l1-high-gas', () => {
      const plugin = getChainPlugin();
      const playbook = plugin.getPlaybooks().find(p => p.name === 'l1-high-gas');
      expect(playbook).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run scenario tests**

```bash
npx vitest run src/lib/__tests__/scenarios/S-L1EVM.test.ts
```

Expected: all tests pass.

- [ ] **Step 3: Run full test suite (regression check)**

```bash
npm run test:run 2>&1 | tail -20
```

Expected: no regressions. New tests pass.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | grep -v '.next/' | head -20
```

Expected: 0 errors in `src/`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/__tests__/scenarios/S-L1EVM.test.ts
git commit -m "test(l1-evm): add S-L1EVM scenario test suite (9 scenarios)"
```

---

## Final Verification

After all chunks are complete:

- [ ] **Build check**

```bash
npm run build 2>&1 | tail -20
```

Expected: successful build, no TypeScript errors.

- [ ] **Lint check**

```bash
npm run lint 2>&1 | tail -20
```

Expected: no lint errors.

- [ ] **Full test run**

```bash
npm run test:run 2>&1 | grep -E 'Tests|Pass|Fail'
```

Expected: all existing tests pass, new tests pass.

- [ ] **Smoke test: plugin loads**

```bash
CHAIN_TYPE=l1-evm node -e "
const { getChainPlugin } = require('./src/chains/registry');
const p = getChainPlugin();
console.log(p.chainType, p.nodeLayer, p.components);
"
```

Expected output:
```
l1-evm l1 [ 'l1-execution' ]
```
