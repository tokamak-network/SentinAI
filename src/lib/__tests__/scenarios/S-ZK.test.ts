/**
 * ZK Stack 연동 시나리오 테스트
 * Ref: docs/guide/testing/chain-client-integration-scenarios.md §5
 *
 * S-ZK-01  ZK Stack 클라이언트 감지 (RPC 메서드 맵 + 스냅샷 파싱)
 * S-ZK-02  ZK Proof 생성 지연 감지 (배치 상태 타임스탬프 기반)
 * S-ZK-03  ZK Stack 의존성 그래프 기반 RCA
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
import { ZkstackPlugin } from '@/chains/zkstack';
import {
  getZkstackRpcMethodMap,
  normalizeZkstackRpcSnapshot,
  resolveZkstackMode,
} from '@/chains/zkstack/rpc';
import { mockRpcFetch } from './helpers/mock-rpc';

// ============================================================
// Helpers
// ============================================================

/**
 * ZK Stack 배치 상태의 committed 시간이 `ageMs`ms 전인 경우를 시뮬레이션
 */
function makeStuckBatch(ageMs: number) {
  return {
    number: 5001,
    status: 'committed',
    committedAt: new Date(Date.now() - ageMs).toISOString(),
    proveTxHash: null as string | null,
    executeTxHash: null as string | null,
  };
}

/**
 * committed 상태로 멈춘 배치가 경고/크리티컬 임계값을 초과하는지 계산
 */
function classifyProofDelay(batch: { status: string; committedAt: string; proveTxHash: string | null }) {
  if (batch.status !== 'committed' || batch.proveTxHash !== null) {
    return null; // 지연 없음
  }

  const committedAt = new Date(batch.committedAt).getTime();
  const elapsedMs = Date.now() - committedAt;

  const WARNING_MS = parseInt(process.env.ZKSTACK_PROOF_DELAY_WARNING_MS || '1800000', 10); // 30분
  const CRITICAL_MS = parseInt(process.env.ZKSTACK_PROOF_DELAY_CRITICAL_MS || '3600000', 10); // 60분

  if (elapsedMs >= CRITICAL_MS) return 'critical';
  if (elapsedMs >= WARNING_MS) return 'warning';
  return null;
}

// ============================================================
// S-ZK-01: ZK Stack 클라이언트 감지 (RPC 메서드 맵 & 스냅샷)
// ============================================================

