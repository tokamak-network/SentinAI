# Zero-Downtime Scaling (Parallel Pod Swap) — Implementation Specification

> **Purpose**: A specification at a level that an AI agent (Claude Opus 4.6) reading this document can complete from implementation → build → test without any additional questions.

---

## 1. Problem definition

### 1.1 Current status

SentinAI's `scaleOpGeth()` function (`src/lib/k8s-scaler.ts:110-256`) changes the CPU/Memory of the op-geth with `kubectl patch statefulset`. In AWS Fargate, resource change = Pod replacement, so RPC is interrupted for **3-5 minutes**.

```
kubectl patch statefulset    ← StatefulSet spec 변경
→ Terminate existing Pods (immediately) ← Initiate RPC interruption
→ Fargate micro-VM allocation (1-3 minutes)
→ Start a new Pod + Sync (1-2 minutes)
→ Service restoration ← Total downtime of 3-5 minutes
```

### 1.2 Problem

- `runK8sCommand(cmd)` success = StatefulSet spec change completed, does not check whether Pod is Ready
- JSON-RPC (8545), WebSocket (8546), and P2P (30303) are all suspended during pod replacement.
- Risk of **full L2 chain disruption** as op-batcher and op-proposer depend on op-geth

### 1.3 Goal

Run vertical scaling with **0 seconds of downtime**. Parallel Pod Swap method that prepares new pods in advance and switches traffic after confirming readiness.

---

## 2. Solution: Parallel Pod Swap

### 2.1 Overall flow

```
[Phase 1: Parallel preparation]
  Service ──→ Pod-old (2 vCPU, label: slot=active)
Pod-new (4 vCPU, label: slot=standby) ← Creating, no traffic

[Phase 2: Ready standby]
  Service ──→ Pod-old (2 vCPU)
Pod-new (4 vCPU) ← Wait for readinessProbe to pass

[Phase 3: Traffic Conversion]
Service ──→ Pod-new (4 vCPU, label: slot=active)  ← selector 전환
Pod-old (2 vCPU) ← graceful shutdown in progress

[Phase 4: Summary]
  Service ──→ Pod-new (4 vCPU)
StatefulSet spec synchronization (ensuring declarative consistency)
```

### 2.2 Key design decisions

| Item | decision | Reason |
|------|------|------|
| Create Standby Pod | Independent Pod (`kubectl run`) | Create simple Pods directly instead of manipulating StatefulSet replicas |
| Traffic Conversion | Change Service selector | atomic conversion, graceful drain of existing connection |
| PV(chaindata) | snapshot clone | EBS RWO Constraints — No concurrent mounts |
| Check Readiness | RPC L7 check (`eth_blockNumber`) | HTTP 200 alone is not enough, check actual RPC operation |
| rollback | Delete standby Pod | Existing Pods will not be affected in case of failure before conversion |
| Simulation mode | Just change state without kubectl | Maintain existing pattern (`simulationConfig.enabled`) |

### 2.3 Cost

2x resource usage during scale events only (3-5 minutes).

- Best case (1→2 vCPU, 5 minutes): **$0.0095/event**
- Worst case (1→4 vCPU, 5 minutes): **$0.019/event**
- Monthly (twice a day): **$0.57 ~ $1.14/month**

---

## 3. File structure

```
new:
src/lib/zero-downtime-scaler.ts ← Orchestrator (core module)
src/types/zero-downtime.ts ← Type definition

correction:
src/lib/k8s-scaler.ts ← Add zeroDowntime mode branch to scaleOpGeth()
src/types/scaling.ts ← Add rollout field to ScaleResult, zeroDowntime option to ScalingConfig
src/app/api/scaler/route.ts ← Add zeroDowntimeEnabled setting to PATCH, include status in GET response
```

---

## 4. Type definition

### File: `src/types/zero-downtime.ts`

