/**
 * K8s Scaler Module
 * Patch StatefulSet resources via kubectl
 *
 * Storage: Redis (if REDIS_URL set) or InMemory (fallback)
 */

import {
  ScaleResult,
  ScalingState,
  ScalingHistoryEntry,
  ScalingConfig,
  DEFAULT_SCALING_CONFIG,
  SimulationConfig,
} from '@/types/scaling';
import { runK8sCommand } from '@/lib/k8s-config';
import { zeroDowntimeScale } from '@/lib/zero-downtime-scaler';
import { getStore } from '@/lib/redis-store';

export interface ContainerResourceUsage {
  cpuMillicores: number;
  memoryMiB: number;
}

/**
 * Get real container CPU/memory usage via kubectl top
 * Requires metrics-server installed in the cluster.
 * Returns null in simulation mode or if metrics are unavailable.
 */
export async function getContainerCpuUsage(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ContainerResourceUsage | null> {
  const simConfig = await getStore().getSimulationConfig();
  if (simConfig.enabled) return null;

  try {
    const { namespace, statefulSetName } = config;
    const podName = `${statefulSetName}-0`;
    const cmd = `top pod ${podName} -n ${namespace} --no-headers`;
    const { stdout } = await runK8sCommand(cmd, { timeout: 5000 });

    // Output format: "op-geth-0   250m   1024Mi"
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 3) return null;

    const cpuStr = parts[1];
    let cpuMillicores: number;
    if (cpuStr.endsWith('m')) {
      cpuMillicores = parseFloat(cpuStr);
    } else if (cpuStr.endsWith('n')) {
      cpuMillicores = parseFloat(cpuStr) / 1_000_000;
    } else {
      // Whole cores (e.g., "2" = 2000m)
      cpuMillicores = parseFloat(cpuStr) * 1000;
    }

    const memStr = parts[2];
    let memoryMiB: number;
    if (memStr.endsWith('Gi')) {
      memoryMiB = parseFloat(memStr) * 1024;
    } else if (memStr.endsWith('Mi')) {
      memoryMiB = parseFloat(memStr);
    } else if (memStr.endsWith('Ki')) {
      memoryMiB = parseFloat(memStr) / 1024;
    } else {
      memoryMiB = parseFloat(memStr);
    }

    if (isNaN(cpuMillicores) || isNaN(memoryMiB)) return null;
    return { cpuMillicores, memoryMiB };
  } catch {
    return null;
  }
}

/**
 * Parse CPU string from kubectl top output to millicores.
 */
function parseCpuMillicores(cpuStr: string): number {
  if (cpuStr.endsWith('m')) {
    return parseFloat(cpuStr);
  } else if (cpuStr.endsWith('n')) {
    return parseFloat(cpuStr) / 1_000_000;
  } else {
    return parseFloat(cpuStr) * 1000;
  }
}

/**
 * Parse memory string from kubectl top output to MiB.
 */
function parseMemoryMiB(memStr: string): number {
  if (memStr.endsWith('Gi')) {
    return parseFloat(memStr) * 1024;
  } else if (memStr.endsWith('Mi')) {
    return parseFloat(memStr);
  } else if (memStr.endsWith('Ki')) {
    return parseFloat(memStr) / 1024;
  } else {
    return parseFloat(memStr);
  }
}

/**
 * Get real CPU/memory usage for ALL pods in the namespace via single kubectl top call.
 * Returns a Map keyed by component suffix (e.g., "op-geth", "op-node").
 * Requires metrics-server installed in the cluster.
 */
