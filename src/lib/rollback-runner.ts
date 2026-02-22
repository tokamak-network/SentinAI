/**
 * Rollback Runner
 * Builds and executes rollback actions when verification fails.
 */

import { scaleOpGeth } from '@/lib/k8s-scaler';
import { switchL1RpcUrl, updateProxydBackendUrl } from '@/lib/l1-rpc-operator';
import { verifyOperationOutcome } from '@/lib/operation-verifier';
import { DEFAULT_SCALING_CONFIG, type TargetMemoryGiB, type TargetVcpu } from '@/types/scaling';
import type {
  OperationActionType,
  OperationVerificationResult,
  RollbackPlan,
  RollbackResult,
} from '@/types/operation-control';

export interface BuildRollbackPlanInput {
  actionType: OperationActionType;
  execution: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function asTargetVcpu(value: number): TargetVcpu | null {
  if (value === 1 || value === 2 || value === 4 || value === 8) return value;
  return null;
}

export function buildRollbackPlan(input: BuildRollbackPlanInput): RollbackPlan {
  if (
    input.actionType === 'scale_component' ||
    input.actionType === 'goal_scale_execution' ||
    input.actionType === 'agent_scaling'
  ) {
    const previousVcpu = asTargetVcpu(toNumber(input.execution.previousVcpu) ?? NaN);
    if (previousVcpu) {
      return {
        available: true,
        actionType: input.actionType,
        params: {
          targetVcpu: previousVcpu,
        },
        reason: 'restore previous vCPU after failed verification',
      };
    }
  }

  if (input.actionType === 'switch_l1_rpc') {
    const previousUrl = toStringValue(input.execution.previousUrl || input.execution.fromUrl);
    if (previousUrl) {
      return {
        available: true,
        actionType: 'switch_l1_rpc',
        params: {
          targetUrl: previousUrl,
        },
        reason: 'restore previous L1 RPC endpoint',
      };
    }
  }

  if (input.actionType === 'update_proxyd_backend') {
    const backendName = toStringValue(input.execution.backendName);
    const oldUrl = toStringValue(input.execution.oldUrl);
    if (backendName && oldUrl) {
      return {
        available: true,
        actionType: 'update_proxyd_backend',
        params: {
          backendName,
          newRpcUrl: oldUrl,
        },
        reason: 'restore previous proxyd backend url',
      };
    }
  }

  return {
    available: false,
    reason: 'rollback not defined for action',
  };
}

async function verifyRollback(
  actionType: OperationActionType,
  expected: Record<string, unknown>,
  observed: Record<string, unknown>
): Promise<OperationVerificationResult> {
  return verifyOperationOutcome({
    actionType,
    dryRun: false,
    expected,
    observed,
  });
}

export async function runRollbackPlan(
  plan: RollbackPlan,
  dryRun: boolean
): Promise<RollbackResult> {
  if (!plan.available || !plan.actionType) {
    return {
      attempted: false,
      success: false,
      message: plan.reason || 'rollback unavailable',
      executedAt: nowIso(),
    };
  }

  if (dryRun) {
    return {
      attempted: true,
      success: true,
      message: '[DRY RUN] rollback simulated',
      executedAt: nowIso(),
    };
  }

  try {
    if (
      plan.actionType === 'scale_component' ||
      plan.actionType === 'goal_scale_execution' ||
      plan.actionType === 'agent_scaling'
    ) {
      const targetVcpu = asTargetVcpu(toNumber(plan.params?.targetVcpu) ?? NaN);
      if (!targetVcpu) {
        return {
          attempted: true,
          success: false,
          message: 'rollback targetVcpu missing',
          executedAt: nowIso(),
        };
      }
      const targetMemoryGiB = (targetVcpu * 2) as TargetMemoryGiB;
      const result = await scaleOpGeth(targetVcpu, targetMemoryGiB, DEFAULT_SCALING_CONFIG, false);
      const verification = await verifyRollback(
        plan.actionType,
        { targetVcpu },
        { currentVcpu: result.currentVcpu }
      );
      return {
        attempted: true,
        success: result.success && verification.passed,
        message: result.message || (verification.passed ? 'rollback scale applied' : 'rollback scale verification failed'),
        executedAt: nowIso(),
        verification,
      };
    }

    if (plan.actionType === 'switch_l1_rpc') {
      const targetUrl = toStringValue(plan.params?.targetUrl);
      if (!targetUrl) {
        return {
          attempted: true,
          success: false,
          message: 'rollback targetUrl missing',
          executedAt: nowIso(),
        };
      }
      const result = await switchL1RpcUrl({
        targetUrl,
        reason: 'rollback after failed verification',
      });
      const verification = await verifyRollback(
        'switch_l1_rpc',
        { targetUrl },
        { activeUrl: result.toUrlRaw || result.toUrl }
      );
      return {
        attempted: true,
        success: result.success && verification.passed,
        message: result.message,
        executedAt: nowIso(),
        verification,
      };
    }

    if (plan.actionType === 'update_proxyd_backend') {
      const backendName = toStringValue(plan.params?.backendName);
      const newRpcUrl = toStringValue(plan.params?.newRpcUrl);
      if (!backendName || !newRpcUrl) {
        return {
          attempted: true,
          success: false,
          message: 'rollback proxyd params missing',
          executedAt: nowIso(),
        };
      }
      const result = await updateProxydBackendUrl({
        backendName,
        newRpcUrl,
        reason: 'rollback after failed verification',
      });
      const verification = await verifyRollback(
        'update_proxyd_backend',
        { backendName, newRpcUrl },
        { backendName: result.backendName, newRpcUrl: result.newUrlRaw, success: result.success }
      );
      return {
        attempted: true,
        success: result.success && verification.passed,
        message: result.message,
        executedAt: nowIso(),
        verification,
      };
    }

    return {
      attempted: true,
      success: false,
      message: `unsupported rollback action: ${plan.actionType}`,
      executedAt: nowIso(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown rollback error';
    return {
      attempted: true,
      success: false,
      message,
      executedAt: nowIso(),
    };
  }
}
