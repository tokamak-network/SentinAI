/**
 * Playbook Matcher Coverage Tests
 * Verifies expanded matchesMetricCondition and matchesLogPattern logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnomalyEvent, AnomalyResult } from '@/types/anomaly';

// ── Hoisted mock ─────────────────────────────────────────────────────────────
const mockGetPlaybooks = vi.hoisted(() => vi.fn().mockReturnValue([]));

vi.mock('@/chains', () => ({
  getChainPlugin: () => ({
    getPlaybooks: mockGetPlaybooks,
    normalizeComponentName: (n: string) => n,
    mapMetricToComponent: (metric: string) => {
      const map: Record<string, string> = {
        cpuUsage: 'op-geth',
        txPoolPending: 'op-geth',
        l2BlockHeight: 'op-geth',
        l1BlockNumber: 'l1',
        hybridScore: 'system',
        batcherBalance: 'op-batcher',
        batchPosterBalance: 'op-batcher',
        proposerBalance: 'op-proposer',
        challengerBalance: 'op-challenger',
        syncGap: 'op-node',
        settlementLag: 'op-proposer',
        gasPrice: 'system',
        proofGenerationLatency: 'zk-prover',
        gameDeadlineProximity: 'op-challenger',
        podRestartCount: 'system',
        unclaimedBonds: 'op-challenger',
        peerCount: 'op-geth',
      };
      return map[metric] ?? 'system';
    },
  }),
}));

vi.mock('@/lib/abstract-playbook-matcher', () => ({
  matchAbstractPlaybooks: vi.fn().mockResolvedValue([]),
  resolvePlaybookActions: vi.fn().mockReturnValue([]),
}));

import { matchPlaybook } from '@/lib/playbook-matcher';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAnomaly(overrides: Partial<AnomalyResult> = {}): AnomalyResult {
  return {
    isAnomaly: true,
    metric: 'cpuUsage',
    value: 95,
    zScore: 3,
    direction: 'spike',
    description: 'test',
    rule: 'threshold-breach',
    ...overrides,
  };
}

function makeEvent(anomalies: AnomalyResult[], recentLogs?: string[]): AnomalyEvent {
  return {
    id: 'test-id',
    timestamp: Date.now(),
    anomalies,
    status: 'active',
    alerts: [],
    ...(recentLogs ? { recentLogs } : {}),
  };
}

type MatchablePlaybook = {
  name: string;
  trigger: {
    component: string;
    indicators: Array<{ type: string; condition: string }>;
  };
  actions: [];
};

function playbookFor(component: string, condition: string, type = 'metric'): MatchablePlaybook {
  return {
    name: `test-${condition}`,
    trigger: { component, indicators: [{ type, condition }] },
    actions: [],
  };
}

function match(component: string, condition: string, anomaly: Partial<AnomalyResult>): boolean {
  mockGetPlaybooks.mockReturnValue([playbookFor(component, condition)]);
  const event = makeEvent([makeAnomaly(anomaly)]);
  return matchPlaybook(event) !== null;
}

beforeEach(() => {
  mockGetPlaybooks.mockReturnValue([]);
});

// ── Numeric comparison tests ─────────────────────────────────────────────────
describe('matchesMetricCondition — numeric comparison', () => {
  it('cpuUsage > 90 matches when value is 95', () => {
    expect(match('op-geth', 'cpuUsage > 90', { metric: 'cpuUsage', value: 95 })).toBe(true);
  });

  it('cpuUsage > 90 does not match when value is 88', () => {
    expect(match('op-geth', 'cpuUsage > 90', { metric: 'cpuUsage', value: 88 })).toBe(false);
  });

  it('cpuUsage > 80 matches when value is 85', () => {
    expect(match('op-geth', 'cpuUsage > 80', { metric: 'cpuUsage', value: 85 })).toBe(true);
  });

  it('cpuUsage > 95 matches when value is 96', () => {
    expect(match('op-geth', 'cpuUsage > 95', { metric: 'cpuUsage', value: 96 })).toBe(true);
  });

  it('peerCount == 0 matches when value is 0', () => {
    expect(match('op-geth', 'peerCount == 0', { metric: 'peerCount', value: 0 })).toBe(true);
  });

  it('peerCount == 0 does not match when value is 5', () => {
    expect(match('op-geth', 'peerCount == 0', { metric: 'peerCount', value: 5 })).toBe(false);
  });

  it('peerCount >= 0 matches when value is 0', () => {
    expect(match('op-geth', 'peerCount >= 0', { metric: 'peerCount', value: 0 })).toBe(true);
  });

  it('cpuUsage <= 100 matches when value is 100', () => {
    expect(match('op-geth', 'cpuUsage <= 100', { metric: 'cpuUsage', value: 100 })).toBe(true);
  });
});

// ── Level comparison tests ───────────────────────────────────────────────────
describe('matchesMetricCondition — level comparison', () => {
  it('batcherBalance < critical matches threshold-breach anomaly', () => {
    expect(match('op-batcher', 'batcherBalance < critical', { metric: 'batcherBalance', rule: 'threshold-breach' })).toBe(true);
  });

  it('batcherBalance < critical does not match z-score anomaly', () => {
    expect(match('op-batcher', 'batcherBalance < critical', { metric: 'batcherBalance', rule: 'z-score' })).toBe(false);
  });

  it('proposerBalance < warning matches threshold-breach', () => {
    expect(match('op-proposer', 'proposerBalance < warning', { metric: 'proposerBalance', rule: 'threshold-breach' })).toBe(true);
  });

  it('challengerBalance < critical matches threshold-breach', () => {
    expect(match('op-challenger', 'challengerBalance < critical', { metric: 'challengerBalance', rule: 'threshold-breach' })).toBe(true);
  });

  it('batchPosterBalance alias resolves to batcherBalance', () => {
    expect(match('op-batcher', 'batchPosterBalance < critical', { metric: 'batcherBalance', rule: 'threshold-breach' })).toBe(true);
  });

  it('proposerBalance < low matches threshold-breach', () => {
    expect(match('op-proposer', 'proposerBalance < low', { metric: 'proposerBalance', rule: 'threshold-breach' })).toBe(true);
  });
});

// ── Direction / rule tests ───────────────────────────────────────────────────
describe('matchesMetricCondition — direction and rule', () => {
  it('l2BlockHeight stagnant matches plateau direction', () => {
    expect(match('op-geth', 'l2BlockHeight stagnant', { metric: 'l2BlockHeight', direction: 'plateau' })).toBe(true);
  });

  it('l1BlockNumber stagnant now matches plateau direction (was always false)', () => {
    expect(match('l1', 'l1BlockNumber stagnant', { metric: 'l1BlockNumber', direction: 'plateau' })).toBe(true);
  });

  it('txPoolPending monotonic increase matches spike direction', () => {
    expect(match('op-geth', 'txPoolPending monotonic increase', { metric: 'txPoolPending', direction: 'spike', rule: 'z-score' })).toBe(true);
  });

  it('txPoolPending monotonic increase matches monotonic-increase rule', () => {
    expect(match('op-geth', 'txPoolPending monotonic increase', { metric: 'txPoolPending', direction: 'drop', rule: 'monotonic-increase' })).toBe(true);
  });

  it('syncGap increasing matches spike direction', () => {
    expect(match('op-node', 'syncGap increasing', { metric: 'syncGap', direction: 'spike' })).toBe(true);
  });
});

// ── Named threshold tests ────────────────────────────────────────────────────
describe('matchesMetricCondition — named threshold identifiers', () => {
  it('gasPrice > guardGwei matches threshold-breach anomaly', () => {
    expect(match('system', 'gasPrice > guardGwei', { metric: 'gasPrice', rule: 'threshold-breach' })).toBe(true);
  });

  it('txPoolPending > threshold matches spike direction', () => {
    expect(match('op-geth', 'txPoolPending > threshold', { metric: 'txPoolPending', direction: 'spike', rule: 'z-score' })).toBe(true);
  });

  it('settlementLag high matches isAnomaly + spike', () => {
    expect(match('op-proposer', 'settlementLag high', { metric: 'settlementLag', isAnomaly: true, direction: 'spike' })).toBe(true);
  });
});

// ── Time-based tests ─────────────────────────────────────────────────────────
describe('matchesMetricCondition — time-based', () => {
  it('proofGenerationLatency > 300s matches value 400 (seconds)', () => {
    expect(match('zk-prover', 'proofGenerationLatency > 300s', { metric: 'proofGenerationLatency', value: 400 })).toBe(true);
  });

  it('proofGenerationLatency > 300s does not match value 200', () => {
    expect(match('zk-prover', 'proofGenerationLatency > 300s', { metric: 'proofGenerationLatency', value: 200 })).toBe(false);
  });

  it('unclaimedBonds > 24h matches value 90000 (seconds, > 86400)', () => {
    expect(match('op-challenger', 'unclaimedBonds > 24h', { metric: 'unclaimedBonds', value: 90000 })).toBe(true);
  });
});

// ── Compound conditions ──────────────────────────────────────────────────────
describe('matchesMetricCondition — compound (&&)', () => {
  it('partial match on && condition: first part matches', () => {
    mockGetPlaybooks.mockReturnValue([
      playbookFor('op-challenger', 'unclaimedBonds > 0 && unclaimedAge > 24h'),
    ]);
    const event = makeEvent([makeAnomaly({ metric: 'unclaimedBonds', value: 5 })]);
    expect(matchPlaybook(event)).not.toBeNull();
  });

  it('no match when no part of && condition matches', () => {
    mockGetPlaybooks.mockReturnValue([
      playbookFor('op-challenger', 'unclaimedBonds > 0 && unclaimedAge > 24h'),
    ]);
    const event = makeEvent([makeAnomaly({ metric: 'peerCount', value: 5 })]);
    expect(matchPlaybook(event)).toBeNull();
  });
});

// ── Special cases ────────────────────────────────────────────────────────────
describe('matchesMetricCondition — special cases', () => {
  it('hybridScore heuristic: matches when 2+ anomalies', () => {
    // Use metrics that both map to 'op-geth' so identifyComponent returns 'op-geth'
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'hybridScore > 70')]);
    const event = makeEvent([
      makeAnomaly({ metric: 'cpuUsage' }),
      makeAnomaly({ metric: 'txPoolPending' }),
    ]);
    expect(matchPlaybook(event)).not.toBeNull();
  });

  it('hybridScore heuristic: no match with single anomaly', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'hybridScore > 70')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })]);
    expect(matchPlaybook(event)).toBeNull();
  });

  it('space-normalized metric "pod restart count" matches podRestartCount', () => {
    expect(match('system', 'pod restart count > 3', { metric: 'podRestartCount', value: 5 })).toBe(true);
  });
});

// ── Log pattern tests ────────────────────────────────────────────────────────
// Note: cpuUsage maps to 'op-geth' — use 'op-geth' as playbook component
describe('matchesLogPattern', () => {
  it('returns null match when recentLogs is absent', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'ERROR|PANIC', 'log_pattern')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })]);
    expect(matchPlaybook(event)).toBeNull();
  });

  it('matches regex pattern case-insensitively', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'reorg detected', 'log_pattern')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })], ['2026-03-17 Reorg Detected at block 12345']);
    expect(matchPlaybook(event)).not.toBeNull();
  });

  it('falls back to substring matching on invalid regex', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', '(invalid[regex', 'log_pattern')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })], ['(invalid[regex found in log']);
    expect(matchPlaybook(event)).not.toBeNull();
  });

  it('pipe-separated fallback matches any alternative', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'timeout|connection refused', 'log_pattern')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })], ['connection refused by peer']);
    expect(matchPlaybook(event)).not.toBeNull();
  });

  it('does not match when log lines do not contain pattern', () => {
    mockGetPlaybooks.mockReturnValue([playbookFor('op-geth', 'CRITICAL ERROR', 'log_pattern')]);
    const event = makeEvent([makeAnomaly({ metric: 'cpuUsage' })], ['normal operation log line']);
    expect(matchPlaybook(event)).toBeNull();
  });
});

// ── claim_bond action ────────────────────────────────────────────────────────
describe('claim_bond action executor', () => {
  it('executes claim_bond with gameIndex param', async () => {
    const { executeAction } = await import('@/lib/action-executor');
    const result = await executeAction(
      { type: 'claim_bond', params: { gameIndex: 42 }, auto: true },
      { id: 'evt-1', anomalies: [], timestamp: 0, status: 'active', alerts: [] }
    );
    expect(result.status).toBe('success');
    expect(result.output).toContain('42');
  });

  it('executes claim_bond without gameIndex param', async () => {
    const { executeAction } = await import('@/lib/action-executor');
    const result = await executeAction(
      { type: 'claim_bond', auto: true },
      { id: 'evt-1', anomalies: [], timestamp: 0, status: 'active', alerts: [] }
    );
    expect(result.status).toBe('success');
    expect(result.output).toContain('all resolved');
  });
});

// ── memoryPercent playbook matching ──────────────────────────────────────────
describe('memoryPercent > 85 playbook matching', () => {
  it('memoryPercent > 85 matches when value is 88', () => {
    // In the mock, memoryPercent maps to 'system' (default)
    expect(match('system', 'memoryPercent > 85', { metric: 'memoryPercent', value: 88 })).toBe(true);
  });

  it('memoryPercent > 85 does not match when value is 80', () => {
    expect(match('system', 'memoryPercent > 85', { metric: 'memoryPercent', value: 80 })).toBe(false);
  });

  it('memoryPercent > 90 matches when value is 95', () => {
    expect(match('system', 'memoryPercent > 90', { metric: 'memoryPercent', value: 95 })).toBe(true);
  });

  it('memoryPercent > 90 does not match when value is 89', () => {
    expect(match('system', 'memoryPercent > 90', { metric: 'memoryPercent', value: 89 })).toBe(false);
  });
});
