# P1-P2 Audit + Agent-for-Hire Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete audit P1-P2 engine improvements and build Agent-for-Hire foundation modules (Experience Store, Pattern Extractor, Agent Resume, Outcome Tracker, Metrics History API).

**Architecture:** Audit P1 tasks harden the engine (faster zero-downtime scaling, parallel NLOps, persistent RCA/prediction history). Audit P2 adds observability (Trace ID). Agent-for-Hire foundation builds on these to accumulate operational experience, extract patterns, generate agent resumes, and track outcomes. All new modules integrate via existing EventBus and IStateStore patterns.

**Tech Stack:** TypeScript (strict), Vitest, Redis (via IStateStore), EventBus (agent-event-bus.ts), Pino logger

---

## Task 1: Zero-Downtime Phase 2 — Exponential Backoff Polling

**Files:**
- Modify: `src/lib/zero-downtime-scaler.ts:270-316` (waitForReady polling loop)
- Test: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**Context:**
`waitForReady()` currently uses a fixed 10s polling interval. The loop at lines 276-316 does `while (Date.now() - startTime < timeoutMs)` with a constant `await _testHooks.sleep(intervalMs)`. We want exponential backoff: [1s, 2s, 5s, 10s, 10s, ...] so initial checks are fast but we don't hammer kubectl.

**Step 1: Write the failing test**

In `src/lib/__tests__/zero-downtime-scaler.test.ts`, add a new test that verifies backoff intervals:

```typescript
it('should use exponential backoff intervals for polling', async () => {
  const sleepCalls: number[] = [];
  const originalSleep = _testHooks.sleep;
  _testHooks.sleep = async (ms: number) => {
    sleepCalls.push(ms);
    // Don't actually sleep
  };

  // Mock: pod not ready for first 4 attempts, then ready on 5th
  let attempt = 0;
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
      attempt++;
      return attempt >= 5 ? 'True' : 'False';
    }
    if (cmd.includes('jsonpath') && cmd.includes('podIP')) {
      return '10.0.0.1';
    }
    if (cmd.includes('exec') && cmd.includes('wget')) {
      return JSON.stringify({ result: '0x1' });
    }
    return '{}';
  });

  await waitForReady('test-pod', testConfig);

  // Verify backoff pattern: 1s, 2s, 5s, 10s
  expect(sleepCalls[0]).toBe(1000);
  expect(sleepCalls[1]).toBe(2000);
  expect(sleepCalls[2]).toBe(5000);
  expect(sleepCalls[3]).toBe(10000);

  _testHooks.sleep = originalSleep;
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "exponential backoff"`
Expected: FAIL — all sleep calls are 10000ms

**Step 3: Implement exponential backoff**

In `src/lib/zero-downtime-scaler.ts`, replace the fixed interval with a backoff schedule. Around lines 270-276:

```typescript
// Before (lines 270-271):
const timeoutMs = parseInt(process.env.ZERO_DOWNTIME_READY_TIMEOUT_MS || '300000', 10);
const intervalMs = parseInt(process.env.ZERO_DOWNTIME_POLL_INTERVAL_MS || '10000', 10);

// After:
const timeoutMs = parseInt(process.env.ZERO_DOWNTIME_READY_TIMEOUT_MS || '300000', 10);
const BACKOFF_INTERVALS = [1000, 2000, 5000, 10000];
```

In the while loop body (around line 285), replace the fixed sleep:

```typescript
// Before:
await _testHooks.sleep(intervalMs);

// After:
const backoffMs = BACKOFF_INTERVALS[Math.min(pollAttempt, BACKOFF_INTERVALS.length - 1)];
await _testHooks.sleep(backoffMs);
pollAttempt++;
```

