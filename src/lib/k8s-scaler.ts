/**
 * K8s Scaler Module
 * Patch StatefulSet resources via kubectl
 */

import {
  ScaleResult,
  ScalingState,
  ScalingHistoryEntry,
  ScalingConfig,
  DEFAULT_SCALING_CONFIG,
  SimulationConfig,
  DEFAULT_SIMULATION_CONFIG,
} from '@/types/scaling';
import { runK8sCommand } from '@/lib/k8s-config';

// Simulation mode (Controlled by env var, default: true = safe mode)
const simulationConfig: SimulationConfig = {
  ...DEFAULT_SIMULATION_CONFIG,
  enabled: process.env.SCALING_SIMULATION_MODE !== 'false',
};

// In-memory state storage (Not persisted between requests in Vercel serverless environment)
// Recommended to use Redis or DB in actual production
let scalingState: ScalingState = {
  currentVcpu: 1,
  currentMemoryGiB: 2,
  lastScalingTime: null,
  lastDecision: null,
  cooldownRemaining: 0,
  autoScalingEnabled: true,
};

let scalingHistory: ScalingHistoryEntry[] = [];

/**
 * Check simulation mode status
 */
export function isSimulationMode(): boolean {
  return simulationConfig.enabled;
}

/**
 * Set simulation mode
 */
export function setSimulationMode(enabled: boolean): void {
  simulationConfig.enabled = enabled;
}

/**
 * Get simulation config
 */
export function getSimulationConfig(): SimulationConfig {
  return { ...simulationConfig };
}


/**
 * Get current op-geth vCPU
 */
export async function getCurrentVcpu(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): Promise<number> {
  // Simulation mode: Return in-memory state
  if (simulationConfig.enabled) {
    return scalingState.currentVcpu;
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
    return scalingState.currentVcpu || 1;
  }
}

/**
 * Check cooldown
 */
export function checkCooldown(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): { inCooldown: boolean; remainingSeconds: number } {
  if (!scalingState.lastScalingTime) {
    return { inCooldown: false, remainingSeconds: 0 };
  }

  const lastScaling = new Date(scalingState.lastScalingTime).getTime();
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
  const { namespace, statefulSetName, containerIndex, minVcpu, maxVcpu } = config;
  const timestamp = new Date().toISOString();

  // Range validation
  if (targetVcpu < minVcpu || targetVcpu > maxVcpu) {
    return {
      success: false,
      previousVcpu: scalingState.currentVcpu,
      currentVcpu: scalingState.currentVcpu,
      previousMemoryGiB: scalingState.currentMemoryGiB,
      currentMemoryGiB: scalingState.currentMemoryGiB,
      timestamp,
      message: `vCPU must be between ${minVcpu} and ${maxVcpu}`,
      error: 'OUT_OF_RANGE',
    };
  }

  // Cooldown check
  const cooldown = checkCooldown(config);
  if (cooldown.inCooldown && !dryRun) {
    return {
      success: false,
      previousVcpu: scalingState.currentVcpu,
      currentVcpu: scalingState.currentVcpu,
      previousMemoryGiB: scalingState.currentMemoryGiB,
      currentMemoryGiB: scalingState.currentMemoryGiB,
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
      previousMemoryGiB: scalingState.currentMemoryGiB,
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
      previousMemoryGiB: scalingState.currentMemoryGiB,
      currentMemoryGiB: targetMemoryGiB,
      timestamp,
      message: `[DRY RUN] Would scale from ${currentVcpu} to ${targetVcpu} vCPU`,
    };
  }

  // Simulation mode: Update state only without actual kubectl execution
  if (simulationConfig.enabled) {
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
      message: `[SIMULATION] Scaled from ${previousVcpu} to ${targetVcpu} vCPU (No actual K8s changes)`,
    };
  }

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
}

/**
 * Get current scaling state
 */
export function getScalingState(
  config: ScalingConfig = DEFAULT_SCALING_CONFIG
): ScalingState {
  const cooldown = checkCooldown(config);
  return {
    ...scalingState,
    cooldownRemaining: cooldown.remainingSeconds,
  };
}

/**
 * Update scaling state (Manual)
 */
export function updateScalingState(updates: Partial<ScalingState>): void {
  scalingState = { ...scalingState, ...updates };
}

/**
 * Add scaling history
 */
export function addScalingHistory(entry: ScalingHistoryEntry): void {
  scalingHistory.unshift(entry);
  // Keep only the last 50 entries
  if (scalingHistory.length > 50) {
    scalingHistory = scalingHistory.slice(0, 50);
  }
}

/**
 * Get scaling history
 */
export function getScalingHistory(limit: number = 10): ScalingHistoryEntry[] {
  return scalingHistory.slice(0, limit);
}

/**
 * Enable/Disable auto-scaling
 */
export function setAutoScalingEnabled(enabled: boolean): void {
  scalingState.autoScalingEnabled = enabled;
}

/**
 * Check auto-scaling status
 */
export function isAutoScalingEnabled(): boolean {
  return scalingState.autoScalingEnabled;
}
