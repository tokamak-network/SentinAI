# Proposal 6: Zero-Downtime Scaling

## Document information

| Item | Content |
|------|------|
| version | 1.0.0 |
| Created date | 2026-02-06 |
| Type | Architecture proposal (including code implementation plan) |
| Dependency | Proposal 1 (Predictive Scaling) — Corresponds to the execution phase after the scaling decision |

---

## 1. Overview & Problem Statement

### 1.1 Problem Summary

SentinAI's current scaling pipeline causes **service interruption** during vertical scaling. Changing the vCPU/Memory of an op-geth will halt all RPC, P2P, and sync functions for **3-5 minutes** while existing Pods are terminated and new Pods are provisioned.

### 1.2 Downtime occurrence sequence

```
kubectl patch statefulset    StatefulSet spec 변경
        ↓
Terminate existing Pod (immediately) ← Initiate RPC interruption
        ↓
Provision Fargate micro-VMs (1-3 minutes)
        ↓
Start a new Pod (30 seconds - 1 minute)
        ↓
op-geth initialization + synchronization (1-2 minutes)
        ↓
Service Recovery ← RPC Recovery (after 3-5 minutes total)
```

### 1.3 Fargate micro-VM architecture

AWS Fargate assigns a dedicated micro-VM to each Pod. Unlike traditional EC2 node groups:

- **Resource change = Pod replacement**: Changing CPU/Memory spec requires a new micro-VM
- **In-place resize not possible**: InPlacePodVerticalScaling not supported in K8s 1.27+
- **Provisioning delay**: New VM allocation takes 1-3 minutes (10-30 seconds for EC2 existing nodes)

### 1.4 op-geth availability requirements

| Features | port | Downtime Impact |
|------|------|--------------|
| JSON-RPC | 8545 | Unable to submit/view transactions, DApp suspended |
| WebSockets | 8546 | Live event subscription disconnected |
| P2P | 30303 | Peer connection lost, resynchronization required |
| Metrics | 6060 | Monitoring gap occurs |

RPC outage directly affects the L2 user experience and, in particular, can affect the stability of the entire L2 chain due to the dependency of the batch/sequencing pipeline (op-batcher, op-proposer).

---

## 2. Current Architecture Analysis

### 2.1 Scaling execution code

**`src/lib/k8s-scaler.ts`** — `scaleOpGeth()` 함수 (line 110-256)

```typescript
// lines 197-223: Run kubectl patch
const patchJson = JSON.stringify([
  {
    op: 'replace',
    path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`,
    value: `${targetVcpu}`,
  },
// ... same pattern for memory requests/limits
]);

const cmd = `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`;
await runK8sCommand(cmd);