```typescript
/**
 * Zero-Downtime Scaling Types
 */

/** Orchestration step */
export type SwapPhase =
  | 'idle'
  | 'creating_standby'
  | 'waiting_ready'
  | 'switching_traffic'
  | 'cleanup'
  | 'syncing_statefulset'
  | 'completed'
  | 'failed'
  | 'rolling_back';

/** Orchestration state (memory singleton) */
export interface SwapState {
/** Current step */
  phase: SwapPhase;
/** Start time */
  startedAt: string | null;
/** Completion time */
  completedAt: string | null;
/** standby Pod name */
  standbyPodName: string | null;
/** Target vCPU */
  targetVcpu: number;
/** Target Memory GiB */
  targetMemoryGiB: number;
/** Error message */
  error: string | null;
/** Time required for each step (ms) */
  phaseDurations: Partial<Record<SwapPhase, number>>;
}

/** Pod readiness check result */
export interface ReadinessCheckResult {
  ready: boolean;
  podIp: string | null;
  rpcResponsive: boolean;
  blockNumber: number | null;
  checkDurationMs: number;
}

/** Traffic conversion results */
export interface TrafficSwitchResult {
  success: boolean;
  previousSelector: Record<string, string>;
  newSelector: Record<string, string>;
  serviceName: string;
}

/** Orchestration overall result */
export interface ZeroDowntimeResult {
  success: boolean;
/** Total time taken (ms) */
  totalDurationMs: number;
/** Time required for each step */
  phaseDurations: Partial<Record<SwapPhase, number>>;
/** Final state */
  finalPhase: SwapPhase;
  error?: string;
}
```

### File: `src/types/scaling.ts` — Edit

Add the following to the existing type:

```typescript
// Add field to ScaleResult interface
export interface ScaleResult {
// ... keep existing fields
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
// new field
/** Whether to use zero-downtime scaling */
  zeroDowntime?: boolean;
/** rollout status (only used in zero-downtime mode) */
  rolloutPhase?: string;
/** Rollout time (ms) */
  rolloutDurationMs?: number;
}

// Add fields to ScalingConfig interface
export interface ScalingConfig {
// ... keep existing fields
/** op-geth Service name (used in zero-downtime) */
  serviceName: string;
}

// Add to DEFAULT_SCALING_CONFIG
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
// ... keep existing fields
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
// new
  serviceName: 'sepolia-thanos-stack-op-geth',
  weights: { cpu: 0.3, gas: 0.3, txPool: 0.2, ai: 0.2 },
  thresholds: { idle: 30, normal: 70 },
};
```

---

## 5. Core module implementation specification

### File: `src/lib/zero-downtime-scaler.ts`

**Role**: Parallel Pod Swap Orchestration. Create a new Pod → Stand by Ready → Switch traffic → Clean up existing Pods.

**Dependencies**:
- `runK8sCommand` from `@/lib/k8s-config`
- 타입: `SwapState`, `SwapPhase`, `ReadinessCheckResult`, `TrafficSwitchResult`, `ZeroDowntimeResult` from `@/types/zero-downtime`
- 타입: `ScalingConfig`, `DEFAULT_SCALING_CONFIG` from `@/types/scaling`

**Existing code you must read**:
- `src/lib/k8s-config.ts` — `runK8sCommand(command, options?)` signature. Automatically run kubectl with token/server URL.
- `src/lib/k8s-scaler.ts:197-223` — See existing kubectl patch pattern.
- `src/types/scaling.ts` — `ScalingConfig`의 `namespace`, `statefulSetName`, `containerIndex`, `serviceName`

#### 5.1 Singleton state

```typescript
let swapState: SwapState = {
  phase: 'idle',
  startedAt: null,
  completedAt: null,
  standbyPodName: null,
  targetVcpu: 0,
  targetMemoryGiB: 0,
  error: null,
  phaseDurations: {},
};
```

#### 5.2 Export function

| function | Signature | Description |
|------|----------|------|
| `zeroDowntimeScale` | `(targetVcpu: number, targetMemoryGiB: number, config?: ScalingConfig): Promise<ZeroDowntimeResult>` | Main orchestration function |
| `getSwapState` | `(): SwapState` | Check current orchestration status |
| `isSwapInProgress` | `(): boolean` | Whether swap is in progress (other than idle/completed/failed) |
| `resetSwapState` | `(): void` | Initialize state (for testing/debugging) |

#### 5.3 Internal functions

##### `createStandbyPod`

```typescript
/**
* Create a standby Pod with target resources
 *
* Import the Pod spec of an existing StatefulSet and create an independent Pod with only the resources changed.
 * label: app=<prefix>-geth, role=standby
 */
async function createStandbyPod(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<string>
```