export async function getAllContainerUsage(
  namespace?: string
): Promise<Map<string, ContainerResourceUsage> | null> {
  const simConfig = await getStore().getSimulationConfig();
  if (simConfig.enabled) return null;

  const ns = namespace || (process.env.K8S_NAMESPACE || 'default');

  try {
    const cmd = `top pods -n ${ns} --no-headers`;
    const { stdout } = await runK8sCommand(cmd, { timeout: 5000 });

    if (!stdout.trim()) return null;

    const result = new Map<string, ContainerResourceUsage>();
    const lines = stdout.trim().split('\n');

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;

      const podName = parts[0];
      const cpuMillicores = parseCpuMillicores(parts[1]);
      const memoryMiB = parseMemoryMiB(parts[2]);

      if (isNaN(cpuMillicores) || isNaN(memoryMiB)) continue;

      // Extract component suffix from pod name
      // e.g., "sepolia-thanos-stack-op-geth-0" → match "op-geth"
      // e.g., "op-node-0" → match "op-node"
      const suffixMatch = podName.match(/(op-(?:geth|node|batcher|proposer))(?:-\d+)?$/);
      if (suffixMatch) {
        result.set(suffixMatch[1], { cpuMillicores, memoryMiB });
      }
    }

    return result.size > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Fallback: Get container usage via kubelet /stats/summary (no metrics-server needed).
 * Queries each node's kubelet proxy endpoint in parallel.
 * Works on EKS Fargate where each pod runs on its own virtual node.
 *
 * @param nodeMap Map of component suffix → node name (e.g., "op-geth" → "fargate-ip-...")
 */
export async function getAllContainerUsageViaKubelet(
  nodeMap: Map<string, string>,
): Promise<Map<string, ContainerResourceUsage> | null> {
  const simConfig = await getStore().getSimulationConfig();
  if (simConfig.enabled) return null;
  if (nodeMap.size === 0) return null;

  try {
    const result = new Map<string, ContainerResourceUsage>();

    // Query each node's kubelet in parallel
    const entries = Array.from(nodeMap.entries());
    const results = await Promise.allSettled(
      entries.map(async ([suffix, nodeName]) => {
        const cmd = `get --raw "/api/v1/nodes/${nodeName}/proxy/stats/summary"`;
        const { stdout } = await runK8sCommand(cmd, { timeout: 10000 });
        const stats = JSON.parse(stdout);

        // Find the first pod's first container (Fargate: 1 pod per node)
        const pod = stats.pods?.[0];
        const container = pod?.containers?.[0];
        if (!container) return null;

        const cpuMillicores = (container.cpu?.usageNanoCores ?? 0) / 1_000_000;
        const memoryMiB = (container.memory?.workingSetBytes ?? 0) / (1024 * 1024);

        return { suffix, cpuMillicores, memoryMiB };
      })
    );

    for (const res of results) {
      if (res.status === 'fulfilled' && res.value) {
        result.set(res.value.suffix, {
          cpuMillicores: res.value.cpuMillicores,
          memoryMiB: res.value.memoryMiB,
        });
      }
    }

    return result.size > 0 ? result : null;
  } catch {
    return null;
  }
}

/**
 * Check simulation mode status
 */
export async function isSimulationMode(): Promise<boolean> {
  const config = await getStore().getSimulationConfig();
  return config.enabled;
}

/**
 * Set simulation mode
 */
export async function setSimulationMode(enabled: boolean): Promise<void> {
  await getStore().setSimulationConfig({ enabled });
}

/**
 * Get simulation config
 */
export async function getSimulationConfig(): Promise<SimulationConfig> {
  return getStore().getSimulationConfig();
}

/**
 * Check zero-downtime scaling mode
 */
export async function isZeroDowntimeEnabled(): Promise<boolean> {
  return getStore().getZeroDowntimeEnabled();
}

/**
 * Enable/disable zero-downtime scaling mode
 */
export async function setZeroDowntimeEnabled(enabled: boolean): Promise<void> {
  await getStore().setZeroDowntimeEnabled(enabled);
}

/**
 * Get current op-geth vCPU
 */
export async function getCurrentVcpu(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<number> {
  const simConfig = await getStore().getSimulationConfig();

  // Simulation mode: Return stored state
  if (simConfig.enabled) {
    const state = await getStore().getScalingState();
    return state.currentVcpu;
  }

  try {
    const { namespace, statefulSetName, containerIndex } = config;
    const cmd = `get statefulset ${statefulSetName} -n ${namespace} -o jsonpath='{.spec.template.spec.containers[${containerIndex}].resources.requests.cpu}'`;
    const { stdout } = await runK8sCommand(cmd);

    const cpuStr = stdout.replace(/'/g, '').trim();
    if (cpuStr.includes('m')) {
      return parseFloat(cpuStr) / 1000;
    }
    return parseFloat(cpuStr) || 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to get current vCPU:', message);
    const state = await getStore().getScalingState();
    return state.currentVcpu || 1;
  }
}

/**
 * Check cooldown
 */
export async function checkCooldown(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<{ inCooldown: boolean; remainingSeconds: number }> {
  const state = await getStore().getScalingState();

  if (!state.lastScalingTime) {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  const lastScaling = new Date(state.lastScalingTime).getTime();
  const now = Date.now();
  const elapsed = (now - lastScaling) / 1000;
  const remaining = Math.max(0, config.cooldownSeconds - elapsed);

  return {
    inCooldown: remaining > 0,
    remainingSeconds: Math.ceil(remaining),
  };
}

/**
 * Execute op-geth vCPU/Memory scaling
 */
export async function scaleOpGeth(
  targetVcpu: number,
  targetMemoryGiB: number,
  config: ScalingConfig = DEFAULT_SCALING_CONFIG,
  dryRun: boolean = false
): Promise<ScaleResult> {
  const store = getStore();
  const { namespace, statefulSetName, containerIndex, minVcpu, maxVcpu } = config;
  const timestamp = new Date().toISOString();
  const state = await store.getScalingState();

  // Range validation
  if (targetVcpu < minVcpu || targetVcpu > maxVcpu) {
    return {
      success: false,
      previousVcpu: state.currentVcpu,
      currentVcpu: state.currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: `vCPU must be between ${minVcpu} and ${maxVcpu}`,
      error: 'OUT_OF_RANGE',
    };
  }

  // Cooldown check
  const cooldown = await checkCooldown(config);
  if (cooldown.inCooldown && !dryRun) {
    return {
      success: false,
      previousVcpu: state.currentVcpu,
      currentVcpu: state.currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: `Cooldown active. ${cooldown.remainingSeconds}s remaining`,
      error: 'COOLDOWN',
    };
  }

  // Get current state
  const currentVcpu = await getCurrentVcpu(config);

  // Skip if values are the same
  if (currentVcpu === targetVcpu && !dryRun) {
    return {
      success: true,
      previousVcpu: currentVcpu,
      currentVcpu: currentVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: 'No scaling needed - already at target',
    };
  }

  // Dry run mode
  if (dryRun) {
    return {
      success: true,
      previousVcpu: currentVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `[DRY RUN] Would scale from ${currentVcpu} to ${targetVcpu} vCPU`,
    };
  }

  // Simulation mode: Update state only without actual kubectl execution
  const simConfig = await store.getSimulationConfig();
  if (simConfig.enabled) {
    const previousVcpu = state.currentVcpu;
    const previousMemoryGiB = state.currentMemoryGiB;

    await store.updateScalingState({
      currentVcpu: targetVcpu,
      currentMemoryGiB: targetMemoryGiB,
      lastScalingTime: timestamp,
    });

    return {
      success: true,
      previousVcpu,
      currentVcpu: targetVcpu,
      previousMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `[SIMULATION] Scaled from ${previousVcpu} to ${targetVcpu} vCPU (No actual K8s changes)`,
    };
  }

  // Zero-downtime mode: Parallel Pod Swap orchestration
  const zdEnabled = await store.getZeroDowntimeEnabled();
  if (zdEnabled) {
    try {
      const zdResult = await zeroDowntimeScale(targetVcpu, targetMemoryGiB, config);
      const previousVcpu = state.currentVcpu;
      const previousMemoryGiB = state.currentMemoryGiB;

      if (zdResult.success) {
        await store.updateScalingState({
          currentVcpu: targetVcpu,
          currentMemoryGiB: targetMemoryGiB,
          lastScalingTime: timestamp,
        });
      }

      return {
        success: zdResult.success,
        previousVcpu,
        currentVcpu: zdResult.success ? targetVcpu : previousVcpu,
        previousMemoryGiB,
        currentMemoryGiB: zdResult.success ? targetMemoryGiB : previousMemoryGiB,
        timestamp,
        message: zdResult.success
          ? `[Zero-Downtime] Scaled from ${previousVcpu} to ${targetVcpu} vCPU via Parallel Pod Swap`
          : `[Zero-Downtime] Failed: ${zdResult.error}`,
        error: zdResult.error,
        zeroDowntime: true,
        rolloutPhase: zdResult.finalPhase,
        rolloutDurationMs: zdResult.totalDurationMs,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[Zero-Downtime] Unexpected error:', errorMessage);
      return {
        success: false,
        previousVcpu: currentVcpu,
        currentVcpu: currentVcpu,
        previousMemoryGiB: state.currentMemoryGiB,
        currentMemoryGiB: state.currentMemoryGiB,
        timestamp,
        message: '[Zero-Downtime] Unexpected orchestration error',
        error: errorMessage,
        zeroDowntime: true,
      };
    }
  }

  try {
    // Execute kubectl patch command (legacy rolling update)
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
    const previousVcpu = state.currentVcpu;
    const previousMemoryGiB = state.currentMemoryGiB;

    await store.updateScalingState({
      currentVcpu: targetVcpu,
      currentMemoryGiB: targetMemoryGiB,
      lastScalingTime: timestamp,
    });

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
      previousMemoryGiB: state.currentMemoryGiB,
      currentMemoryGiB: state.currentMemoryGiB,
      timestamp,
      message: 'Failed to execute kubectl patch',
      error: errorMessage,
    };
  }
}

/**
 * Get current scaling state
 */
export async function getScalingState(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<ScalingState> {
  const state = await getStore().getScalingState();
  const cooldown = await checkCooldown(config);
  return {
    ...state,
    cooldownRemaining: cooldown.remainingSeconds,
  };
}

/**
 * Update scaling state (Manual)
 */
export async function updateScalingState(updates: Partial<ScalingState>): Promise<void> {
  await getStore().updateScalingState(updates);
}

/**
 * Add scaling history
 */
export async function addScalingHistory(entry: ScalingHistoryEntry): Promise<void> {
  await getStore().addScalingHistory(entry);
}

/**
 * Get scaling history
 */
export async function getScalingHistory(limit: number = 10): Promise<ScalingHistoryEntry[]> {
  return getStore().getScalingHistory(limit);
}

/**
 * Enable/Disable auto-scaling
 */
export async function setAutoScalingEnabled(enabled: boolean): Promise<void> {
  await getStore().updateScalingState({ autoScalingEnabled: enabled });
}

/**
 * Check auto-scaling status
 */
export async function isAutoScalingEnabled(): Promise<boolean> {
  const state = await getStore().getScalingState();
  return state.autoScalingEnabled;
}
