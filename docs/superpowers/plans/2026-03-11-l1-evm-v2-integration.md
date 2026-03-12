# L1 EVM 플러그인 V2 Orchestrator 통합 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate L1 EVM node monitoring (Geth, Reth, Nethermind, Besu) into V2 event-driven orchestrator. Enable `CHAIN_TYPE=l1-evm` to work end-to-end with autonomous anomaly detection, RCA, and remediation.

**Architecture:** V2 agents (Collector, Detector, Analyzer, Executor, RCA) will branch on `ChainPlugin.nodeLayer === 'l1'` to:
1. Collect L1-specific metrics via `collectL1NodeMetrics()` (sync status, peer isolation, txpool backlog)
2. Detect L1 anomalies using `ethereum-el` protocol descriptor (syncStatus, peerCount thresholds)
3. Analyze via L1-specific prompts and playbooks
4. Execute L1-safe remediation (monitoring, alerts, restarts)

**Tech Stack:** TypeScript (strict), viem, V2 agent orchestrator, existing `collectL1NodeMetrics()`, `ETHEREUM_EL_DESCRIPTOR`

---

## File Map

| Path | Status | Responsibility |
|------|--------|-----------------|
| `src/core/agents/collector-agent.ts` | Modify | Add `nodeLayer === 'l1'` branch, call `collectL1NodeMetrics()` |
| `src/core/instance-metrics-store.ts` | Check | Verify L1 metric fields supported (syncStatus, highestBlock, txPoolQueued) |
| `src/core/agents/detector-agent.ts` | Check | Verify `ethereum-el` protocol is used for L1 instances |
| `src/core/agents/analyzer-agent.ts` | Check | Verify L1 AI prompts are applied |
| `src/core/agents/executor-agent.ts` | Check | Verify L1 remediation playbooks are matched |
| `src/core/types.ts` | Check | Verify `NodeType` includes L1 types (e.g., 'ethereum-el') |
| `src/core/instance-orchestrator.ts` | Check | Verify L1 instances are created with correct protocolId |
| `src/lib/client-detector.ts` | Check | Already exists; used to detect Geth/Reth/Nethermind |
| `src/lib/l1-node-metrics.ts` | ✅ Complete | Already implements full L1 metric collection |
| `src/protocols/ethereum-el/descriptor.ts` | ✅ Complete | Already defines L1 metric fields and thresholds |

---

## Chunk 1: CollectorAgent Integration

### Task 1: Modify CollectorAgent to collect L1 metrics

**Files:**
- Modify: `src/core/agents/collector-agent.ts`

#### Step 1: Add imports and type definitions

- [ ] Open `src/core/agents/collector-agent.ts`
- [ ] Add imports after existing imports:

```typescript
import { getChainPlugin } from '@/chains/registry';
import { collectL1NodeMetrics } from '@/lib/l1-node-metrics';
import { detectExecutionClient } from '@/lib/client-detector';
```

#### Step 2: Add deployment type detection

- [ ] In `CollectorAgent` class, add new private field after `vcpuCachedAt`:

```typescript
private deploymentType: 'k8s' | 'docker' | 'external' = 'k8s';
```

#### Step 3: Detect deployment type from environment

- [ ] In constructor, after `this.authToken = config.authToken;`, add:

```typescript
const envDeployment = process.env.DEPLOYMENT_TYPE;
if (envDeployment === 'docker' || envDeployment === 'external') {
  this.deploymentType = envDeployment;
}
```

#### Step 4: Refactor collectMetrics() to branch on nodeLayer

- [ ] Find `private async collectMetrics()` method
- [ ] Replace entire method with:

