/**
 * Goal Planner
 * Decomposes natural-language goals into guarded operation steps.
 */

import { randomUUID } from 'crypto';
import { getChainPlugin } from '@/chains';
import { getEvents } from '@/lib/anomaly-event-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { generateGoalPlanCandidate } from '@/lib/goal-planner-llm';
import {
  collectGoalPlannerRuntimeContext,
  validateGoalPlanCandidate,
  type GoalPlanCandidate,
  type GoalPlanValidationIssue,
} from '@/lib/goal-plan-validator';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import { getRecentMetrics } from '@/lib/metrics-store';
import { performRCA, addRCAHistory } from '@/lib/rca-engine';
import { executeAction } from '@/lib/action-executor';
import { setRoutingPolicy } from '@/lib/ai-routing';
import { verifyOperationOutcome } from '@/lib/operation-verifier';
import { buildRollbackPlan, runRollbackPlan } from '@/lib/rollback-runner';
import { scaleOpGeth, getScalingState } from '@/lib/k8s-scaler';
import { DEFAULT_SCALING_CONFIG, type TargetMemoryGiB, type TargetVcpu } from '@/types/scaling';
import type { RemediationAction } from '@/types/remediation';
import type { RoutingPolicyName } from '@/types/ai-routing';
import type { OperationActionType } from '@/types/operation-control';
import type {
  GoalExecutionOptions,
  GoalExecutionResult,
  GoalPlan,
  GoalPlanFailureReasonCode,
  GoalPlanIntent,
  GoalPlanStep,
  GoalPlanStepAction,
  GoalPlanStepStatus,
} from '@/types/goal-planner';

const MAX_GOAL_PLAN_HISTORY = 100;
const MAX_REPLANS = 2;

type ExecutionContext = {
  latestCpuUsage: number | null;
  latestTxPool: number | null;
  currentVcpu: number;
  activeAnomalyCount: number;
};

const planHistory: GoalPlan[] = [];

function inferGoalIntent(goal: string): GoalPlanIntent {
  const normalized = goal.toLowerCase();
  if (normalized.includes('cost') || normalized.includes('saving') || normalized.includes('optimiz')) {
    return 'cost-optimize';
  }
  if (normalized.includes('recover') || normalized.includes('restart')) {
    return 'recover';
  }
  if (normalized.includes('investigate') || normalized.includes('diagnos') || normalized.includes('root cause')) {
    return 'investigate';
  }
  if (normalized.includes('stabilize') || normalized.includes('safe')) {
    return 'stabilize';
  }
  return 'custom';
}

function parseTargetVcpu(goal: string): TargetVcpu | undefined {
  const matched = goal.match(/(?:^|\s)(1|2|4|8)\s*v?cpu(?:\s|$)/i);
  if (!matched) return undefined;
  const value = Number.parseInt(matched[1], 10);
  if (value === 1 || value === 2 || value === 4 || value === 8) {
    return value;
  }
  return undefined;
}

function parseRoutingPolicy(goal: string): RoutingPolicyName | undefined {
  const normalized = goal.toLowerCase();
  if (normalized.includes('latency-first')) return 'latency-first';
  if (normalized.includes('quality-first')) return 'quality-first';
  if (normalized.includes('cost-first')) return 'cost-first';
  if (normalized.includes('balanced')) return 'balanced';
  if (normalized.includes('cost optimize')) return 'cost-first';
  return undefined;
}

function makeStep(
  action: GoalPlanStepAction,
  title: string,
  reason: string,
  options: Partial<GoalPlanStep> = {}
): GoalPlanStep {
  const defaultRequiresApproval =
    action === 'scale_execution' || action === 'restart_execution' || action === 'set_routing_policy';

  return {
    id: randomUUID(),
    title,
    action,
    reason,
    risk: options.risk || 'low',
    requiresApproval: options.requiresApproval ?? defaultRequiresApproval,
    parameters: options.parameters,
    preconditions: options.preconditions,
    rollbackHint: options.rollbackHint,
    status: 'pending',
  };
}

