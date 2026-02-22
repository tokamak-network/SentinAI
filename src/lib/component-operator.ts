/**
 * Component Operator
 * Restart helpers and health diagnostics for MCP operational tools.
 */

import { getChainPlugin } from '@/chains';
import { executeAction } from '@/lib/action-executor';
import { getEvents } from '@/lib/anomaly-event-store';
import { getScalingState } from '@/lib/k8s-scaler';
import {
  getActiveL1RpcUrl,
  getL1FailoverState,
  healthCheckEndpoint,
  maskUrl,
} from '@/lib/l1-rpc-failover';
import { getMetricsCount, getRecentMetrics } from '@/lib/metrics-store';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type { ActionResult, RemediationAction } from '@/types/remediation';

export interface RestartComponentInput {
  target?: string;
  dryRun?: boolean;
}

export interface RestartComponentResult {
  success: boolean;
  target: string;
  dryRun: boolean;
  message: string;
  actionResult?: ActionResult;
}

function resolveComponentTarget(target?: string): string {
  const plugin = getChainPlugin();
  if (!target || target.trim().length === 0) return plugin.primaryExecutionClient;
  const normalized = plugin.normalizeComponentName(target);
  return normalized === 'system' ? plugin.primaryExecutionClient : normalized;
}

export async function restartComponent(
  input: RestartComponentInput
): Promise<RestartComponentResult> {
  const target = resolveComponentTarget(input.target);
  const dryRun = input.dryRun === true;

  if (dryRun) {
    return {
      success: true,
      target,
      dryRun: true,
      message: `[DRY RUN] restart_component target=${target}`,
    };
  }

  const action: RemediationAction = {
    type: 'restart_pod',
    safetyLevel: 'guarded',
    target,
  };

  const actionResult = await executeAction(action, DEFAULT_SCALING_CONFIG);
  return {
    success: actionResult.status === 'success',
    target,
    dryRun: false,
    message: actionResult.output || actionResult.error || 'restart completed',
    actionResult,
  };
}

export interface HealthDiagnosticsComponentResult {
  component: string;
  healthy: boolean;
  details: string;
}

export interface HealthDiagnosticsResult {
  generatedAt: string;
  metrics: {
    count: number;
    latestCpuUsage: number | null;
    latestTxPoolPending: number | null;
    currentVcpu: number;
    cooldownRemaining: number;
  };
  anomalies: {
    total: number;
    active: number;
  };
  l1Rpc: {
    activeUrl: string;
    healthy: boolean;
    endpointCount: number;
  };
  components: HealthDiagnosticsComponentResult[];
}

function buildDiagnosticTargets(): string[] {
  const plugin = getChainPlugin();
  const targets = new Set<string>();
  targets.add(plugin.primaryExecutionClient);

  const batcher = plugin.normalizeComponentName('batcher');
  if (batcher !== 'system') targets.add(batcher);

  const proposer = plugin.normalizeComponentName('proposer');
  if (proposer !== 'system') targets.add(proposer);

  return [...targets];
}

export async function runHealthDiagnostics(): Promise<HealthDiagnosticsResult> {
  const [metrics, metricsCount, scalingState, anomalyEvents, activeL1Url, failoverState] = await Promise.all([
    getRecentMetrics(1),
    getMetricsCount(),
    getScalingState(),
    getEvents(100, 0),
    Promise.resolve(getActiveL1RpcUrl()),
    Promise.resolve(getL1FailoverState()),
  ]);

  const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const l1Healthy = await healthCheckEndpoint(activeL1Url);

  const componentResults = await Promise.all(
    buildDiagnosticTargets().map(async (component): Promise<HealthDiagnosticsComponentResult> => {
      const action: RemediationAction = {
        type: 'health_check',
        safetyLevel: 'safe',
        target: component,
      };
      const result = await executeAction(action, DEFAULT_SCALING_CONFIG);
      const details = result.output || result.error || 'health check unavailable';
      return {
        component,
        healthy: result.status === 'success' && !details.toLowerCase().includes('not'),
        details,
      };
    })
  );

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      count: metricsCount,
      latestCpuUsage: latestMetric?.cpuUsage ?? null,
      latestTxPoolPending: latestMetric?.txPoolPending ?? null,
      currentVcpu: scalingState.currentVcpu,
      cooldownRemaining: scalingState.cooldownRemaining,
    },
    anomalies: {
      total: anomalyEvents.total,
      active: anomalyEvents.events.filter((event) => event.status === 'active').length,
    },
    l1Rpc: {
      activeUrl: maskUrl(activeL1Url),
      healthy: l1Healthy,
      endpointCount: failoverState.endpoints.length,
    },
    components: componentResults,
  };
}