// lines 225-240: Immediate status update after patch (no waiting for Pod ready)
scalingState.currentVcpu = targetVcpu;
scalingState.currentMemoryGiB = targetMemoryGiB;
scalingState.lastScalingTime = timestamp;
```

**Problem**: `runK8sCommand()` success = StatefulSet spec change is completed, but it does not check whether the actual Pod is ready. To the client, scaling appears to be a success, but in reality, pod replacement is in progress.

### 2.2 StatefulSet settings

**`src/types/scaling.ts`** — `DEFAULT_SCALING_CONFIG` (line 115-132)

```typescript
export const DEFAULT_SCALING_CONFIG: ScalingConfig = {
  minVcpu: 1,
  maxVcpu: 4,
  cooldownSeconds: 300,  // 5 minutes
  namespace: 'thanos-sepolia',
  statefulSetName: 'sepolia-thanos-stack-op-geth',
  containerIndex: 0,
  // ...
};
```

- **StatefulSet**: `sepolia-thanos-stack-op-geth`
- **Namespace**: `thanos-sepolia`
- **Container**: index 0 (op-geth main container)
- **Number of replicas**: 1 (no replica-related logic in the code)

### 2.3 K8s connection configuration

**`src/lib/k8s-config.ts`** — `runK8sCommand()` (line 202-238)

- AWS EKS token automatic creation + 10 minutes caching
- Automatically detect API URL with `aws eks describe-cluster`
- Command timeout: 10 seconds (default)

### 2.4 Currently missing elements

| Item | Current status | Requirements |
|------|-----------|-----------|
| readinessProbe | Not set | HTTP GET `:8545/` check required |
| preStop hook | Not set | Graceful drain required |
| PodDisruptionBudget | Not set | Requires `minAvailable: 1` |
| Rollout status monitoring | None | Need to wait for `kubectl rollout status` |
| Traffic conversion logic | None | Service selector management required |

---

## 3. Fargate Constraints

### 3.1 EC2 Managed Node vs Fargate comparison

| Item | EC2 Managed Node | Fargate |
|------|------------------|---------|
| In-place resize | K8s 1.27+ support | **No** |
| Node provisioning | Utilize existing nodes (immediately) | Always New micro-VM (1-3 minutes) |
| Pod replacement rate | 10-30 seconds | **2-5 minutes** |
| VPA support | Fully supported | **Not supported** |
| cost model | Node unit (reservation possible) | Pod Unit (On Demand) |
| Pod Density | Multiple Pods/Nodes | 1 Pod = 1 VM |

### 3.2 Why non-disruptive vertical scaling is difficult on Fargate

1. **Atomic VM**: CPU/Memory is determined on a per-VM basis and cannot be changed at runtime.
2. **Scheduling delay**: It takes 1-3 minutes to allocate a new VM (capacity securing process)
3. **StatefulSet Constraint**: A StatefulSet with replica=1 must terminate the existing Pod to start a new Pod.
4. **PV access conflict**: EBS volume can only be mounted on a single node (RWO mode)

### 3.3 Summary of key constraints

> **In Fargate, changing a resource means replacing a Pod, and replacing a Pod means downtime.**
> To circumvent this limitation, a strategy of “preparing new pods in advance and switching traffic after preparation” is needed.

---

## 4. Approach Comparison

### 4.1 Approach A: Enhanced Rolling Update — minimal changes

**Overview**: Minimize downtime by adding readinessProbe, preStop hook, and rollout wait logic to the current code.

**Changes**:
1. Add readinessProbe to K8s manifest: `httpGet :8545/` (initialDelaySeconds: 30)
2. preStop hook: `sleep 30` (graceful shutdown 대기)
3. `terminationGracePeriodSeconds: 120`
4. Add `kubectl rollout status --timeout=300s` wait logic to `k8s-scaler.ts`

**merit**:
- Minimal changes to existing code
- No additional resource costs
- Low implementation complexity

**margin**:
- **Cannot completely eliminate downtime** — Service interruptions still occur during pod replacement
- 3-5 minutes → Shortened to 1-3 minutes (improvement, not elimination)

**Downtime**: 1-3 minutes (improved)
**Additional Cost**: $0/month
**Implementation Complexity**: ★☆☆☆☆

---

### 4.2 Approach B: Blue-Green with Standby — Always on standby

**Overview**: Achieve uninterrupted scaling by operating two StatefulSets and switching Service selectors.

**Architecture**:
```
                     ┌──────────────────┐
                     │  Service (op-geth) │
                     │  selector: slot=A │
                     └────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              ↓                               ↓
   ┌─────────────────────┐       ┌─────────────────────┐
   │ StatefulSet-A (active)│       │ StatefulSet-B (standby)│
   │ 2 vCPU / 4 GiB       │       │ 1 vCPU / 2 GiB         │
   │ slot=A                │       │ slot=B                  │
   └─────────────────────┘       └─────────────────────┘
