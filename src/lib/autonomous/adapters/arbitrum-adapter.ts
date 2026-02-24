import type {
  AutonomousExecutionContext,
  AutonomousIntent,
  AutonomousPlanStep,
  AutonomousVerificationResult,
} from '@/types/autonomous-ops';
import type { AutonomousAdapter } from './types';
import { makeAutonomousStep, verifyBlockProgress, verifyComponentRecovered } from './utils';

const SUPPORTED_INTENTS: AutonomousIntent[] = [
  'stabilize_throughput',
  'recover_sequencer_path',
  'reduce_cost_idle_window',
  'restore_l1_connectivity',
  'protect_critical_eoa',
];

export class ArbitrumAutonomousAdapter implements AutonomousAdapter {
  readonly chainType = 'arbitrum';

  getSupportedIntents(): AutonomousIntent[] {
    return [...SUPPORTED_INTENTS];
  }

  translateIntentToActions(intent: AutonomousIntent, context: AutonomousExecutionContext): AutonomousPlanStep[] {
    switch (intent) {
      case 'stabilize_throughput':
        return [
          makeAutonomousStep({
            intent,
            action: 'collect_metrics',
            title: 'Collect Nitro Throughput Signals',
            reason: 'Capture queue/sequencer load before scaling.',
            risk: 'low',
            requiresApproval: false,
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_sequencer',
            title: 'Scale Nitro Sequencer Capacity',
            reason: 'Increase sequencer resources to reduce backlog.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'nitro-node',
            verificationChecks: ['block_progress_ok'],
            rollbackHint: 'Scale down when queue returns to baseline.',
          }),
          makeAutonomousStep({
            intent,
            action: 'verify_block_progress',
            title: 'Verify Nitro Block Progression',
            reason: 'Confirm sequencer health and block progression.',
            risk: 'low',
            requiresApproval: false,
          }),
        ];
      case 'recover_sequencer_path':
        return [
          makeAutonomousStep({
            intent,
            action: 'restart_batch_poster',
            title: 'Restart Batch Poster',
            reason: 'Recover delayed inbox posting path.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'batch-poster',
            verificationChecks: ['component_recovered'],
          }),
          makeAutonomousStep({
            intent,
            action: 'restart_validator',
            title: 'Restart Validator',
            reason: 'Recover assertion/validation lag path.',
            risk: 'critical',
            requiresApproval: true,
            targetComponent: 'validator',
            verificationChecks: ['component_recovered'],
          }),
        ];
      case 'reduce_cost_idle_window':
        return [
          makeAutonomousStep({
            intent,
            action: 'set_routing_policy',
            title: 'Shift to Cost-first Routing',
            reason: 'Lower model routing cost during off-peak.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
            params: { policyName: 'cost-first' },
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_sequencer',
            title: 'Reduce Sequencer Resource Tier',
            reason: 'Scale down Nitro node in low throughput windows.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'nitro-node',
          }),
        ];
      case 'restore_l1_connectivity':
        return [
          makeAutonomousStep({
            intent,
            action: 'switch_l1_rpc',
            title: 'Failover Orbit L1 Endpoint',
            reason: 'Restore healthy parent-chain connectivity.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
          }),
        ];
      case 'protect_critical_eoa':
        return [
          makeAutonomousStep({
            intent,
            action: 'inspect_anomalies',
            title: 'Inspect Batch Poster/Validator EOA Risk',
            reason: 'Review critical wallet and backlog risk before intervention.',
            risk: 'low',
            requiresApproval: false,
          }),
        ];
      default:
        return [];
    }
  }

  verifyActionOutcome(
    step: AutonomousPlanStep,
    before: Record<string, unknown>,
    after: Record<string, unknown>
  ): AutonomousVerificationResult {
    if (step.action === 'verify_block_progress' || step.action === 'scale_sequencer') {
      return verifyBlockProgress(step, before, after);
    }

    if (step.action === 'restart_batch_poster' || step.action === 'restart_validator') {
      return verifyComponentRecovered(step, after);
    }

    return {
      stepId: step.id,
      action: step.action,
      passed: true,
      checks: [{ check: 'default_pass', passed: true, details: 'No chain-specific verifier matched.' }],
      summary: 'No explicit verification rule; treated as pass',
      verifiedAt: new Date().toISOString(),
    };
  }

  buildRollback(step: AutonomousPlanStep): AutonomousPlanStep[] {
    if (step.action === 'scale_sequencer') {
      return [
        makeAutonomousStep({
          intent: step.intent,
          action: 'scale_sequencer',
          title: 'Rollback Sequencer Scale',
          reason: 'Return nitro-node to previous stable tier.',
          risk: 'medium',
          requiresApproval: true,
          targetComponent: step.targetComponent,
        }),
      ];
    }

    return [];
  }
}
