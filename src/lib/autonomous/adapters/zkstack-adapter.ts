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

export class ZkstackAutonomousAdapter implements AutonomousAdapter {
  readonly chainType = 'zkstack';

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
            title: 'Collect ZK Throughput/Proof Signals',
            reason: 'Capture proof backlog and settlement lag before scaling.',
            risk: 'low',
            requiresApproval: false,
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_core_execution',
            title: 'Scale ZK Core Execution',
            reason: 'Increase zksync-server resources under sustained load.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'zksync-server',
            verificationChecks: ['block_progress_ok', 'proof_pipeline_recovered'],
          }),
          makeAutonomousStep({
            intent,
            action: 'verify_settlement_lag',
            title: 'Verify Settlement Lag Reduced',
            reason: 'Confirm settlement/proof lag recovery post action.',
            risk: 'low',
            requiresApproval: false,
          }),
        ];
      case 'recover_sequencer_path':
        return [
          makeAutonomousStep({
            intent,
            action: 'restart_prover',
            title: 'Restart ZK Prover',
            reason: 'Recover stalled proof generation pipeline.',
            risk: 'critical',
            requiresApproval: true,
            targetComponent: 'zk-prover',
            verificationChecks: ['component_recovered', 'proof_pipeline_recovered'],
          }),
          makeAutonomousStep({
            intent,
            action: 'restart_batcher_pipeline',
            title: 'Restart ZK Batcher Pipeline',
            reason: 'Recover settlement batching flow.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'zk-batcher',
            verificationChecks: ['component_recovered', 'settlement_lag_reduced'],
          }),
        ];
      case 'reduce_cost_idle_window':
        return [
          makeAutonomousStep({
            intent,
            action: 'set_routing_policy',
            title: 'Switch to Cost-first Routing',
            reason: 'Constrain model spend during low activity.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
            params: { policyName: 'cost-first' },
          }),
          makeAutonomousStep({
            intent,
            action: 'scale_core_execution',
            title: 'Scale Down Core Execution',
            reason: 'Reduce zksync-server resources in idle windows.',
            risk: 'high',
            requiresApproval: !context.dryRun,
            targetComponent: 'zksync-server',
          }),
        ];
      case 'restore_l1_connectivity':
        return [
          makeAutonomousStep({
            intent,
            action: 'switch_l1_rpc',
            title: 'Failover Parent-chain RPC',
            reason: 'Restore settlement path connectivity to L1.',
            risk: 'medium',
            requiresApproval: !context.dryRun,
          }),
        ];
      case 'protect_critical_eoa':
        return [
          makeAutonomousStep({
            intent,
            action: 'inspect_anomalies',
            title: 'Inspect Batcher/Operator EOA Risk',
            reason: 'Assess critical account risk before remediation.',
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
    if (step.action === 'scale_core_execution') {
      return verifyBlockProgress(step, before, after);
    }

    if (step.action === 'restart_prover' || step.action === 'restart_batcher_pipeline') {
      return verifyComponentRecovered(step, after);
    }

    if (step.action === 'verify_settlement_lag') {
      const beforeLag = Number(before.settlementLag ?? Number.POSITIVE_INFINITY);
      const afterLag = Number(after.settlementLag ?? Number.POSITIVE_INFINITY);
      const passed = Number.isFinite(beforeLag) && Number.isFinite(afterLag) && afterLag <= beforeLag;
      return {
        stepId: step.id,
        action: step.action,
        passed,
        checks: [
          {
            check: 'settlement_lag_reduced',
            passed,
            details: `before=${beforeLag}, after=${afterLag}`,
          },
        ],
        summary: passed ? 'Settlement lag reduced' : 'Settlement lag did not improve',
        verifiedAt: new Date().toISOString(),
      };
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
    if (step.action === 'scale_core_execution') {
      return [
        makeAutonomousStep({
          intent: step.intent,
          action: 'scale_core_execution',
          title: 'Rollback Core Execution Scale',
          reason: 'Return zksync-server to previous resource tier.',
          risk: 'medium',
          requiresApproval: true,
          targetComponent: step.targetComponent,
        }),
      ];
    }

    return [];
  }
}