**Implementation Flow**:
1. Import the spec of an existing active Pod:
   ```
   kubectl get pod <statefulSetName>-0 -n <namespace> -o json
   ```
2. Remove `metadata`, `status`, `nodeName`, etc. from Pod spec.
3. Replace resources with `targetVcpu`/`targetMemoryGiB`
4. Pod name: `<statefulSetName>-standby-<timestamp>`
5. label 추가: `role: standby`, `slot: standby`
6. Maintain existing label: `app: <prefix>-geth` (for matching Service selector — However, Service is filtered by `slot=active`, so no traffic is received)
7. Create a Pod with `kubectl apply -f -` (pass JSON to stdin)

**kubectl command pattern**:
```typescript
// 1. Import existing Pod spec
const { stdout: podJson } = await runK8sCommand(
  `get pod ${config.statefulSetName}-0 -n ${config.namespace} -o json`
);
const podSpec = JSON.parse(podJson);

// 2. Assemble Pod manifest
const standbyPodName = `${config.statefulSetName}-standby-${Date.now()}`;
const manifest = {
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: {
    name: standbyPodName,
    namespace: config.namespace,
    labels: {
      ...podSpec.metadata.labels,
      role: 'standby',
      slot: 'standby',
    },
  },
  spec: {
    ...podSpec.spec,
nodeName: undefined, // Fargate allocates a new node
    hostname: undefined,
    subdomain: undefined,
    containers: podSpec.spec.containers.map((c: any, i: number) => {
      if (i === config.containerIndex) {
        return {
          ...c,
          resources: {
            requests: { cpu: `${targetVcpu}`, memory: `${targetMemoryGiB}Gi` },
            limits: { cpu: `${targetVcpu}`, memory: `${targetMemoryGiB}Gi` },
          },
        };
      }
      return c;
    }),
  },
};

// 3. Volume handling — remove existing PVC references, use emptyDir or new PVC
// (see Section 5.5 PV Strategy)

// 4. Create Pod
const manifestStr = JSON.stringify(manifest);
await runK8sCommand(
  `apply -f - -n ${config.namespace}`,
  { stdin: manifestStr, timeout: 30000 }
);
```

**Note**: `runK8sCommand` does not currently support stdin. Two options:
- **Option A (recommended)**: Create the manifest as a temporary JSON string with `echo '...' | kubectl apply -f -` using pattern
- **Option B**: Add `runK8sCommandWithStdin()` function to `k8s-config.ts`

Implementing Option A:
```typescript
// Run directly with exec (instead of runK8sCommand)
const manifestStr = JSON.stringify(manifest).replace(/'/g, "'\\''");
await runK8sCommand(
  `apply -f /dev/stdin -n ${config.namespace}`,
  { timeout: 30000, stdin: manifestStr }
);
```

Actually, it would be neat to add stdin support by extending `runK8sCommand` in `k8s-config.ts`. See Section 6.2 below.

##### `waitForReady`

```typescript
/**
* Poll until Pod is in Ready state
* Pass readinessProbe + check actual RPC response
 *
* @param podName - Pod name to wait on.
* @param config - scaling settings
* @param timeoutMs - maximum waiting time (default: 300000ms = 5 minutes)
* @param intervalMs - Polling interval (default: 10000ms = 10 seconds)
 */
async function waitForReady(
  podName: string,
  config: ScalingConfig,
  timeoutMs: number = 300000,
  intervalMs: number = 10000
): Promise<ReadinessCheckResult>
```

**Implementation Flow**:
1. Check Pod status every 10 seconds:
   ```
   kubectl get pod <podName> -n <namespace> -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}'
   ```
2. If Ready=True, get Pod IP:
   ```
   kubectl get pod <podName> -n <namespace> -o jsonpath='{.status.podIP}'
   ```
3. RPC L7 check (use kubectl exec as direct call from inside the cluster is not possible):
   ```
   kubectl exec <podName> -n <namespace> -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
   ```
Or, if the Pod IP is accessible, call it directly with `curl`.
4. If blockNumber parsing is possible, return `ready: true`
5. When timeout is exceeded, `ready: false` is returned.

##### `switchTraffic`

