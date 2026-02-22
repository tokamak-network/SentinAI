/**
 * Goal Plan Validator
 * Validates model-generated plan candidates with schema/policy/runtime checks.
 */

import { randomUUID } from 'crypto';
import { getEvents } from '@/lib/anomaly-event-store';
import { getScalingState } from '@/lib/k8s-scaler';
import { getRecentMetrics } from '@/lib/metrics-store';
import type {
  GoalPlanFailureReasonCode,
  GoalPlanIntent,
  GoalPlanStep,
  GoalPlanStepAction,
  GoalPlannerRuntimeContext,
} from '@/types/goal-planner';

const ALLOWED_ACTIONS: GoalPlanStepAction[] = [
  'collect_state',
  'inspect_anomalies',
  'run_rca',
  'scale_execution',
  'restart_execution',
  'set_routing_policy',
];

const ROUTING_POLICIES = new Set(['balanced', 'cost-first', 'latency-first', 'quality-first']);

export interface GoalPlanCandidateStep {
  id?: string;
  title?: string;
  action?: string;
  reason?: string;
  risk?: string;
  requiresApproval?: boolean;
  parameters?: Record<string, unknown>;
  preconditions?: string[];
  rollbackHint?: string;
}

export interface GoalPlanCandidate {
  intent?: string;
  summary?: string;
  steps?: GoalPlanCandidateStep[];
}

export interface GoalPlanValidationIssue {
  code: GoalPlanFailureReasonCode;
  message: string;
  stepIndex?: number;
}

export interface GoalPlanValidationInput {
  candidate: GoalPlanCandidate;
  dryRun: boolean;
  allowWrites: boolean;
  readOnlyMode: boolean;
  runtime: GoalPlannerRuntimeContext;
}

export interface GoalPlanValidationSuccess {
  valid: true;
  intent: GoalPlanIntent;
  summary: string;
  steps: GoalPlanStep[];
  issues: [];
}

export interface GoalPlanValidationFailure {
  valid: false;
  failureReasonCode: GoalPlanFailureReasonCode;
  issues: GoalPlanValidationIssue[];
}

export type GoalPlanValidationResult =
  | GoalPlanValidationSuccess
  | GoalPlanValidationFailure;

function toIntent(value: unknown): GoalPlanIntent {
  if (
    value === 'stabilize' ||
    value === 'cost-optimize' ||
    value === 'investigate' ||
    value === 'recover' ||
    value === 'custom'
  ) {
    return value;
  }
  return 'custom';
}

function toRisk(value: unknown): GoalPlanStep['risk'] {
  if (value === 'medium' || value === 'high' || value === 'low') return value;
  return 'low';
}

function isScaleAction(action: GoalPlanStepAction): boolean {
  return action === 'scale_execution';
}

function isWriteAction(action: GoalPlanStepAction): boolean {
  return action === 'scale_execution' || action === 'restart_execution' || action === 'set_routing_policy';
}

function inferFailureReason(issues: GoalPlanValidationIssue[]): GoalPlanFailureReasonCode {
  if (issues.some((issue) => issue.code === 'policy_violation')) return 'policy_violation';
  if (issues.some((issue) => issue.code === 'runtime_precondition_failed')) return 'runtime_precondition_failed';
  if (issues.some((issue) => issue.code === 'invalid_step_action')) return 'invalid_step_action';
  if (issues.some((issue) => issue.code === 'schema_invalid')) return 'schema_invalid';
  return 'schema_invalid';
}

function validateScaleParameters(
  stepIndex: number,
  step: GoalPlanCandidateStep,
  runtime: GoalPlannerRuntimeContext,
  issues: GoalPlanValidationIssue[]
): void {
  const targetVcpu = step.parameters?.targetVcpu;
  if (typeof targetVcpu !== 'number' || ![1, 2, 4, 8].includes(targetVcpu)) {
    issues.push({
      code: 'schema_invalid',
      stepIndex,
      message: 'scale_execution step requires targetVcpu in [1,2,4,8].',
    });
    return;
  }

  if (runtime.cooldownRemaining > 0 && targetVcpu !== runtime.currentVcpu) {
    issues.push({
      code: 'runtime_precondition_failed',
      stepIndex,
      message: `cooldown active (${runtime.cooldownRemaining}s)`,
    });
  }

  if (targetVcpu < runtime.currentVcpu && runtime.activeAnomalyCount > 0) {
    issues.push({
      code: 'runtime_precondition_failed',
      stepIndex,
      message: 'downscale blocked while active anomalies exist',
    });
  }
}

