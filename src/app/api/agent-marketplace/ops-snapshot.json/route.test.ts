import { describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  buildOpsSnapshotMock: vi.fn(),
}));

vi.mock('@/lib/agent-marketplace/ops-snapshot', () => ({
  buildOpsSnapshot: hoisted.buildOpsSnapshotMock,
}));

const { GET } = await import(
  '@/app/api/agent-marketplace/ops-snapshot.json/route'
);

describe('/api/agent-marketplace/ops-snapshot.json', () => {
  it('returns an operational snapshot on success', async () => {
    const mockSnapshot = {
      version: '1',
      generatedAt: '2026-03-17T12:00:00.000Z',
      chain: { chainType: 'thanos', displayName: 'Thanos Sepolia', chainMode: 'standard' },
      metrics: {
        sampleCount: 42,
        latestTimestamp: '2026-03-17T11:59:55.000Z',
        cpu: { mean: 35.2, max: 78.1, trend: 'stable' },
        txPool: { mean: 12, max: 50, trend: 'stable' },
        gasUsedRatio: { mean: 0.45, max: 0.92, trend: 'rising' },
        blockInterval: { mean: 2.01, stdDev: 0.15 },
      },
      scaling: {
        currentVcpu: 2,
        currentMemoryGiB: 4,
        autoScalingEnabled: true,
        cooldownRemaining: 0,
        lastDecisionScore: 42,
        lastDecisionReason: 'Moderate load',
      },
      anomalies: { activeCount: 0, totalRecent: 3 },
    };

    hoisted.buildOpsSnapshotMock.mockResolvedValue(mockSnapshot);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.version).toBe('1');
    expect(body.chain.chainType).toBe('thanos');
    expect(body.metrics.sampleCount).toBe(42);
    expect(body.scaling.currentVcpu).toBe(2);
    expect(body.anomalies.activeCount).toBe(0);
  });

  it('returns 500 when snapshot build fails', async () => {
    hoisted.buildOpsSnapshotMock.mockRejectedValue(new Error('Redis down'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('Redis down');
  });
});