```

**Scaling flow**:
1. Change the resources of Standby StatefulSet to target value
2. Wait until the new Pod is Ready
3. Switch Service selector to `slot=B`
4. Reduce existing Active StatefulSet

**merit**:
- 0 seconds of downtime (completely uninterrupted)
- Easy rollback (selector restore)

**margin**:
- Constant standby pod costs incurred
- PV (Persistent Volume) sharing issue — EBS RWO constraints
- Complex synchronization management of two StatefulSets

**Downtime**: 0 seconds
**Additional cost**: ~$41/month (based on 1 vCPU standby always running)
**Implementation Complexity**: ★★★★☆

> Cost calculation: 1 vCPU × $0.04656/h + 2 GiB × $0.00511/h = $0.05678/h × 720h = **$40.88/month**

---

### 4.3 Approach C: Parallel Pod Swap — Create when needed (recommended)

**Overview**: At the time of scaling decision, create a new temporary Pod for the target resource, switch traffic after confirming Ready, and then terminate the existing Pod.

**Architecture**:
```
[Phase 1: Parallel preparation]
Service ──→ Pod-old (2 vCPU)
Pod-new (4 vCPU) ← Creating, not receiving traffic

[Phase 2: Transition]
Service ──→ Pod-new (4 vCPU) ← Confirm Ready and switch selector
Pod-old (2 vCPU) ← graceful shutdown

[Phase 3: Summary]
Service ──→ Pod-new (4 vCPU)
Updated StatefulSet spec (declarative consistency)
```

**Scaling flow**:
1. **Create**: Create a temporary Pod with target resources (label: `role=standby`)
2. **Wait**: Wait for readinessProbe to pass (maximum 5 minutes)
3. **Switch**: Switch Service selector to new Pod
4. **Cleanup**: Delete existing Pods, synchronize StatefulSet spec
5. **Verify**: Verify RPC response from new Pod

**merit**:
- 0 seconds of downtime
- No permanent standby fee
- Rollback possible (delete new Pod in case of problems before conversion)

**margin**:
- Double resource usage during scale events (3-5 minutes)
- PV sharing strategy required (chaindata synchronization)
- Requires orchestrator module implementation

**Downtime**: 0 seconds
**Additional Cost**: ~$0.005-$0.02 per scale event (2x resources for 5 minutes)
**Implementation Complexity**: ★★★☆☆

> Cost calculation (worst case): 4 vCPU × $0.04656/h + 8 GiB × $0.00511/h = $0.22716/h × (5/60)h = **$0.019/event**

---

### 4.4 Approach D: EC2 Migration + Karpenter — Infrastructure Transformation

**Overview**: Switch from Fargate to EC2 Managed Node (or Karpenter) to utilize in-place vertical scaling.

**Changes**:
1. Migrate EKS node group to EC2 base
2. Install Karpenter and configure NodePool
3. Vertical Pod Autoscaler (VPA) settings
4. K8s 1.27+ Activate InPlacePodVerticalScaling feature gate

**merit**:
- Native K8s vertical scaling support
- Resources can be changed without pod replacement
- Cost-effective in the long term (utilizing Reserved Instance)

**margin**:
- Requires **full infrastructure migration** — very high operational risk
- Complete modification of existing Fargate-based deployment pipeline
- InPlacePodVerticalScaling is still in beta (as of K8s 1.32)

**Downtime**: 0 seconds (after migration complete)
**Additional costs**: EC2 instance management costs (variable)
**Implementation Complexity**: ★★★★★

---

### 4.5 Comparison Summary

| 항목 | A: Enhanced Rolling | B: Blue-Green | C: Parallel Swap | D: EC2 Migration |
|------|:-------------------:|:-------------:|:----------------:|:----------------:|
| Downtime | 1-3 minutes | 0 seconds | **0 seconds** | 0 seconds |
| Additional costs | $0/month | $41/month | ~$0.01/event | variable |
| Implementation Complexity | low | High | **Medium** | very high |
| Code change scope | Minimum | large scale | middle | Infrastructure Transformation |
| PV sharing issues | None | Yes | Yes | None |
| Ease of rollback | low | High | **High** | low |

---

## 5. Recommended Solution — Phase 1 + Phase 2

### 5.1 Strategy

Progressive improvement in two phases (Phased Approach):

- **Phase 1** (Immediately): Approach A — Minimize downtime by strengthening existing code
- **Phase 2** (mid-term): Approach C — Achieve non-stop with Parallel Pod Swap

Phase 1 is the basis for Phase 2, and the readinessProbe and rollout monitoring added in Phase 1 are also reused in Phase 2.

### 5.2 Phase 1: Enhanced Rolling Update

#### K8s Manifest changes

```yaml
# StatefulSet: sepolia-thanos-stack-op-geth
spec:
  template:
    spec:
      terminationGracePeriodSeconds: 120
      containers:
        - name: op-geth