function buildSteps(intent: GoalPlanIntent, goal: string): GoalPlanStep[] {
  const explicitTarget = parseTargetVcpu(goal);
  const explicitPolicy = parseRoutingPolicy(goal);

  if (intent === 'stabilize') {
    return [
      makeStep('collect_state', 'Collect Current State', 'Review recent metrics and resource state.'),
      makeStep('inspect_anomalies', 'Inspect Anomaly Events', 'Check active anomaly count and severity.'),
      makeStep('run_rca', 'Run Root Cause Analysis', 'Analyze the root cause of current signals with RCA.', { risk: 'medium' }),
      makeStep(
        'scale_execution',
        'Scale Execution Node for Stabilization',
        'Scale up the execution node when load signals are present.',
        {
          risk: 'high',
          requiresApproval: true,
          parameters: { targetVcpu: explicitTarget || 4 },
          preconditions: ['CPU >= 65% or active anomaly events present'],
          rollbackHint: 'Gradually return to 2 vCPU after load stabilizes',
        }
      ),
    ];
  }

  if (intent === 'cost-optimize') {
    return [
      makeStep('collect_state', 'Collect Current State', 'Review recent metrics and resource usage.'),
      makeStep(
        'set_routing_policy',
        'Prioritize Cost in Model Routing',
        'Adjust AI model routing toward cost efficiency.',
        {
          risk: 'medium',
          requiresApproval: true,
          parameters: { policyName: explicitPolicy || 'cost-first' },
          rollbackHint: 'Revert to balanced if quality issues appear',
        }
      ),
      makeStep(
        'scale_execution',
        'Optimize Execution Node Cost',
        'Scale down the execution node during low-utilization windows.',
        {
          risk: 'high',
          requiresApproval: true,
          parameters: { targetVcpu: explicitTarget || 2 },
          preconditions: ['CPU <= 50% and no active anomaly events'],
          rollbackHint: 'Immediately return to 4 vCPU on sudden load spikes',
        }
      ),
    ];
  }

  if (intent === 'recover') {
    return [
      makeStep('collect_state', 'Collect Current State', 'Check the latest state before recovery.'),
      makeStep(
        'restart_execution',
        'Restart Execution Node',
        'Restart the execution component for incident recovery.',
        {
          risk: 'high',
          requiresApproval: true,
          rollbackHint: 'Keep previous resource state and perform manual inspection if restart fails',
        }
      ),
      makeStep('run_rca', 'Run Post-Recovery RCA', 'Trace remaining causes after recovery.', { risk: 'medium' }),
    ];
  }

  if (intent === 'investigate') {
    return [
      makeStep('collect_state', 'Collect Current State', 'Review metrics and scaling state.'),
      makeStep('inspect_anomalies', 'Inspect Anomaly Events', 'Query active anomaly events.'),
      makeStep('run_rca', 'Run Root Cause Analysis', 'Run RCA to identify the root cause.', { risk: 'medium' }),
    ];
  }

  return [
    makeStep('collect_state', 'Collect Current State', 'Collect baseline operational state.'),
    makeStep('run_rca', 'Run Root Cause Analysis', 'Check for anomaly signals.', { risk: 'medium' }),
  ];
}

function createGoalPlan(
  goal: string,
  dryRun: boolean,
  intent: GoalPlanIntent,
  summary: string,
  steps: GoalPlanStep[],
  planVersion: GoalPlan['planVersion'],
  replanCount: number,
  failureReasonCode?: GoalPlanFailureReasonCode
): GoalPlan {
  const timestamp = new Date().toISOString();
  return {
    planId: randomUUID(),
    goal,
    intent,
    planVersion,
    replanCount,
    failureReasonCode,
    status: 'planned',
    dryRun,
    createdAt: timestamp,
    updatedAt: timestamp,
    summary,
    steps,
  };
}