```typescript
/**
* Change the Service selector to divert traffic to a new Pod
 */
async function switchTraffic(
  newPodName: string,
  config: ScalingConfig
): Promise<TrafficSwitchResult>
```

**Implementation Flow**:
1. Check the selector of the current Service:
   ```
   kubectl get service <serviceName> -n <namespace> -o json
   ```
2. If the service does not have a `slot` selector, it needs to be added (initial setting).
- If there is no `slot=active` label in the existing active Pod, add it first:
     ```
     kubectl label pod <statefulSetName>-0 -n <namespace> slot=active --overwrite
     ```
- Add `slot: active` to Service selector:
     ```
     kubectl patch service <serviceName> -n <namespace> --type='json' -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'
     ```
3. Change the standby Pod’s label to `slot=active`:
   ```
   kubectl label pod <newPodName> -n <namespace> slot=active --overwrite
   ```
4. Change the label of the existing Pod to `slot=draining`:
   ```
   kubectl label pod <statefulSetName>-0 -n <namespace> slot=draining --overwrite
   ```
→ Service selector is `slot=active`, so traffic is immediately switched to the new Pod (atomic)

##### `cleanupOldPod`

```typescript
/**
* Existing Pod gracefully terminated
* preStop hook or wait for terminationGracePeriodSeconds
 */
async function cleanupOldPod(
  podName: string,
  config: ScalingConfig
): Promise<void>
```

**Implementation Flow**:
1. Wait 30 seconds (drain existing connection)
2. Delete Pod:
   ```
   kubectl delete pod <podName> -n <namespace> --grace-period=60
   ```
3. Wait for deletion to complete:
   ```
   kubectl wait --for=delete pod/<podName> -n <namespace> --timeout=120s
   ```

##### `syncStatefulSet`

```typescript
/**
* Synchronize StatefulSet spec to final state
* Since we manipulated the Pod directly, the StatefulSet's declarative spec matches the actual state.
 */
async function syncStatefulSet(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<void>
```

**Implementation Flow**:
Same as the kubectl patch pattern in the existing `k8s-scaler.ts`:
```typescript
const patchJson = JSON.stringify([
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/requests/cpu`,
    value: `${targetVcpu}`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/requests/memory`,
    value: `${targetMemoryGiB}Gi`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/limits/cpu`,
    value: `${targetVcpu}`,
  },
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${config.containerIndex}/resources/limits/memory`,
    value: `${targetMemoryGiB}Gi`,
  },
]);

await runK8sCommand(
  `patch statefulset ${config.statefulSetName} -n ${config.namespace} --type='json' -p='${patchJson}'`
);
```

**Important**: After this patch, the StatefulSet controller may attempt to replace Pods. To prevent this, it must be set to `updateStrategy.type: OnDelete`. Otherwise, the StatefulSet will try to replace Pods that have already been replaced.

##### `rollback`

```typescript
/**
* Rollback in case of orchestration failure
* Delete standby Pod, restore Service selector
 */
async function rollback(config: ScalingConfig): Promise<void>
```

**Implementation Flow**:
1. Delete the standby Pod (if it exists):
   ```
   kubectl delete pod <standbyPodName> -n <namespace> --grace-period=0 --force
   ```
2. Restore the label of the existing Pod:
   ```
   kubectl label pod <statefulSetName>-0 -n <namespace> slot=active --overwrite
   ```
3. Set swapState to `failed`

#### 5.4 Main orchestration function