# Add readinessProbe
          readinessProbe:
            httpGet:
              path: /
              port: 8545
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
# Add livenessProbe
          livenessProbe:
            httpGet:
              path: /
              port: 8545
            initialDelaySeconds: 60
            periodSeconds: 30
            failureThreshold: 5
# Add preStop hook
          lifecycle:
            preStop:
              exec:
                command: ["sh", "-c", "sleep 30"]
```

#### Change `k8s-scaler.ts` code

Add rollout wait logic to `scaleOpGeth()` function:

```typescript
// Existing: Return immediately after kubectl patch
await runK8sCommand(cmd);

// Changed: After kubectl patch, wait for rollout to complete
await runK8sCommand(cmd);
await runK8sCommand(
  `rollout status statefulset ${statefulSetName} -n ${namespace} --timeout=300s`,
{ timeout: 310000 } // 310 seconds (kubectl 300 seconds + 10 seconds slack)
);
```

Add rollout status field to `ScaleResult`:

```typescript
export interface ScaleResult {
// ... existing field
  rolloutStatus?: 'pending' | 'in_progress' | 'completed' | 'failed';
  rolloutDurationMs?: number;
}
```

### 5.3 Phase 2: Parallel Pod Swap

#### New module: `src/lib/zero-downtime-orchestrator.ts`

```
zero-downtime-orchestrator.ts
├── createStandbyPod(targetVcpu, targetMemoryGiB)
│ → Create temporary Pod with target resource (label: role=standby)
├── waitForReady(podName, timeoutMs)
│ → waiting for readinessProbe to pass (polling)
├── switchTraffic(newPodName, oldPodName)
│ → Switch Service selector
├── cleanupOldPod(oldPodName)
│ → Existing Pod graceful termination
└── updateStatefulSet(targetVcpu, targetMemoryGiB)
→ Synchronize StatefulSet spec to final state
```

#### Orchestration flow

```typescript
async function zeroDowntimeScale(
  targetVcpu: TargetVcpu,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<ScaleResult> {
  // Step 1: Create standby pod with target resources
  const standbyPod = await createStandbyPod(targetVcpu, targetMemoryGiB, config);

  // Step 2: Wait for standby pod to be ready
  const ready = await waitForReady(standbyPod.name, 300000); // 5min timeout
  if (!ready) {
    await cleanupOldPod(standbyPod.name); // Rollback: delete standby
    throw new Error('Standby pod failed to become ready');
  }

  // Step 3: Switch traffic to standby pod
  await switchTraffic(standbyPod.name, config);

  // Step 4: Cleanup old pod
  await cleanupOldPod(config.statefulSetName + '-0');

  // Step 5: Update StatefulSet spec for declarative consistency
  await updateStatefulSet(targetVcpu, targetMemoryGiB, config);

  return { success: true, /* ... */ };
}
```

#### `scaler/route.ts` API extension

```typescript
// POST /api/scaler
// Existing: call scaleOpGeth()
// Change: branch based on zeroDowntimeEnabled setting

if (zeroDowntimeEnabled) {
  result = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);
} else {
  result = await scaleOpGeth(targetVcpu, targetMemoryGiB, config);
}
```

#### Persistent Volume (PV) Strategy

op-geth's chaindata is stored in the EBS volume (RWO). Since two Pods cannot access the same volume at the same time:

**Option 1: Snapshot Clone** (recommended)
1. Create an EBS snapshot of existing PV
2. Create a new PV from Snapshot
3. Mount the new PV on the Standby Pod
4. Delete existing PV after conversion

**Option 2: EFS Conversion**
- Change volume type from EBS (RWO) → EFS (RWX)
- Simultaneous mounting is possible, but there are concerns about IOPS performance degradation

**Option 3: Fresh Sync**
- Start Standby Pods with empty volumes and track up-to-date status with snap sync
- Traffic switching after synchronization is complete
- May take a long time (depending on network conditions)

---

## 6. Implementation Plan

### 6.1 Phase 1: Enhanced Rolling Update

| steps | work | change file |
|------|------|-----------|
| 1-1 | Add readinessProbe, preStop hook to K8s manifest | K8s YAML (cluster) |
| 1-2 | set `terminationGracePeriodSeconds: 120` | K8s YAML (cluster) |
| 1-3 | Add rollout status wait logic to `k8s-scaler.ts` | `src/lib/k8s-scaler.ts` |
| 1-4 | Add rollout status field to `ScaleResult` type | `src/types/scaling.ts` |
| 1-5 | Include rollout information in scaler API response | `src/app/api/scaler/route.ts` |
| 1-6 | Show rollout progress in UI | `src/app/page.tsx` |

### 6.2 Phase 2: Parallel Pod Swap

| steps | work | change file |
|------|------|-----------|
| 2-1 | Writing module `zero-downtime-orchestrator.ts` | `src/lib/zero-downtime-orchestrator.ts` (new) |
| 2-2 | orchestrator type definition | `src/types/scaling.ts` |
| 2-3 | Add kubectl apply/delete helper to `k8s-config.ts` | `src/lib/k8s-config.ts` |
| 2-4 | Add zero-downtime mode branch to scaler API | `src/app/api/scaler/route.ts` |
| 2-5 | PV snapshot/clone logic implementation | `src/lib/zero-downtime-orchestrator.ts` |
| 2-6 | Display scaling progress steps in UI (progress stepper) | `src/app/page.tsx` |
| 2-7 | simulation mode 연동 | `src/lib/k8s-scaler.ts` |

---

## 7. Verification Plan

### 7.1 Phase 1 Verification

| Item | Verification method | Success Criteria |
|------|-----------|-----------|
| readinessProbe | Check probe configuration with `kubectl describe pod` | httpGet :8545 set |
| preStop hook | Check the 30 second sleep in the log when the Pod is terminated | After a 30 second delay SIGTERM |
| wait for rollout | Measure API response time after scaling | Response returned after rollout completes |
| Downtime Measurement | Monitoring RPC continuous calls (`eth_blockNumber`) | Downtime < 2 minutes |
| rollout failure handling | Check error return after intentional failure (bad image) | Error message + timeout processing |

**Verification Script (Phase 1)**:
```bash
# Continuous monitoring of RPC availability
while true; do
  RESULT=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://<op-geth>:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}')
  echo "$(date +%H:%M:%S) - HTTP $RESULT"
  sleep 1