function createRuleBasedPlan(
  goal: string,
  dryRun: boolean,
  failureReasonCode?: GoalPlanFailureReasonCode,
  replanCount: number = 0
): GoalPlan {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) {
    throw new Error('Goal text is required');
  }

  const intent = inferGoalIntent(normalizedGoal);
  const steps = buildSteps(intent, normalizedGoal);
  const summary = `${steps.length} steps generated for ${intent} intent`;
  return createGoalPlan(
    normalizedGoal,
    dryRun,
    intent,
    summary,
    steps,
    'v1-rule',
    replanCount,
    failureReasonCode
  );
}

function issuesToText(issues: GoalPlanValidationIssue[]): string[] {
  return issues.map((issue) => {
    const stepLabel = typeof issue.stepIndex === 'number' ? `step#${issue.stepIndex + 1}: ` : '';
    return `${stepLabel}${issue.code} - ${issue.message}`;
  });
}

function normalizeGoalCandidate(goal: string, candidate: GoalPlanCandidate): GoalPlanCandidate {
  return {
    ...candidate,
    summary: candidate.summary || `${goal} goal plan`,
  };
}

export async function buildGoalPlan(goal: string, dryRun: boolean = true): Promise<GoalPlan> {
  const normalizedGoal = goal.trim();
  if (!normalizedGoal) {
    throw new Error('Goal text is required');
  }

  let validationIssues: string[] = [];
  let lastFailureReason: GoalPlanFailureReasonCode | undefined;

  for (let replanCount = 0; replanCount <= MAX_REPLANS; replanCount++) {
    const llmResult = await generateGoalPlanCandidate({
      goal: normalizedGoal,
      dryRun,
      replanCount,
      maxReplans: MAX_REPLANS,
      previousIssues: validationIssues,
    });

    if (!llmResult.ok) {
      lastFailureReason = llmResult.reasonCode;
      break;
    }

    const runtime = await collectGoalPlannerRuntimeContext();
    const validation = validateGoalPlanCandidate({
      candidate: normalizeGoalCandidate(normalizedGoal, llmResult.candidate),
      dryRun,
      allowWrites: !dryRun,
      readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
      runtime,
    });

    if (validation.valid) {
      return createGoalPlan(
        normalizedGoal,
        dryRun,
        validation.intent,
        validation.summary,
        validation.steps,
        'v2-llm',
        replanCount,
        'none'
      );
    }

    validationIssues = issuesToText(validation.issues);
    lastFailureReason = validation.failureReasonCode;
  }

  if (lastFailureReason) {
    const fallbackReason: GoalPlanFailureReasonCode = lastFailureReason === 'llm_unavailable' || lastFailureReason === 'llm_parse_error'
      ? 'fallback_rule_based'
      : 'replan_exhausted';
    return createRuleBasedPlan(normalizedGoal, dryRun, fallbackReason, MAX_REPLANS);
  }

  return createRuleBasedPlan(normalizedGoal, dryRun, 'fallback_rule_based', 0);
}

function clonePlan(plan: GoalPlan): GoalPlan {
  return JSON.parse(JSON.stringify(plan)) as GoalPlan;
}

function pushPlanHistory(plan: GoalPlan): void {
  planHistory.unshift(clonePlan(plan));
  if (planHistory.length > MAX_GOAL_PLAN_HISTORY) {
    planHistory.splice(MAX_GOAL_PLAN_HISTORY);
  }
}

export function getGoalPlanHistory(limit: number = 20): GoalPlan[] {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_GOAL_PLAN_HISTORY);
  return planHistory.slice(0, safeLimit).map((plan) => clonePlan(plan));
}

export function getGoalPlanById(planId: string): GoalPlan | null {
  const found = planHistory.find((plan) => plan.planId === planId);
  return found ? clonePlan(found) : null;
}

export function saveGoalPlan(plan: GoalPlan): GoalPlan {
  pushPlanHistory(plan);
  return clonePlan(plan);
}

