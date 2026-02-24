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

export class OpstackAutonomousAdapter implements AutonomousAdapter {
  readonly chainType = 'optimism';

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
            title: 'Collect Throughput Signals',
            reason: 'Gather cpu/txpool/block interval baseline before acting.',
            risk: 'low',
            requiresApproval: false,
            verificationChecks: ['block_progress_ok'],
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_execution',
            title: 'Scale op-geth Execution Capacity',
            reason: 'Scale execution to absorb sustained load and reduce backlog.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'op-geth',
            verificationChecks: ['block_progress_ok'],
            rollbackHint: 'Scale back to previous vCPU tier after stabilization.',
          }),
          makeAutonomousStep({
            intent,
            action: 'verify_block_progress',
            title: 'Verify Block Progression',
            reason: 'Confirm throughput stabilization after scaling.',
            risk: 'low',
            requiresApproval: false,
            verificationChecks: ['block_progress_ok'],
          }),
        ];
      case 'recover_sequencer_path':
        return [
          makeAutonomousStep({
            intent,
            action: 'restart_execution',
            title: 'Restart op-node/op-geth Path',
            reason: 'Recover derivation/sequencer path from unhealthy state.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'op-node',
            verificationChecks: ['component_recovered', 'block_progress_ok'],
            rollbackHint: 'Restart proposer if derivation lag remains.',
          }),
          makeAutonomousStep({
            intent,
            action: 'restart_proposer',
            title: 'Restart Proposer',
            reason: 'Recover output-root submission path when sequencer path lags.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'op-proposer',
            verificationChecks: ['component_recovered'],
          }),
        ];
      case 'reduce_cost_idle_window':
        return [
          makeAutonomousStep({
            intent,
            action: 'set_routing_policy',
            title: 'Switch Routing Policy to Cost-first',
            reason: 'Reduce AI runtime cost in low-load periods.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
            params: { policyName: 'cost-first' },
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_execution',
            title: 'Scale Down Execution in Idle Window',
            reason: 'Lower resource allocation during stable low-utilization windows.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'op-geth',
          }),
        ];
      case 'restore_l1_connectivity':
        return [
          makeAutonomousStep({
            intent,
            action: 'switch_l1_rpc',
            title: 'Failover to Healthy L1 RPC',
            reason: 'Restore L1 connectivity with endpoint failover.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
            verificationChecks: ['l1_connectivity_restored'],
          }),
        ];
      case 'protect_critical_eoa':
        return [
          makeAutonomousStep({
            intent,
            action: 'inspect_anomalies',
            title: 'Inspect EOA/Balance Risk Signals',
            reason: 'Check critical operator account risk before refill/recovery.',
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
    if (step.action === 'verify_block_progress' || step.action === 'scale_execution') {
      return verifyBlockProgress(step, before, after);
    }

    if (
      step.action === 'restart_execution' ||
      step.action === 'restart_proposer' ||
      step.action === 'restart_batcher'
    ) {
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
    if (step.action === 'scale_execution') {
      return [
        makeAutonomousStep({
          intent: step.intent,
          action: 'scale_execution',
          title: 'Rollback Execution Scale',
          reason: 'Revert to previous stable execution tier.',
          risk: 'medium',
          requiresApproval: true,
          targetComponent: step.targetComponent,
        }),
      ];
    }

    if (step.action === 'set_routing_policy') {
      return [
        makeAutonomousStep({
          intent: step.intent,
          action: 'set_routing_policy',
          title: 'Rollback Routing Policy',
          reason: 'Restore balanced routing policy.',
          risk: 'low',
          requiresApproval: true,
          params: { policyName: 'balanced' },
        }),
      ];
    }

    return [];
  }
}