done
```

### 7.2 Phase 2 Verification

| Item | Verification method | Success Criteria |
|------|-----------|-----------|
| Create Standby Pod | Check 2 Pods with `kubectl get pods` | standby Pod Running status |
| Traffic Conversion | RPC continuous calls before and after switching | No response time 0 seconds |
| Clean up existing Pods | Confirm deletion of existing Pods after conversion | Only 1 Pod left |
| StatefulSet Synchronization | `kubectl get sts -o yaml` check spec | final resource = target |
| rollback scenario | Confirm maintaining existing pods when standby pod fails | No service impact |
| RPC continuous availability | Monitor RPC at 1-second intervals throughout the entire process | 0 failed responses |

**Verification Procedure (Phase 2)**:
1. Start monitoring at 1 vCPU status (1 second interval `eth_blockNumber`)
2. Scaling up to 4 vCPU in SentinAI UI
3. Check HTTP 200 continuity in monitoring logs
4. Check the process of changing the number of pods from 2 → 1
5. Verify that the final Pod has 4 vCPU resources

---

## 8. Cost & Risk Analysis

### 8.1 Cost comparison by approach

> 기준: AWS Fargate Seoul (ap-northeast-2) — $0.04656/vCPU-hour, $0.00511/GB-hour

| 항목 | A: Enhanced Rolling | B: Blue-Green | C: Parallel Swap | D: EC2 |
|------|:-------------------:|:-------------:|:----------------:|:------:|
| Monthly basic cost | $0 | $40.88 | $0 | variable |
| Cost per event | $0 | $0 | $0.005-$0.019 | $0 |
| Monthly forecast (twice a day) | **$0** | **$40.88** | **$0.30-$1.14** | variable |

**Approach C detailed cost (assuming scaling twice per day)**:
- Best case (1→2 vCPU, 5 min): 2 vCPU × $0.04656 + 4 GiB × $0.00511 = $0.1136/h × (5/60) = $0.0095
- Worst case (1→4 vCPU, 5 min): 4 vCPU × $0.04656 + 8 GiB × $0.00511 = $0.2271/h × (5/60) = $0.0189
- Monthly: $0.0095 × 60 ~ $0.0189 × 60 = **$0.57 ~ $1.14/month**

### 8.2 Risk Analysis

| risk | Severity | Occurrence probability | Mitigation measures |
|--------|:------:|:---------:|-----------|
| Standby Pod fails to start | High | low | Timeout + automatic rollback (maintain existing Pods) |
| RPC health check false positive | middle | middle | `eth_blockNumber` verified by actual call, L7 check instead of simple TCP check |
| PV approach collision (EBS RWO) | High | Occurs in Phase 2 | Snapshot clone method used, no simultaneous mount attempts |
| Requests lost during traffic transition | middle | low | Service selector switching is atomic, existing connections are graceful drain |
| Fargate capacity shortage | High | very low | Retry logic + notifications, fallback to another AZ |
| StatefulSet/Pod state mismatch | middle | middle | Solved by synchronizing StatefulSet spec in Phase 2 Step 5 |
| EBS snapshot timeout | middle | low | Snapshot time varies depending on chaindata size, timeout setting required |

### 8.3 Detailed mitigation measures for each risk

**If Pod fails to start**:
```
1. Create a standby Pod
2. Wait for 5 minutes timeout
3. Failure → Delete standby Pod
4. Maintain existing pods (no service impact)
5. Return error to ScaleResult + notification
```

**In case of PV approach collision (Phase 2)**:
```
1. Create EBS snapshot (based on existing PV)
2. snapshot → create new PVC
3. Mount the new PVC on the standby Pod
4. Delete existing PVC after conversion is complete
```

**Health check to prevent false positives**:
```
readinessProbe:
  httpGet:
path: / # op-geth JSON-RPC endpoint
    port: 8545
initialDelaySeconds: 30 # Wait for op-geth initialization
  periodSeconds: 10
failureThreshold: 3 # NotReady after 30 seconds of consecutive failures
  successThreshold: 1
```

Additional RPC level validation within the orchestrator:
```typescript
// Verify actual RPC response in addition to readinessProbe
async function verifyRpcHealth(podIp: string): Promise<boolean> {
  const response = await fetch(`http://${podIp}:8545`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1,
    }),
  });
  const data = await response.json();
  return data.result !== undefined;
}
```

---

## Appendix: Related file structure

```
src/
├── lib/
│ ├── k8s-scaler.ts # Phase 1 modification target
│ ├── k8s-config.ts # Add Phase 2 helper
│ ├── scaling-decision.ts # No change (score calculation)
│   ├── zero-downtime-orchestrator.ts    # Phase 2 신규
│ └── predictive-scaler.ts # No change (predictive)
├── types/
│ └── scaling.ts # Add Phase 1/2 type
├── app/
│   ├── api/
│ │ └── scaler/route.ts # Phase 1/2 API expansion
│ └── page.tsx # Display UI status
```