async function collectExecutionContext(): Promise<ExecutionContext> {
  const [metrics, scalingState, anomalyEvents] = await Promise.all([
    getRecentMetrics(5),
    getScalingState(),
    getEvents(100, 0),
  ]);

  const latestMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const activeAnomalyCount = anomalyEvents.events.filter((event) => event.status === 'active').length;

  return {
    latestCpuUsage: latestMetric ? latestMetric.cpuUsage : null,
    latestTxPool: latestMetric ? latestMetric.txPoolPending : null,
    currentVcpu: scalingState.currentVcpu,
    activeAnomalyCount,
  };
}

function setStepResult(step: GoalPlanStep, status: GoalPlanStepStatus, message: string): void {
  step.status = status;
  step.resultSummary = message;
}

function shouldSkipScaleStep(step: GoalPlanStep, context: ExecutionContext): string | null {
  const targetRaw = step.parameters?.targetVcpu;
  if (typeof targetRaw !== 'number' || ![1, 2, 4, 8].includes(targetRaw)) {
    return 'No valid targetVcpu provided.';
  }

  const target = targetRaw as TargetVcpu;
  if (target === context.currentVcpu) {
    return `Already at ${target} vCPU.`;
  }

  if (target < context.currentVcpu) {
    if (context.activeAnomalyCount > 0) return 'Skip scale-down because active anomaly events are present.';
    if (context.latestCpuUsage !== null && context.latestCpuUsage > 55) return 'Skip scale-down because CPU is high.';
  }

  if (target > context.currentVcpu) {
    if (context.latestCpuUsage !== null && context.latestCpuUsage < 45 && context.activeAnomalyCount === 0) {
      return 'Skip scale-up because no load signal is present.';
    }
  }

  return null;
}

async function executeRcaStep(): Promise<{ ok: boolean; message: string }> {
  const metrics = await getRecentMetrics();
  if (metrics.length === 0) {
    return { ok: false, message: 'No metrics available for RCA.' };
  }

  const current = metrics[metrics.length - 1];
  const history = metrics.slice(0, -1);
  const anomalies = history.length > 0 ? detectAnomalies(current, history) : [];

  let logs: Record<string, string>;
  try {
    logs = await getAllLiveLogs();
  } catch {
    logs = generateMockLogs('normal');
  }

  const result = await performRCA(anomalies, logs, metrics);
  addRCAHistory(result, 'manual');

  return {
    ok: true,
    message: `RCA completed: ${result.rootCause.component} - ${result.rootCause.description}`,
  };
}

async function runStepOperationControl(
  actionType: OperationActionType,
  dryRun: boolean,
  expected: Record<string, unknown>,
  observed: Record<string, unknown>,
  execution: Record<string, unknown>
): Promise<string> {
  const verification = await verifyOperationOutcome({
    actionType,
    dryRun,
    expected,
    observed,
  });

  if (verification.passed) {
    return verification.details ? ` | verify: ${verification.details}` : '';
  }

  const rollbackPlan = buildRollbackPlan({ actionType, execution });
  const rollback = await runRollbackPlan(rollbackPlan, dryRun);
  if (rollback.success) {
    return ` | verify-failed: ${verification.details || 'unknown'} | rollback: ${rollback.message}`;
  }

  const rollbackDetails = rollback.attempted
    ? `rollback failed: ${rollback.message}`
    : `rollback unavailable: ${rollback.message}`;
  throw new Error(`verification failed (${verification.details || 'unknown'}), ${rollbackDetails}`);
}