```typescript
export async function zeroDowntimeScale(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ZeroDowntimeResult> {
// Reject if already in progress
  if (isSwapInProgress()) {
    return { success: false, totalDurationMs: 0, phaseDurations: {}, finalPhase: swapState.phase, error: 'Swap already in progress' };
  }

  const startTime = Date.now();
  let phaseStart = startTime;

  try {
    // Phase 1: Create standby pod
    updatePhase('creating_standby', targetVcpu, targetMemoryGiB);
    const standbyPodName = await createStandbyPod(targetVcpu, targetMemoryGiB, config);
    swapState.standbyPodName = standbyPodName;
    recordPhaseDuration('creating_standby', phaseStart);
    phaseStart = Date.now();

    // Phase 2: Wait for ready
    updatePhase('waiting_ready', targetVcpu, targetMemoryGiB);
    const readiness = await waitForReady(standbyPodName, config);
    recordPhaseDuration('waiting_ready', phaseStart);
    phaseStart = Date.now();

    if (!readiness.ready) {
// Rollback: Delete standby Pod
      updatePhase('rolling_back', targetVcpu, targetMemoryGiB);
      await rollback(config);
      recordPhaseDuration('rolling_back', phaseStart);
      return { success: false, totalDurationMs: Date.now() - startTime, phaseDurations: swapState.phaseDurations, finalPhase: 'failed', error: 'Standby pod failed to become ready' };
    }

    // Phase 3: Switch traffic
    updatePhase('switching_traffic', targetVcpu, targetMemoryGiB);
    await switchTraffic(standbyPodName, config);
    recordPhaseDuration('switching_traffic', phaseStart);
    phaseStart = Date.now();

    // Phase 4: Cleanup old pod
    updatePhase('cleanup', targetVcpu, targetMemoryGiB);
    await cleanupOldPod(`${config.statefulSetName}-0`, config);
    recordPhaseDuration('cleanup', phaseStart);
    phaseStart = Date.now();

    // Phase 5: Sync StatefulSet
    updatePhase('syncing_statefulset', targetVcpu, targetMemoryGiB);
    await syncStatefulSet(targetVcpu, targetMemoryGiB, config);
    recordPhaseDuration('syncing_statefulset', phaseStart);

    // Done
    updatePhase('completed', targetVcpu, targetMemoryGiB);
    swapState.completedAt = new Date().toISOString();

    return {
      success: true,
      totalDurationMs: Date.now() - startTime,
      phaseDurations: { ...swapState.phaseDurations },
      finalPhase: 'completed',
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ZeroDowntime] Orchestration failed:', errorMessage);

    // Attempt rollback
    try {
      await rollback(config);
    } catch (rollbackError) {
      console.error('[ZeroDowntime] Rollback also failed:', rollbackError);
    }

    swapState.phase = 'failed';
    swapState.error = errorMessage;

    return {
      success: false,
      totalDurationMs: Date.now() - startTime,
      phaseDurations: { ...swapState.phaseDurations },
      finalPhase: 'failed',
      error: errorMessage,
    };
  }
}
```

#### 5.5 PV (Persistent Volume) Strategy

op-geth's chaindata is stored in the EBS volume (RWO). Since two Pods cannot mount the same volume at the same time:

**Option 1: Start without PVC (snap sync)** — simple but requires synchronization time
```typescript
// Remove PVC reference from volumeMounts/volumes in standby Pod manifest
// op-geth receives the latest status from the network through snap sync
// Readiness judgment: eth_blockNumber response + block height within a certain range of active Pod
```

**Option 2: EBS snapshot clone** — Faster, but requires direct AWS API calls
```typescript
// 1. aws ec2 create-snapshot --volume-id <vol-id>
// 2. aws ec2 create-volume --snapshot-id <snap-id>
// 3. Create PVC as a new volume
// 4. Mount on standby Pod
```

**In this specification, option 1 is implemented by default**. reason:
- No need to call AWS API directly (complete with kubectl only)
- op-geth has fast snap sync (catches up to the latest block within minutes)
- Eliminate PV-related complexity

Replace the `volumeClaimTemplates` associated volume with `emptyDir` in the standby Pod manifest:
```typescript
// Replace PVC references with emptyDir in volumes
manifest.spec.volumes = manifest.spec.volumes?.map((v: any) => {
  if (v.persistentVolumeClaim) {
    return { name: v.name, emptyDir: {} };
  }
  return v;
}) || [];
```

---

## 6. Modify existing code

### 6.1 `src/types/scaling.ts`

**Add 1**: Add field to `ScaleResult`

```typescript
// existing
export interface ScaleResult {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
}

// After modification
export interface ScaleResult {
  success: boolean;
  previousVcpu: number;
  currentVcpu: number;
  previousMemoryGiB: number;
  currentMemoryGiB: number;
  timestamp: string;
  message: string;
  error?: string;
/** Whether to use zero-downtime mode */
  zeroDowntime?: boolean;
/** rollout step */
  rolloutPhase?: string;
/** Rollout time (ms) */
  rolloutDurationMs?: number;
}
```

