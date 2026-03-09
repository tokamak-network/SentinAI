/**
 * Zero-Downtime Scaler Module
 * Parallel Pod Swap orchestration for zero-downtime vertical scaling
 *
 * Phase flow:
 *   creating_standby → waiting_ready → switching_traffic → cleanup → syncing_statefulset → completed
 *   Any failure → rolling_back → failed
 */

import { runK8sCommand } from '@/lib/k8s-config';
import {
  SwapState,
  SwapPhase,
  ReadinessCheckResult,
  TrafficSwitchResult,
  ZeroDowntimeResult,
  INITIAL_SWAP_STATE,
} from '@/types/zero-downtime';
import { ScalingConfig, DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import logger from '@/lib/logger';

// ============================================================
// Constants
// ============================================================

/** Exponential backoff intervals for readiness polling (ms) */
export const BACKOFF_INTERVALS = [1000, 2000, 5000, 10000];

// ============================================================
// Singleton State
// ============================================================

let swapState: SwapState = { ...INITIAL_SWAP_STATE };

// ============================================================
// Test Hooks — override internal behavior for testing
// ============================================================

/** @internal Override for testing — replaces sleep with no-op, exposes state setter */
export const _testHooks = {
  sleep: (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms)),
  /** Force swap state phase for testing concurrent rejection */
  _setPhase: (phase: SwapPhase): void => { swapState.phase = phase; },
};

// ============================================================
// Export Functions
// ============================================================

/** Get current orchestration state (returns a copy) */
export function getSwapState(): SwapState {
  return { ...swapState, phaseDurations: { ...swapState.phaseDurations } };
}

/** Whether a swap is in progress (any phase other than idle/completed/failed) */
export function isSwapInProgress(): boolean {
  return !['idle', 'completed', 'failed'].includes(swapState.phase);
}

/** Reset state (for testing/debugging) */
export function resetSwapState(): void {
  swapState = { ...INITIAL_SWAP_STATE, phaseDurations: {} };
}

/**
 * Main orchestration: Zero-Downtime Scaling
 *
 * 1. Create standby Pod (with target resources)
 * 2. Wait for ready (readinessProbe + RPC L7 check)
 * 3. Switch traffic (Service selector)
 * 4. Cleanup old Pod
 * 5. Sync StatefulSet spec
 */