async function executePlanStep(
  step: GoalPlanStep,
  context: ExecutionContext,
  options: GoalExecutionOptions
): Promise<string> {
  if (step.action === 'collect_state') {
    return `cpu=${context.latestCpuUsage?.toFixed(1) ?? 'n/a'}%, txPool=${context.latestTxPool ?? 'n/a'}, currentVcpu=${context.currentVcpu}, activeAnomaly=${context.activeAnomalyCount}`;
  }

  if (step.action === 'inspect_anomalies') {
    return `${context.activeAnomalyCount} active anomaly event(s)`;
  }

  if (step.action === 'run_rca') {
    const rcaResult = await executeRcaStep();
    if (!rcaResult.ok) {
      throw new Error(rcaResult.message);
    }
    return rcaResult.message;
  }

  if (step.action === 'set_routing_policy') {
    const policyName = (step.parameters?.policyName as RoutingPolicyName | undefined) || 'balanced';
    if (options.dryRun) {
      return `[DRY RUN] routing policy -> ${policyName}`;
    }
    setRoutingPolicy({ name: policyName, enabled: true });
    return `routing policy updated: ${policyName}`;
  }

  if (step.action === 'scale_execution') {
    const skipReason = shouldSkipScaleStep(step, context);
    if (skipReason) {
      throw new Error(skipReason);
    }

    const targetRaw = step.parameters?.targetVcpu as number;
    const targetVcpu = targetRaw as TargetVcpu;
    const targetMemoryGiB = (targetVcpu * 2) as TargetMemoryGiB;
    const result = await scaleOpGeth(targetVcpu, targetMemoryGiB, DEFAULT_SCALING_CONFIG, options.dryRun);
    if (!result.success) {
      throw new Error(result.message || result.error || 'scaling failed');
    }
    const controlMessage = await runStepOperationControl(
      'goal_scale_execution',
      options.dryRun,
      { targetVcpu },
      { currentVcpu: result.currentVcpu },
      {
        previousVcpu: result.previousVcpu,
        currentVcpu: result.currentVcpu,
      }
    );
    return `${result.message}${controlMessage}`;
  }

  if (step.action === 'restart_execution') {
    if (options.dryRun) {
      return '[DRY RUN] restart execution component';
    }

    const target = getChainPlugin().primaryExecutionClient;
    const action: RemediationAction = {
      type: 'restart_pod',
      safetyLevel: 'guarded',
      target,
    };
    const result = await executeAction(action, DEFAULT_SCALING_CONFIG);
    if (result.status !== 'success') {
      throw new Error(result.error || result.output || 'restart failed');
    }
    const controlMessage = await runStepOperationControl(
      'goal_restart_execution',
      false,
      { target },
      { target, success: true },
      { target }
    );
    return `component restarted: ${target}${controlMessage}`;
  }

  throw new Error(`Unsupported step action: ${step.action}`);
}

export async function executeGoalPlan(
  sourcePlan: GoalPlan,
  options: GoalExecutionOptions
): Promise<GoalExecutionResult> {
  const plan = clonePlan(sourcePlan);
  plan.status = 'running';
  plan.updatedAt = new Date().toISOString();

  const executionLog: GoalExecutionResult['executionLog'] = [];
  let hasFailure = false;

  let context = await collectExecutionContext();

  for (const step of plan.steps) {
    if (step.requiresApproval && !options.allowWrites) {
      setStepResult(step, 'skipped', 'Skipped because this write step is not approved.');
      executionLog.push({
        stepId: step.id,
        action: step.action,
        status: step.status,
        message: step.resultSummary || 'skipped',
        executedAt: new Date().toISOString(),
      });
      continue;
    }

    try {
      const message = await executePlanStep(step, context, options);
      setStepResult(step, 'completed', message);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      if (message.toLowerCase().includes('skip') || message.toLowerCase().includes('already')) {
        setStepResult(step, 'skipped', message);
      } else {
        setStepResult(step, 'failed', message);
        hasFailure = true;
      }
    }

    executionLog.push({
      stepId: step.id,
      action: step.action,
      status: step.status,
      message: step.resultSummary || step.status,
      executedAt: new Date().toISOString(),
    });

    context = await collectExecutionContext();
  }

  plan.status = hasFailure ? 'failed' : 'completed';
  plan.updatedAt = new Date().toISOString();
  pushPlanHistory(plan);

  return { plan, executionLog };
}

export async function planAndExecuteGoal(
  goal: string,
  options: GoalExecutionOptions
): Promise<GoalExecutionResult> {
  const plan = await buildGoalPlan(goal, options.dryRun);
  return executeGoalPlan(plan, options);
}
