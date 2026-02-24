import { randomUUID } from 'crypto';
import { getChainPlugin } from '@/chains';
import { executeAutonomousAction } from '@/lib/action-executor';
import { getRuntimeAutonomyPolicy } from '@/lib/autonomy-policy';
import { getAutonomousAdapter } from '@/lib/autonomous/adapters';
import { verifyAutonomousActionOutcome } from '@/lib/operation-verifier';
import { evaluateGoalExecutionPolicy } from '@/lib/policy-engine';
import type {
  AutonomousActionPolicy,
  AutonomousCapabilities,
  AutonomousExecutionContext,
  AutonomousExecutionResult,
  AutonomousIntent,
  AutonomousPlan,
  AutonomousPlanStep,
  AutonomousRiskLevel,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

interface AutonomousOperationRecord {
  plan: AutonomousPlan;
  execution?: AutonomousExecutionResult;
  createdAt: string;
}

const globalForAutonomousOps = globalThis as unknown as {
  __sentinai_autonomous_ops?: Map<string, AutonomousOperationRecord>;
};

function getStore(): Map<string, AutonomousOperationRecord> {
  if (!globalForAutonomousOps.__sentinai_autonomous_ops) {
    globalForAutonomousOps.__sentinai_autonomous_ops = new Map<string, AutonomousOperationRecord>();
  }
  return globalForAutonomousOps.__sentinai_autonomous_ops;
}

function mapRiskToConfidence(risk: AutonomousRiskLevel): number {
  switch (risk) {
    case 'low':
      return 0.9;
    case 'medium':
      return 0.75;
    case 'high':
      return 0.6;
    case 'critical':
      return 0.5;
    default:
      return 0.7;
  }
}

function getDefaultPolicies(chainType: string, steps: AutonomousPlanStep[]): AutonomousActionPolicy[] {
  return steps.map((step) => ({
    chainType,
    action: step.action,
    risk: step.risk,
    requiresApproval: step.requiresApproval,
    allowAutoExecute: step.risk === 'low' || step.risk === 'medium',
    cooldownSeconds: step.risk === 'critical' ? 900 : step.risk === 'high' ? 300 : 120,
  }));
}

function buildContext(input?: Partial<AutonomousExecutionContext>): AutonomousExecutionContext {
  const plugin = getChainPlugin();
  return {
    chainType: input?.chainType || plugin.chainType,
    runtime: input?.runtime || (process.env.ORCHESTRATOR_TYPE === 'docker' ? 'docker' : 'k8s'),
    dryRun: input?.dryRun !== false,
    allowWrites: input?.allowWrites === true,
    confidence: typeof input?.confidence === 'number' ? input.confidence : 0.8,
    metadata: input?.metadata,
  };
}

function summarize(intent: AutonomousIntent, steps: AutonomousPlanStep[], chainType: string): string {
  return `${chainType} intent=${intent} steps=${steps.length}`;
}

export function getAutonomousCapabilities(): AutonomousCapabilities {
  const plugin = getChainPlugin();
  const adapter = getAutonomousAdapter(plugin.chainType);
  const context = buildContext();
  const probeIntent = adapter.getSupportedIntents()[0];
  const probeSteps = probeIntent ? adapter.translateIntentToActions(probeIntent, context) : [];

  return {
    chainType: plugin.chainType,
    intents: adapter.getSupportedIntents(),
    actions: plugin.capabilities.autonomousActions,
    policies: getDefaultPolicies(plugin.chainType, probeSteps),
  };
}

export function planAutonomousOperation(input: {
  intent: AutonomousIntent;
  context?: Partial<AutonomousExecutionContext>;
}): AutonomousPlan {
  const context = buildContext(input.context);
  const adapter = getAutonomousAdapter(context.chainType);
  const steps = adapter.translateIntentToActions(input.intent, context);

  if (steps.length === 0) {
    throw new Error(`No autonomous steps available for intent=${input.intent} on chain=${context.chainType}`);
  }

  const plan: AutonomousPlan = {
    planId: randomUUID(),
    chainType: context.chainType,
    intent: input.intent,
    dryRun: context.dryRun,
    generatedAt: new Date().toISOString(),
    summary: summarize(input.intent, steps, context.chainType),
    steps,
  };

  getStore().set(plan.planId, {
    plan,
    createdAt: new Date().toISOString(),
  });

  return plan;
}

function shouldStepExecute(step: AutonomousPlanStep, context: AutonomousExecutionContext): { execute: boolean; reason?: string } {
  const policy = getRuntimeAutonomyPolicy();
  const decision = evaluateGoalExecutionPolicy({
    autoExecute: true,
    allowWrites: context.allowWrites && !context.dryRun,
    readOnlyMode: process.env.NEXT_PUBLIC_SENTINAI_READ_ONLY_MODE === 'true',
    autonomyPolicy: policy,
    risk: step.risk,
    confidence: context.confidence ?? mapRiskToConfidence(step.risk),
  });

  if (decision.decision === 'deny') {
    return { execute: false, reason: decision.message };
  }

  if (decision.decision === 'require_approval' && !step.requiresApproval) {
    return { execute: false, reason: decision.message };
  }

  return { execute: true };
}

export async function executeAutonomousOperation(input: {
  planId?: string;
  intent?: AutonomousIntent;
  context?: Partial<AutonomousExecutionContext>;
}): Promise<AutonomousExecutionResult> {
  const context = buildContext(input.context);
  const plan = input.planId
    ? getStore().get(input.planId)?.plan
    : input.intent
      ? planAutonomousOperation({ intent: input.intent, context })
      : undefined;

  if (!plan) {
    throw new Error('Either planId or intent is required for autonomous execution.');
  }

  const operationId = randomUUID();
  const startedAt = new Date().toISOString();
  const steps: AutonomousExecutionResult['steps'] = [];

  for (const step of plan.steps) {
    const stepPolicy = shouldStepExecute(step, context);
    if (!stepPolicy.execute) {
      steps.push({
        stepId: step.id,
        action: step.action,
        status: 'skipped',
        message: stepPolicy.reason || 'Skipped by policy',
      });
      continue;
    }

    const executed = await executeAutonomousAction(step.action, {
      ...(step.params || {}),
      targetComponent: step.targetComponent,
      resourceTarget: step.resourceTarget,
      dryRun: context.dryRun,
      allowWrites: context.allowWrites,
    });

    steps.push({
      stepId: step.id,
      action: step.action,
      status: executed.success ? 'completed' : 'failed',
      message: executed.message,
      output: executed.output,
    });
  }

  const result: AutonomousExecutionResult = {
    operationId,
    chainType: plan.chainType,
    intent: plan.intent,
    dryRun: context.dryRun,
    success: steps.every((step) => step.status !== 'failed'),
    steps,
    startedAt,
    completedAt: new Date().toISOString(),
  };

  getStore().set(operationId, {
    plan,
    execution: result,
    createdAt: startedAt,
  });

  return result;
}

export function getAutonomousOperation(operationId: string): AutonomousOperationRecord | null {
  return getStore().get(operationId) || null;
}

export async function verifyAutonomousOperation(input: {
  operationId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<{ operationId: string; results: AutonomousVerificationResult[]; passed: boolean }> {
  const stored = getStore().get(input.operationId);
  if (!stored?.execution) {
    throw new Error(`Operation not found: ${input.operationId}`);
  }

  const adapter = getAutonomousAdapter(stored.plan.chainType);
  const before = input.before || {};
  const after = input.after || {};
  const results: AutonomousVerificationResult[] = [];

  for (const step of stored.plan.steps) {
    const executionStep = stored.execution.steps.find((entry) => entry.stepId === step.id);
    if (!executionStep || executionStep.status === 'skipped') continue;

    const verification = await verifyAutonomousActionOutcome({
      step,
      before,
      after: {
        ...after,
        ...(executionStep.output || {}),
        componentHealthy: executionStep.status === 'completed',
      },
      dryRun: stored.execution.dryRun,
      pluginVerifier: adapter.verifyActionOutcome.bind(adapter),
    });

    executionStep.verification = verification;
    results.push(verification);
  }

  return {
    operationId: input.operationId,
    results,
    passed: results.every((item) => item.passed),
  };
}

export async function rollbackAutonomousOperation(input: {
  operationId: string;
  dryRun?: boolean;
}): Promise<{ operationId: string; rollbackSteps: AutonomousExecutionResult['steps']; success: boolean }> {
  const stored = getStore().get(input.operationId);
  if (!stored?.execution) {
    throw new Error(`Operation not found: ${input.operationId}`);
  }

  const adapter = getAutonomousAdapter(stored.plan.chainType);
  const rollbackSteps: AutonomousExecutionResult['steps'] = [];

  for (const step of stored.plan.steps) {
    const executionStep = stored.execution.steps.find((entry) => entry.stepId === step.id);
    if (!executionStep || executionStep.status !== 'failed') continue;

    const candidates = adapter.buildRollback(step);
    for (const rollbackStep of candidates) {
      const executed = await executeAutonomousAction(rollbackStep.action, {
        ...(rollbackStep.params || {}),
        targetComponent: rollbackStep.targetComponent,
        dryRun: input.dryRun !== false,
        allowWrites: false,
      });

      rollbackSteps.push({
        stepId: rollbackStep.id,
        action: rollbackStep.action,
        status: executed.success ? 'completed' : 'failed',
        message: executed.message,
        output: executed.output,
      });
    }
  }

  return {
    operationId: input.operationId,
    rollbackSteps,
    success: rollbackSteps.every((step) => step.status !== 'failed'),
  };
}