function validateRoutingParameters(
  stepIndex: number,
  step: GoalPlanCandidateStep,
  issues: GoalPlanValidationIssue[]
): void {
  const policyName = step.parameters?.policyName;
  if (typeof policyName !== 'string' || !ROUTING_POLICIES.has(policyName)) {
    issues.push({
      code: 'schema_invalid',
      stepIndex,
      message: 'set_routing_policy step requires valid policyName.',
    });
  }
}

export async function collectGoalPlannerRuntimeContext(): Promise<GoalPlannerRuntimeContext> {
  const [metrics, anomalyEvents, scalingState] = await Promise.all([
    getRecentMetrics(5),
    getEvents(100, 0),
    getScalingState(),
  ]);

  const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const activeAnomalyCount = anomalyEvents.events.filter((event) => event.status === 'active').length;

  return {
    latestCpuUsage: latestMetric?.cpuUsage ?? null,
    activeAnomalyCount,
    currentVcpu: scalingState.currentVcpu,
    cooldownRemaining: scalingState.cooldownRemaining,
  };
}

export function validateGoalPlanCandidate(input: GoalPlanValidationInput): GoalPlanValidationResult {
  const { candidate, dryRun, allowWrites, readOnlyMode, runtime } = input;
  const issues: GoalPlanValidationIssue[] = [];

  if (!candidate || typeof candidate !== 'object') {
    return {
      valid: false,
      failureReasonCode: 'schema_invalid',
      issues: [{ code: 'schema_invalid', message: 'candidate is not an object' }],
    };
  }

  if (!Array.isArray(candidate.steps) || candidate.steps.length === 0) {
    return {
      valid: false,
      failureReasonCode: 'schema_invalid',
      issues: [{ code: 'schema_invalid', message: 'plan requires at least one step' }],
    };
  }

  if (candidate.steps.length > 12) {
    issues.push({
      code: 'schema_invalid',
      message: 'plan has too many steps (max 12).',
    });
  }

  const normalizedSteps: GoalPlanStep[] = [];

  candidate.steps.forEach((rawStep, index) => {
    const action = rawStep.action;
    if (typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action as GoalPlanStepAction)) {
      issues.push({
        code: 'invalid_step_action',
        stepIndex: index,
        message: `unsupported step action: ${String(action)}`,
      });
      return;
    }

    const typedAction = action as GoalPlanStepAction;

    const title = typeof rawStep.title === 'string' && rawStep.title.trim().length > 0
      ? rawStep.title.trim()
      : `${typedAction} step`;
    const reason = typeof rawStep.reason === 'string' && rawStep.reason.trim().length > 0
      ? rawStep.reason.trim()
      : 'No reason provided';

    const requiresApproval = rawStep.requiresApproval === true || isWriteAction(typedAction);

    if (readOnlyMode && allowWrites && isWriteAction(typedAction)) {
      issues.push({
        code: 'policy_violation',
        stepIndex: index,
        message: 'write step blocked in read-only mode',
      });
    }

    if (isScaleAction(typedAction)) {
      validateScaleParameters(index, rawStep, runtime, issues);
    }

    if (typedAction === 'set_routing_policy') {
      validateRoutingParameters(index, rawStep, issues);
    }

    normalizedSteps.push({
      id: typeof rawStep.id === 'string' && rawStep.id.trim().length > 0 ? rawStep.id : randomUUID(),
      title,
      action: typedAction,
      reason,
      risk: toRisk(rawStep.risk),
      requiresApproval,
      parameters: rawStep.parameters,
      preconditions: Array.isArray(rawStep.preconditions)
        ? rawStep.preconditions.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : undefined,
      rollbackHint: typeof rawStep.rollbackHint === 'string' ? rawStep.rollbackHint : undefined,
      status: 'pending',
    });
  });

  if (!dryRun && !allowWrites) {
    issues.push({
      code: 'policy_violation',
      message: 'write execution disabled while dryRun=false and allowWrites=false',
    });
  }

  if (issues.length > 0) {
    return {
      valid: false,
      failureReasonCode: inferFailureReason(issues),
      issues,
    };
  }

  const summary = typeof candidate.summary === 'string' && candidate.summary.trim().length > 0
    ? candidate.summary.trim()
    : `validated plan with ${normalizedSteps.length} steps`;

  return {
    valid: true,
    intent: toIntent(candidate.intent),
    summary,
    steps: normalizedSteps,
    issues: [],
  };
}
