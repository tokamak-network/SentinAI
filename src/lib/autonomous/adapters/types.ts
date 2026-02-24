import type {
  AutonomousExecutionContext,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';

export interface AutonomousAdapter {
  readonly chainType: string;
  getSupportedIntents(): AutonomousIntent[];
  translateIntentToActions(intent: AutonomousIntent, context: AutonomousExecutionContext): AutonomousPlanStep[];
  verifyActionOutcome(
    step: AutonomousPlanStep,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): AutonomousVerificationResult;
  buildRollback(step: AutonomousPlanStep): AutonomousPlanStep[];
}