**Add 2**: Add `serviceName` to `ScalingConfig`

```typescript
// Add to existing interface
export interface ScalingConfig {
// ... existing field
/** op-geth K8s Service name */
  serviceName: string;
}

// Add to DEFAULT_SCALING_CONFIG
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
// ... existing field
  serviceName: 'sepolia-thanos-stack-op-geth',
};
```

### 6.2 `src/lib/k8s-config.ts` — Add stdin support

Extending the existing `runK8sCommand` signature:

```typescript
// Add stdin to options type
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number; stdin?: string }
): Promise<{ stdout: string; stderr: string }>
```

**Implementation changes** (in the `execAsync` call):

If stdin is provided, use `child_process.spawn` or pipe instead of `child_process.exec`:

```typescript
if (options?.stdin) {
// If stdin is needed, use echo + pipe pattern
  const fullCmd = `echo '${options.stdin.replace(/'/g, "'\\''")}' | ${baseCmd} ${command}`;
  const result = await execAsync(fullCmd, {
    timeout: options?.timeout ?? 10000,
  });
  return result;
}
// Maintain existing logic
const result = await execAsync(`${baseCmd} ${command}`, {
  timeout: options?.timeout ?? 10000,
});
```

### 6.3 `src/lib/k8s-scaler.ts` — zero-downtime mode branch

**Edit Location**: Actual kubectl execution in the `scaleOpGeth()` function (around line 197)

**Additional import**:
```typescript
import { zeroDowntimeScale, isSwapInProgress, getSwapState } from '@/lib/zero-downtime-scaler';
```

**ADD**: Module level status
```typescript
let zeroDowntimeEnabled = process.env.ZERO_DOWNTIME_SCALING === 'true';

export function isZeroDowntimeEnabled(): boolean {
  return zeroDowntimeEnabled;
}

export function setZeroDowntimeEnabled(enabled: boolean): void {
  zeroDowntimeEnabled = enabled;
}
```

**Edit**: Actual execution part of the `scaleOpGeth()` function (previously lines 197-241). Current code:

```typescript
// current code (lines 197-241)
  try {
    const patchJson = JSON.stringify([...]);
    const cmd = `patch statefulset ...`;
    await runK8sCommand(cmd);
// update status...
    return { success: true, ... };
  } catch (error) {
// Error handling...
  }
```

**After modification**:

```typescript
  try {
    if (zeroDowntimeEnabled) {
      // Zero-downtime mode: Parallel Pod Swap
      const zdResult = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);

      if (!zdResult.success) {
        return {
          success: false,
          previousVcpu: currentVcpu,
          currentVcpu: currentVcpu,
          previousMemoryGiB: scalingState.currentMemoryGiB,
          currentMemoryGiB: scalingState.currentMemoryGiB,
          timestamp,
          message: `Zero-downtime scaling failed: ${zdResult.error}`,
          error: zdResult.error,
          zeroDowntime: true,
          rolloutPhase: zdResult.finalPhase,
          rolloutDurationMs: zdResult.totalDurationMs,
        };
      }

      const previousVcpu = scalingState.currentVcpu;
      const previousMemoryGiB = scalingState.currentMemoryGiB;
      scalingState.currentVcpu = targetVcpu;
      scalingState.currentMemoryGiB = targetMemoryGiB;
      scalingState.lastScalingTime = timestamp;

      return {
        success: true,
        previousVcpu,
        currentVcpu: targetVcpu,
        previousMemoryGiB,
        currentMemoryGiB: targetMemoryGiB,
        timestamp,
        message: `Zero-downtime scale: ${previousVcpu} → ${targetVcpu} vCPU (${zdResult.totalDurationMs}ms)`,
        zeroDowntime: true,
        rolloutPhase: 'completed',
        rolloutDurationMs: zdResult.totalDurationMs,
      };
    }

// Legacy mode: Direct kubectl patch (maintain existing code)
    const patchJson = JSON.stringify([...]);
// ... existing code ...
  } catch (error) {
// ... existing error handling ...
  }