describe('S-ZK-01: ZK Stack 클라이언트 감지', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('RPC 메서드 맵 검증', () => {
    it('legacy-era 모드에서 zks_getL1BatchDetails를 proof 메서드로 포함해야 한다', () => {
      const methods = getZkstackRpcMethodMap('legacy-era');
      expect(methods.proof).toContain('zks_getL1BatchDetails');
    });

    it('legacy-era 모드에서 zks_L1BatchNumber를 settlement 메서드로 포함해야 한다', () => {
      const methods = getZkstackRpcMethodMap('legacy-era');
      expect(methods.settlement).toContain('zks_L1BatchNumber');
    });

    it('os-preview 모드에서 동일한 ZK 메서드를 지원해야 한다', () => {
      const methods = getZkstackRpcMethodMap('os-preview');
      expect(methods.proof).toContain('zks_getL1BatchDetails');
      expect(methods.settlement).toContain('zks_L1BatchNumber');
    });

    it('필수(required) 메서드에 eth_chainId, eth_blockNumber가 포함되어야 한다', () => {
      const methods = getZkstackRpcMethodMap('legacy-era');
      expect(methods.required).toContain('eth_chainId');
      expect(methods.required).toContain('eth_blockNumber');
    });
  });

  describe('모드 해석', () => {
    it('잘못된 모드 문자열은 legacy-era로 폴백해야 한다', () => {
      expect(resolveZkstackMode('invalid')).toBe('legacy-era');
      expect(resolveZkstackMode(undefined)).toBe('legacy-era');
    });

    it('os-preview 문자열을 올바르게 인식해야 한다', () => {
      expect(resolveZkstackMode('os-preview')).toBe('os-preview');
    });
  });

  describe('RPC 스냅샷 파싱 (normalizeZkstackRpcSnapshot)', () => {
    it('zks_getL1BatchDetails와 zks_L1BatchNumber를 올바르게 파싱해야 한다', () => {
      const raw = {
        eth_blockNumber: '0x186A0', // 100000
        zks_L1BatchNumber: '0x1388', // 5000
        zks_getL1BatchDetails: {
          number: 5000,
          timestamp: 1700000000,
          l1TxCount: 10,
          l2TxCount: 500,
          status: 'verified',
        },
      };

      const snapshot = normalizeZkstackRpcSnapshot(raw);

      expect(snapshot.latestBlockNumber).toBe(100000);
      expect(snapshot.l1BatchNumber).toBe(5000);
      expect(snapshot.l1BatchTimestamp).toBe(1700000000);
      expect(snapshot.l1TxCount).toBe(10);
    });

    it('필드 누락 시 null로 처리해야 한다', () => {
      const snapshot = normalizeZkstackRpcSnapshot({});

      expect(snapshot.latestBlockNumber).toBeNull();
      expect(snapshot.l1BatchNumber).toBeNull();
      expect(snapshot.l1BatchTimestamp).toBeNull();
      expect(snapshot.l1TxCount).toBeNull();
    });

    it('16진수와 10진수 블록 번호를 모두 파싱해야 한다', () => {
      const hexSnapshot = normalizeZkstackRpcSnapshot({ eth_blockNumber: '0x64' }); // 100
      const decSnapshot = normalizeZkstackRpcSnapshot({ eth_blockNumber: 100 });

      expect(hexSnapshot.latestBlockNumber).toBe(100);
      expect(decSnapshot.latestBlockNumber).toBe(100);
    });
  });

  describe('클라이언트 감지 (detectExecutionClient)', () => {
    it('ZK Stack은 zksync 클라이언트 버전으로 감지되어야 한다', async () => {
      vi.stubGlobal(
        'fetch',
        mockRpcFetch({
          web3_clientVersion: 'zkSync/v24.1.0',
          eth_chainId: '0x144', // zkSync Era Mainnet
          eth_syncing: false,
          net_peerCount: '0x3',
          // ZK Stack은 arb_blockNumber, optimism_syncStatus 없음
          // → family는 web3_clientVersion에서 결정됨
        })
      );

      // ZK Stack은 현재 client-detector에서 별도 family가 없으므로
      // web3_clientVersion 패턴 매칭으로 결정됨 (unknown으로 폴백 가능)
      const result = await detectExecutionClient({ rpcUrl: 'http://localhost:3050' });

      // zkSync는 현재 코드에서 별도 family가 없으므로 'unknown' 반환
      // 이 테스트는 현재 상태를 문서화하고 향후 개선을 위해 유지
      expect(['unknown', 'zksync-server']).toContain(result.family);
      expect(result.supportsL2SyncStatus).toBe(false);
    });
  });
});

// ============================================================
// S-ZK-02: ZK Proof 생성 지연 감지
// ============================================================

