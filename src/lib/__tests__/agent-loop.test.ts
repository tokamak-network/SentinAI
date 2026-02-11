/**
 * Agent Loop Tests
 * Tests the autonomous observe-detect-decide-act cycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before importing
vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBlock: vi.fn().mockResolvedValue({
      number: BigInt(1000),
      transactions: ['0x1', '0x2'],
      gasUsed: BigInt(5000000),
      gasLimit: BigInt(10000000),
    }),
    getBlockNumber: vi.fn().mockResolvedValue(BigInt(500)),
  })),
  http: vi.fn(),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11155111 },
}));

vi.mock('@/lib/metrics-store', () => ({
  pushMetric: vi.fn().mockResolvedValue(undefined),
  getRecentMetrics: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/redis-store', () => ({
  getStore: vi.fn(() => ({
    getLastBlock: vi.fn().mockResolvedValue({ height: '999', time: String(Date.now() - 2000) }),
    setLastBlock: vi.fn().mockResolvedValue(undefined),
    getScalingState: vi.fn().mockResolvedValue({
      currentVcpu: 1,
      currentMemoryGiB: 2,
      autoScalingEnabled: true,
      lastScalingTime: null,
      cooldownRemaining: 0,
    }),
    getSimulationConfig: vi.fn().mockResolvedValue({ enabled: true }),
    updateScalingState: vi.fn().mockResolvedValue(undefined),
    addScalingHistory: vi.fn().mockResolvedValue(undefined),
    getZeroDowntimeEnabled: vi.fn().mockResolvedValue(false),
  })),
}));

vi.mock('@/lib/usage-tracker', () => ({
  recordUsage: vi.fn(),
}));

vi.mock('@/lib/detection-pipeline', () => ({
  runDetectionPipeline: vi.fn().mockResolvedValue({
    anomalies: [],
    activeEventId: undefined,
    deepAnalysisTriggered: false,
  }),
}));

vi.mock('@/lib/scaling-decision', () => ({
  makeScalingDecision: vi.fn().mockReturnValue({
    targetVcpu: 1,
    targetMemoryGiB: 2,
    reason: 'System Idle (Score: 15.0)',
    confidence: 0.85,
    score: 15,
    breakdown: { cpuScore: 10, gasScore: 20, txPoolScore: 0, aiScore: 0 },
  }),
  mapAIResultToSeverity: vi.fn().mockReturnValue(undefined),
}));

vi.mock('@/lib/k8s-scaler', () => ({
  scaleOpGeth: vi.fn().mockResolvedValue({
    success: true,
    previousVcpu: 1,
    currentVcpu: 2,
    previousMemoryGiB: 2,
    currentMemoryGiB: 4,
    timestamp: new Date().toISOString(),
    message: 'Scaled successfully',
  }),
  getCurrentVcpu: vi.fn().mockResolvedValue(1),
  isAutoScalingEnabled: vi.fn().mockResolvedValue(true),
  checkCooldown: vi.fn().mockResolvedValue({ inCooldown: false, remainingSeconds: 0 }),
  addScalingHistory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/predictive-scaler', () => ({
  predictScaling: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/ai-analyzer', () => ({
  analyzeLogChunk: vi.fn().mockResolvedValue({ severity: 'normal', summary: 'OK', action_item: 'none' }),
}));

vi.mock('@/lib/log-ingester', () => ({
  getAllLiveLogs: vi.fn().mockResolvedValue('mock logs'),
}));

vi.mock('@/lib/daily-accumulator', () => ({
  addScalingEvent: vi.fn().mockResolvedValue(undefined),
}));

// Mock global fetch for txpool_status
const mockFetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ result: { pending: '0xa' } }), // 10 pending
});
vi.stubGlobal('fetch', mockFetch);

import { runAgentCycle, isAgentRunning, resetAgentState } from '@/lib/agent-loop';
import { runDetectionPipeline } from '@/lib/detection-pipeline';
import { makeScalingDecision } from '@/lib/scaling-decision';
import { scaleOpGeth, isAutoScalingEnabled, checkCooldown, getCurrentVcpu } from '@/lib/k8s-scaler';

describe('agent-loop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAgentState();
    process.env.L2_RPC_URL = 'http://mock-rpc:8545';
  });

  afterEach(() => {
    delete process.env.L2_RPC_URL;
  });

  describe('runAgentCycle', () => {
    it('should complete a full observe-detect-decide cycle', async () => {
      const result = await runAgentCycle();

      expect(result.phase).toBe('complete');
      expect(result.metrics).not.toBeNull();
      expect(result.detection).not.toBeNull();
      expect(result.scaling).not.toBeNull();
      expect(result.error).toBeUndefined();
    });

    it('should collect metrics and push to store', async () => {
      const { pushMetric } = await import('@/lib/metrics-store');

      await runAgentCycle();

      expect(pushMetric).toHaveBeenCalledTimes(1);
      const calledWith = vi.mocked(pushMetric).mock.calls[0][0];
      expect(calledWith).toHaveProperty('cpuUsage');
      expect(calledWith).toHaveProperty('txPoolPending');
      expect(calledWith).toHaveProperty('gasUsedRatio');
      expect(calledWith).toHaveProperty('blockHeight', 1000);
    });

    it('should run detection pipeline', async () => {
      await runAgentCycle();

      expect(runDetectionPipeline).toHaveBeenCalledTimes(1);
    });

    it('should not auto-execute scaling when target equals current vCPU', async () => {
      const result = await runAgentCycle();

      expect(result.scaling?.executed).toBe(false);
      expect(scaleOpGeth).not.toHaveBeenCalled();
    });

    it('should auto-execute scaling when score is high', async () => {
      vi.mocked(makeScalingDecision).mockReturnValue({
        targetVcpu: 4,
        targetMemoryGiB: 8,
        reason: 'High Load (Score: 85.0)',
        confidence: 0.95,
        score: 85,
        breakdown: { cpuScore: 80, gasScore: 70, txPoolScore: 50, aiScore: 66 },
      });

      const result = await runAgentCycle();

      expect(result.scaling?.executed).toBe(true);
      expect(scaleOpGeth).toHaveBeenCalledWith(4, 8, expect.anything());
    });

    it('should skip scaling when auto-scaling is disabled', async () => {
      vi.mocked(isAutoScalingEnabled).mockResolvedValue(false);
      vi.mocked(makeScalingDecision).mockReturnValue({
        targetVcpu: 4,
        targetMemoryGiB: 8,
        reason: 'High Load (Score: 85.0)',
        confidence: 0.95,
        score: 85,
        breakdown: { cpuScore: 80, gasScore: 70, txPoolScore: 50, aiScore: 66 },
      });

      const result = await runAgentCycle();

      expect(result.scaling?.executed).toBe(false);
      expect(result.scaling?.reason).toContain('[Skip] Auto-scaling disabled');
      expect(scaleOpGeth).not.toHaveBeenCalled();
    });

    it('should skip scaling when in cooldown', async () => {
      vi.mocked(isAutoScalingEnabled).mockResolvedValue(true);
      vi.mocked(checkCooldown).mockResolvedValue({ inCooldown: true, remainingSeconds: 120 });
      vi.mocked(makeScalingDecision).mockReturnValue({
        targetVcpu: 4,
        targetMemoryGiB: 8,
        reason: 'High Load (Score: 85.0)',
        confidence: 0.95,
        score: 85,
        breakdown: { cpuScore: 80, gasScore: 70, txPoolScore: 50, aiScore: 66 },
      });

      const result = await runAgentCycle();

      expect(result.scaling?.executed).toBe(false);
      expect(result.scaling?.reason).toContain('[Skip] Cooldown');
    });

    it('should return error when L2_RPC_URL is not set', async () => {
      delete process.env.L2_RPC_URL;

      const result = await runAgentCycle();

      expect(result.phase).toBe('error');
      expect(result.error).toContain('L2_RPC_URL');
    });

    it('should prevent concurrent cycles', async () => {
      // Start a slow cycle
      const slowPromise = runAgentCycle();

      // Try to start another while first is running
      const concurrentResult = await runAgentCycle();

      expect(concurrentResult.phase).toBe('error');
      expect(concurrentResult.error).toContain('Previous cycle still running');

      await slowPromise; // Clean up
    });

    it('should handle RPC errors gracefully', async () => {
      const { createPublicClient } = await import('viem');
      vi.mocked(createPublicClient).mockReturnValue({
        getBlock: vi.fn().mockRejectedValue(new Error('RPC timeout')),
        getBlockNumber: vi.fn().mockRejectedValue(new Error('RPC timeout')),
      } as never);

      const result = await runAgentCycle();

      expect(result.phase).toBe('error');
      expect(result.error).toBeDefined();
    });
  });

  describe('isAgentRunning', () => {
    it('should return false when no cycle is running', () => {
      expect(isAgentRunning()).toBe(false);
    });
  });

  describe('resetAgentState', () => {
    it('should reset running state', () => {
      resetAgentState();
      expect(isAgentRunning()).toBe(false);
    });
  });
});
