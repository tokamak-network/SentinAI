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
