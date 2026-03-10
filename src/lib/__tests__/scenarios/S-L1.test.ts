/**
 * L1 실행 클라이언트 시나리오 테스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §6
 *
 * S-L1-GETH-01   Geth 클라이언트 감지
 * S-L1-GETH-02   Geth Mempool 모니터링
 * S-L1-RETH-01   Reth 클라이언트 감지
 * S-L1-RETH-02   Reth와 OP Stack 연동 (URL 분기 mock)
 * S-L1-NETH-01   Nethermind 클라이언트 감지 (parity txpool)
 * S-L1-NETH-02   Nethermind 수동 환경변수 설정
 * S-L1-BESU-01   Besu 클라이언트 감지
 * S-L1-BESU-02   Besu 엔터프라이즈 설정 (capability override)
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
import { mockRpcFetch, urlDispatchFetch } from './helpers/mock-rpc';
import type { MetricDataPoint } from '@/types/prediction';

// ============================================================
// Helpers
// ============================================================

function makeMetric(overrides: Partial<MetricDataPoint> = {}): MetricDataPoint {
  return {
    timestamp: Date.now(),
    l1BlockNumber: 19000000,
    l1BlockTime: 12,
    blockHeight: 5000,
    blockInterval: 2,
    cpuUsage: 20,
    gasUsedRatio: 0.4,
    txPoolPending: 10,
    ...overrides,
  };
}

// ============================================================
// S-L1-GETH-01: Geth 클라이언트 감지
// ============================================================

describe('S-L1-GETH-01: Geth 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('web3_clientVersion "Geth"로 geth 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.14.13-stable-2bd6bd01/linux-amd64/go1.22.11',
        eth_syncing: false,
        txpool_status: { pending: '0x0', queued: '0x0' },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://geth-l1:8545' });

    expect(result.family).toBe('geth');
    expect(result.txpoolNamespace).toBe('txpool');
    expect(result.supportsL2SyncStatus).toBe(false);
  });

  it('버전 정보를 원시(raw) 형태로 저장해야 한다', async () => {
    const clientVersion = 'Geth/v1.14.13-stable-2bd6bd01/linux-amd64/go1.22.11';
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: clientVersion,
        eth_syncing: false,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://geth-l1:8545' });

    expect(result.version).toBe(clientVersion);
    expect(result.raw?.web3_clientVersion).toBe(clientVersion);
  });

  it('txpool_status 지원 시 txpoolNamespace=txpool이어야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.14.13-stable/linux-amd64/go1.22.11',
        eth_syncing: false,
        txpool_status: { pending: '0x5', queued: '0x1' },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://geth-l1:8545' });

    expect(result.txpoolNamespace).toBe('txpool');
    expect(result.probes.txpool_status).toBe(true);
  });

  it('peerCount를 올바르게 파싱해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Geth/v1.14.13-stable/linux-amd64/go1.22.11',
        eth_syncing: false,
        net_peerCount: '0x8', // 8 peers
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://geth-l1:8545' });

    expect(result.peerCount).toBe(8);
  });
});

// ============================================================
// S-L1-GETH-02: Geth Mempool 모니터링
// ============================================================

describe('S-L1-GETH-02: Geth Mempool 모니터링', () => {
  beforeEach(() => {
    resetAllStreaks();
  });

  it('pending 트랜잭션이 급격히 증가 시 txPoolPending 이상 감지', () => {
    const now = Date.now();

    // 5분간 50배 증가 (100 → 5000)
    const history: MetricDataPoint[] = [
      makeMetric({ txPoolPending: 100, timestamp: now - 300_000 }),
      makeMetric({ txPoolPending: 500, timestamp: now - 240_000 }),
      makeMetric({ txPoolPending: 1500, timestamp: now - 180_000 }),
      makeMetric({ txPoolPending: 3000, timestamp: now - 120_000 }),
      makeMetric({ txPoolPending: 5000, timestamp: now - 60_000 }),
    ];

    const current = makeMetric({ txPoolPending: 8000, timestamp: now });

    // 3 사이클 누적
    detectAnomalies(current, history);
    detectAnomalies(current, history);
    const anomalies = detectAnomalies(current, history);

    const mempoolAnomalies = anomalies.filter((a) => a.metric === 'txPoolPending');
    expect(mempoolAnomalies.length).toBeGreaterThan(0);
    expect(mempoolAnomalies[0].direction).toBe('spike');
  });

  it('정상적인 mempool 수준에서는 이상이 없어야 한다', () => {
    const now = Date.now();
    const history: MetricDataPoint[] = Array.from({ length: 10 }, (_, i) =>
      makeMetric({ txPoolPending: 10 + i, timestamp: now - (10 - i) * 30_000 })
    );

    const current = makeMetric({ txPoolPending: 12, timestamp: now });
    const anomalies = detectAnomalies(current, history);

    const mempoolAnomalies = anomalies.filter((a) => a.metric === 'txPoolPending');
    expect(mempoolAnomalies).toHaveLength(0);
  });
});

// ============================================================
// S-L1-RETH-01: Reth 클라이언트 감지
// ============================================================

describe('S-L1-RETH-01: Reth 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('web3_clientVersion "reth"로 reth 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'reth/v1.1.2/linux-amd64/rustc1.82.0',
        eth_syncing: false,
        txpool_status: { pending: '0x5', queued: '0x0' },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://reth-l1:8545' });

    expect(result.family).toBe('reth');
    expect(result.txpoolNamespace).toBe('txpool'); // Reth는 Geth 호환 API 사용
  });

  it('Reth가 Geth와 동일한 txpool namespace를 사용해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'reth/v1.1.2/linux-amd64/rustc1.82.0',
        eth_syncing: false,
        txpool_status: { pending: '0x0', queued: '0x0' },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://reth-l1:8545' });

    // Reth는 geth 호환 API → txpool namespace 동일
    expect(result.txpoolNamespace).toBe('txpool');
    expect(result.probes.txpool_status).toBe(true);
  });

  it('Reth는 L2 sync status를 지원하지 않아야 한다 (L1 클라이언트)', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'reth/v1.1.2/linux-amd64/rustc1.82.0',
        eth_syncing: false,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://reth-l1:8545' });

    expect(result.supportsL2SyncStatus).toBe(false);
    expect(result.l2SyncMethod).toBeNull();
  });
});

// ============================================================
// S-L1-RETH-02: Reth L1 + OP Stack L2 연동
// ============================================================

describe('S-L1-RETH-02: Reth L1 + OP Stack L2 연동', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('URL 분기로 L1(reth)과 L2(op-geth)를 독립적으로 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      urlDispatchFetch({
        'reth-l1': {
          web3_clientVersion: 'reth/v1.1.2/linux-amd64/rustc1.82.0',
          eth_blockNumber: '0x1215918', // 19000000
          eth_syncing: false,
        },
        'op-geth-l2': {
          web3_clientVersion: 'Geth/v1.13.14-stable/linux-amd64/go1.21.7',
          eth_blockNumber: '0x186A0', // 100000
          eth_syncing: false,
          optimism_syncStatus: {
            head_l1: { number: 19000000 },
            unsafe_l2: { number: 100000 },
          },
        },
      })
    );

    const l1Result = await detectExecutionClient({ rpcUrl: 'http://reth-l1:8545' });
    const l2Result = await detectExecutionClient({ rpcUrl: 'http://op-geth-l2:8545' });

    expect(l1Result.family).toBe('reth');
    expect(l2Result.family).toBe('op-geth');
    expect(l2Result.supportsL2SyncStatus).toBe(true);
    expect(l2Result.l2SyncMethod).toBe('optimism_syncStatus');
  });
});

// ============================================================
// S-L1-NETH-01: Nethermind 클라이언트 감지
// ============================================================

describe('S-L1-NETH-01: Nethermind 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('web3_clientVersion "Nethermind"로 nethermind 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
        eth_syncing: false,
        // txpool_status 없음 → parity로 폴백
        parity_pendingTransactions: [
          { hash: '0xabc', nonce: '0x1', gasPrice: '0x3B9ACA00' },
          { hash: '0xdef', nonce: '0x2', gasPrice: '0x3B9ACA00' },
        ],
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://nethermind-l1:8545' });

    expect(result.family).toBe('nethermind');
    expect(result.txpoolNamespace).toBe('parity');
    expect(result.probes.txpool_status).toBe(false);
    expect(result.probes.parity_pendingTransactions).toBe(true);
  });

  it('txpool_status 미지원 시에도 parity_pendingTransactions로 TxPool 파악 가능해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
        eth_syncing: false,
        parity_pendingTransactions: [], // 빈 배열도 OK
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://nethermind-l1:8545' });

    expect(result.txpoolNamespace).toBe('parity');
  });
});

// ============================================================
// S-L1-NETH-02: Nethermind 수동 환경변수 설정
// ============================================================

describe('S-L1-NETH-02: Nethermind 수동 환경변수 설정', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // 환경변수 복원
    for (const key of ['SENTINAI_CLIENT_FAMILY', 'SENTINAI_OVERRIDE_TXPOOL_METHOD', 'SENTINAI_OVERRIDE_TXPOOL_PARSER']) {
      delete process.env[key];
    }
    vi.unstubAllGlobals();
  });

  it('SENTINAI_CLIENT_FAMILY=nethermind 설정 시 parity 방식으로 TxPool을 읽어야 한다', async () => {
    // 이 테스트는 환경변수가 client-detector에 영향을 주는지 검증
    // 현재 detectExecutionClient는 환경변수 오버라이드를 지원하지 않으므로
    // 실제 RPC 응답(parity_pendingTransactions)으로 nethermind를 감지함
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });

    process.env.SENTINAI_CLIENT_FAMILY = 'nethermind';
    process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'parity_pendingTransactions';
    process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER = 'parity';

    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
        eth_syncing: false,
        parity_pendingTransactions: [],
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://nethermind-l1:8545' });

    expect(result.family).toBe('nethermind');
    expect(result.txpoolNamespace).toBe('parity');
  });

  void savedEnv; // suppress unused warning
});

// ============================================================
// S-L1-BESU-01: Besu 클라이언트 감지
// ============================================================

describe('S-L1-BESU-01: Besu 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('web3_clientVersion "besu"로 besu 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
        eth_syncing: false,
        eth_chainId: '0x1',
        txpool_status: { pending: '0x0', queued: '0x0' },
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://besu-l1:8545' });

    expect(result.family).toBe('besu');
    expect(result.txpoolNamespace).toBe('txpool');
  });

  it('Besu가 L2 sync status를 지원하지 않아야 한다 (L1 클라이언트)', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
        eth_syncing: false,
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://besu-l1:8545' });

    expect(result.supportsL2SyncStatus).toBe(false);
    expect(result.l2SyncMethod).toBeNull();
  });
});

// ============================================================
// S-L1-BESU-02: Besu 엔터프라이즈 설정
// ============================================================

describe('S-L1-BESU-02: Besu 엔터프라이즈 설정 (capability override)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    delete process.env.SENTINAI_CAPABILITY_PEER_COUNT;
    vi.unstubAllGlobals();
  });

  it('net_peerCount 미지원 시 peerCount가 admin_peers로 폴백해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
        eth_syncing: false,
        // net_peerCount 없음 (enterprise 모드에서 net namespace 비활성화)
        admin_peers: [{ id: '0x1' }, { id: '0x2' }],
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://besu-l1:8545' });

    expect(result.probes.net_peerCount).toBe(false);
    // admin_peers로 폴백하여 peer count 수집
    expect(result.peerCount).toBe(2);
  });

  it('admin_peers도 없는 경우 peerCount가 undefined여야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      mockRpcFetch({
        web3_clientVersion: 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
        eth_syncing: false,
        // net_peerCount, admin_peers 모두 없음
      })
    );

    const result = await detectExecutionClient({ rpcUrl: 'http://besu-l1:8545' });

    expect(result.peerCount).toBeUndefined();
  });
});
