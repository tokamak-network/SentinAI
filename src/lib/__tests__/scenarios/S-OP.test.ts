/**
 * OP Stack 연동 시나리오 테스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §3
 *
 * S-OP-01  클라이언트 자동 감지
 * S-OP-02  L2 동기화 지연 감지
 * S-OP-03  EOA 잔액 모니터링
 * S-OP-04  의존성 그래프 기반 RCA
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks – must be hoisted before imports
// ============================================================

vi.mock('fs');
import * as fs from 'fs';

const { mockGetBalance } = vi.hoisted(() => ({
  mockGetBalance: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({ getBalance: mockGetBalance })),
  createWalletClient: vi.fn(() => ({})),
  http: vi.fn(),
  parseEther: vi.fn((val: string) => BigInt(Math.floor(parseFloat(val) * 1e18))),
  formatEther: vi.fn((val: bigint) => (Number(val) / 1e18).toString()),
  parseGwei: vi.fn((val: string) => BigInt(Math.floor(parseFloat(val) * 1e9))),
  defineChain: vi.fn((config) => config),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  sepolia: { id: 11155111, name: 'Sepolia' },
  optimismSepolia: { id: 11155420, name: 'OP Sepolia' },
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAccount: vi.fn(() => ({ address: '0xTreasury' as `0x${string}` })),
}));

vi.mock('@/lib/l1-rpc-failover', () => ({
  getSentinaiL1RpcUrl: vi.fn(() => 'http://l1-rpc:8545'),
}));

vi.mock('@/lib/eoa-detector', () => ({
  getEOAAddressWithAutoDetect: vi.fn(),
}));

vi.mock('@/lib/l1-rpc-cache', () => ({
  getCachedEOABalance: vi.fn(async () => null),
  invalidateEOABalanceCache: vi.fn(),
}));

// ============================================================
// Imports
// ============================================================

import { detectExecutionClient } from '@/lib/client-detector';
import { detectAnomalies, resetAllStreaks } from '@/lib/anomaly-detector';
import { checkBalance } from '@/lib/eoa-balance-monitor';
import { findAffectedComponents, findUpstreamComponents } from '@/lib/rca-engine';
import { mockRpcFetch, FIXTURES } from './helpers/mock-rpc';
import type { MetricDataPoint } from '@/types/prediction';

// ============================================================
// Helpers
// ============================================================

function makeMetric(overrides: Partial<MetricDataPoint> = {}): MetricDataPoint {
  return {
    timestamp: Date.now(),
    l1BlockNumber: 19000000,
    l1BlockTime: 12,
    blockHeight: 100000,
    blockInterval: 2,
    cpuUsage: 20,
    gasUsedRatio: 0.4,
    txPoolPending: 10,
    ...overrides,
  };
}

function stableHistory(length: number, base: Partial<MetricDataPoint> = {}): MetricDataPoint[] {
  const now = Date.now();
  return Array.from({ length }, (_, i) =>
    makeMetric({ ...base, timestamp: now - (length - i) * 10_000 })
  );
}

// ============================================================
// S-OP-01: 클라이언트 자동 감지
// ============================================================

describe('S-OP-01: OP Stack 클라이언트 자동 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // No custom profiles
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('optimism_syncStatus 응답 시 op-geth 패밀리로 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.13.14-stable-2bd6bd01/linux-amd64/go1.21.7',
        eth_chainId: '0xa',
        eth_syncing: false,
        net_peerCount: '0x8',
        txpool_status: { pending: '0xa', queued: '0x2' },
        optimism_syncStatus: FIXTURES.opSyncStatus,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });

    expect(result.family).toBe('op-geth');
  });

  it('L2 sync 상태 메서드(optimism_syncStatus)를 활성화해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.13.14-stable/linux-amd64/go1.21.7',
        eth_chainId: '0xa',
        eth_syncing: false,
        optimism_syncStatus: FIXTURES.opSyncStatus,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });

    expect(result.supportsL2SyncStatus).toBe(true);
    expect(result.l2SyncMethod).toBe('optimism_syncStatus');
  });

  it('txpool_status를 통해 TxPool을 지원해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.13.14-stable/linux-amd64/go1.21.7',
        eth_chainId: '0xa',
        eth_syncing: false,
        txpool_status: { pending: '0xa', queued: '0x2' },
        optimism_syncStatus: FIXTURES.opSyncStatus,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });

    expect(result.txpoolNamespace).toBe('txpool');
  });

  it('optimism_syncStatus 미지원 시 geth 패밀리로 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.14.13-stable/linux-amd64/go1.22.11',
        eth_chainId: '0x1',
        eth_syncing: false,
        txpool_status: { pending: '0x0', queued: '0x0' },
        // optimism_syncStatus 없음 → 일반 geth
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });

    expect(result.family).toBe('geth');
    expect(result.supportsL2SyncStatus).toBe(false);
    expect(result.l2SyncMethod).toBeNull();
  });
});

// ============================================================
// S-OP-02: L2 동기화 지연 감지
// ============================================================

describe('S-OP-02: L2 동기화 지연 감지 (블록 플래토 기반)', () => {
  beforeEach(() => {
    resetAllStreaks();
  });

  it('blockHeight가 2분 이상 변하지 않으면 이상으로 감지해야 한다', () => {
    const now = Date.now();
    const stuckBlockHeight = 99000;

    // 히스토리: 15초 간격, 15개 → 가장 오래된 항목이 now - 210s, recentHistory[0] = now - 120s
    const history: MetricDataPoint[] = Array.from({ length: 15 }, (_, i) =>
      makeMetric({
        blockHeight: stuckBlockHeight, // 변화 없음
        blockInterval: 2,
        timestamp: now - (15 - i) * 15_000, // 15초 간격 (oldest: -225s)
      })
    );

    const current = makeMetric({
      blockHeight: stuckBlockHeight, // 계속 동일
      blockInterval: 2,
      timestamp: now,
    });

    // plateau 감지: blockHeight가 BLOCK_PLATEAU_SECONDS(120s) 이상 변화 없음
    const anomalies = detectAnomalies(current, history);

    // detectBlockPlateau: l2BlockHeight plateau anomaly
    const plateauAnomalies = anomalies.filter(
      (a) => a.metric === 'l2BlockHeight' && a.rule === 'plateau'
    );
    expect(plateauAnomalies.length).toBeGreaterThan(0);
  });

  it('정상 blockHeight 증가 시 이상이 없어야 한다', () => {
    const now = Date.now();

    const history = stableHistory(20, { blockInterval: 2, blockHeight: 98000 });
    const current = makeMetric({
      blockHeight: 98021, // 정상 증가
      blockInterval: 2,
      timestamp: now,
    });

    const anomalies = detectAnomalies(current, history);
    const syncAnomalies = anomalies.filter(
      (a) => a.metric === 'blockInterval' || a.metric === 'l2BlockInterval'
    );
    expect(syncAnomalies).toHaveLength(0);
  });
});

// ============================================================
// S-OP-03: EOA 잔액 모니터링 (Batcher / Proposer)
// ============================================================

describe('S-OP-03: EOA 잔액 모니터링', () => {
  const BATCHER_ADDRESS = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const PROPOSER_ADDRESS = '0xabcdef1234567890123456789012345678901234' as `0x${string}`;

  it('Batcher 잔액이 critical 임계값(0.1 ETH) 미만 시 critical 상태여야 한다', async () => {
    // 0.05 ETH → critical threshold(0.1 ETH) 미만
    mockGetBalance.mockResolvedValue(BigInt(5e16)); // 0.05 ETH in wei

    const result = await checkBalance('http://l1-rpc:8545', BATCHER_ADDRESS, 'batcher', {
      criticalThresholdEth: 0.1,
      warningThresholdEth: 0.5,
    });

    expect(result.role).toBe('batcher');
    expect(result.level).toBe('critical');
    expect(result.balanceEth).toBeLessThan(0.1);
  });

  it('Proposer 잔액이 warning 임계값(0.5 ETH) 미만 시 warning 상태여야 한다', async () => {
    // 0.3 ETH → warning threshold(0.5 ETH) 미만, critical(0.1 ETH) 초과
    mockGetBalance.mockResolvedValue(BigInt(3e17)); // 0.3 ETH in wei

    const result = await checkBalance('http://l1-rpc:8545', PROPOSER_ADDRESS, 'proposer', {
      criticalThresholdEth: 0.1,
      warningThresholdEth: 0.5,
    });

    expect(result.role).toBe('proposer');
    expect(result.level).toBe('warning');
  });

  it('잔액이 충분할 때(1.0 ETH) 정상 상태여야 한다', async () => {
    // 1.0 ETH → 정상
    mockGetBalance.mockResolvedValue(BigInt(1e18)); // 1.0 ETH in wei

    const result = await checkBalance('http://l1-rpc:8545', BATCHER_ADDRESS, 'batcher', {
      criticalThresholdEth: 0.1,
      warningThresholdEth: 0.5,
    });

    expect(result.level).toBe('normal'); // BalanceLevel: 'normal' | 'warning' | 'critical'
    expect(result.balanceEth).toBeCloseTo(1.0, 1);
  });
});

// ============================================================
// S-OP-04: 의존성 그래프 기반 RCA
// ============================================================

describe('S-OP-04: RCA - OP Stack 의존성 그래프 전파 분석', () => {
  it('op-node 장애 시 op-geth, op-batcher, op-proposer 모두 영향받아야 한다', () => {
    const affected = findAffectedComponents('op-node');

    // op-node → feeds: op-geth, op-batcher, op-proposer, op-challenger
    expect(affected).toContain('op-geth');
    expect(affected).toContain('op-batcher');
    expect(affected).toContain('op-proposer');
  });

  it('L1 장애 시 op-node가 전파 경로에 포함되어야 한다', () => {
    const affected = findAffectedComponents('l1');

    expect(affected).toContain('op-node');
  });

  it('L1 → op-node 순서로 전파되어야 한다 (op-node의 upstream은 l1)', () => {
    const upstream = findUpstreamComponents('op-node');

    expect(upstream).toContain('l1');
  });

  it('op-geth는 leaf 노드로 downstream 영향이 없어야 한다', () => {
    const affected = findAffectedComponents('op-geth');

    // op-geth의 feeds: [] → downstream 없음
    expect(affected).not.toContain('op-batcher');
    expect(affected).not.toContain('op-proposer');
  });

  it('op-geth의 upstream은 op-node이어야 한다', () => {
    const upstream = findUpstreamComponents('op-geth');

    expect(upstream).toContain('op-node');
  });

  it('l1은 root 노드로 upstream 의존성이 없어야 한다', () => {
    const upstream = findUpstreamComponents('l1');

    expect(upstream).toHaveLength(0);
  });
});