export async function zeroDowntimeScale(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ZeroDowntimeResult> {
  if (isSwapInProgress()) {
    return {
      success: false,
      totalDurationMs: 0,
      phaseDurations: {},
      finalPhase: swapState.phase,
      error: 'Swap already in progress',
    };
  }

  // Preflight: verify StatefulSet updateStrategy is OnDelete.
  // If it is RollingUpdate, K8s will auto-replace the pod when the spec changes
  // (Phase 5 syncStatefulSet), which conflicts with the Parallel Pod Swap approach.
  try {
    const { stdout: strategy } = await runK8sCommand(
      `get statefulset ${config.statefulSetName} -n ${config.namespace} -o jsonpath='{.spec.updateStrategy.type}'`,
      { timeout: 10000 }
    );
    const strategyValue = strategy.replace(/'/g, '').trim();
    if (strategyValue && strategyValue !== 'OnDelete') {
      logger.error(`[ZeroDowntime] Preflight failed: updateStrategy=${strategyValue}, expected OnDelete`);
      return {
        success: false,
        totalDurationMs: 0,
        phaseDurations: {},
        finalPhase: 'idle',
        error: `StatefulSet '${config.statefulSetName}' updateStrategy is '${strategyValue}'. ` +
               `Zero-downtime scaling requires OnDelete. ` +
               `Fix: kubectl patch statefulset ${config.statefulSetName} -n ${config.namespace} ` +
               `-p '{"spec":{"updateStrategy":{"type":"OnDelete"}}}'`,
      };
    }
    logger.info(`[ZeroDowntime] Preflight passed: updateStrategy=${strategyValue || 'OnDelete'}`);
  } catch (err) {
    logger.warn('[ZeroDowntime] Could not verify updateStrategy (proceeding anyway):', err);
  }

  const startTime = Date.now();
  let phaseStart = startTime;

  // Reset state for new operation
  resetSwapState();

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
      updatePhase('rolling_back', targetVcpu, targetMemoryGiB);
      await rollback(config);
      recordPhaseDuration('rolling_back', phaseStart);
      return {
        success: false,
        totalDurationMs: Date.now() - startTime,
        phaseDurations: { ...swapState.phaseDurations },
        finalPhase: 'failed',
        error: 'Standby pod failed to become ready',
      };
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
    logger.error('[ZeroDowntime] Orchestration failed:', errorMessage);

    try {
      await rollback(config);
    } catch (rollbackError) {
      logger.error('[ZeroDowntime] Rollback also failed:', rollbackError);
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

// ============================================================
// Internal Helpers
// ============================================================

function updatePhase(phase: SwapPhase, targetVcpu: number, targetMemoryGiB: number): void {
  swapState.phase = phase;
  swapState.targetVcpu = targetVcpu;
  swapState.targetMemoryGiB = targetMemoryGiB;
  if (phase !== 'idle' && !swapState.startedAt) {
    swapState.startedAt = new Date().toISOString();
  }
}

function recordPhaseDuration(phase: SwapPhase, startTime: number): void {
  swapState.phaseDurations[phase] = Date.now() - startTime;
}


// ============================================================
// Phase Functions
// ============================================================

/**
 * Phase 1: Create standby Pod with target resources
 *
 * Creates an independent Pod based on the existing StatefulSet Pod spec.
 * PVCs are cloned via CSI DataSource so the standby starts with existing chain data.
 * Requires the CSI driver to support volume cloning (e.g. EBS CSI driver >= 1.x).
 *
 * Clone PVC names: "<original-pvc-name>-standby-<timestamp>"
 * Cloned PVCs are deleted in rollback / cleanup (Phase 4).
 */
async function createStandbyPod(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<string> {
  const { namespace, statefulSetName, containerIndex } = config;

  // 1. Get existing active Pod spec
  const { stdout: podJson } = await runK8sCommand(
    `get pod ${statefulSetName}-0 -n ${namespace} -o json`,
    { timeout: 30000 }
  );
  const podSpec = JSON.parse(podJson);

  // 2. Generate standby Pod name and timestamp suffix
  const suffix = Date.now();
  const standbyPodName = `${statefulSetName}-standby-${suffix}`;

  // 3. Clone each PVC (CSI volume clone via dataSource)
  const clonedPvcNames: string[] = [];
  const pvcVolumes = (podSpec.spec.volumes || []).filter((v: Record<string, unknown>) => v.persistentVolumeClaim);

  for (const vol of pvcVolumes) {
    const srcPvcName = (vol.persistentVolumeClaim as { claimName: string }).claimName;

    // Fetch original PVC spec to inherit storageClass and size
    const { stdout: srcPvcJson } = await runK8sCommand(
      `get pvc ${srcPvcName} -n ${namespace} -o json`,
      { timeout: 10000 }
    );
    const srcPvc = JSON.parse(srcPvcJson);
    const storageClass: string = srcPvc.spec.storageClassName;
    const storage: string = srcPvc.spec.resources?.requests?.storage ?? '10Gi';

    const clonePvcName = `${srcPvcName}-standby-${suffix}`;
    clonedPvcNames.push(clonePvcName);

    const clonePvcManifest = {
      apiVersion: 'v1',
      kind: 'PersistentVolumeClaim',
      metadata: { name: clonePvcName, namespace, labels: { role: 'standby', sourcePvc: srcPvcName } },
      spec: {
        accessModes: srcPvc.spec.accessModes,
        storageClassName: storageClass,
        resources: { requests: { storage } },
        dataSource: { name: srcPvcName, kind: 'PersistentVolumeClaim', apiGroup: '' },
      },
    };
    await runK8sCommand(
      `apply -f - -n ${namespace}`,
      { stdin: JSON.stringify(clonePvcManifest), timeout: 30000 }
    );
    logger.info(`[ZeroDowntime] Cloned PVC ${srcPvcName} → ${clonePvcName}`);
  }

  // Track cloned PVCs for cleanup/rollback
  swapState.clonedPvcNames = clonedPvcNames;

  // 4. Assemble Pod manifest — map cloned PVC names onto volumes
  let cloneIdx = 0;
  const manifest = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: standbyPodName,
      namespace,
      labels: {
        ...(podSpec.metadata?.labels || {}),
        role: 'standby',
        slot: 'standby',
      },
    },
    spec: {
      ...podSpec.spec,
      nodeName: undefined,
      hostname: undefined,
      subdomain: undefined,
      serviceAccountName: podSpec.spec.serviceAccountName,
      containers: podSpec.spec.containers.map((c: Record<string, unknown>, i: number) => {
        if (i === containerIndex) {
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
      volumes: (podSpec.spec.volumes || []).map((v: Record<string, unknown>) => {
        if (v.persistentVolumeClaim) {
          const clonedName = clonedPvcNames[cloneIdx++];
          return { name: v.name, persistentVolumeClaim: { claimName: clonedName } };
        }
        return v;
      }),
    },
  };

  // 5. kubectl apply
  await runK8sCommand(
    `apply -f - -n ${namespace}`,
    { stdin: JSON.stringify(manifest), timeout: 30000 }
  );

  return standbyPodName;
}

/**
 * Phase 2: Pod Ready + RPC L7 check
 *
 * Polls every 10 seconds with a maximum 5-minute timeout.
 * Verifies K8s readinessProbe passed + eth_blockNumber RPC response.
 */
async function waitForReady(
  podName: string,
  config: ScalingConfig,
  timeoutMs: number = parseInt(process.env.ZERO_DOWNTIME_READY_TIMEOUT_MS || '300000', 10),
): Promise<ReadinessCheckResult> {
  const { namespace } = config;
  const startTime = Date.now();
  let pollAttempt = 0;

  while (Date.now() - startTime < timeoutMs) {
    try {
      // 1. Check Pod Ready status + Pod IP in a single kubectl call
      const { stdout: combinedOutput } = await runK8sCommand(
        `get pod ${podName} -n ${namespace} -o jsonpath='{.status.conditions[?(@.type=="Ready")].status},{.status.podIP}'`,
        { timeout: 10000 }
      );

      const [readyStatus, podIp] = combinedOutput.replace(/'/g, '').trim().split(',');

      if (readyStatus !== 'True') {
        await _testHooks.sleep(BACKOFF_INTERVALS[Math.min(pollAttempt, BACKOFF_INTERVALS.length - 1)]);
        pollAttempt++;
        continue;
      }

      // 2. RPC L7 check (call localhost via kubectl exec)
      const { stdout: rpcResponse } = await runK8sCommand(
        `exec ${podName} -n ${namespace} -- wget -qO- --timeout=5 http://localhost:8545 --post-data='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
        { timeout: parseInt(process.env.RPC_CHECK_TIMEOUT_MS || '15000', 10) }
      );

      const parsed = JSON.parse(rpcResponse);
      const blockNumber = parseInt(parsed.result, 16);

      return {
        ready: true,
        podIp,
        rpcResponsive: true,
        blockNumber,
        checkDurationMs: Date.now() - startTime,
      };
    } catch {
      // Pod not ready yet — keep polling
      await _testHooks.sleep(BACKOFF_INTERVALS[Math.min(pollAttempt, BACKOFF_INTERVALS.length - 1)]);
      pollAttempt++;
    }
  }

  // Timeout
  return {
    ready: false,
    podIp: null,
    rpcResponsive: false,
    blockNumber: null,
    checkDurationMs: Date.now() - startTime,
  };
}

/**
 * Phase 3: Switch traffic by changing Service selector
 *
 * 1. Initialize slot selector on Service if not present
 * 2. Standby Pod label -> slot=active
 * 3. Old Pod label -> slot=draining (traffic switches immediately)
 */
async function switchTraffic(
  newPodName: string,
  config: ScalingConfig
): Promise<TrafficSwitchResult> {
  const { namespace, serviceName, statefulSetName } = config;

  // 1. Check current Service selector
  const { stdout: serviceJson } = await runK8sCommand(
    `get service ${serviceName} -n ${namespace} -o json`,
    { timeout: 10000 }
  );
  const service = JSON.parse(serviceJson);
  const previousSelector = { ...service.spec.selector };

  // 2. Initialize slot selector if not present
  if (!previousSelector.slot) {
    await runK8sCommand(
      `label pod ${statefulSetName}-0 -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
    await runK8sCommand(
      `patch service ${serviceName} -n ${namespace} --type='json' -p='[{"op":"add","path":"/spec/selector/slot","value":"active"}]'`,
      { timeout: 10000 }
    );
  }

  // 3. Standby Pod -> active
  await runK8sCommand(
    `label pod ${newPodName} -n ${namespace} slot=active --overwrite`,
    { timeout: 10000 }
  );

  // 4. Old Pod -> draining (Service selects only slot=active, so traffic switches immediately)
  //    If this fails, both pods have slot=active — inconsistent state.
  //    Partial rollback: re-label old pod as active, new pod as standby.
  try {
    await runK8sCommand(
      `label pod ${statefulSetName}-0 -n ${namespace} slot=draining --overwrite`,
      { timeout: 10000 }
    );
  } catch (err) {
    logger.error('[ZeroDowntime] Failed to drain old pod, attempting partial rollback', { error: err });
    try {
      // Recovery: re-label old pod as active, remove new pod from active
      await runK8sCommand(
        `label pod ${statefulSetName}-0 -n ${namespace} slot=active --overwrite`,
        { timeout: 10000 }
      );
      await runK8sCommand(
        `label pod ${newPodName} -n ${namespace} slot=standby --overwrite`,
        { timeout: 10000 }
      );
      logger.info('[ZeroDowntime] Partial rollback successful — labels restored');
    } catch (rollbackErr) {
      logger.error('[ZeroDowntime] Partial rollback failed — manual intervention required', { error: rollbackErr });
    }
    // Re-throw so parent orchestrator enters rolling_back phase and cleans up standby pod
    throw err;
  }

  return {
    success: true,
    previousSelector,
    newSelector: { ...previousSelector, slot: 'active' },
    serviceName,
  };
}

/**
 * Phase 4: Gracefully terminate old Pod + delete its original PVCs
 *
 * Wait 30 seconds for drain, then delete the pod.
 * After the pod is gone, delete the PVCs that were associated with it
 * (the standby pod now owns its own cloned PVCs).
 */
async function cleanupOldPod(podName: string, config: ScalingConfig): Promise<void> {
  const { namespace, statefulSetName } = config;

  // Wait for drain
  await _testHooks.sleep(parseInt(process.env.ZERO_DOWNTIME_POD_CLEANUP_SLEEP_MS || '30000', 10));

  await runK8sCommand(
    `delete pod ${podName} -n ${namespace} --grace-period=60`,
    { timeout: 90000 }
  );

  await runK8sCommand(
    `wait --for=delete pod/${podName} -n ${namespace} --timeout=120s`,
    { timeout: 130000 }
  );

  // Delete the old pod's PVCs (StatefulSet VolumeClaimTemplates → "<claim>-<pod>")
  // These are no longer needed; the standby pod uses cloned PVCs.
  try {
    const { stdout: pvcList } = await runK8sCommand(
      `get pvc -n ${namespace} -l app=${statefulSetName} -o jsonpath='{.items[*].metadata.name}'`,
      { timeout: 10000 }
    );
    const pvcs = pvcList.replace(/'/g, '').trim().split(/\s+/).filter(Boolean);
    // Only delete PVCs that belong to the old pod (not cloned ones)
    const oldPodPvcs = pvcs.filter(name =>
      !swapState.clonedPvcNames.includes(name) && name.endsWith(`-${podName}`)
    );
    for (const pvcName of oldPodPvcs) {
      await runK8sCommand(`delete pvc ${pvcName} -n ${namespace}`, { timeout: 30000 });
      logger.info(`[ZeroDowntime] Deleted old PVC: ${pvcName}`);
    }
  } catch (err) {
    logger.warn('[ZeroDowntime] Failed to delete old pod PVCs (may need manual cleanup):', err);
  }
}

/**
 * Phase 5: Sync StatefulSet spec
 *
 * Since the Pod was manipulated directly, sync the StatefulSet's declarative spec with actual state.
 * Requires updateStrategy: OnDelete (to prevent automatic Pod replacement).
 */
async function syncStatefulSet(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig
): Promise<void> {
  const { namespace, statefulSetName, containerIndex } = config;

  const patchJson = JSON.stringify([
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/requests/cpu`, value: `${targetVcpu}` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/requests/memory`, value: `${targetMemoryGiB}Gi` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/limits/cpu`, value: `${targetVcpu}` },
    { op: 'replace', path: `/spec/template/spec/containers/${containerIndex}/resources/limits/memory`, value: `${targetMemoryGiB}Gi` },
  ]);

  await runK8sCommand(
    `patch statefulset ${statefulSetName} -n ${namespace} --type='json' -p='${patchJson}'`,
    { timeout: 30000 }
  );
}

/**
 * Rollback: delete standby Pod + cloned PVCs, restore old Pod labels
 *
 * If failure occurs before traffic switch, the old Pod is unaffected.
 */
async function rollback(config: ScalingConfig): Promise<void> {
  const { namespace, statefulSetName } = config;

  // Delete standby Pod
  if (swapState.standbyPodName) {
    try {
      await runK8sCommand(
        `delete pod ${swapState.standbyPodName} -n ${namespace} --grace-period=0 --force`,
        { timeout: 30000 }
      );
    } catch (error) {
      logger.warn('[ZeroDowntime] Failed to delete standby pod during rollback:', error);
    }
  }

  // Delete cloned PVCs (they were only for the standby pod)
  for (const pvcName of swapState.clonedPvcNames) {
    try {
      await runK8sCommand(`delete pvc ${pvcName} -n ${namespace}`, { timeout: 30000 });
      logger.info(`[ZeroDowntime] Rollback: deleted cloned PVC ${pvcName}`);
    } catch (error) {
      logger.warn(`[ZeroDowntime] Rollback: failed to delete cloned PVC ${pvcName}:`, error);
    }
  }

  // Restore old Pod labels
  try {
    await runK8sCommand(
      `label pod ${statefulSetName}-0 -n ${namespace} slot=active --overwrite`,
      { timeout: 10000 }
    );
  } catch (error) {
    logger.warn('[ZeroDowntime] Failed to restore label during rollback:', error);
  }

  swapState.phase = 'failed';
}