```typescript
private async collectMetrics(): Promise<GenericMetricDataPoint | null> {
  try {
    const plugin = getChainPlugin();

    // L1 node monitoring
    if (plugin.nodeLayer === 'l1') {
      return await this.collectL1Metrics();
    }

    // L2 node monitoring (existing logic)
    return await this.collectL2Metrics();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[CollectorAgent:${this.instanceId}] Collection error: ${message}`);
    return null;
  }
}
```

#### Step 5: Implement collectL1Metrics()

- [ ] Add new private method after `collectMetrics()`:

```typescript
private async collectL1Metrics(): Promise<GenericMetricDataPoint | null> {
  const RPC_TIMEOUT_MS = 10_000;

  try {
    // Detect client to handle client-specific RPC variations
    const client = await detectExecutionClient(this.rpcUrl);

    // Collect L1-specific metrics
    const l1Metrics = await collectL1NodeMetrics(this.rpcUrl, client, this.deploymentType);

    // Map to GenericMetricDataPoint
    const syncStatus = l1Metrics.syncing
      ? Math.max(0, 100 - (l1Metrics.syncGap / 1000) * 100) // Rough estimate: blocks per 1000
      : 100;

    return {
      instanceId: this.instanceId,
      timestamp: new Date().toISOString(),
      fields: {
        blockHeight: l1Metrics.blockHeight,
        blockInterval: l1Metrics.blockInterval,
        peerCount: l1Metrics.peerCount,
        syncStatus,                    // 0=not synced, 100=fully synced
        txPoolPending: l1Metrics.txPoolPending,
        txPoolQueued: l1Metrics.txPoolQueued,
        highestBlock: l1Metrics.syncGap > 0
          ? l1Metrics.blockHeight + l1Metrics.syncGap
          : l1Metrics.blockHeight,
      },
    };
  } catch (error) {
    logger.error(`[CollectorAgent:${this.instanceId}] L1 collection failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}
```

#### Step 6: Implement collectL2Metrics() (extract existing logic)

- [ ] Find the existing `collectMetrics()` implementation (before refactor)
- [ ] Move that entire logic into new `private async collectL2Metrics()` method
- [ ] Keep error handling as-is

#### Step 7: TypeScript verification

- [ ] Run: `npx tsc --noEmit 2>&1 | grep collector-agent`
- [ ] Expected: 0 errors

#### Step 8: Unit test (if exists)

- [ ] Run: `npx vitest run src/core/agents/__tests__/collector-agent.test.ts`
- [ ] Expected: all tests pass

#### Step 9: Commit

```bash
git add src/core/agents/collector-agent.ts
git commit -m "feat(v2): add L1 nodeLayer branch to CollectorAgent, call collectL1NodeMetrics()"
```

---

### Task 2: Verify instance-metrics-store supports L1 fields

**Files:**
- Check: `src/core/instance-metrics-store.ts`

#### Step 1: Review InstanceMetricsStore implementation

- [ ] Read `src/core/instance-metrics-store.ts`
- [ ] Check if `pushMetric()` accepts arbitrary `fields: Record<string, unknown>`
- [ ] Verify ring buffer stores L1 fields (syncStatus, highestBlock, txPoolQueued)

#### Step 2: If fields need migration

- [ ] If ring buffer has fixed field list, add L1 fields to schema
- [ ] If using JSON serialization, should work as-is (no changes needed)

#### Step 3: Document findings

- [ ] If no changes needed, commit note:

```bash
git commit --allow-empty -m "docs(v2): verified instance-metrics-store supports arbitrary L1 fields"
```

---

## Chunk 2: DetectorAgent & Protocol Integration

### Task 3: Verify DetectorAgent uses ethereum-el protocol for L1

**Files:**
- Check: `src/core/agents/detector-agent.ts`
- Check: `src/core/instance-orchestrator.ts` (where instances are created)

#### Step 1: Review DetectorAgent protocol flow

- [ ] Open `src/core/agents/detector-agent.ts`
- [ ] Look for: `findProtocol(this.protocolId)`
- [ ] Verify it loads ProtocolDescriptor (field definitions, anomaly config)

#### Step 2: Check instance creation for L1

- [ ] Find where CollectorAgent and DetectorAgent are instantiated
- [ ] Look for: `new DetectorAgent({ instanceId, protocolId })`
- [ ] Verify `protocolId` is set based on CHAIN_TYPE or plugin

#### Step 3: Add L1 instance creation logic (if missing)

- [ ] If `protocolId` is hardcoded to L2 types, modify to:

```typescript
const plugin = getChainPlugin();
let protocolId: NodeType = 'opstack-l2'; // default

if (plugin.nodeLayer === 'l1') {
  protocolId = 'ethereum-el';
} else if (plugin.chainType === 'arbitrum') {
  protocolId = 'arbitrum-nitro';
}
// ... etc

const detectorAgent = new DetectorAgent({ instanceId, protocolId });
```

#### Step 4: Verify ethernet-el descriptor is registered

- [ ] Check if `src/protocols/ethereum-el/descriptor.ts` exports ETHEREUM_EL_DESCRIPTOR
- [ ] Find where descriptors are registered (likely `src/core/instrumentation.ts` or `src/lib/bootstrap.ts`)
- [ ] Verify registration:

```typescript
import { ETHEREUM_EL_DESCRIPTOR } from '@/protocols/ethereum-el/descriptor';
// ...
registerProtocol(ETHEREUM_EL_DESCRIPTOR);
```

#### Step 5: If not registered, add registration

- [ ] Find the bootstrap/instrumentation file
- [ ] Add registration for ETHEREUM_EL_DESCRIPTOR if missing
- [ ] Run: `npm run dev` to verify no registration errors

#### Step 6: Commit

```bash
git commit --allow-empty -m "docs(v2): verified DetectorAgent protocol flow for L1 (ethereum-el)"
```

---

## Chunk 3: Analyzer & Executor Integration

### Task 4: Verify L1 AI prompts and playbooks are used

**Files:**
- Check: `src/core/agents/analyzer-agent.ts`
- Check: `src/core/agents/executor-agent.ts`
- Check: `src/core/agents/playbook-matcher.ts`

#### Step 1: Review AnalyzerAgent prompt injection

- [ ] Open `src/core/agents/analyzer-agent.ts`
- [ ] Look for: how ChainPlugin AI prompts are injected
- [ ] Verify L1EVMPlugin.aiPrompts are used

#### Step 2: Check Executor playbook matching

- [ ] Open `src/core/agents/executor-agent.ts`
- [ ] Look for: playbook matching logic
- [ ] Verify `ChainPlugin.getPlaybooks()` returns L1_EVM_PLAYBOOKS for L1

#### Step 3: Verify playbook matcher

- [ ] Open `src/core/agents/playbook-matcher.ts`
- [ ] Check if it filters playbooks by anomaly type
- [ ] Verify L1 playbooks ('l1-high-block-interval', 'l1-slow-sync', etc.) match L1 anomalies

#### Step 4: If AI prompts/playbooks not injected, add logic

**For AnalyzerAgent:**

```typescript
private buildPrompt(): string {
  const plugin = getChainPlugin();
  const basePrompt = "Analyze this node anomaly...";
  const chainContext = plugin.aiPrompts.anomalyAnalyzerContext;
  return `${basePrompt}\n${chainContext}`;
}
```

**For ExecutorAgent:**

```typescript
private getApplicablePlaybooks(anomaly: DetectionResult): Playbook[] {
  const plugin = getChainPlugin();
  const playbooks = plugin.getPlaybooks();

  // Filter by anomaly type
  return playbooks.filter(pb => {
    if (plugin.nodeLayer === 'l1') {
      // L1-specific playbooks: l1-high-block-interval, l1-slow-sync, etc.
      return pb.key.startsWith('l1-');
    } else {
      // L2-specific playbooks
      return pb.key.startsWith('l2-') || !pb.key.includes('-');
    }
  });
}
```

#### Step 5: Commit

```bash
git commit --allow-empty -m "docs(v2): verified AI prompts and playbooks flow for L1"
```

---

## Chunk 4: End-to-End Testing

### Task 5: E2E integration test

**Files:**
- Create: `src/core/agents/__tests__/scenarios/S-L1EVM-V2.test.ts`

#### Step 1: Write E2E test scaffold

- [ ] Create `src/core/agents/__tests__/scenarios/S-L1EVM-V2.test.ts`:

```typescript
/**
 * E2E test: L1 EVM node monitoring via V2 orchestrator
 * Scenario: Start orchestrator with CHAIN_TYPE=l1-evm, verify full pipeline
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AgentOrchestrator } from '@/core/agent-orchestrator';
import type { DetectionResult } from '@/core/anomaly/generic-detector';

describe('S-L1EVM-V2: L1 EVM monitoring end-to-end', () => {
  let orchestrator: AgentOrchestrator | null = null;

  beforeEach(() => {
    process.env.CHAIN_TYPE = 'l1-evm';
    process.env.L1_RPC_URL = 'http://localhost:8545';
    process.env.DEPLOYMENT_TYPE = 'external';
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.stop();
      orchestrator = null;
    }
  });

  it('orchestrator uses ethereum-el protocol for L1 instances', async () => {
    orchestrator = new AgentOrchestrator({
      instanceId: 'test-l1-node',
      rpcUrl: 'http://localhost:8545',
      protocolId: 'ethereum-el',
    });

    await orchestrator.start();
    expect(orchestrator.isRunning()).toBe(true);

    // Collector should use collectL1NodeMetrics
    // Detector should use ethereum-el descriptor
    // Analyzer should inject L1 prompts
    // Executor should use L1 playbooks
  });

  it('detects L1 anomalies (syncGap > 100)', async () => {
    // Mock: collectL1NodeMetrics returns syncGap = 500
    // Expected: DetectorAgent emits anomaly-detected event
    // Expected: Analyzer classifies as 'l1-slow-sync'
    // Expected: Executor matches 'l1-slow-sync' playbook
  });

  it('detects L1 anomalies (peerCount < 20)', async () => {
    // Mock: collectL1NodeMetrics returns peerCount = 5
    // Expected: DetectorAgent emits anomaly-detected event
    // Expected: Analyzer classifies as 'l1-peer-isolation'
  });

  it('skips guarded actions on external deployment', async () => {
    process.env.DEPLOYMENT_TYPE = 'external';

    // Mock: anomaly detected, remediation triggered
    // Expected: Executor skips 'restart' action
    // Expected: Executor allows 'monitor' and 'alert' actions
  });
});
```

#### Step 2: Write minimal test cases

- [ ] Fill in test bodies with:
  - Mock RPC responses
  - Verify orchestrator starts with correct protocol
  - Verify event flow (collect → detect → analyze → execute)

#### Step 3: Run test

- [ ] Run: `npx vitest run src/core/agents/__tests__/scenarios/S-L1EVM-V2.test.ts`
- [ ] Expected: all tests pass

#### Step 4: Commit

```bash
git add src/core/agents/__tests__/scenarios/S-L1EVM-V2.test.ts
git commit -m "test(v2): add E2E scenario test for L1 EVM monitoring"
```

---

### Task 6: Integration verification

#### Step 1: TypeScript check

- [ ] Run: `npx tsc --noEmit 2>&1 | head -20`
- [ ] Expected: 0 errors in src/core

#### Step 2: Build

- [ ] Run: `npm run build 2>&1 | tail -10`
- [ ] Expected: success (0 errors, ≤2 warnings)

#### Step 3: Full test suite

- [ ] Run: `npm run test:run 2>&1 | tail -30`
- [ ] Expected: all tests pass (including new S-L1EVM-V2)

#### Step 4: Manual smoke test (local)

- [ ] If you have local Geth/Reth node, run:

```bash
export CHAIN_TYPE=l1-evm
export L1_RPC_URL=http://localhost:8545
export DEPLOYMENT_TYPE=external
npm run dev
```

- [ ] Check logs for:
  ```
  [CollectorAgent:...] L1 collection — blockHeight=...
  [DetectorAgent:...] Protocol ethereum-el loaded
  [AnalyzerAgent:...] Anomaly analysis (L1 context)
  ```

#### Step 5: Final commit

```bash
git add -A
git commit -m "feat(v2): L1 EVM plugin integration complete, all tests passing"
```

---

## Implementation Notes

### Design Decisions

1. **nodeLayer branching**: V2 agents branch on `ChainPlugin.nodeLayer === 'l1'` instead of `CHAIN_TYPE`. This allows future 'both' mode (monitoring L1+L2 simultaneously).

2. **Protocol separation**: Using separate `ethereum-el` protocol instead of embedding L1 logic in existing L2 protocols. Cleaner separation, easier to extend.

3. **collectL1NodeMetrics reuse**: The standalone `collectL1NodeMetrics()` function is already tested; V2 CollectorAgent just wraps it. No duplication.

4. **Deployment type detection**: CollectorAgent detects deployment (k8s/docker/external) from env. Used by `collectL1NodeMetrics()` to control resource metric availability.

5. **SyncStatus conversion**: L1 syncing status is mapped to 0-100 percent scale (0 = not synced, 100 = fully synced) for compatibility with generic DetectorAgent anomaly thresholds.

### Migration Path

- **Phase 1 (this plan)**: CollectorAgent → DetectorAgent pipeline
- **Phase 2 (future)**: Analyzer + Executor integration testing
- **Phase 3 (future)**: Multi-instance orchestration (multiple L1 nodes)

### Testing Strategy

1. **Unit tests**: Existing `l1-node-metrics.test.ts` already covers L1 collection
2. **Integration tests**: New `S-L1EVM-V2.test.ts` covers agent orchestration
3. **E2E tests**: Manual smoke test with real L1 RPC endpoint

### Known Gaps

- [ ] RCA engine (RCAAgent) — verify L1 dependency graph is used
- [ ] Verifier agent — verify L1 verification logic exists
- [ ] Remediation engine — verify L1 playbooks are executable
- [ ] Cost optimizer — L1 costs may differ from L2
- [ ] Multi-instance management — orchestrating multiple L1 node instances

---

## Checklist

- [ ] Chunk 1: CollectorAgent integration (collect L1 metrics)
- [ ] Chunk 2: DetectorAgent & Protocol (use ethereum-el descriptor)
- [ ] Chunk 3: Analyzer & Executor (apply L1 prompts/playbooks)
- [ ] Chunk 4: E2E testing & verification
- [ ] All tests passing
- [ ] Build successful
- [ ] Manual smoke test (optional but recommended)

**Next Steps:**
- Execute plan (subagent-driven-development or executing-plans)
- Verify CHAIN_TYPE=l1-evm works end-to-end
- Monitor logs for L1-specific metric collection and anomaly detection
- Test L1 remediation playbooks (monitor, alert, restart)