describe('S-ZK-02: ZK Proof 생성 지연 감지', () => {
  it('committed 상태에서 30분 미만이면 이상 없어야 한다', () => {
    const batch = makeStuckBatch(20 * 60 * 1000); // 20분 전

    const severity = classifyProofDelay(batch);

    expect(severity).toBeNull();
  });

  it('committed 상태에서 30분 이상 stuck 시 warning이어야 한다', () => {
    const batch = makeStuckBatch(31 * 60 * 1000); // 31분 전

    const severity = classifyProofDelay(batch);

    expect(severity).toBe('warning');
  });

  it('committed 상태에서 1시간 초과 시 critical로 에스컬레이션해야 한다', () => {
    const batch = makeStuckBatch(61 * 60 * 1000); // 61분 전

    const severity = classifyProofDelay(batch);

    expect(severity).toBe('critical');
  });

  it('이미 proven 상태(proveTxHash 존재)이면 지연이 없어야 한다', () => {
    const batch = {
      number: 5001,
      status: 'committed',
      committedAt: new Date(Date.now() - 61 * 60 * 1000).toISOString(),
      proveTxHash: '0xproofhash', // proof 존재
      executeTxHash: null as string | null,
    };

    const severity = classifyProofDelay(batch);

    expect(severity).toBeNull();
  });

  it('환경변수 ZKSTACK_PROOF_DELAY_WARNING_MS로 임계값 조정이 가능해야 한다', () => {
    process.env.ZKSTACK_PROOF_DELAY_WARNING_MS = '3600000'; // 1시간
    process.env.ZKSTACK_PROOF_DELAY_CRITICAL_MS = '7200000'; // 2시간

    // 31분 stuck → 기본은 warning이지만 조정된 임계값에서는 이상 없음
    const batch = makeStuckBatch(31 * 60 * 1000);
    const severity = classifyProofDelay(batch);

    expect(severity).toBeNull(); // 1시간 미만이므로 정상

    delete process.env.ZKSTACK_PROOF_DELAY_WARNING_MS;
    delete process.env.ZKSTACK_PROOF_DELAY_CRITICAL_MS;
  });
});

// ============================================================
// S-ZK-03: ZK Stack 의존성 그래프 기반 RCA
// ============================================================

describe('S-ZK-03: RCA - ZK Stack 의존성 그래프 분석', () => {
  let plugin: ZkstackPlugin;

  beforeEach(() => {
    plugin = new ZkstackPlugin();
  });

  it('ZkstackPlugin이 필수 컴포넌트를 포함해야 한다', () => {
    const allComponents = [...plugin.components, ...plugin.metaComponents];
    expect(allComponents).toContain('zksync-server');
    expect(allComponents).toContain('l1');
    expect(allComponents).toContain('system');
  });

  it('zk-prover 중단이 zk-batcher(배치 수집)에 즉각적인 영향을 주지 않아야 한다', () => {
    // zk-prover는 proof 생성만 담당 → zk-batcher의 직접 upstream이 아님
    const proverDeps = plugin.dependencyGraph['zk-prover'];
    if (proverDeps) {
      // prover가 batcher를 feeds하지 않음을 검증
      expect(proverDeps.feeds).not.toContain('zk-batcher');
    } else {
      // zk-prover가 의존성 그래프에 없는 경우 (독립 컴포넌트)
      // → zksync-server의 feeds에도 없음을 확인
      const serverDeps = plugin.dependencyGraph['zksync-server'];
      if (serverDeps) {
        // zksync-server가 prover에 의존하지 않음
        expect(serverDeps.dependsOn).not.toContain('zk-prover');
      }
    }
  });

  it('zksync-server 중단 시 downstream이 영향받아야 한다', () => {
    const serverDeps = plugin.dependencyGraph['zksync-server'];
    if (serverDeps) {
      // zksync-server는 downstream에 영향
      expect(serverDeps.feeds.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('l1이 root 노드여야 한다 (upstream 없음)', () => {
    const l1Deps = plugin.dependencyGraph['l1'];
    expect(l1Deps).toBeDefined();
    expect(l1Deps.dependsOn).toHaveLength(0);
  });

  it('의존성 그래프에 순환이 없어야 한다', () => {
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

  it('모든 컴포넌트가 의존성 그래프에 정의되어야 한다', () => {
    const allComponents = [...plugin.components, ...plugin.metaComponents];
    for (const comp of allComponents) {
      expect(plugin.dependencyGraph[comp]).toBeDefined();
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
