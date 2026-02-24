import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  executeAutonomousOperation,
  getAutonomousCapabilities,
  planAutonomousOperation,
  rollbackAutonomousOperation,
  verifyAutonomousOperation,
} from '@/lib/autonomous/service';

const hoisted = vi.hoisted(() => ({
  executeAutonomousAction: vi.fn(),
  verifyAutonomousActionOutcome: vi.fn(),
}));

vi.mock('@/chains', () => ({
  getChainPlugin: vi.fn(() => ({
    chainType: 'optimism',
    capabilities: {
      autonomousActions: ['collect_metrics', 'restart_execution'],
    },
  })),
}));

vi.mock('@/lib/action-executor', () => ({
  executeAutonomousAction: hoisted.executeAutonomousAction,
}));

vi.mock('@/lib/operation-verifier', () => ({
  verifyAutonomousActionOutcome: hoisted.verifyAutonomousActionOutcome,
}));

describe('autonomous-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CHAIN_TYPE = 'optimism';
    process.env.ORCHESTRATOR_TYPE = 'docker';

    hoisted.executeAutonomousAction.mockResolvedValue({
      success: true,
      message: 'ok',
      output: { blockHeight: 101 },
    });

    hoisted.verifyAutonomousActionOutcome.mockImplementation(async ({ step }) => ({
      stepId: step.id,
      action: step.action,
      passed: true,
      checks: [{ check: 'mock', passed: true }],
      summary: 'verified',
      verifiedAt: new Date().toISOString(),
    }));
  });

  it('returns chain autonomous capabilities', () => {
    const capabilities = getAutonomousCapabilities();
    expect(capabilities.chainType).toBe('optimism');
    expect(capabilities.intents.length).toBeGreaterThan(0);
  });

  it('plans, executes, and verifies autonomous operation', async () => {
    const plan = planAutonomousOperation({
      intent: 'recover_sequencer_path',
      context: { dryRun: true, allowWrites: false },
    });

    const execution = await executeAutonomousOperation({
      planId: plan.planId,
      context: { dryRun: true, allowWrites: false },
    });

    expect(execution.success).toBe(true);
    expect(execution.steps.length).toBeGreaterThan(0);

    const verification = await verifyAutonomousOperation({
      operationId: execution.operationId,
      before: { blockHeight: 100 },
      after: { blockHeight: 101 },
    });

    expect(verification.passed).toBe(true);
    expect(verification.results.length).toBeGreaterThan(0);
  });

  it('returns empty rollback steps when no failures', async () => {
    const execution = await executeAutonomousOperation({
      intent: 'stabilize_throughput',
      context: { dryRun: true, allowWrites: false },
    });

    const rollback = await rollbackAutonomousOperation({
      operationId: execution.operationId,
      dryRun: true,
    });

    expect(rollback.success).toBe(true);
    expect(Array.isArray(rollback.rollbackSteps)).toBe(true);
  });
});
