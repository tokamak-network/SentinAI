/**
 * Arbitrum Nitro 연동 시나리오 테스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §4
 *
 * S-ARB-01  Nitro 클라이언트 감지
 * S-ARB-02  L1 배치 포스팅 지연 감지 (txPool 모노토닉 증가)
 * S-ARB-03  Validator 챌린지 상태 (플러그인 의존성 그래프 검증)
 * S-ARB-04  의존성 그래프 기반 RCA
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks
// ============================================================

vi.mock('fs');
import * as fs from 'fs';

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({})),
  http: vi.fn(),
  defineChain: vi.fn((config) => config),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11155111 },
  optimismSepolia: { id: 11155420 },
}));

// ============================================================
// Imports
// ============================================================

import { detectExecutionClient } from '@/lib/client-detector';
import { detectAnomalies, resetAllStreaks } from '@/lib/anomaly-detector';
import { ArbitrumPlugin } from '@/chains/arbitrum';
import { mockRpcFetch } from './helpers/mock-rpc';
import type { MetricDataPoint } from '@/types/prediction';

// ============================================================
// Helpers
// ============================================================

function makeMetric(overrides: Partial<MetricDataPoint> = {}): MetricDataPoint {
  return {
    timestamp: Date.now(),
    l1BlockNumber: 19000000,
    l1BlockTime: 12,
    blockHeight: 50000,
    blockInterval: 0.3, // Arbitrum: ~0.3s
    cpuUsage: 20,
    gasUsedRatio: 0.4,
    txPoolPending: 20,
    ...overrides,
  };
}

// ============================================================
// S-ARB-01: Nitro 클라이언트 감지
// ============================================================

describe('S-ARB-01: Arbitrum Nitro 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('arb_blockNumber 응답 시 nitro-node로 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        // Nitro는 Geth 기반이라 web3_clientVersion에 Geth가 포함
        web3_clientVersion: 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
        eth_chainId: '0xa4b1', // Arbitrum One
        eth_syncing: false,
        net_peerCount: '0x5',
        txpool_status: { pending: '0x14', queued: '0x3' },
        arb_blockNumber: '0x1234', // Nitro 식별 메서드
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });

    expect(result.family).toBe('nitro-node');
  });

  it('L2 sync 메서드로 arb_getL1BlockNumber를 사용해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
        eth_chainId: '0xa4b1',
        eth_syncing: false,
        arb_blockNumber: '0x1234',
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });

    expect(result.supportsL2SyncStatus).toBe(true);
    expect(result.l2SyncMethod).toBe('arb_getL1BlockNumber');
  });

  it('txpool_status 응답 시 TxPool을 지원해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
        eth_chainId: '0xa4b1',
        eth_syncing: false,
        txpool_status: { pending: '0x14', queued: '0x3' },
        arb_blockNumber: '0x1234',
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });

    expect(result.txpoolNamespace).toBe('txpool');
  });

  it('arb_blockNumber가 nitro-node 감지를 op-geth보다 우선해야 한다', async () => {
    // 두 fingerprint 모두 응답하는 경우 nitro-node가 우선
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
        eth_chainId: '0xa4b1',
        arb_blockNumber: '0x1234',
        optimism_syncStatus: { current_l1: { number: 100 } },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });

    expect(result.family).toBe('nitro-node');
    expect(result.l2SyncMethod).toBe('arb_getL1BlockNumber');
  });
});

// ============================================================
// S-ARB-02: L1 배치 포스팅 지연 감지 (txPool 모노토닉 증가)
// ============================================================

describe('S-ARB-02: Batch Poster 지연 감지', () => {
  beforeEach(() => {
    resetAllStreaks();
  });

  it('txPool pending이 5분간 단조 증가 시 이상으로 감지해야 한다', () => {
    const now = Date.now();

    // 45초 간격 6개 → 모두 TXPOOL_MONOTONIC_SECONDS(300s) 윈도우 내에 포함
    // (oldest: now - 270s, all < 300s threshold)
    const history: MetricDataPoint[] = [
      makeMetric({ txPoolPending: 100, timestamp: now - 270_000 }),
      makeMetric({ txPoolPending: 300, timestamp: now - 225_000 }),
      makeMetric({ txPoolPending: 600, timestamp: now - 180_000 }),
      makeMetric({ txPoolPending: 1000, timestamp: now - 135_000 }),
      makeMetric({ txPoolPending: 1500, timestamp: now - 90_000 }),
      makeMetric({ txPoolPending: 2000, timestamp: now - 45_000 }),
    ];

    const current = makeMetric({ txPoolPending: 2500, timestamp: now });

    // monotonic-increase는 rule-based → sustained 없이 즉시 감지
    const anomalies = detectAnomalies(current, history);

    const txPoolAnomalies = anomalies.filter(
      (a) => a.metric === 'txPoolPending' && a.rule === 'monotonic-increase'
    );
    expect(txPoolAnomalies.length).toBeGreaterThan(0);
  });

  it('txPool이 안정적일 때는 이상이 없어야 한다', () => {
    const now = Date.now();

    const stableHistory: MetricDataPoint[] = Array.from({ length: 10 }, (_, i) =>
      makeMetric({
        txPoolPending: 20 + Math.sin(i) * 3, // 소폭 변동 (정상 범위)
        timestamp: now - (10 - i) * 30_000,
      })
    );

    const current = makeMetric({ txPoolPending: 22, timestamp: now });
    const anomalies = detectAnomalies(current, stableHistory);

    const txPoolAnomalies = anomalies.filter((a) => a.metric === 'txPoolPending');
    expect(txPoolAnomalies).toHaveLength(0);
  });
});

// ============================================================
// S-ARB-03: Validator 챌린지 상태 - 의존성 그래프 검증
// ============================================================

describe('S-ARB-03: Validator 챌린지 상태 모니터링 (플러그인 검증)', () => {
  let plugin: ArbitrumPlugin;

  beforeEach(() => {
    plugin = new ArbitrumPlugin();
  });

  it('ArbitrumPlugin이 validator 컴포넌트를 포함해야 한다', () => {
    expect(plugin.components).toContain('validator');
  });

  it('validator가 nitro-node에 의존해야 한다', () => {
    const deps = plugin.dependencyGraph['validator'];
    expect(deps).toBeDefined();
    expect(deps.dependsOn).toContain('nitro-node');
  });

  it('validator가 leaf 노드여야 한다 (downstream 없음)', () => {
    const deps = plugin.dependencyGraph['validator'];
    expect(deps.feeds).toHaveLength(0);
  });

  it('batch-poster와 validator 모두 nitro-node에 의존해야 한다', () => {
    const batchPosterDeps = plugin.dependencyGraph['batch-poster'];
    const validatorDeps = plugin.dependencyGraph['validator'];

    expect(batchPosterDeps.dependsOn).toContain('nitro-node');
    expect(validatorDeps.dependsOn).toContain('nitro-node');
  });
});

// ============================================================
// S-ARB-04: 의존성 그래프 기반 RCA
// ============================================================

describe('S-ARB-04: RCA - Arbitrum Nitro 의존성 전파 분석', () => {
  let plugin: ArbitrumPlugin;

  beforeEach(() => {
    plugin = new ArbitrumPlugin();
  });

  it('nitro-node 장애 시 batch-poster와 validator 모두 영향받아야 한다', () => {
    // nitro-node feeds: ['batch-poster', 'validator']
    const deps = plugin.dependencyGraph['nitro-node'];
    expect(deps.feeds).toContain('batch-poster');
    expect(deps.feeds).toContain('validator');
  });

  it('l1 장애 시 nitro-node, batch-poster, validator 모두 영향받아야 한다', () => {
    const deps = plugin.dependencyGraph['l1'];
    expect(deps.feeds).toContain('nitro-node');
    expect(deps.feeds).toContain('batch-poster');
    expect(deps.feeds).toContain('validator');
  });

  it('nitro-node의 upstream은 l1이어야 한다', () => {
    const deps = plugin.dependencyGraph['nitro-node'];
    expect(deps.dependsOn).toContain('l1');
  });

  it('batch-poster의 upstream은 nitro-node와 l1이어야 한다', () => {
    const deps = plugin.dependencyGraph['batch-poster'];
    expect(deps.dependsOn).toContain('nitro-node');
    expect(deps.dependsOn).toContain('l1');
  });

  it('의존성 그래프에 순환 의존이 없어야 한다', () => {
    const visited = new Set<string>();
    const path = new Set<string>();

    function hasCycle(node: string): boolean {
      if (path.has(node)) return true;
      if (visited.has(node)) return false;
      path.add(node);
      visited.add(node);
      const deps = plugin.dependencyGraph[node]?.dependsOn ?? [];
      for (const dep of deps) {
        if (hasCycle(dep)) return true;
      }
      path.delete(node);
      return false;
    }

    const allNodes = [...plugin.components, ...plugin.metaComponents];
    for (const node of allNodes) {
      expect(hasCycle(node)).toBe(false);
    }
  });

  it('feeds와 dependsOn이 서로 대칭이어야 한다', () => {
    for (const [comp, deps] of Object.entries(plugin.dependencyGraph)) {
      for (const upstream of deps.dependsOn) {
        const upstreamDeps = plugin.dependencyGraph[upstream];
        if (upstreamDeps) {
          expect(upstreamDeps.feeds).toContain(comp);
        }
      }
    }
  });
});
