import { randomUUID } from 'crypto';
import type {
  AutonomousAction,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousRiskLevel,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

export function makeAutonomousStep(input: {
  intent: AutonomousIntent;
  action: AutonomousAction;
  title: string;
  reason: string;
  risk?: AutonomousRiskLevel;
  requiresApproval?: boolean;
  targetComponent?: string;
  verificationChecks?: string[];
  rollbackHint?: string;
  params?: Record<string, unknown>;
}): AutonomousPlanStep {
  return {
    id: randomUUID(),
    intent: input.intent,
    action: input.action,
    title: input.title,
    reason: input.reason,
    risk: input.risk || 'medium',
    requiresApproval: input.requiresApproval ?? (input.risk === 'high' || input.risk === 'critical'),
    targetComponent: input.targetComponent,
    verificationChecks: input.verificationChecks,
    rollbackHint: input.rollbackHint,
    params: input.params,
  };
}

export function verifyBlockProgress(
  step: AutonomousPlanStep,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): AutonomousVerificationResult {
  const beforeBlock = Number(before.blockHeight ?? -1);
  const afterBlock = Number(after.blockHeight ?? -1);
  const passed = Number.isFinite(beforeBlock) && Number.isFinite(afterBlock) && afterBlock >= beforeBlock;

  return {
    stepId: step.id,
    action: step.action,
    passed,
    checks: [
      {
        check: 'block_progress_ok',
        passed,
        details: `before=${beforeBlock}, after=${afterBlock}`,
      },
    ],
    summary: passed ? 'Block progression verified' : 'Block progression check failed',
    verifiedAt: new Date().toISOString(),
  };
}

export function verifyComponentRecovered(
  step: AutonomousPlanStep,
  after: Record<string, unknown>
): AutonomousVerificationResult {
  const healthy = after.componentHealthy === true || after.healthy === true;

  return {
    stepId: step.id,
    action: step.action,
    passed: healthy,
    checks: [
      {
        check: 'component_recovered',
        passed: healthy,
        details: healthy ? 'component marked healthy' : 'component not healthy',
      },
    ],
    summary: healthy ? 'Component recovery verified' : 'Component recovery check failed',
    verifiedAt: new Date().toISOString(),
  };
}