Add `let pollAttempt = 0;` before the while loop.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "perf(zero-downtime): exponential backoff polling [1s,2s,5s,10s]"
```

---

## Task 2: Zero-Downtime Phase 2 — kubectl Consolidation

**Files:**
- Modify: `src/lib/zero-downtime-scaler.ts:278-303` (3 kubectl calls → 1 combined + parallel RPC)
- Test: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**Context:**
`waitForReady()` makes 3 sequential kubectl calls per poll: (1) get Ready status, (2) get podIP, (3) exec wget for RPC check. We consolidate (1)+(2) into a single jsonpath call and run (3) in parallel once the pod is Ready.

**Step 1: Write the failing test**

```typescript
it('should use single kubectl call for ready+ip check', async () => {
  const kubectlCmds: string[] = [];
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    kubectlCmds.push(cmd);
    if (cmd.includes('jsonpath') && cmd.includes('Ready')) {
      // Combined response: "True,10.0.0.1"
      return 'True,10.0.0.1';
    }
    if (cmd.includes('exec') && cmd.includes('wget')) {
      return JSON.stringify({ result: '0x1' });
    }
    // Phase 1/3/4/5 mocks
    return setupFullSuccessMocks_passthrough(cmd);
  });

  await zeroDowntimeScale(2, 4, testConfig);

  // In the ready-check phase, only 1 kubectl get (not 2 separate)
  const readyCheckCmds = kubectlCmds.filter(c =>
    c.includes('get pod') && c.includes('jsonpath')
  );
  // Each poll attempt should have exactly 1 jsonpath call (combined), not 2
  const uniquePatterns = new Set(readyCheckCmds.map(c => c.includes('podIP') ? 'combined' : 'ready-only'));
  expect(readyCheckCmds.every(c => c.includes('podIP'))).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "single kubectl"`
Expected: FAIL — separate calls exist

**Step 3: Implement consolidated kubectl**

In `src/lib/zero-downtime-scaler.ts`, replace lines 279-303 (the 3 separate kubectl calls):

```typescript
// Combined Ready + PodIP in one call
const combined = await runK8sCommand(
  `get pod ${podName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status},{.status.podIP}'`,
  { timeout: 10000 }
);
const [readyStatus, podIP] = combined.replace(/'/g, '').trim().split(',');

if (readyStatus !== 'True' || !podIP) {
  continue;
}

// RPC liveness check (only after pod is ready)
const rpcCheckTimeoutMs = parseInt(process.env.RPC_CHECK_TIMEOUT_MS || '15000', 10);
const rpcResponse = await runK8sCommand(
  `exec ${podName} -n ${namespace} -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
  { timeout: rpcCheckTimeoutMs }
);
const parsed = JSON.parse(rpcResponse);
if (parsed.result) {
  const blockNumber = parseInt(parsed.result, 16);
  return { ready: true, blockNumber };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
Expected: ALL PASS (update mocks in `setupFullSuccessMocks` if needed to return combined format)

**Step 5: Commit**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "perf(zero-downtime): consolidate 3 kubectl calls to 1+1 per poll"
```

---

## Task 3: Zero-Downtime Phase 2 — Partial Rollback

**Files:**
- Modify: `src/lib/zero-downtime-scaler.ts:335-379` (switchTraffic error handling)
- Test: `src/lib/__tests__/zero-downtime-scaler.test.ts`

**Context:**
`switchTraffic()` has no recovery when labeling fails mid-switch. If the new pod gets `slot=active` but the old pod label fails, both pods could be active. We add partial rollback: on error, re-label old pod as active.

**Step 1: Write the failing test**

```typescript
it('should partial-rollback on traffic switch label failure', async () => {
  let labelAttempts = 0;
  mockRunK8sCommand.mockImplementation(async (cmd: string) => {
    // Phase 1-2 succeed normally
    if (cmd.includes('apply') || cmd.includes('jsonpath')) {
      return setupFullSuccessMocks_passthrough(cmd);
    }
    // Phase 3: traffic switch
    if (cmd.includes('label') && cmd.includes('slot=draining')) {
      // Fail on draining label (old pod)
      throw new Error('kubectl label failed: connection refused');
    }
    if (cmd.includes('label') && cmd.includes('slot=active')) {
      labelAttempts++;
      return 'labeled';
    }
    return setupFullSuccessMocks_passthrough(cmd);
  });

  const result = await zeroDowntimeScale(2, 4, testConfig);

  // Should have attempted recovery (re-labeling old pod as active)
  expect(labelAttempts).toBeGreaterThanOrEqual(2); // initial + recovery
  expect(result.success).toBe(false);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts -t "partial-rollback"`
Expected: FAIL

**Step 3: Implement partial rollback**

In `src/lib/zero-downtime-scaler.ts`, wrap the traffic switch label operations (lines 362-371) with try-catch and recovery:

```typescript
// Label standby as active
await runK8sCommand(
  `label pod ${standbyPodName} -n ${namespace} slot=active --overwrite`,
  { timeout: 10000 }
);

try {
  // Label old pod as draining
  await runK8sCommand(
    `label pod ${oldPodName} -n ${namespace} slot=draining --overwrite`,
    { timeout: 10000 }
  );
} catch (err) {
  logger.error('[ZeroDowntime] Failed to label old pod as draining, rolling back', { error: err });
  // Recovery: re-label old pod as active, remove standby active label
  try {
    await runK8sCommand(
      `label pod ${oldPodName} -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
    await runK8sCommand(
      `label pod ${standbyPodName} -n ${namespace} slot=standby --overwrite`,
      { timeout: 10000 }
    );
    logger.info('[ZeroDowntime] Partial rollback successful');
  } catch (rollbackErr) {
    logger.error('[ZeroDowntime] Partial rollback also failed', { error: rollbackErr });
  }
  return { success: false, previousSelector: {}, newSelector: {}, serviceName };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/zero-downtime-scaler.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/lib/zero-downtime-scaler.ts src/lib/__tests__/zero-downtime-scaler.test.ts
git commit -m "feat(zero-downtime): partial rollback on traffic switch failure"
```

---

## Task 4: NLOps Tool Parallelization

**Files:**
- Modify: `src/lib/nlops-engine.ts:549-552` (sequential tool loop → Promise.allSettled)
- Test: `src/lib/__tests__/nlops-engine.test.ts`

**Context:**
NLOps `processCommand()` at lines 549-552 executes tools sequentially in a for-loop. Multiple independent tools (e.g. `get_metrics` + `get_anomalies`) should run in parallel. Dangerous tools (`scale_node`, `update_config`) are already gated by confirmation flow before this point, so parallelization is safe.

**Step 1: Write the failing test**

```typescript
it('should execute multiple tools in parallel', async () => {
  const executionOrder: { tool: string; time: number }[] = [];
  const startTime = Date.now();

  // Mock 2 tool calls that each take ~50ms
  mockFetch.mockImplementation(async (url: string) => {
    const toolName = url.includes('metrics') ? 'get_metrics' : 'get_anomalies';
    await new Promise(r => setTimeout(r, 50));
    executionOrder.push({ tool: toolName, time: Date.now() - startTime });
    return new Response(JSON.stringify({ success: true }));
  });

  mockPlanResponse([
    { name: 'get_metrics', params: {} },
    { name: 'get_anomalies', params: {} },
  ]);

  const result = await processCommand('show metrics and anomalies', 'http://localhost:3002');

  // If parallel, both should complete in ~50ms total (not ~100ms)
  // With sequential, second tool starts after first finishes
  expect(executionOrder.length).toBe(2);
  // Both should start within 20ms of each other (parallel)
  const timeDiff = Math.abs(executionOrder[0].time - executionOrder[1].time);
  expect(timeDiff).toBeLessThan(40); // parallel: near-simultaneous
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/nlops-engine.test.ts -t "parallel"`
Expected: FAIL — timeDiff will be ~50ms (sequential)

**Step 3: Implement parallel execution**

In `src/lib/nlops-engine.ts`, replace lines 549-552:

```typescript
// Before:
for (const tc of toolCalls) {
  const data = await executeTool(tc.name, tc.params, baseUrl);
  toolResults.push({ name: tc.name, data });
}

// After:
const toolPromises = toolCalls.map(tc =>
  executeTool(tc.name, tc.params, baseUrl)
    .then(data => ({ name: tc.name, data }))
    .catch(err => ({ name: tc.name, data: { error: err.message } }))
);
const toolResults = await Promise.all(toolPromises);

const failedTools = toolResults.filter(r => r.data?.error);
if (failedTools.length > 0) {
  logger.warn('[NLOps] Some tools failed', {
    failed: failedTools.map(r => ({ name: r.name, error: r.data.error })),
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/nlops-engine.test.ts`
Expected: ALL PASS (existing tests for partial failure should still work since error shape is preserved)

**Step 5: Commit**

```bash
git add src/lib/nlops-engine.ts src/lib/__tests__/nlops-engine.test.ts
git commit -m "perf(nlops): parallelize tool execution with Promise.all"
```

---

## Task 5: RCA History Redis Migration

**Files:**
- Modify: `src/lib/rca-engine.ts:57-65,531-565` (in-memory array → IStateStore)
- Modify: `src/types/redis.ts` (add RCA history methods to IStateStore)
- Modify: `src/lib/redis-store.ts` (implement RCA history in both RedisStateStore and InMemoryStateStore)
- Test: `src/lib/__tests__/rca-engine.test.ts:219-309`

**Context:**
RCA history is stored in a global `let rcaHistory: RCAHistoryEntry[] = []` (line 63). Max 20 items. On process restart, all history is lost. We migrate to IStateStore so Redis-backed deployments persist history across restarts.

**Step 1: Add IStateStore methods**

In `src/types/redis.ts`, add to the IStateStore interface (after the existing prediction tracker section, ~line 181):

```typescript
// RCA History
addRCAHistory(entry: RCAHistoryEntry): Promise<void>;
getRCAHistory(limit?: number): Promise<RCAHistoryEntry[]>;
getRCAById(id: string): Promise<RCAHistoryEntry | undefined>;
getRCAHistoryCount(): Promise<number>;
```

Import the type at the top of `src/types/redis.ts`:
```typescript
import type { RCAHistoryEntry } from './rca';
```

**Step 2: Implement in RedisStateStore**

In `src/lib/redis-store.ts`, add to RedisStateStore class (after prediction tracker methods, ~line 762):

```typescript
// --- RCA History ---
private readonly RCA_HISTORY_MAX = 100;
private readonly RCA_HISTORY_TTL = 7 * 24 * 60 * 60; // 7 days

async addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  const data = JSON.stringify(entry);
  await this.client.lpush(this.key('rca:history'), data);
  await this.client.ltrim(this.key('rca:history'), 0, this.RCA_HISTORY_MAX - 1);
  await this.client.expire(this.key('rca:history'), this.RCA_HISTORY_TTL);
}

async getRCAHistory(limit: number = 20): Promise<RCAHistoryEntry[]> {
  const items = await this.client.lrange(this.key('rca:history'), 0, limit - 1);
  return items.map(item => JSON.parse(item));
}

async getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  const all = await this.client.lrange(this.key('rca:history'), 0, this.RCA_HISTORY_MAX - 1);
  for (const item of all) {
    const entry: RCAHistoryEntry = JSON.parse(item);
    if (entry.id === id) return entry;
  }
  return undefined;
}

async getRCAHistoryCount(): Promise<number> {
  return this.client.llen(this.key('rca:history'));
}
```

**Step 3: Implement in InMemoryStateStore**

In the InMemoryStateStore class (same file), add:

```typescript
private rcaHistory: RCAHistoryEntry[] = [];

async addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  this.rcaHistory.unshift(entry);
  if (this.rcaHistory.length > 100) this.rcaHistory.pop();
}

async getRCAHistory(limit: number = 20): Promise<RCAHistoryEntry[]> {
  return this.rcaHistory.slice(0, limit);
}

async getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  return this.rcaHistory.find(e => e.id === id);
}

async getRCAHistoryCount(): Promise<number> {
  return this.rcaHistory.length;
}
```

**Step 4: Update rca-engine.ts to use store**

In `src/lib/rca-engine.ts`:

1. Remove line 63: `let rcaHistory: RCAHistoryEntry[] = [];`
2. Add import: `import { getStore } from '@/lib/redis-store';`
3. Replace history functions (lines 531-565):

```typescript
export async function addRCAHistory(entry: RCAHistoryEntry): Promise<void> {
  const store = getStore();
  await store.addRCAHistory(entry);
}

export async function getRCAHistory(limit?: number): Promise<RCAHistoryEntry[]> {
  const store = getStore();
  return store.getRCAHistory(limit);
}

export async function getRCAById(id: string): Promise<RCAHistoryEntry | undefined> {
  const store = getStore();
  return store.getRCAById(id);
}

export async function getRCAHistoryCount(): Promise<number> {
  const store = getStore();
  return store.getRCAHistoryCount();
}
```

**Step 5: Update tests**

Existing tests at lines 219-309 test the same public API (`addRCAHistory`, `getRCAHistory`, etc.). They should continue to work if the InMemoryStateStore is the default. Verify:

Run: `npx vitest run src/lib/__tests__/rca-engine.test.ts`
Expected: ALL PASS (behavior unchanged, storage backend changed)

**Step 6: Commit**

```bash
git add src/types/redis.ts src/lib/redis-store.ts src/lib/rca-engine.ts src/lib/__tests__/rca-engine.test.ts
git commit -m "feat(rca): migrate history from in-memory to IStateStore (Redis/InMemory)"
```

---

## Task 6: Prediction Accuracy Tracking

**Files:**
- Modify: `src/lib/predictive-scaler.ts:214-275` (add accuracy recording after prediction verification)
- Modify: `src/types/redis.ts` (IStateStore already has prediction tracker methods at lines 176-181)
- Test: `src/lib/__tests__/predictive-scaler.test.ts`

**Context:**
`PredictionRecord` type already exists in `src/types/prediction.ts:84-99` with fields: `id`, `prediction`, `actualVcpu?`, `wasAccurate?`, `verifiedAt?`. IStateStore already has `addPredictionRecord`, `updatePredictionRecord`, `getPredictionRecords`. The store implementations already exist. We just need to wire prediction → record → verify in the engine.

**Step 1: Write the failing test**

```typescript
it('should record prediction for later accuracy verification', async () => {
  // Mock AI to return a prediction
  mockChatCompletion.mockResolvedValueOnce('{"predictedVcpu":4,"confidence":0.85,"trend":"rising","reasoning":"test","recommendedAction":"scale_up","predictionWindow":"5min","factors":[]}');

  const result = await predictScaling(mockMetrics);

  // Verify prediction was recorded in store
  const store = getStore();
  const records = await store.getPredictionRecords(1);
  expect(records.length).toBe(1);
  expect(records[0].prediction.predictedVcpu).toBe(4);
  expect(records[0].actualVcpu).toBeUndefined(); // not verified yet
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/predictive-scaler.test.ts -t "record prediction"`
Expected: FAIL — no record stored

**Step 3: Implement prediction recording**

In `src/lib/predictive-scaler.ts`, after a successful prediction is returned (around line 260), add:

```typescript
// Record prediction for accuracy tracking
const predictionRecord: PredictionRecord = {
  id: `pred-${Date.now()}`,
  prediction: result,
};
await store.addPredictionRecord(predictionRecord);
```

Add import for `PredictionRecord` from `@/types/prediction`.

**Step 4: Add verification function**

Export a new function to verify prediction accuracy (called by agent-loop after scaling executes):

```typescript
export async function verifyPredictionAccuracy(
  actualVcpu: TargetVcpu
): Promise<void> {
  const store = getStore();
  const records = await store.getPredictionRecords(1);
  if (records.length === 0) return;

  const latest = records[0];
  if (latest.verifiedAt) return; // already verified

  const wasAccurate = latest.prediction.predictedVcpu === actualVcpu;
  await store.updatePredictionRecord(latest.id, {
    actualVcpu,
    wasAccurate,
    verifiedAt: new Date().toISOString(),
  });

  logger.info('[Prediction] Accuracy verified', {
    predicted: latest.prediction.predictedVcpu,
    actual: actualVcpu,
    accurate: wasAccurate,
  });
}
```

**Step 5: Write verification test**

```typescript
it('should verify prediction accuracy when actual vCPU is known', async () => {
  const store = getStore();
  await store.addPredictionRecord({
    id: 'pred-test',
    prediction: { predictedVcpu: 4, confidence: 0.85 } as PredictionResult,
  });

  await verifyPredictionAccuracy(4);

  const records = await store.getPredictionRecords(1);
  expect(records[0].wasAccurate).toBe(true);
  expect(records[0].verifiedAt).toBeDefined();
});
```

**Step 6: Run all tests**

Run: `npx vitest run src/lib/__tests__/predictive-scaler.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/lib/predictive-scaler.ts src/lib/__tests__/predictive-scaler.test.ts
git commit -m "feat(prediction): record predictions and verify accuracy via IStateStore"
```

---

## Task 7: Trace ID Based Request Tracking

**Files:**
- Create: `src/lib/trace-context.ts` (trace ID generation and propagation)
- Modify: `src/app/api/metrics/route.ts` (add trace header)
- Modify: `src/lib/rca-engine.ts` (accept and log traceId)
- Modify: `src/lib/scaling-decision.ts` (accept and log traceId)
- Modify: `src/lib/anomaly-detector.ts` (accept and log traceId)
- Test: `src/lib/__tests__/trace-context.test.ts`

**Context:**
Currently there is no way to trace a request from API → anomaly detection → RCA → scaling decision. The v2 agent system already uses `correlationId` in AgentEvent. We create a lightweight trace context that works for both the v1 API pipeline and v2 agent pipeline.

**Step 1: Write the test**

Create `src/lib/__tests__/trace-context.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateTraceId, withTraceId, getTraceId } from '@/lib/trace-context';

describe('trace-context', () => {
  it('should generate unique trace IDs', () => {
    const id1 = generateTraceId();
    const id2 = generateTraceId();
    expect(id1).toMatch(/^tr-[a-z0-9]+$/);
    expect(id2).toMatch(/^tr-[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it('should propagate trace ID via AsyncLocalStorage', async () => {
    const traceId = 'tr-test123';
    let captured: string | undefined;

    await withTraceId(traceId, async () => {
      captured = getTraceId();
    });

    expect(captured).toBe(traceId);
  });

  it('should return undefined outside trace context', () => {
    expect(getTraceId()).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/trace-context.test.ts`
Expected: FAIL — module not found

**Step 3: Implement trace context**

Create `src/lib/trace-context.ts`:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

interface TraceContext {
  traceId: string;
}

const traceStorage = new AsyncLocalStorage<TraceContext>();

export function generateTraceId(): string {
  return `tr-${randomBytes(8).toString('hex')}`;
}

export function withTraceId<T>(traceId: string, fn: () => T | Promise<T>): T | Promise<T> {
  return traceStorage.run({ traceId }, fn);
}

export function getTraceId(): string | undefined {
  return traceStorage.getStore()?.traceId;
}
```

**Step 4: Run test**

Run: `npx vitest run src/lib/__tests__/trace-context.test.ts`
Expected: PASS

**Step 5: Add trace ID to metrics API route**

In `src/app/api/metrics/route.ts`, at the top of the GET handler:

```typescript
import { generateTraceId, withTraceId } from '@/lib/trace-context';

export async function GET(request: NextRequest) {
  const traceId = request.headers.get('x-trace-id') || generateTraceId();

  return withTraceId(traceId, async () => {
    // ... existing handler body ...
    const response = NextResponse.json(data);
    response.headers.set('x-trace-id', traceId);
    return response;
  });
}
```

**Step 6: Add trace ID to logger output**

In `src/lib/logger.ts`, modify `writeLog` to include traceId if present:

```typescript
import { getTraceId } from '@/lib/trace-context';

// In writeLog or wrapLogger, add traceId to log bindings:
const traceId = getTraceId();
if (traceId) {
  target[level]({ traceId }, formatted);
} else {
  target[level](formatted);
}
```

**Step 7: Run full test suite**

Run: `npx vitest run src/lib/__tests__/trace-context.test.ts`
Expected: ALL PASS

**Step 8: Commit**

```bash
git add src/lib/trace-context.ts src/lib/__tests__/trace-context.test.ts src/app/api/metrics/route.ts src/lib/logger.ts
git commit -m "feat(observability): trace ID context propagation via AsyncLocalStorage"
```

---

## Task 8: Experience Store

**Files:**
- Create: `src/lib/experience-store.ts`
- Modify: `src/types/redis.ts` (add experience store methods to IStateStore)
- Modify: `src/lib/redis-store.ts` (implement experience methods)
- Test: `src/lib/__tests__/experience-store.test.ts`

**Context:**
The Experience Store captures operational events from VerifierAgent outcomes (via `verification-complete` EventBus events) and enriches them with metrics context. This is the foundation for the Agent-for-Hire model — agents accumulate verifiable experience over time. Builds on top of the existing OperationLedger (`src/core/playbook-system/store.ts`) and IStateStore patterns.

The playbook system already stores `OperationRecord` per instance. The Experience Store aggregates these into **ExperienceEntry** records that include:
- The operation outcome (from VerifierAgent)
- Metrics context (from InstanceMetricsStore)
- Protocol type (from instance registry)
- Pattern category (from trigger signature)

**Step 1: Define types**

Create `src/types/experience.ts`:

```typescript
export interface ExperienceEntry {
  id: string;
  instanceId: string;
  protocolId: string;
  timestamp: string;
  category: 'anomaly-resolution' | 'scaling-action' | 'rca-diagnosis' | 'remediation';
  trigger: {
    type: string;         // e.g., 'z-score', 'threshold', 'plateau'
    metric: string;       // e.g., 'cpuUsage', 'gasUsedRatio'
    value: number;
  };
  action: string;           // what was done
  outcome: 'success' | 'failure' | 'partial';
  resolutionMs: number;
  metricsSnapshot: Record<string, number>;  // key metrics at time of event
  traceId?: string;
}

export interface ExperienceStats {
  totalOperations: number;
  successRate: number;
  avgResolutionMs: number;
  topCategories: { category: string; count: number }[];
  operatingDays: number;
}
```

**Step 2: Add IStateStore methods**

In `src/types/redis.ts`, add to the IStateStore interface:

```typescript
// Experience Store
addExperience(entry: ExperienceEntry): Promise<void>;
getExperience(limit?: number, offset?: number): Promise<ExperienceEntry[]>;
getExperienceByInstance(instanceId: string, limit?: number): Promise<ExperienceEntry[]>;
getExperienceCount(): Promise<number>;
getExperienceStats(): Promise<ExperienceStats>;
```

**Step 3: Implement in both stores**

RedisStateStore — use LPUSH + LRANGE list pattern (same as RCA history).
InMemoryStateStore — use array with push/slice.

Key constants: `EXPERIENCE_MAX = 5000`, `EXPERIENCE_TTL = 90 * 24 * 60 * 60` (90 days).

**Step 4: Write tests**

Create `src/lib/__tests__/experience-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { recordExperience, getExperienceLog, getExperienceStats } from '@/lib/experience-store';

describe('experience-store', () => {
  beforeEach(async () => {
    // reset store
  });

  it('should record an experience entry', async () => {
    await recordExperience({
      instanceId: 'inst-1',
      protocolId: 'opstack',
      category: 'scaling-action',
      trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
      action: 'scale_up 2→4 vCPU',
      outcome: 'success',
      resolutionMs: 45000,
      metricsSnapshot: { cpuUsage: 85, gasUsedRatio: 0.7 },
    });

    const log = await getExperienceLog(10);
    expect(log.length).toBe(1);
    expect(log[0].category).toBe('scaling-action');
    expect(log[0].outcome).toBe('success');
  });

  it('should calculate experience stats', async () => {
    // Add 3 entries: 2 success, 1 failure
    await recordExperience({ /* success */ });
    await recordExperience({ /* success */ });
    await recordExperience({ /* failure */ });

    const stats = await getExperienceStats();
    expect(stats.totalOperations).toBe(3);
    expect(stats.successRate).toBeCloseTo(0.667, 2);
  });
});
```

**Step 5: Implement experience-store.ts**

Create `src/lib/experience-store.ts`:

```typescript
import { getStore } from '@/lib/redis-store';
import { getTraceId } from '@/lib/trace-context';
import { randomUUID } from 'node:crypto';
import type { ExperienceEntry, ExperienceStats } from '@/types/experience';

export async function recordExperience(
  input: Omit<ExperienceEntry, 'id' | 'timestamp' | 'traceId'>
): Promise<ExperienceEntry> {
  const entry: ExperienceEntry = {
    ...input,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    traceId: getTraceId(),
  };
  const store = getStore();
  await store.addExperience(entry);
  return entry;
}

export async function getExperienceLog(
  limit: number = 50,
  offset: number = 0
): Promise<ExperienceEntry[]> {
  const store = getStore();
  return store.getExperience(limit, offset);
}

export async function getExperienceStats(): Promise<ExperienceStats> {
  const store = getStore();
  return store.getExperienceStats();
}
```

**Step 6: Run tests**

Run: `npx vitest run src/lib/__tests__/experience-store.test.ts`
Expected: ALL PASS

**Step 7: Commit**

```bash
git add src/types/experience.ts src/lib/experience-store.ts src/lib/__tests__/experience-store.test.ts src/types/redis.ts src/lib/redis-store.ts
git commit -m "feat(experience): experience store for operational knowledge accumulation"
```

---

## Task 9: Pattern Extractor

**Files:**
- Create: `src/lib/pattern-extractor.ts`
- Create: `src/types/pattern.ts`
- Test: `src/lib/__tests__/pattern-extractor.test.ts`

**Context:**
The Pattern Extractor analyzes ExperienceEntry records to discover repeatable operational patterns. It builds on the existing `incident-analyzer.ts` (`src/core/playbook-system/incident-analyzer.ts`) which already groups OperationRecords by trigger signature. The Pattern Extractor works at a higher level: it identifies cross-instance, cross-time patterns from the Experience Store.

A **Pattern** is: "When [trigger condition], doing [action] has [success rate] over [N occurrences]."

**Step 1: Define types**

Create `src/types/pattern.ts`:

```typescript
export interface OperationalPattern {
  id: string;
  signature: string;          // e.g., "z-score|cpuUsage|3.0-4.0|scale_up"
  description: string;        // human-readable
  trigger: {
    type: string;
    metric: string;
    valueRange: [number, number];
  };
  action: string;
  occurrences: number;
  successRate: number;         // 0-1
  avgResolutionMs: number;
  confidence: number;          // 0-1 (based on occurrences + success rate)
  protocols: string[];         // which protocol types this pattern applies to
  firstSeen: string;
  lastSeen: string;
}

export interface PatternExtractionResult {
  patterns: OperationalPattern[];
  totalExperienceAnalyzed: number;
  extractedAt: string;
}
```

**Step 2: Write tests**

Create `src/lib/__tests__/pattern-extractor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { ExperienceEntry } from '@/types/experience';

describe('pattern-extractor', () => {
  const makeEntry = (overrides: Partial<ExperienceEntry> = {}): ExperienceEntry => ({
    id: `exp-${Math.random()}`,
    instanceId: 'inst-1',
    protocolId: 'opstack',
    timestamp: new Date().toISOString(),
    category: 'scaling-action',
    trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 },
    action: 'scale_up',
    outcome: 'success',
    resolutionMs: 45000,
    metricsSnapshot: { cpuUsage: 85 },
    ...overrides,
  });

  it('should extract pattern from repeated similar experiences', () => {
    const entries = [
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.2 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.7 } }),
      makeEntry({ trigger: { type: 'z-score', metric: 'cpuUsage', value: 3.5 } }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(1);
    expect(result.patterns[0].occurrences).toBe(3);
    expect(result.patterns[0].successRate).toBe(1.0);
    expect(result.patterns[0].trigger.metric).toBe('cpuUsage');
  });

  it('should require minimum 3 occurrences for a pattern', () => {
    const entries = [makeEntry(), makeEntry()]; // only 2
    const result = extractPatterns(entries);
    expect(result.patterns.length).toBe(0);
  });

  it('should calculate confidence from occurrences and success rate', () => {
    const entries = [
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'success' }),
      makeEntry({ outcome: 'failure' }),
      makeEntry({ outcome: 'success' }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns[0].confidence).toBeGreaterThan(0);
    expect(result.patterns[0].confidence).toBeLessThan(1);
    expect(result.patterns[0].successRate).toBe(0.75);
  });

  it('should track multiple protocols in a pattern', () => {
    const entries = [
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'opstack' }),
      makeEntry({ protocolId: 'arbitrum' }),
    ];

    const result = extractPatterns(entries);
    expect(result.patterns[0].protocols).toContain('opstack');
    expect(result.patterns[0].protocols).toContain('arbitrum');
  });
});
```

**Step 3: Implement**

Create `src/lib/pattern-extractor.ts`:

```typescript
import type { ExperienceEntry } from '@/types/experience';
import type { OperationalPattern, PatternExtractionResult } from '@/types/pattern';
import { randomUUID } from 'node:crypto';

const MIN_OCCURRENCES = 3;

function buildSignature(entry: ExperienceEntry): string {
  const valueBucket = Math.floor(entry.trigger.value);
  return `${entry.trigger.type}|${entry.trigger.metric}|${valueBucket}|${entry.action}`;
}

export function extractPatterns(
  entries: ExperienceEntry[],
  minOccurrences: number = MIN_OCCURRENCES
): PatternExtractionResult {
  // Group by signature
  const groups = new Map<string, ExperienceEntry[]>();
  for (const entry of entries) {
    const sig = buildSignature(entry);
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig)!.push(entry);
  }

  const patterns: OperationalPattern[] = [];

  for (const [signature, group] of groups) {
    if (group.length < minOccurrences) continue;

    const successes = group.filter(e => e.outcome === 'success').length;
    const successRate = successes / group.length;
    const avgResolutionMs = group.reduce((s, e) => s + e.resolutionMs, 0) / group.length;
    const protocols = [...new Set(group.map(e => e.protocolId))];
    const values = group.map(e => e.trigger.value);
    const confidence = Math.min(1, (Math.log2(group.length) / 5) * successRate);

    const sorted = group.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    patterns.push({
      id: randomUUID(),
      signature,
      description: `When ${group[0].trigger.metric} ${group[0].trigger.type} triggers (${Math.min(...values).toFixed(1)}-${Math.max(...values).toFixed(1)}), ${group[0].action} succeeds ${(successRate * 100).toFixed(0)}% of the time`,
      trigger: {
        type: group[0].trigger.type,
        metric: group[0].trigger.metric,
        valueRange: [Math.min(...values), Math.max(...values)],
      },
      action: group[0].action,
      occurrences: group.length,
      successRate,
      avgResolutionMs,
      confidence,
      protocols,
      firstSeen: sorted[0].timestamp,
      lastSeen: sorted[sorted.length - 1].timestamp,
    });
  }

  return {
    patterns: patterns.sort((a, b) => b.confidence - a.confidence),
    totalExperienceAnalyzed: entries.length,
    extractedAt: new Date().toISOString(),
  };
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/pattern-extractor.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/types/pattern.ts src/lib/pattern-extractor.ts src/lib/__tests__/pattern-extractor.test.ts
git commit -m "feat(patterns): pattern extractor from operational experience"
```

---

## Task 10: Agent Resume Generator

**Files:**
- Create: `src/lib/agent-resume.ts`
- Create: `src/types/agent-resume.ts`
- Create: `src/app/api/v2/instances/[id]/resume/route.ts`
- Test: `src/lib/__tests__/agent-resume.test.ts`

**Context:**
Agent Resume is the public-facing proof of an agent's operational experience. It reads from Experience Store (Task 8) and Pattern Extractor (Task 9) to generate a structured profile. This is the "CV" of the agent that operators see before hiring.

**Step 1: Define types**

Create `src/types/agent-resume.ts`:

```typescript
import type { ExperienceStats } from './experience';
import type { OperationalPattern } from './pattern';

export type ExperienceTier = 'trainee' | 'junior' | 'senior' | 'expert';

export interface AgentResume {
  instanceId: string;
  protocolId: string;
  tier: ExperienceTier;
  operatingSince: string;              // ISO date
  stats: ExperienceStats;
  topPatterns: OperationalPattern[];   // top 5 by confidence
  specialties: string[];               // derived from pattern categories
  generatedAt: string;
}
```

**Step 2: Write tests**

Create `src/lib/__tests__/agent-resume.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateResume, calculateTier } from '@/lib/agent-resume';

describe('agent-resume', () => {
  describe('calculateTier', () => {
    it('should return trainee for < 30 days', () => {
      expect(calculateTier(15)).toBe('trainee');
    });

    it('should return junior for 30-90 days', () => {
      expect(calculateTier(45)).toBe('junior');
    });

    it('should return senior for 90-180 days', () => {
      expect(calculateTier(120)).toBe('senior');
    });

    it('should return expert for 180+ days', () => {
      expect(calculateTier(200)).toBe('expert');
    });
  });

  describe('generateResume', () => {
    it('should generate a complete resume from experience data', async () => {
      // Mock getExperienceStats and getExperienceLog
      const resume = await generateResume('inst-1', 'opstack');

      expect(resume.instanceId).toBe('inst-1');
      expect(resume.protocolId).toBe('opstack');
      expect(resume.tier).toBeDefined();
      expect(resume.stats).toBeDefined();
      expect(resume.generatedAt).toBeDefined();
    });
  });
});
```

**Step 3: Implement**

Create `src/lib/agent-resume.ts`:

```typescript
import { getExperienceLog, getExperienceStats } from '@/lib/experience-store';
import { extractPatterns } from '@/lib/pattern-extractor';
import type { AgentResume, ExperienceTier } from '@/types/agent-resume';

export function calculateTier(operatingDays: number): ExperienceTier {
  if (operatingDays >= 180) return 'expert';
  if (operatingDays >= 90) return 'senior';
  if (operatingDays >= 30) return 'junior';
  return 'trainee';
}

export async function generateResume(
  instanceId: string,
  protocolId: string
): Promise<AgentResume> {
  const stats = await getExperienceStats();
  const entries = await getExperienceLog(500);
  const instanceEntries = entries.filter(e => e.instanceId === instanceId);
  const { patterns } = extractPatterns(instanceEntries);

  const topPatterns = patterns.slice(0, 5);
  const specialties = [...new Set(topPatterns.map(p => p.trigger.metric))];

  return {
    instanceId,
    protocolId,
    tier: calculateTier(stats.operatingDays),
    operatingSince: instanceEntries.length > 0
      ? instanceEntries[instanceEntries.length - 1].timestamp
      : new Date().toISOString(),
    stats,
    topPatterns,
    specialties,
    generatedAt: new Date().toISOString(),
  };
}
```

**Step 4: Create API route**

Create `src/app/api/v2/instances/[id]/resume/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { generateResume } from '@/lib/agent-resume';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: instanceId } = await params;

  try {
    // Default to opstack; in production, look up from instance registry
    const resume = await generateResume(instanceId, 'opstack');
    return NextResponse.json(resume);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to generate resume' },
      { status: 500 }
    );
  }
}
```

**Step 5: Run tests**

Run: `npx vitest run src/lib/__tests__/agent-resume.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/types/agent-resume.ts src/lib/agent-resume.ts src/lib/__tests__/agent-resume.test.ts src/app/api/v2/instances/[id]/resume/route.ts
git commit -m "feat(resume): agent resume generator with tier calculation and API"
```

---

## Task 11: Outcome Tracker

**Files:**
- Create: `src/lib/outcome-tracker.ts`
- Create: `src/types/billing.ts`
- Test: `src/lib/__tests__/outcome-tracker.test.ts`

**Context:**
The Outcome Tracker listens to VerifierAgent `verification-complete` events, classifies outcomes, and emits billing events. It bridges the gap between operational events and revenue — each verified outcome can trigger a billing event for outcome-based pricing. Uses the existing EventBus subscription pattern.

**Step 1: Define types**

Create `src/types/billing.ts`:

```typescript
export type OutcomeType = 'auto-resolved' | 'escalated' | 'false-positive' | 'failed';

export interface BillingEvent {
  id: string;
  instanceId: string;
  timestamp: string;
  eventType: 'operation-outcome';
  outcomeType: OutcomeType;
  operationId: string;
  value: number;               // monetary value (used for outcome-based pricing)
  metadata: Record<string, unknown>;
}
```

**Step 2: Write tests**

Create `src/lib/__tests__/outcome-tracker.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { classifyOutcome, createBillingEvent } from '@/lib/outcome-tracker';

describe('outcome-tracker', () => {
  describe('classifyOutcome', () => {
    it('should classify successful verified execution as auto-resolved', () => {
      expect(classifyOutcome({ executed: true, passed: true })).toBe('auto-resolved');
    });

    it('should classify failed verification as escalated', () => {
      expect(classifyOutcome({ executed: true, passed: false })).toBe('escalated');
    });

    it('should classify non-executed pass as false-positive', () => {
      expect(classifyOutcome({ executed: false, passed: true })).toBe('false-positive');
    });

    it('should classify non-executed fail as failed', () => {
      expect(classifyOutcome({ executed: false, passed: false })).toBe('failed');
    });
  });

  describe('createBillingEvent', () => {
    it('should create billing event with correct fields', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-1',
        outcomeType: 'auto-resolved',
      });

      expect(event.id).toBeDefined();
      expect(event.instanceId).toBe('inst-1');
      expect(event.eventType).toBe('operation-outcome');
      expect(event.outcomeType).toBe('auto-resolved');
      expect(event.value).toBeGreaterThan(0); // auto-resolved has value
    });

    it('should assign zero value to false-positive outcomes', () => {
      const event = createBillingEvent({
        instanceId: 'inst-1',
        operationId: 'op-2',
        outcomeType: 'false-positive',
      });

      expect(event.value).toBe(0);
    });
  });
});
```

**Step 3: Implement**

Create `src/lib/outcome-tracker.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import logger from '@/lib/logger';
import { getStore } from '@/lib/redis-store';
import { recordExperience } from '@/lib/experience-store';
import type { BillingEvent, OutcomeType } from '@/types/billing';

// Value assigned per outcome type (base units for pricing calculation)
const OUTCOME_VALUES: Record<OutcomeType, number> = {
  'auto-resolved': 1.0,
  'escalated': 0.3,
  'false-positive': 0,
  'failed': 0,
};

export function classifyOutcome(result: {
  executed: boolean;
  passed: boolean;
}): OutcomeType {
  if (result.executed && result.passed) return 'auto-resolved';
  if (result.executed && !result.passed) return 'escalated';
  if (!result.executed && result.passed) return 'false-positive';
  return 'failed';
}

export function createBillingEvent(input: {
  instanceId: string;
  operationId: string;
  outcomeType: OutcomeType;
  metadata?: Record<string, unknown>;
}): BillingEvent {
  return {
    id: randomUUID(),
    instanceId: input.instanceId,
    timestamp: new Date().toISOString(),
    eventType: 'operation-outcome',
    outcomeType: input.outcomeType,
    operationId: input.operationId,
    value: OUTCOME_VALUES[input.outcomeType],
    metadata: input.metadata ?? {},
  };
}

export async function trackOutcome(payload: {
  instanceId: string;
  operationId: string;
  executed: boolean;
  passed: boolean;
  resolutionMs: number;
  trigger?: { type: string; metric: string; value: number };
  action?: string;
  protocolId?: string;
  metricsSnapshot?: Record<string, number>;
}): Promise<BillingEvent> {
  const outcomeType = classifyOutcome(payload);
  const event = createBillingEvent({
    instanceId: payload.instanceId,
    operationId: payload.operationId,
    outcomeType,
  });

  // Store billing event
  const store = getStore();
  await store.addPredictionRecord({
    id: event.id,
    prediction: { outcomeType, value: event.value } as never,
  });

  // Also record as experience (if trigger info available)
  if (payload.trigger && payload.action) {
    await recordExperience({
      instanceId: payload.instanceId,
      protocolId: payload.protocolId ?? 'unknown',
      category: 'anomaly-resolution',
      trigger: payload.trigger,
      action: payload.action,
      outcome: outcomeType === 'auto-resolved' ? 'success'
        : outcomeType === 'escalated' ? 'partial'
        : 'failure',
      resolutionMs: payload.resolutionMs,
      metricsSnapshot: payload.metricsSnapshot ?? {},
    });
  }

  logger.info('[OutcomeTracker] Tracked outcome', {
    instanceId: payload.instanceId,
    outcomeType,
    value: event.value,
  });

  return event;
}
```

**Step 4: Run tests**

Run: `npx vitest run src/lib/__tests__/outcome-tracker.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/types/billing.ts src/lib/outcome-tracker.ts src/lib/__tests__/outcome-tracker.test.ts
git commit -m "feat(billing): outcome tracker with classification and billing events"
```

---

## Task 12: Metrics History API

**Files:**
- Create: `src/app/api/metrics/history/route.ts`
- Modify: `src/types/redis.ts` (add metrics history methods if needed)
- Test: `src/app/api/metrics/history/route.test.ts`

**Context:**
Currently MetricsStore holds only 60 data points (1 hour at 1-minute intervals) in a ring buffer. For longer-term analysis, we need a history API that supports time-range queries. This builds on the existing `getRecentMetrics()` pattern but adds windowed aggregation. For v1, we expose the existing ring buffer data with time-range filtering.

**Step 1: Write the test**

Create `src/app/api/metrics/history/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/redis-store', () => ({
  getStore: () => ({
    getRecentMetrics: vi.fn().mockResolvedValue([
      { timestamp: '2026-03-03T10:00:00Z', cpuUsage: 45, gasUsedRatio: 0.5 },
      { timestamp: '2026-03-03T10:01:00Z', cpuUsage: 50, gasUsedRatio: 0.6 },
      { timestamp: '2026-03-03T10:02:00Z', cpuUsage: 55, gasUsedRatio: 0.7 },
    ]),
  }),
}));

const { GET } = await import('./route');

describe('GET /api/metrics/history', () => {
  it('should return metrics within time range', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=1h');
    const response = await GET(request as never);
    const data = await response.json();

    expect(data.metrics).toBeDefined();
    expect(data.metrics.length).toBeGreaterThan(0);
    expect(data.duration).toBe('1h');
  });

  it('should return 400 for invalid duration', async () => {
    const request = new Request('http://localhost:3002/api/metrics/history?duration=invalid');
    const response = await GET(request as never);
    expect(response.status).toBe(400);
  });
});
```

**Step 2: Implement**

Create `src/app/api/metrics/history/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/redis-store';

const DURATION_MAP: Record<string, number> = {
  '15m': 15,
  '30m': 30,
  '1h': 60,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const duration = searchParams.get('duration') || '1h';

  const count = DURATION_MAP[duration];
  if (!count) {
    return NextResponse.json(
      { error: `Invalid duration. Supported: ${Object.keys(DURATION_MAP).join(', ')}` },
      { status: 400 }
    );
  }

  const store = getStore();
  const metrics = await store.getRecentMetrics(count);

  return NextResponse.json({
    metrics,
    count: metrics.length,
    duration,
    maxAvailable: 60,
  });
}
```

**Step 3: Run tests**

Run: `npx vitest run src/app/api/metrics/history/route.test.ts`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/app/api/metrics/history/route.ts src/app/api/metrics/history/route.test.ts
git commit -m "feat(api): metrics history endpoint with duration-based filtering"
```

---

## Dependency Graph

```
Task 1 (backoff) ──┐
Task 2 (kubectl)  ──┤── Zero-Downtime improvements (independent of each other)
Task 3 (rollback) ──┘

Task 4 (NLOps parallel)       ← independent

Task 5 (RCA Redis) ──┐
Task 6 (Prediction)  ──┤── Data persistence (independent of each other)
                       │
Task 7 (Trace ID)     ← independent, but enriches Tasks 8-9

Task 8 (Experience Store) ← depends on Task 7 (trace ID enrichment)
Task 9 (Pattern Extractor) ← depends on Task 8 (reads experience entries)
Task 10 (Agent Resume) ← depends on Tasks 8 + 9
Task 11 (Outcome Tracker) ← depends on Task 8
Task 12 (Metrics History) ← independent
```

## Execution Schedule

**Week 1-2: Engine Quality (Tasks 1-6)**
- Tasks 1, 2, 3 can run in parallel (all modify zero-downtime-scaler.ts but different sections)
- Task 4 is independent
- Tasks 5, 6 are independent

**Week 2-3: Observability + Foundation (Tasks 7-9)**
- Task 7 first (Trace ID — used by Task 8)
- Task 8 next (Experience Store — used by Tasks 9, 10, 11)
- Task 9 after Task 8

**Week 3-4: Completion (Tasks 10-12)**
- Tasks 10, 11, 12 can run in parallel after Task 8/9 are done

---

*Generated from Audit P1-P2 Work Plan + Agent-for-Hire Revenue Model Design, 2026-03-03*
