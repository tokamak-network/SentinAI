import { getAutonomousAdapter } from '@/lib/autonomous/adapters';
import type {
  AutonomousAction,
  AutonomousExecutionContext,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

export function getDefaultAutonomousIntents(chainType: string): AutonomousIntent[] {
  return getAutonomousAdapter(chainType).getSupportedIntents();
}

export function getDefaultAutonomousActions(chainType: string): AutonomousAction[] {
  const adapter = getAutonomousAdapter(chainType);
  const intents = adapter.getSupportedIntents();
  const observed = new Set<AutonomousAction>();

  for (const intent of intents) {
    const steps = adapter.translateIntentToActions(intent, {
      chainType,
      runtime: 'k8s',
      dryRun: true,
      allowWrites: false,
    });
    for (const step of steps) {
      observed.add(step.action);
    }
  }

  return [...observed];
}

export function defaultTranslateIntentToActions(
  chainType: string,
  intent: AutonomousIntent,
  context: AutonomousExecutionContext
): AutonomousPlanStep[] {
  return getAutonomousAdapter(chainType).translateIntentToActions(intent, context);
}

export function defaultVerifyActionOutcome(
  chainType: string,
  step: AutonomousPlanStep,
  before: Record<string, unknown>,
  after: Record<string, unknown>
): AutonomousVerificationResult {
  return getAutonomousAdapter(chainType).verifyActionOutcome(step, before, after);
}

export function defaultBuildRollback(chainType: string, step: AutonomousPlanStep): AutonomousPlanStep[] {
  return getAutonomousAdapter(chainType).buildRollback(step);
}
