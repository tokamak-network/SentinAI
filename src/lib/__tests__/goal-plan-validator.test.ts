import { describe, expect, it } from 'vitest';
import { validateGoalPlanCandidate } from '@/lib/goal-plan-validator';

describe('goal-plan-validator', () => {
  it('should validate a normal investigate plan', () => {
    const result = validateGoalPlanCandidate({
      candidate: {
        intent: 'investigate',
        summary: 'Investigate current anomaly',
        steps: [
          {
            title: 'Collect state',
            action: 'collect_state',
            reason: 'Need baseline',
            risk: 'low',
            requiresApproval: false,
          },
          {
            title: 'Run RCA',
            action: 'run_rca',
            reason: 'Identify root cause',
            risk: 'medium',
            requiresApproval: false,
          },
        ],
      },
      dryRun: true,
      allowWrites: false,
      readOnlyMode: false,
      runtime: {
        latestCpuUsage: 62,
        activeAnomalyCount: 1,
        currentVcpu: 2,
        cooldownRemaining: 0,
      },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.intent).toBe('investigate');
      expect(result.steps).toHaveLength(2);
    }
  });

  it('should reject unsupported actions', () => {
    const result = validateGoalPlanCandidate({
      candidate: {
        intent: 'custom',
        steps: [
          {
            title: 'Unknown action',
            action: 'drain_cluster',
            reason: 'invalid',
            risk: 'high',
          },
        ],
      },
      dryRun: true,
      allowWrites: false,
      readOnlyMode: false,
      runtime: {
        latestCpuUsage: 35,
        activeAnomalyCount: 0,
        currentVcpu: 2,
        cooldownRemaining: 0,
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failureReasonCode).toBe('invalid_step_action');
    }
  });

  it('should reject scale plan during cooldown', () => {
    const result = validateGoalPlanCandidate({
      candidate: {
        intent: 'stabilize',
        steps: [
          {
            title: 'Scale up',
            action: 'scale_execution',
            reason: 'Need more capacity',
            risk: 'high',
            parameters: { targetVcpu: 4 },
          },
        ],
      },
      dryRun: false,
      allowWrites: true,
      readOnlyMode: false,
      runtime: {
        latestCpuUsage: 80,
        activeAnomalyCount: 2,
        currentVcpu: 2,
        cooldownRemaining: 120,
      },
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failureReasonCode).toBe('runtime_precondition_failed');
    }
  });
});