```

### 6.4 `src/app/api/scaler/route.ts`

**Add zeroDowntimeEnabled setting to PATCH handler**:

Add import:
```typescript
import {
// ... existing import
  isZeroDowntimeEnabled,
  setZeroDowntimeEnabled,
} from '@/lib/k8s-scaler';
```

In the current PATCH handler (lines 283-309):

```typescript
// Add to existing body destructuring
const { autoScalingEnabled, simulationMode, zeroDowntimeEnabled } = body;

// Add after existing if blocks
if (typeof zeroDowntimeEnabled === 'boolean') {
  setZeroDowntimeEnabled(zeroDowntimeEnabled);
}

// add to response
return NextResponse.json({
  success: true,
  autoScalingEnabled: isAutoScalingEnabled(),
  simulationMode: isSimulationMode(),
  zeroDowntimeEnabled: isZeroDowntimeEnabled(),
});
```

**Add swap status to GET handler response**:

Add import:
```typescript
import { getSwapState } from '@/lib/zero-downtime-scaler';
```

Add to GET response (lines 122-134):
```typescript
return NextResponse.json({
// ... existing field
  zeroDowntime: {
    enabled: isZeroDowntimeEnabled(),
    swapState: getSwapState(),
  },
});
```

---

## 7. K8s prerequisites (cluster manual setup)

Apart from the code implementation, the following settings are required on the K8s cluster: You can run this directly with `kubectl`, or change Helm values:

### 7.1 StatefulSet updateStrategy

```yaml
# StatefulSet: sepolia-thanos-stack-op-geth
spec:
  updateStrategy:
type: OnDelete # Prevent StatefulSet from automatically replacing Pods
```

```bash
kubectl patch statefulset sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{"op":"replace","path":"/spec/updateStrategy/type","value":"OnDelete"}]'
```

### 7.2 Add slot selector to Service

```bash
# Add slot label to existing active Pod
kubectl label pod sepolia-thanos-stack-op-geth-0 \
  -n thanos-sepolia \
  slot=active

# Add slot to Service selector
kubectl patch service sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'
```

### 7.3 Add readinessProbe (recommended)

```bash
kubectl patch statefulset sepolia-thanos-stack-op-geth \
  -n thanos-sepolia \
  --type='json' \
  -p='[{
    "op":"add",
    "path":"/spec/template/spec/containers/0/readinessProbe",
    "value":{
      "httpGet":{"path":"/","port":8545},
      "initialDelaySeconds":30,
      "periodSeconds":10,
      "failureThreshold":3
    }
  }]'
```

---

## 8. Environment variables

| variable | default | Description |
|------|--------|------|
| `ZERO_DOWNTIME_SCALING` | `false` | enable zero-downtime mode (`true`/`false`) |

Existing variables (`K8S_NAMESPACE`, `AWS_CLUSTER_NAME`, etc.) remain unchanged.

---

## 9. Error handling matrix

| steps | Failure Scenario | Action |
|------|--------------|------|
| `creating_standby` | Pod creation failed (insufficient resources) | Returns an error, does not affect existing Pods |
| `waiting_ready` | 5 minute timeout (sync delay) | Delete standby Pod → rollback |
| `waiting_ready` | RPC unresponsive | Delete standby Pod → rollback |
| `switching_traffic` | Service patch failed | Delete standby Pod, restore existing selector |
| `cleanup` | Failed to delete existing Pod | Warning log, manual cleanup required (service already switched) |
| `syncing_statefulset` | StatefulSet patch failed | Warning log (service already switched, only spec mismatch) |
| All | Swap already in progress | Immediate rejection (check `isSwapInProgress()`) |

**Core Principle**: Existing Pods are not affected in case of failure before traffic conversion. In case of failure after switching traffic, the service is already running in the new Pod, so cleanup/sync failure does not affect the service.

---

## 10. Verification procedure

### 10.1 Build Verification

```bash
npm run build
npm run lint
```

### 10.2 Simulation mode test

Enable zero-downtime mode but test in simulation mode:

```bash
# 1. Activate simulation mode + zero-downtime
curl -X PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": true, "zeroDowntimeEnabled": true}'

#2. Execute scaling
curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 4, "reason": "zero-downtime test"}'

# 3. Check state — check zeroDowntime.swapState
curl http://localhost:3002/api/scaler
```

### 10.3 Real cluster testing (requires K8s environment)

```bash
# 0. Check preconditions
kubectl get statefulset sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.updateStrategy.type}'
# Expectation: OnDelete

