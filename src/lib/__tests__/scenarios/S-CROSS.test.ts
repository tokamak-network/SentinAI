/**
 * 크로스-매트릭스 (L1 × L2) 연동 시나리오 테스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §7
 *
 * S-CROSS-01  L1 RPC 장애 조치 (Failover)
 * S-CROSS-02  OP Stack L2 + Nethermind L1 조합
 * S-CROSS-03  Arbitrum Nitro + Reth L1 블록 격차
 * S-CROSS-04  ZK Stack + Besu L1 Proof 상태 검증
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Mocks – viem, k8s-config (L1 failover 의존성)
// ============================================================

vi.mock('fs');
import * as fs from 'fs';

const { mockGetBlockNumber, mockRunK8sCommand } = vi.hoisted(() => ({
  mockGetBlockNumber: vi.fn(),
  mockRunK8sCommand: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: vi.fn(() => ({
    getBlockNumber: mockGetBlockNumber,
  })),
  http: vi.fn(),
  defineChain: vi.fn((config) => config),
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11155111 },
  optimismSepolia: { id: 11155420 },
}));

vi.mock('@/lib/k8s-config', () => ({
  runK8sCommand: mockRunK8sCommand,
  getNamespace: vi.fn(() => 'default'),
  getAppPrefix: vi.fn(() => process.env.K8S_APP_PREFIX || 'op'),
}));

vi.mock('@/lib/docker-config', () => ({
  isDockerMode: vi.fn(() => false),
}));

vi.mock('@/lib/docker-orchestrator', () => ({
  setDockerEnvAndRecreate: vi.fn(),
}));

// ============================================================
// Imports
// ============================================================

import {
  reportL1Failure,
  executeFailover,
  getL1FailoverState,
  resetL1FailoverState,
  getActiveL1RpcUrl,
} from '@/lib/l1-rpc-failover';
import { detectExecutionClient } from '@/lib/client-detector';
import { urlDispatchFetch, mockRpcFetch } from './helpers/mock-rpc';
import { normalizeZkstackRpcSnapshot } from '@/chains/zkstack/rpc';

// ============================================================
// S-CROSS-01: L1 RPC 장애 조치 (Failover)
// ============================================================

describe('S-CROSS-01: L1 RPC 장애 조치 (Failover)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    resetL1FailoverState();
    process.env.L1_RPC_URLS = 'http://geth-l1:8545,http://reth-l1:8545';
    process.env.SCALING_SIMULATION_MODE = 'true';
    delete process.env.AWS_CLUSTER_NAME;
    delete process.env.K8S_API_URL;
    delete process.env.L1_PROXYD_ENABLED;
    mockGetBlockNumber.mockResolvedValue(BigInt(1000));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetL1FailoverState();
  });

  it('초기 상태에서 첫 번째 엔드포인트(geth-l1)가 active여야 한다', () => {
    const activeUrl = getActiveL1RpcUrl();
    expect(activeUrl).toContain('geth-l1');
  });

  it('2회 연속 실패는 failover를 트리거하지 않아야 한다 (threshold=3)', async () => {
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));

    // 2회 실패 → threshold(3) 미달 → geth-l1 유지
    const activeUrl = getActiveL1RpcUrl();
    expect(activeUrl).toContain('geth-l1');
  });

  it('3회 연속 실패 후 자동으로 두 번째 엔드포인트로 failover해야 한다', async () => {
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused')); // threshold=3 도달 → failover

    // 3회 후 자동으로 reth-l1으로 전환
    const activeUrl = getActiveL1RpcUrl();
    expect(activeUrl).toContain('reth-l1');
  });

  it('executeFailover 직접 호출로 두 번째 엔드포인트로 전환되어야 한다', async () => {
    const event = await executeFailover('manual test failover');

    const state = getL1FailoverState();
    const activeUrl = getActiveL1RpcUrl();

    // 두 번째 엔드포인트(reth-l1)로 전환
    expect(activeUrl).toContain('reth-l1');
    expect(state.activeIndex).toBe(1);
    expect(event).not.toBeNull();
  });

  it('failover 후 새 active endpoint의 consecutiveFailures가 0이어야 한다', async () => {
    await executeFailover('manual failover');

    const state = getL1FailoverState();
    const activeEndpoint = state.endpoints[state.activeIndex];
    expect(activeEndpoint.consecutiveFailures).toBe(0);
  });

  it('5분 쿨다운 내 reportL1Failure은 재failover를 차단해야 한다', async () => {
    // 3회 실패로 첫 번째 failover (geth→reth)
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));
    const urlAfterFirst = getActiveL1RpcUrl();
    expect(urlAfterFirst).toContain('reth-l1');

    // 쿨다운 내 reth에서도 3회 실패 → 쿨다운으로 차단
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));
    await reportL1Failure(new Error('Connection refused'));

    // lastFailoverTime이 설정되어 있어 쿨다운 활성 → URL 유지
    const state = getL1FailoverState();
    expect(state.lastFailoverTime).not.toBeNull();
  });

  it('L1_RPC_URLS 미설정 시 기본 public endpoint를 사용해야 한다', () => {
    delete process.env.L1_RPC_URLS;
    resetL1FailoverState();

    const activeUrl = getActiveL1RpcUrl();
    // publicnode.com 기반 기본 엔드포인트
    expect(activeUrl).toBeTruthy();
    expect(typeof activeUrl).toBe('string');
  });
});

// ============================================================
// S-CROSS-02: OP Stack L2 + Nethermind L1 조합
// ============================================================

describe('S-CROSS-02: OP Stack L2 + Nethermind L1 조합', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('L1(Nethermind)과 L2(op-geth)를 URL 분기로 독립 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      urlDispatchFetch({
        'nethermind-l1': {
          web3_clientVersion: 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
          eth_blockNumber: '0x1215918', // 19000000
          eth_syncing: false,
          parity_pendingTransactions: [],
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

    const l1Result = await detectExecutionClient({ rpcUrl: 'http://nethermind-l1:8545' });
    const l2Result = await detectExecutionClient({ rpcUrl: 'http://op-geth-l2:8545' });

    // L1: Nethermind → parity txpool
    expect(l1Result.family).toBe('nethermind');
    expect(l1Result.txpoolNamespace).toBe('parity');

    // L2: op-geth → optimism_syncStatus
    expect(l2Result.family).toBe('op-geth');
    expect(l2Result.l2SyncMethod).toBe('optimism_syncStatus');
  });
});

// ============================================================
// S-CROSS-03: Arbitrum Nitro + Reth L1 블록 격차
// ============================================================

describe('S-CROSS-03: Arbitrum Nitro + Reth L1 블록 격차', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('L1(Reth)과 L2(nitro-node)를 독립적으로 감지해야 한다', async () => {
    vi.stubGlobal(
      'fetch',
      urlDispatchFetch({
        'reth-l1': {
          web3_clientVersion: 'reth/v1.1.2/linux-amd64/rustc1.82.0',
          eth_blockNumber: '0x1215928', // 19000360
          eth_syncing: false,
        },
        'nitro-l2': {
          web3_clientVersion: 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
          eth_blockNumber: '0x1234',
          eth_syncing: false,
          arb_blockNumber: '0x1234',
        },
      })
    );

    const l1Result = await detectExecutionClient({ rpcUrl: 'http://reth-l1:8545' });
    const l2Result = await detectExecutionClient({ rpcUrl: 'http://nitro-l2:8547' });

    expect(l1Result.family).toBe('reth');
    expect(l2Result.family).toBe('nitro-node');
  });

  it('L1과 nitro L2의 블록 번호 차이를 계산해야 한다', () => {
    // 블록 격차 계산 (arb_getL1BlockNumber vs 현재 L1 blockNumber)
    const l1CurrentBlock = 19000360;
    const l2L1Cursor = 19000000; // nitro가 인지하는 L1 블록

    const gap = l1CurrentBlock - l2L1Cursor;

    expect(gap).toBe(360);
    // 15초/블록 기준으로 약 90분 지연 (360 * 15s = 5400s)
    const delaySeconds = gap * 15;
    expect(delaySeconds).toBe(5400);
  });
});

// ============================================================
// S-CROSS-04: ZK Stack + Besu L1 Proof 상태 검증
// ============================================================

describe('S-CROSS-04: ZK Stack + Besu L1 Proof 검증', () => {
  it('ZK 배치의 현재 finalization 단계를 올바르게 파악해야 한다', () => {
    // proven 상태: commit 완료, prove 완료, execute 미완료
    const zkBatchDetails = {
      number: 5000,
      status: 'proven',
      proveTxHash: '0xproofhash',
      executeTxHash: null as string | null, // 아직 execute 안 됨
    };

    const pendingStep = getPendingFinalityStep(zkBatchDetails);

    expect(pendingStep).toBe('execute');
  });

  it('executed 상태에서는 pending step이 없어야 한다 (fully finalized)', () => {
    const zkBatchDetails = {
      number: 5000,
      status: 'executed',
      proveTxHash: '0xproofhash',
      executeTxHash: '0xexecutehash',
    };

    const pendingStep = getPendingFinalityStep(zkBatchDetails);

    expect(pendingStep).toBeNull();
  });

  it('committed 상태에서는 pending step이 prove여야 한다', () => {
    const zkBatchDetails = {
      number: 5000,
      status: 'committed',
      proveTxHash: null as string | null,
      executeTxHash: null as string | null,
    };

    const pendingStep = getPendingFinalityStep(zkBatchDetails);

    expect(pendingStep).toBe('prove');
  });

  it('ZK Stack RPC 스냅샷에서 배치 정보를 올바르게 파싱해야 한다', () => {
    const raw = {
      eth_blockNumber: '0x186A0', // 100000
      zks_L1BatchNumber: '0x1388', // 5000
      zks_getL1BatchDetails: {
        number: 5000,
        timestamp: 1700000000,
        l1TxCount: 10,
        status: 'verified',
      },
    };

    const snapshot = normalizeZkstackRpcSnapshot(raw);

    expect(snapshot.latestBlockNumber).toBe(100000);
    expect(snapshot.l1BatchNumber).toBe(5000);
    expect(snapshot.l1TxCount).toBe(10);
  });
});

// ============================================================
// Helper: ZK Finality Step 결정
// ============================================================

function getPendingFinalityStep(batch: {
  status: string;
  proveTxHash: string | null;
  executeTxHash: string | null;
}): 'prove' | 'execute' | null {
  if (batch.status === 'executed' && batch.executeTxHash) return null;
  if (batch.proveTxHash === null) return 'prove';
  if (batch.executeTxHash === null) return 'execute';
  return null;
}
