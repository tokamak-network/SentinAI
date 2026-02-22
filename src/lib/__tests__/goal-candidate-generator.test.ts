import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateAutonomousGoalCandidates,
  generateRuleBasedGoalCandidates,
} from '@/lib/goal-candidate-generator';
import type { GoalSignalSnapshot } from '@/types/goal-manager';

const hoisted = vi.hoisted(() => ({
  aiClientMock: {
    chatCompletion: vi.fn(),
  },
}));

vi.mock('@/lib/ai-client', () => ({
  chatCompletion: hoisted.aiClientMock.chatCompletion,
}));

function createSnapshot(overrides?: Partial<GoalSignalSnapshot>): GoalSignalSnapshot {
  return {
    snapshotId: 'snapshot-1',
    collectedAt: '2026-02-22T12:00:00.000Z',
    chainType: 'thanos',
    sources: ['metrics', 'anomaly', 'policy', 'cost', 'failover', 'memory'],
    metrics: {
      latestCpuUsage: 82,
      latestTxPoolPending: 1200,
      latestGasUsedRatio: 0.81,
      currentVcpu: 2,
      cooldownRemaining: 0,
      cpuTrend: 'rising',
      txPoolTrend: 'rising',
      gasTrend: 'rising',
    },
    anomalies: {
      activeCount: 1,
      criticalCount: 1,
      latestEventTimestamp: '2026-02-22T11:58:00.000Z',
    },
    failover: {
      recentCount: 1,
      latestEventTimestamp: '2026-02-22T11:50:00.000Z',
      activeL1RpcUrl: 'https://rpc.sepolia.org',
    },
    cost: {
      avgVcpu: 2.5,
      peakVcpu: 4,
      avgUtilization: 48,
      dataPointCount: 120,
    },
    memory: {
      recentEntryCount: 3,
      recentIncidentCount: 2,
      recentHighSeverityCount: 1,
      latestEntryTimestamp: '2026-02-22T11:40:00.000Z',
    },
    policy: {
      readOnlyMode: false,
      autoScalingEnabled: true,
    },
    ...overrides,
  };
}

describe('goal-candidate-generator', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...envBackup };
    process.env.GOAL_CANDIDATE_LLM_ENABLED = 'false';
  });

  it('should generate stabilize/investigate candidates under pressure and failover', () => {
    const candidates = generateRuleBasedGoalCandidates(createSnapshot(), {
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(candidates.length).toBeGreaterThanOrEqual(2);
    expect(candidates.every((candidate) => candidate.status === 'candidate')).toBe(true);
    expect(candidates.some((candidate) => candidate.intent === 'stabilize')).toBe(true);
    expect(candidates.some((candidate) => candidate.source === 'failover')).toBe(true);
  });

  it('should generate cost-optimize candidate when system is healthy and underutilized', () => {
    const snapshot = createSnapshot({
      metrics: {
        latestCpuUsage: 21,
        latestTxPoolPending: 40,
        latestGasUsedRatio: 0.2,
        currentVcpu: 2,
        cooldownRemaining: 0,
        cpuTrend: 'stable',
        txPoolTrend: 'stable',
        gasTrend: 'stable',
      },
      anomalies: {
        activeCount: 0,
        criticalCount: 0,
        latestEventTimestamp: null,
      },
      failover: {
        recentCount: 0,
        latestEventTimestamp: null,
        activeL1RpcUrl: 'https://rpc.sepolia.org',
      },
      cost: {
        avgVcpu: 3,
        peakVcpu: 4,
        avgUtilization: 30,
        dataPointCount: 240,
      },
    });

    const candidates = generateRuleBasedGoalCandidates(snapshot, {
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(candidates.some((candidate) => candidate.intent === 'cost-optimize')).toBe(true);
    expect(candidates.some((candidate) => candidate.source === 'cost')).toBe(true);
  });

  it('should generate fallback investigate candidate when no strong signal exists', () => {
    const snapshot = createSnapshot({
      metrics: {
        latestCpuUsage: 18,
        latestTxPoolPending: 20,
        latestGasUsedRatio: 0.15,
        currentVcpu: 1,
        cooldownRemaining: 0,
        cpuTrend: 'stable',
        txPoolTrend: 'stable',
        gasTrend: 'stable',
      },
      anomalies: {
        activeCount: 0,
        criticalCount: 0,
        latestEventTimestamp: null,
      },
      failover: {
        recentCount: 0,
        latestEventTimestamp: null,
        activeL1RpcUrl: 'https://rpc.sepolia.org',
      },
      cost: {
        avgVcpu: 1,
        peakVcpu: 1,
        avgUtilization: 25,
        dataPointCount: 8,
      },
      memory: {
        recentEntryCount: 1,
        recentIncidentCount: 0,
        recentHighSeverityCount: 0,
        latestEntryTimestamp: '2026-02-22T11:59:00.000Z',
      },
      policy: {
        readOnlyMode: false,
        autoScalingEnabled: true,
      },
    });

    const candidates = generateRuleBasedGoalCandidates(snapshot, {
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].intent).toBe('investigate');
    expect(candidates[0].risk).toBe('low');
    expect((candidates[0].metadata as { fallback?: boolean })?.fallback).toBe(true);
  });

  it('should apply llm enhancement when enabled and response is valid', async () => {
    process.env.QWEN_API_KEY = 'test-key';

    hoisted.aiClientMock.chatCompletion.mockResolvedValue({
      content: JSON.stringify({
        candidates: [
          {
            index: 0,
            goal: 'L2 부하 급증 구간을 즉시 안정화한다',
            rationale: '활성 이상 이벤트와 높은 트랜잭션 대기열을 근거로 우선 대응',
          },
        ],
      }),
      provider: 'qwen',
      model: 'qwen3-80b-next',
    });

    const result = await generateAutonomousGoalCandidates(createSnapshot(), {
      llmEnhancerEnabled: true,
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.llmEnhanced).toBe(true);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].goal).toContain('안정화');
    expect(hoisted.aiClientMock.chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('should fallback to rule candidates when llm enhancement fails', async () => {
    process.env.QWEN_API_KEY = 'test-key';
    hoisted.aiClientMock.chatCompletion.mockRejectedValue(new Error('provider down'));

    const result = await generateAutonomousGoalCandidates(createSnapshot(), {
      llmEnhancerEnabled: true,
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.llmEnhanced).toBe(false);
    expect(result.llmFallbackReason).toBe('llm_unavailable');
    expect(result.candidates.length).toBeGreaterThan(0);
  });

  it('should skip llm enhancement when no provider key exists', async () => {
    delete process.env.QWEN_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GPT_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const result = await generateAutonomousGoalCandidates(createSnapshot(), {
      llmEnhancerEnabled: true,
      now: new Date('2026-02-22T12:00:00.000Z').getTime(),
    });

    expect(result.llmEnhanced).toBe(false);
    expect(result.llmFallbackReason).toBe('no_ai_provider_key');
    expect(hoisted.aiClientMock.chatCompletion).not.toHaveBeenCalled();
  });
});