kubectl get service sepolia-thanos-stack-op-geth -n thanos-sepolia \
  -o jsonpath='{.spec.selector}'
# Expectation: includes slot=active

# 1. Start RPC continuous monitoring (separate terminal)
while true; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://<op-geth-service>:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}')
  echo "$(date +%H:%M:%S) HTTP $CODE"
  sleep 1
done

# 2. Implement zero-downtime scaling
curl -X PATCH http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"simulationMode": false, "zeroDowntimeEnabled": true}'

curl -X POST http://localhost:3002/api/scaler \
  -H "Content-Type: application/json" \
  -d '{"targetVcpu": 4, "reason": "zero-downtime production test"}'

# 3. Check progress (polling)
watch -n 2 'curl -s http://localhost:3002/api/scaler | jq .zeroDowntime'

#4. Verification
# - Check HTTP 200 continuity in monitoring log (0 failures)
# - kubectl get pods -n thanos-sepolia (only 1 pod left)
# - Check if the remaining Pod's resources are 4 vCPU
```

### 10.4 Rollback Test

```bash
# Simulate a scenario where the standby Pod is not Ready
# (intentionally bad image or impossible resource request)
# → Check if swapState.phase is ‘failed’
# → Check that existing Pods are not affected
```

---

## 11. Implementation order

```
Phase 1: Type + Infrastructure
1. src/types/zero-downtime.ts — Type definitions
2. src/types/scaling.ts — Modify ScaleResult, ScalingConfig (add serviceName)
3. src/lib/k8s-config.ts — Add stdin option to runK8sCommand

Phase 2: Core modules
4. src/lib/zero-downtime-scaler.ts — Full orchestrator implementation

Phase 3: Integration
5. src/lib/k8s-scaler.ts — zeroDowntimeEnabled state + scaleOpGeth branch
6. src/app/api/scaler/route.ts — PATCH/GET extension

Phase 4: Verification
  7. npm run build && npm run lint
8. Simulation mode test
```

---

## Appendix A: Code to be modified in k8s-scaler.ts

```typescript
// src/lib/k8s-scaler.ts — actual execution part of the scaleOpGeth() function
// lines 197-255 (current code)

  try {
    // Execute kubectl patch command
    const patchJson = JSON.stringify([
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/requests/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/cpu`,
        value: `${targetVcpu}`,
      },
      {
        op: 'replace',
        path: `/spec/template/spec/containers/${containerIndex}/resources/limits/memory`,
        value: `${targetMemoryGiB}Gi`,
      },
    ]);

    const cmd = `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`;
    await runK8sCommand(cmd);

    // Update state
    const previousVcpu = scalingState.currentVcpu;
    const previousMemoryGiB = scalingState.currentMemoryGiB;

    scalingState.currentVcpu = targetVcpu;
    scalingState.currentMemoryGiB = targetMemoryGiB;
    scalingState.lastScalingTime = timestamp;

    return {
      success: true,
      previousVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `Scaled from ${previousVcpu} to ${targetVcpu} vCPU successfully`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Scaling failed:', errorMessage);
    return {
      success: false,
      previousVcpu: currentVcpu,
      currentVcpu: currentVcpu,
      previousMemoryGiB: scalingState.currentMemoryGiB,
      currentMemoryGiB: scalingState.currentMemoryGiB,
      timestamp,
      message: 'Failed to execute kubectl patch',
      error: errorMessage,
    };
  }
```

The key to modifying this part is to surround this part with `if (zeroDowntimeEnabled) { ... } else { existing code }`.

## Appendix B: runK8sCommand Current Signature

```typescript
// src/lib/k8s-config.ts:202-238
export async function runK8sCommand(
  command: string,
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }>
```

Just add the `stdin?: string` field to `options`.

## Appendix C: DEFAULT_SCALING_CONFIG Current Full

```typescript
// src/types/scaling.ts:115-132
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
  weights: {
    cpu: 0.3,
    gas: 0.3,
    txPool: 0.2,
    ai: 0.2,
  },
  thresholds: {
    idle: 30,
    normal: 70,
  },
};
```

Add `serviceName: 'sepolia-thanos-stack-op-geth'` here.
