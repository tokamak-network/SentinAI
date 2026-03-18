# SentinAI 체인/클라이언트 연동 테스팅 시나리오

> 대상: L2 (OP Stack, Arbitrum Nitro, ZK Stack) × L1 실행 클라이언트 (Geth, Reth, Nethermind, Besu)

---

## 목차

1. [테스팅 전략 개요](#1-테스팅-전략-개요)
2. [공통 환경 설정](#2-공통-환경-설정)
3. [L2 시나리오: OP Stack](#3-l2-시나리오-op-stack)
4. [L2 시나리오: Arbitrum Nitro](#4-l2-시나리오-arbitrum-nitro)
5. [L2 시나리오: ZK Stack](#5-l2-시나리오-zk-stack)
6. [L1 실행 클라이언트 시나리오](#6-l1-실행-클라이언트-시나리오)
   - [Geth](#61-geth)
   - [Reth](#62-reth)
   - [Nethermind](#63-nethermind)
   - [Besu](#64-besu)
7. [크로스-매트릭스 시나리오 (L1 × L2)](#7-크로스-매트릭스-시나리오-l1--l2)
8. [공통 검증 체크리스트](#8-공통-검증-체크리스트)
9. [트러블슈팅 가이드](#9-트러블슈팅-가이드)

---

## 1. 테스팅 전략 개요

### 테스트 레이어

| 레이어 | 목적 | 도구 |
|--------|------|------|
| **Unit** | ChainPlugin 인터페이스 준수, RPC 파싱 정확도 | Vitest + mock fetch |
| **Integration** | 실제 노드 RPC 연결, 클라이언트 자동 감지 | Vitest + testcontainers |
| **E2E** | 대시보드 표시, 스케일링 결정, 알림 발송 | Playwright |

### 테스트 우선순위 매트릭스

```
Priority 1 (Critical Path)
  ├── 클라이언트 자동 감지 정확도
  ├── L2 sync 상태 정규화
  └── L1 RPC 장애 조치 (failover)

Priority 2 (Core Features)
  ├── 이상 감지 + 알림
  ├── 스케일링 결정 (scoring)
  └── RCA 의존성 그래프

Priority 3 (Extended)
  ├── NLOps 자연어 쿼리
  └── EOA 잔액 모니터링
```

### 지원 매트릭스

| | Geth | Reth | Nethermind | Besu |
|---|:---:|:---:|:---:|:---:|
| **OP Stack** | ✅ Primary | ✅ Supported | ⚠️ Limited | ⚠️ Limited |
| **Arbitrum Nitro** | ✅ Primary | ✅ Supported | ✅ Supported | ⚠️ Limited |
| **ZK Stack** | ✅ Primary | 🔲 Planned | ⚠️ Limited | 🔲 Planned |

- ✅ 완전 지원 (자동 감지 + 모든 메트릭)
- ⚠️ 부분 지원 (환경변수 수동 설정 필요)
- 🔲 미검증 (커뮤니티 피드백 기반)

---

## 2. 공통 환경 설정

### 필수 환경변수

```bash
# .env.local 기본 설정
L2_RPC_URL=http://localhost:8545
L1_RPC_URLS=https://ethereum-rpc-1.example.com,https://ethereum-rpc-2.example.com

# SentinAI 설정
SENTINAI_API_KEY=your-api-key
K8S_NAMESPACE=default
SCALING_SIMULATION_MODE=true    # 테스트 시 반드시 true

# AI 제공자 (하나 이상 설정)
ANTHROPIC_API_KEY=sk-ant-...
```

### 테스트 실행 명령어

```bash
# 단위 테스트
npm run test:run

# 특정 체인 플러그인 테스트
npx vitest run src/lib/__tests__/chain-plugin.test.ts

# 클라이언트 감지 테스트
npx vitest run src/lib/__tests__/client-detector.test.ts

# L1 failover 테스트
npx vitest run src/lib/__tests__/l1-rpc-failover.test.ts
```

### Mock RPC 헬퍼 (공통)

```typescript
// src/lib/__tests__/helpers/mock-rpc.ts
export function mockRpcFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) as { method: string } : null;
    const method = body?.method;

    if (!method || !(method in handlers)) {
      return new Response(
        JSON.stringify({ error: { code: -32601, message: 'Method not found' } }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: handlers[method] }),
      { status: 200 }
    );
  });
}

// 공통 응답 픽스처
export const FIXTURES = {
  eth: {
    synced: false,
    syncing: { currentBlock: '0x100', highestBlock: '0x200', startingBlock: '0x0' },
    blockNumber: '0x1a4',
    chainId: '0x1',
    peerCount: '0x8',
  },
  txpool: {
    status: { pending: '0xa', queued: '0x2' },
    parityPending: [{ hash: '0xabc', nonce: '0x1' }],
  },
};
```

---

## 3. L2 시나리오: OP Stack

### 3.1 환경 설정

```bash
CHAIN_TYPE=optimism
K8S_APP_PREFIX=op
# Thanos 기반 배포의 경우
CHAIN_TYPE=thanos
```

### 3.2 시나리오 S-OP-01: 클라이언트 자동 감지

**목적**: `op-geth` 실행 클라이언트를 자동으로 감지하고 올바른 RPC 메서드 프로파일을 적용하는지 확인

**검증 조건**:
- `web3_clientVersion` 응답에 "Geth" 포함 → 클라이언트 패밀리 = `geth`
- `optimism_syncStatus` RPC 지원 확인 → L2 sync 상태 활성화
- `txpool_status` RPC 지원 확인 → TxPool 모니터링 활성화

```typescript
// src/lib/__tests__/scenarios/op-stack/S-OP-01.test.ts
describe('S-OP-01: OP Stack 클라이언트 자동 감지', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'Geth/v1.13.14-stable-2bd6bd01/linux-amd64/go1.21.7',
      'eth_chainId': '0xa',           // OP Mainnet
      'eth_syncing': false,
      'net_peerCount': '0x8',
      'txpool_status': { pending: '0xa', queued: '0x2' },
      'optimism_syncStatus': {
        head_l1: { hash: '0xabc', number: 19000000, timestamp: 1700000000, parentHash: '0x000' },
        safe_l1: { hash: '0xabc', number: 18999990, timestamp: 1699999900, parentHash: '0x000' },
        unsafe_l2: { hash: '0xdef', number: 100000, timestamp: 1700000010, parentHash: '0x000' },
        safe_l2:   { hash: '0xdef', number: 99990,  timestamp: 1699999920, parentHash: '0x000' },
        finalized_l2: { hash: '0xghi', number: 99900, timestamp: 1699998000, parentHash: '0x000' },
        engine_sync_target: { hash: '0x000', number: 0, timestamp: 0, parentHash: '0x000' },
        queued_unsafe_l2_transactions: 0,
        pending_safe_l2_blocks: 10,
      },
    }));
  });

  it('클라이언트 패밀리를 geth로 감지해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });
    expect(result.family).toBe('geth');
  });

  it('L2 sync 상태 메서드를 활성화해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });
    expect(result.supportsL2SyncStatus).toBe(true);
    expect(result.l2SyncMethod).toBe('optimism_syncStatus');
  });

  it('TxPool 메서드를 활성화해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8545' });
    expect(result.supportsTxPool).toBe(true);
    expect(result.txPoolParser).toBe('txpool');
  });
});
```

**실행 방법**:
```bash
npx vitest run src/lib/__tests__/scenarios/op-stack/S-OP-01.test.ts
```

---

### 3.3 시나리오 S-OP-02: L2 동기화 지연 감지

**목적**: `op-node`와 `op-geth` 간 블록 높이 차이가 임계값(기본 10 블록)을 초과할 때 이상으로 감지

**트리거 조건**:
- `optimism_syncStatus.unsafe_l2.number` vs `optimism_syncStatus.head_l1` 기반 예상 블록 간 차이 > 10
- 또는 SentinAI `/api/metrics`의 `syncLag` 값 > `SYNC_LAG_THRESHOLD`

```typescript
describe('S-OP-02: L2 동기화 지연 감지', () => {
  it('sync lag가 임계값 초과 시 anomaly로 표시해야 한다', async () => {
    // op-geth가 뒤처진 상태 시뮬레이션
    const mockMetrics = {
      l2BlockNumber: 99000,  // op-geth
      l1BlockNumber: 19000000,
      expectedL2Block: 99200, // op-node 기준 예상치
      syncLag: 200,          // 200 블록 뒤처짐
    };

    const anomalies = await runAnomalyDetection(mockMetrics);

    expect(anomalies).toContainEqual(
      expect.objectContaining({
        component: 'op-geth',
        type: 'sync_lag',
        severity: expect.stringMatching(/warning|critical/),
      })
    );
  });

  it('정상 동기화 상태에서는 anomaly가 없어야 한다', async () => {
    const mockMetrics = {
      l2BlockNumber: 99990,
      l1BlockNumber: 19000000,
      syncLag: 3,  // 3 블록 차이 (정상)
    };

    const anomalies = await runAnomalyDetection(mockMetrics);
    const syncAnomalies = anomalies.filter(a => a.type === 'sync_lag');
    expect(syncAnomalies).toHaveLength(0);
  });
});
```

---

### 3.4 시나리오 S-OP-03: EOA 잔액 모니터링 (Batcher/Proposer)

**목적**: `op-batcher`와 `op-proposer` EOA 잔액이 임계값 미만으로 떨어질 때 알림 발송

**설정**:
```bash
BATCHER_EOA_ADDRESS=0x1234...
PROPOSER_EOA_ADDRESS=0x5678...
# 임계값: 기본 0.05 ETH (CLAUDE.md에 미정의 시 코드 기본값 사용)
```

```typescript
describe('S-OP-03: EOA 잔액 모니터링', () => {
  it('Batcher 잔액이 0.05 ETH 미만 시 경고를 발생해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'eth_getBalance': '0xADE0', // 0.0001 ETH (위험 수준)
    }));

    const response = await fetch('/api/eoa-balance');
    const data = await response.json() as {
      batcher: { balance: string; status: string };
    };

    expect(data.batcher.status).toBe('critical');
  });

  it('Proposer 잔액이 충분할 때 정상 상태여야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'eth_getBalance': '0x16345785D8A0000', // 0.1 ETH (정상)
    }));

    const response = await fetch('/api/eoa-balance');
    const data = await response.json() as {
      proposer: { balance: string; status: string };
    };

    expect(data.proposer.status).toBe('ok');
  });
});
```

---

### 3.5 시나리오 S-OP-04: 의존성 그래프 기반 RCA

**목적**: `op-geth` 장애 시 `op-batcher` → `op-proposer` 연쇄 장애를 RCA 엔진이 올바르게 추적

**OP Stack 의존성 그래프**:
```
L1 ──→ op-node ──→ op-geth ──→ (L2 RPC 소비자)
                 ├──→ op-batcher ──→ L1
                 └──→ op-proposer ──→ L1
```

```typescript
describe('S-OP-04: RCA - op-geth 장애 연쇄 분석', () => {
  it('op-geth 장애가 downstream 컴포넌트에 전파되어야 한다', async () => {
    const failureEvent = {
      component: 'op-geth',
      type: 'connection_refused',
      timestamp: Date.now(),
    };

    const rca = await runRCA(failureEvent, getChainPlugin('optimism'));

    expect(rca.rootCause).toMatchObject({ component: 'op-geth' });
    expect(rca.affectedComponents).toContain('op-batcher');
    expect(rca.affectedComponents).toContain('op-proposer');
  });

  it('L1 장애가 op-node → op-geth 순으로 전파되어야 한다', async () => {
    const failureEvent = {
      component: 'l1',
      type: 'rpc_unavailable',
      timestamp: Date.now(),
    };

    const rca = await runRCA(failureEvent, getChainPlugin('optimism'));

    // L1 → op-node → op-geth 순서로 영향
    expect(rca.propagationPath).toEqual(['l1', 'op-node', 'op-geth']);
  });
});
```

---

## 4. L2 시나리오: Arbitrum Nitro

### 4.1 환경 설정

```bash
CHAIN_TYPE=arbitrum
K8S_APP_PREFIX=arb
# Nitro 노드 RPC (op-geth와 동일 포트지만 다른 메서드 지원)
L2_RPC_URL=http://nitro-node:8547
```

### 4.2 시나리오 S-ARB-01: Nitro 클라이언트 감지

**목적**: `nitro-node`의 `arb_blockNumber` 메서드를 통해 Arbitrum Nitro를 Geth 패밀리와 구분

```typescript
describe('S-ARB-01: Arbitrum Nitro 클라이언트 감지', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockRpcFetch({
      // Nitro는 Geth를 기반으로 하므로 clientVersion에 Geth가 포함됨
      'web3_clientVersion': 'Geth/v1.12.0-stable/linux-amd64/go1.20.3',
      'eth_chainId': '0xa4b1',        // Arbitrum One
      'eth_syncing': false,
      'net_peerCount': '0x5',
      'txpool_status': { pending: '0x14', queued: '0x3' },
      // Arbitrum-specific method (이것이 nitro-node를 식별함)
      'arb_blockNumber': '0x1234',
      'arb_getL1BlockNumber': '0x1215918',
    }));
  });

  it('arb_blockNumber 존재 시 nitro-node로 감지해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });
    expect(result.family).toBe('nitro-node');
  });

  it('L2 sync 메서드로 arb_getL1BlockNumber를 사용해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });
    expect(result.l2SyncMethod).toBe('arb_getL1BlockNumber');
  });

  it('TxPool을 지원해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:8547' });
    expect(result.supportsTxPool).toBe(true);
  });
});
```

---

### 4.3 시나리오 S-ARB-02: L1 배치 포스팅 지연 감지

**목적**: `batch-poster`가 L1에 트랜잭션을 제출하지 못하는 상황 감지

**지표**:
- `arb_getL1BlockNumber` 기준 L1 sync cursor가 멈춤
- `txpool_status.pending` 지속 증가 (배치 큐에 트랜잭션 누적)

```typescript
describe('S-ARB-02: Batch Poster 지연 감지', () => {
  it('L1 블록 커서가 정지 시 batch_poster 이상 감지', async () => {
    // 5분간 동일한 L1 블록 번호 유지 (정지 상태)
    const staleMetrics = Array(5).fill({
      l1BlockCursor: 19000000,  // 변화 없음
      l2BatchesPending: 50,     // 누적 증가
      timestamp: Date.now(),
    });

    const anomalies = await detectAnomalies(staleMetrics);

    expect(anomalies).toContainEqual(
      expect.objectContaining({
        component: 'batch-poster',
        type: 'l1_submission_stall',
        severity: 'warning',
      })
    );
  });

  it('Batch poster EOA 가스 부족 시 critical 이상 감지', async () => {
    const metrics = {
      batchPosterBalance: '0x0',  // 가스 없음
      l2BatchesPending: 100,
    };

    const anomalies = await detectAnomalies([metrics]);

    expect(anomalies).toContainEqual(
      expect.objectContaining({
        component: 'batch-poster',
        type: 'insufficient_gas',
        severity: 'critical',
      })
    );
  });
});
```

---

### 4.4 시나리오 S-ARB-03: Validator 챌린지 감지

**목적**: Arbitrum validator가 악의적 assertion을 감지하고 챌린지를 제출하는 상황 모니터링

```typescript
describe('S-ARB-03: Validator 챌린지 상태 모니터링', () => {
  it('활성 챌린지 존재 시 validator 상태가 challenged로 표시되어야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'arb_validatorStatus': {
        isValidator: true,
        latestStakedNode: 1000,
        latestStakedNodeBlockHash: '0xabc',
        isInChallenge: true,        // 챌린지 진행 중
        challengeIndex: 42,
        currentChallenge: '0xchallenge_address',
      },
    }));

    const status = await getValidatorStatus('http://localhost:8547');

    expect(status.inChallenge).toBe(true);
    expect(status.severity).toBe('critical');
    expect(status.alertRequired).toBe(true);
  });
});
```

---

### 4.5 시나리오 S-ARB-04: 의존성 그래프 기반 RCA

**Arbitrum 의존성 그래프**:
```
L1 ──→ nitro-node ──→ batch-poster ──→ L1
                  └──→ validator ──→ L1
```

```typescript
describe('S-ARB-04: RCA - nitro-node 장애 분석', () => {
  it('nitro-node 중단 시 batch-poster와 validator 모두 영향받아야 한다', async () => {
    const rca = await runRCA(
      { component: 'nitro-node', type: 'pod_crash' },
      getChainPlugin('arbitrum')
    );

    expect(rca.affectedComponents).toContain('batch-poster');
    expect(rca.affectedComponents).toContain('validator');
    expect(rca.recommendedActions).toContainEqual(
      expect.objectContaining({ action: 'restart', target: 'nitro-node' })
    );
  });
});
```

---

## 5. L2 시나리오: ZK Stack

### 5.1 환경 설정

```bash
CHAIN_TYPE=zkstack
K8S_APP_PREFIX=zk
L2_RPC_URL=http://zksync-server:3050
# ZK proof RPC (별도 엔드포인트인 경우)
ZKSTACK_PROOF_RPC_URL=http://prover:3051
```

### 5.2 시나리오 S-ZK-01: ZK Stack 클라이언트 감지

**목적**: `zks_getL1BatchDetails` 메서드를 통해 ZK Stack을 감지

```typescript
describe('S-ZK-01: ZK Stack 클라이언트 감지', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'zkSync/v24.1.0',
      'eth_chainId': '0x144',          // zkSync Era Mainnet
      'eth_syncing': false,
      'net_peerCount': '0x3',
      // ZK Stack 식별 메서드
      'zks_getL1BatchDetails': {
        number: 5000,
        timestamp: 1700000000,
        l1TxCount: 10,
        l2TxCount: 500,
        rootHash: '0xabc',
        status: 'verified',
        commitTxHash: '0xcommit',
        committedAt: '2024-01-01T00:00:00Z',
        proveTxHash: '0xprove',
        provenAt: '2024-01-01T00:01:00Z',
        executeTxHash: '0xexecute',
        executedAt: '2024-01-01T00:02:00Z',
        l1GasPrice: '0x3B9ACA00',
        l2FairGasPrice: '0x250',
      },
      'zks_L1BatchNumber': '0x1388', // 배치 5000
    }));
  });

  it('zks_getL1BatchDetails 존재 시 zksync-server로 감지해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:3050' });
    expect(result.family).toBe('zksync-server');
  });

  it('L2 sync 메서드로 zks_L1BatchNumber를 사용해야 한다', async () => {
    const result = await detectExecutionClient({ rpcUrl: 'http://localhost:3050' });
    expect(result.l2SyncMethod).toBe('zks_L1BatchNumber');
  });
});
```

---

### 5.3 시나리오 S-ZK-02: Proof 생성 지연 감지

**목적**: ZK proof 생성이 예상보다 오래 걸릴 때 이상 감지

**ZK 배치 생명주기**:
```
sealed → committed → proven → executed
  (L1 commit)  (ZK proof)  (L1 finalized)
```

```typescript
describe('S-ZK-02: ZK Proof 생성 지연 감지', () => {
  it('committed 상태에서 30분 이상 stuck 시 zk-prover 경고 발생', async () => {
    const stuckBatch = {
      number: 5001,
      status: 'committed',          // proven으로 넘어가지 못함
      committedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(), // 31분 전
      proveTxHash: null,            // 아직 proof 없음
    };

    vi.stubGlobal('fetch', mockRpcFetch({
      'zks_getL1BatchDetails': stuckBatch,
    }));

    const anomalies = await detectProofDelay({ rpcUrl: 'http://localhost:3050' });

    expect(anomalies).toContainEqual(
      expect.objectContaining({
        component: 'zk-prover',
        type: 'proof_generation_delay',
        batchNumber: 5001,
        severity: 'warning',
      })
    );
  });

  it('1시간 초과 시 critical로 에스컬레이션해야 한다', async () => {
    const criticalBatch = {
      number: 5001,
      status: 'committed',
      committedAt: new Date(Date.now() - 61 * 60 * 1000).toISOString(), // 61분 전
      proveTxHash: null,
    };

    // critical 에스컬레이션 검증
    const anomalies = await detectProofDelay({ rpcUrl: 'http://localhost:3050', batch: criticalBatch });
    const proofAnomaly = anomalies.find(a => a.type === 'proof_generation_delay');

    expect(proofAnomaly?.severity).toBe('critical');
  });
});
```

---

### 5.4 시나리오 S-ZK-03: ZK Stack 의존성 RCA

**ZK Stack 의존성 그래프**:
```
L1 ──→ zksync-server ──→ zk-batcher ──→ L1
                     └──→ zk-prover (독립적 proof 생성)
```

```typescript
describe('S-ZK-03: RCA - zk-prover 장애 분석', () => {
  it('zk-prover 중단이 zk-batcher에 영향주지 않아야 한다', async () => {
    // prover는 독립적으로 동작 (단기적으로 batcher에 영향 없음)
    const rca = await runRCA(
      { component: 'zk-prover', type: 'oom_killed' },
      getChainPlugin('zkstack')
    );

    // batcher는 계속 배치 수집 가능
    expect(rca.affectedComponents).not.toContain('zk-batcher');
    // 단, finalization이 지연되어 사용자 UX에 영향
    expect(rca.userImpact).toContain('withdrawal_delay');
  });

  it('zksync-server 중단 시 모든 downstream이 영향받아야 한다', async () => {
    const rca = await runRCA(
      { component: 'zksync-server', type: 'pod_eviction' },
      getChainPlugin('zkstack')
    );

    expect(rca.affectedComponents).toContain('zk-batcher');
    expect(rca.affectedComponents).toContain('zk-prover');
  });
});
```

---

## 6. L1 실행 클라이언트 시나리오

### 6.1 Geth

**특징**: Ethereum 레퍼런스 구현, `txpool_status` + `txpool_content` 완전 지원

#### 시나리오 S-L1-GETH-01: Geth 클라이언트 감지

```typescript
describe('S-L1-GETH-01: Geth 클라이언트 감지', () => {
  it('web3_clientVersion "Geth"로 geth 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'Geth/v1.14.13-stable-2bd6bd01/linux-amd64/go1.22.11',
      'eth_syncing': false,
      'txpool_status': { pending: '0x0', queued: '0x0' },
    }));

    const result = await detectL1Client({ rpcUrl: 'http://geth-l1:8545' });
    expect(result.family).toBe('geth');
    expect(result.supportsTxPool).toBe(true);
    expect(result.txPoolParser).toBe('txpool');
  });

  it('버전 정보를 올바르게 파싱해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'Geth/v1.14.13-stable-2bd6bd01/linux-amd64/go1.22.11',
    }));

    const result = await detectL1Client({ rpcUrl: 'http://geth-l1:8545' });
    expect(result.version).toBe('1.14.13');
    expect(result.platform).toBe('linux-amd64');
  });
});
```

#### 시나리오 S-L1-GETH-02: Geth Mempool 모니터링

```typescript
describe('S-L1-GETH-02: Geth Mempool 모니터링', () => {
  it('pending 트랜잭션 증가 추세 감지', async () => {
    const trendMetrics = [
      { pending: 100, queued: 10, timestamp: Date.now() - 300000 },
      { pending: 500, queued: 50, timestamp: Date.now() - 240000 },
      { pending: 1500, queued: 150, timestamp: Date.now() - 180000 },
      { pending: 3000, queued: 300, timestamp: Date.now() - 120000 },
      { pending: 5000, queued: 500, timestamp: Date.now() - 60000 },
    ];

    const anomalies = await detectMempoolAnomaly(trendMetrics, 'geth');

    expect(anomalies).toContainEqual(
      expect.objectContaining({
        type: 'mempool_growth',
        severity: expect.stringMatching(/warning|critical/),
      })
    );
  });
});
```

---

### 6.2 Reth

**특징**: Rust 기반 고성능 클라이언트, Geth와 동일한 JSON-RPC API (호환성 높음)

#### 시나리오 S-L1-RETH-01: Reth 클라이언트 감지

```typescript
describe('S-L1-RETH-01: Reth 클라이언트 감지', () => {
  it('web3_clientVersion "reth"로 reth 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'reth/v1.1.2/linux-amd64/rustc1.82.0',
      'eth_syncing': false,
      'txpool_status': { pending: '0x5', queued: '0x0' },
    }));

    const result = await detectL1Client({ rpcUrl: 'http://reth-l1:8545' });
    expect(result.family).toBe('reth');
    expect(result.supportsTxPool).toBe(true);
  });

  it('Reth가 Geth와 동일한 txpool API를 사용해야 한다', async () => {
    const result = await detectL1Client({ rpcUrl: 'http://reth-l1:8545' });
    // Reth는 Geth 호환 API를 사용하므로 동일한 파서 사용
    expect(result.txPoolParser).toBe('txpool');
  });
});
```

#### 시나리오 S-L1-RETH-02: Reth와 OP Stack 연동 검증

**목적**: Reth를 L1 클라이언트로, op-geth를 L2 클라이언트로 사용하는 조합 검증

```bash
# .env.local 설정
L1_RPC_URLS=http://reth-l1:8545
L2_RPC_URL=http://op-geth-l2:8545
CHAIN_TYPE=optimism
```

```typescript
describe('S-L1-RETH-02: Reth L1 + OP Stack L2 연동', () => {
  it('Reth L1에서 블록 높이를 올바르게 읽어야 한다', async () => {
    // L1 RPC (reth)
    const l1Mock = mockRpcFetch({
      'web3_clientVersion': 'reth/v1.1.2/linux-amd64/rustc1.82.0',
      'eth_blockNumber': '0x1215918',  // 19000000
    });

    // L2 RPC (op-geth)
    const l2Mock = mockRpcFetch({
      'web3_clientVersion': 'Geth/v1.13.14-stable/linux-amd64/go1.21.7',
      'eth_blockNumber': '0x186A0',    // 100000
      'optimism_syncStatus': {
        head_l1: { number: 19000000 },
        unsafe_l2: { number: 100000 },
      },
    });

    // L1 RPC URL에 따라 올바른 mock 사용
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      return url.includes('reth') ? l1Mock(url, init) : l2Mock(url, init);
    });

    const metrics = await collectMetrics();

    expect(metrics.l1BlockNumber).toBe(19000000);
    expect(metrics.l2BlockNumber).toBe(100000);
    expect(metrics.l1ClientFamily).toBe('reth');
    expect(metrics.l2ClientFamily).toBe('geth');  // op-geth는 geth 패밀리
  });
});
```

---

### 6.3 Nethermind

**특징**: .NET 기반, `parity_pendingTransactions` 방식의 TxPool API (Geth와 다름)

#### 시나리오 S-L1-NETH-01: Nethermind 클라이언트 감지

```typescript
describe('S-L1-NETH-01: Nethermind 클라이언트 감지', () => {
  it('web3_clientVersion "Nethermind"로 nethermind 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
      'eth_syncing': false,
      // txpool_status는 지원하지 않음
      // parity_pendingTransactions를 사용
      'parity_pendingTransactions': [
        { hash: '0xabc', nonce: '0x1', gasPrice: '0x3B9ACA00' },
        { hash: '0xdef', nonce: '0x2', gasPrice: '0x3B9ACA00' },
      ],
    }));

    const result = await detectL1Client({ rpcUrl: 'http://nethermind-l1:8545' });

    expect(result.family).toBe('nethermind');
    // Nethermind는 parity 방식 TxPool 사용
    expect(result.txPoolParser).toBe('parity');
  });

  it('txpool_status 미지원 시에도 TxPool 모니터링이 작동해야 한다', async () => {
    // Nethermind는 parity_pendingTransactions 사용
    const txCount = await getTxPoolSize('http://nethermind-l1:8545');
    expect(typeof txCount).toBe('number');
  });
});
```

#### 시나리오 S-L1-NETH-02: Nethermind 수동 설정 (환경변수 오버라이드)

**목적**: 자동 감지가 실패하는 경우 환경변수로 수동 설정

```bash
# 자동 감지 실패 시 수동 오버라이드
SENTINAI_CLIENT_FAMILY=nethermind
SENTINAI_OVERRIDE_TXPOOL_METHOD=parity_pendingTransactions
SENTINAI_OVERRIDE_TXPOOL_PARSER=parity
```

```typescript
describe('S-L1-NETH-02: Nethermind 수동 환경변수 설정', () => {
  beforeEach(() => {
    process.env.SENTINAI_CLIENT_FAMILY = 'nethermind';
    process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD = 'parity_pendingTransactions';
    process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER = 'parity';
  });

  afterEach(() => {
    delete process.env.SENTINAI_CLIENT_FAMILY;
    delete process.env.SENTINAI_OVERRIDE_TXPOOL_METHOD;
    delete process.env.SENTINAI_OVERRIDE_TXPOOL_PARSER;
  });

  it('환경변수 설정으로 nethermind 프로파일이 적용되어야 한다', async () => {
    const profile = await getClientProfile('http://nethermind-l1:8545');

    expect(profile.clientFamily).toBe('nethermind');
    expect(profile.methods.txPool?.method).toBe('parity_pendingTransactions');
    expect(profile.parsers.txPool).toBe('parity');
  });
});
```

---

### 6.4 Besu

**특징**: Java 기반 Hyperledger Besu, 기업 환경에서 사용 (Quorum 프라이빗 네트워크 호환)

#### 시나리오 S-L1-BESU-01: Besu 클라이언트 감지

```typescript
describe('S-L1-BESU-01: Besu 클라이언트 감지', () => {
  it('web3_clientVersion "besu"로 besu 패밀리를 감지해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      'web3_clientVersion': 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
      'eth_syncing': false,
      'eth_chainId': '0x1',
      // Besu는 txpool_status 지원
      'txpool_status': { pending: '0x0', queued: '0x0' },
      // Besu 추가 지표
      'txpool_besuStatistics': {
        maxSize: 4096,
        localCount: 0,
        remoteCount: 0,
      },
    }));

    const result = await detectL1Client({ rpcUrl: 'http://besu-l1:8545' });
    expect(result.family).toBe('besu');
    expect(result.supportsTxPool).toBe(true);
  });

  it('Besu 추가 통계 (txpool_besuStatistics)를 수집해야 한다', async () => {
    const stats = await getBesuTxPoolStats('http://besu-l1:8545');

    expect(stats).toMatchObject({
      maxSize: expect.any(Number),
      localCount: expect.any(Number),
      remoteCount: expect.any(Number),
    });
  });
});
```

#### 시나리오 S-L1-BESU-02: Besu 수동 설정

**목적**: Besu가 enterprise 설정으로 일부 API가 비활성화된 경우 처리

```bash
# Besu에서 일부 네임스페이스가 비활성화된 경우
SENTINAI_CLIENT_FAMILY=besu
SENTINAI_CAPABILITY_PEER_COUNT=false   # net 네임스페이스 비활성화
SENTINAI_CAPABILITY_TXPOOL=true
```

```typescript
describe('S-L1-BESU-02: Besu 엔터프라이즈 설정', () => {
  it('net 네임스페이스 비활성화 시 peer count 없이 작동해야 한다', async () => {
    process.env.SENTINAI_CAPABILITY_PEER_COUNT = 'false';

    const metrics = await collectL1Metrics('http://besu-l1:8545');

    // peer count 없이도 기본 메트릭 수집 가능
    expect(metrics.blockNumber).toBeGreaterThan(0);
    expect(metrics.peerCount).toBeNull(); // 수집 안 함

    delete process.env.SENTINAI_CAPABILITY_PEER_COUNT;
  });
});
```

---

## 7. 크로스-매트릭스 시나리오 (L1 × L2)

### 7.1 시나리오 S-CROSS-01: L1 RPC 장애 조치 (Failover)

**목적**: 기본 L1 RPC 장애 시 백업으로 자동 전환 (모든 L2 체인에 적용)

```bash
# 다중 L1 RPC 설정 (클라이언트 혼용 가능)
L1_RPC_URLS=http://geth-l1:8545,http://reth-l1:8545,http://nethermind-l1:8545
```

```typescript
describe('S-CROSS-01: L1 RPC 장애 조치', () => {
  it('기본 Geth L1 실패 시 Reth 백업으로 전환해야 한다', async () => {
    // 첫 번째 RPC (Geth) 실패 시뮬레이션
    let callCount = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      callCount++;
      if (url.includes('geth-l1') && callCount <= 3) {
        // 3회 연속 실패 (장애 감지 임계값)
        throw new Error('Connection refused');
      }
      // Reth로 failover
      return new Response(JSON.stringify({ result: '0x1215918' }), { status: 200 });
    });

    // 3회 실패 후 자동 전환 확인
    await triggerL1Failover();

    const state = getL1FailoverState();
    expect(state.activeIndex).toBe(1); // 두 번째 엔드포인트(Reth)로 전환
    expect(state.consecutiveFailures).toBe(0); // 리셋됨
  });

  it('5분 쿨다운 후 원래 Geth L1으로 복구 시도해야 한다', async () => {
    // 쿨다운 시간 경과 시뮬레이션
    vi.useFakeTimers();
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000); // 5분 1초

    const state = getL1FailoverState();
    expect(state.canRetryPrimary).toBe(true);

    vi.useRealTimers();
  });
});
```

---

### 7.2 시나리오 S-CROSS-02: OP Stack + Nethermind L1 조합

**특이사항**: Nethermind의 `parity_pendingTransactions` API로 L1 TxPool을 모니터링하면서 OP Stack L2의 `optimism_syncStatus`를 동시에 처리

```typescript
describe('S-CROSS-02: OP Stack L2 + Nethermind L1 조합', () => {
  beforeEach(() => {
    // L1 (Nethermind) mock
    const l1Mock = mockRpcFetch({
      'web3_clientVersion': 'Nethermind/v1.29.1+8b46ff9/linux-x64/dotnet9.0.0',
      'eth_blockNumber': '0x1215918',
      'eth_syncing': false,
      'parity_pendingTransactions': [],
    });

    // L2 (op-geth) mock
    const l2Mock = mockRpcFetch({
      'web3_clientVersion': 'Geth/v1.13.14-stable/linux-amd64/go1.21.7',
      'eth_blockNumber': '0x186A0',
      'optimism_syncStatus': {
        head_l1: { number: 19000000 },
        unsafe_l2: { number: 100000 },
      },
    });

    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (url.includes('nethermind')) return l1Mock(url, init);
      return l2Mock(url, init);
    });
  });

  it('L1과 L2 메트릭을 독립적으로 수집해야 한다', async () => {
    process.env.L1_RPC_URLS = 'http://nethermind-l1:8545';
    process.env.L2_RPC_URL = 'http://op-geth-l2:8545';
    process.env.CHAIN_TYPE = 'optimism';

    const metrics = await collectMetrics();

    expect(metrics.l1BlockNumber).toBe(19000000);
    expect(metrics.l2BlockNumber).toBe(100000);
    // Nethermind는 parity TxPool 사용
    expect(metrics.l1TxPoolParser).toBe('parity');
    // op-geth는 optimism_syncStatus 사용
    expect(metrics.l2SyncMethod).toBe('optimism_syncStatus');
  });
});
```

---

### 7.3 시나리오 S-CROSS-03: Arbitrum Nitro + Reth L1 — 블록 격차 추적

```typescript
describe('S-CROSS-03: Arbitrum Nitro + Reth L1 블록 격차', () => {
  it('L1 블록과 Nitro의 L1 커서 간 격차를 정확히 계산해야 한다', async () => {
    vi.stubGlobal('fetch', mockRpcFetch({
      // Reth L1
      'eth_blockNumber': '0x1215928', // L1 현재: 19000360
      // Nitro L2
      'arb_getL1BlockNumber': '0x1215918', // Nitro가 인지하는 L1: 19000000
    }));

    const gap = await calculateL1L2BlockGap({
      l1RpcUrl: 'http://reth-l1:8545',
      l2RpcUrl: 'http://nitro-l2:8547',
      chainType: 'arbitrum',
    });

    expect(gap.l1Current).toBe(19000360);
    expect(gap.l1CursorOnL2).toBe(19000000);
    expect(gap.gap).toBe(360); // 6분 정도의 지연 (15초/블록 × 24블록)
  });
});
```

---

### 7.4 시나리오 S-CROSS-04: ZK Stack + Besu L1 — Proof 상태와 L1 확인

```typescript
describe('S-CROSS-04: ZK Stack + Besu L1 Proof 검증', () => {
  it('L1에서 proof 트랜잭션 확인 후 finalized 상태로 업데이트해야 한다', async () => {
    // Besu L1: proof tx가 포함된 블록 반환
    const besuMock = mockRpcFetch({
      'web3_clientVersion': 'besu/v24.12.0/linux-x86_64/openjdk-java-21',
      'eth_getTransactionReceipt': {
        blockNumber: '0x1215918',
        status: '0x1',              // 성공
        transactionHash: '0xprove',
        logs: [{ /* ProofVerified event */ }],
      },
    });

    // ZK Stack: proof pending 상태
    const zkMock = mockRpcFetch({
      'zks_getL1BatchDetails': {
        number: 5000,
        status: 'proven',
        proveTxHash: '0xprove',
        executeTxHash: null,        // 아직 execute 안 됨
      },
    });

    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (url.includes('besu')) return besuMock(url, init);
      return zkMock(url, init);
    });

    const status = await getBatchFinalityStatus(5000, {
      l1RpcUrl: 'http://besu-l1:8545',
      l2RpcUrl: 'http://zksync-l2:3050',
    });

    expect(status.l1Confirmed).toBe(true);
    expect(status.finalized).toBe(false); // execute 아직 안 됨
    expect(status.pendingStep).toBe('execute');
  });
});
```

---

## 8. 공통 검증 체크리스트

### 신규 L2 체인 플러그인 검증

새 체인 플러그인을 추가할 때 다음을 모두 확인합니다:

```typescript
// src/lib/__tests__/new-chain-plugin-validation.test.ts
describe('체인 플러그인 공통 검증 체크리스트', () => {
  const CHAINS = ['thanos', 'optimism', 'arbitrum', 'zkstack'];

  CHAINS.forEach(chainType => {
    describe(`${chainType} 체인 검증`, () => {
      let plugin: ChainPlugin;

      beforeEach(() => {
        plugin = getChainPlugin(chainType);
      });

      // ✅ 1. 기본 속성
      it('chainType과 displayName이 있어야 한다', () => {
        expect(plugin.chainType).toBeTruthy();
        expect(plugin.displayName).toBeTruthy();
      });

      // ✅ 2. 컴포넌트 목록
      it('최소 1개의 컴포넌트가 있어야 한다', () => {
        expect(plugin.components.length).toBeGreaterThan(0);
      });

      // ✅ 3. 의존성 그래프 일관성
      it('모든 컴포넌트가 의존성 그래프에 존재해야 한다', () => {
        const allComponents = [...plugin.components, ...plugin.metaComponents];
        for (const comp of Object.keys(plugin.dependencyGraph)) {
          expect(allComponents).toContain(comp);
        }
      });

      // ✅ 4. 순환 의존성 없음
      it('의존성 그래프에 순환이 없어야 한다', () => {
        const visited = new Set<string>();
        const path = new Set<string>();

        function dfs(node: string): boolean {
          if (path.has(node)) return true;
          if (visited.has(node)) return false;
          path.add(node);
          visited.add(node);
          const deps = plugin.dependencyGraph[node]?.dependsOn ?? [];
          for (const dep of deps) {
            if (dfs(dep)) return true;
          }
          path.delete(node);
          return false;
        }

        const allNodes = [...plugin.components, ...plugin.metaComponents];
        for (const node of allNodes) {
          expect(dfs(node)).toBe(false);
        }
      });

      // ✅ 5. 양방향 참조 일관성
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

      // ✅ 6. AI 프롬프트 존재
      it('AI 프롬프트가 정의되어야 한다', () => {
        expect(plugin.aiPrompts.systemContext).toBeTruthy();
        expect(plugin.aiPrompts.componentDescriptions).toBeTruthy();
      });

      // ✅ 7. K8s 설정 존재
      it('K8s 설정이 정의되어야 한다', () => {
        expect(plugin.k8sConfigs).toBeDefined();
        expect(plugin.k8sConfigs.appLabelPrefix).toBeTruthy();
      });

      // ✅ 8. Playbook 존재
      it('기본 플레이북이 정의되어야 한다', () => {
        expect(plugin.playbooks.length).toBeGreaterThan(0);
      });
    });
  });
});
```

### API 엔드포인트 검증

```typescript
describe('API 엔드포인트 공통 검증', () => {
  const ENDPOINTS = [
    '/api/metrics',
    '/api/anomalies',
    '/api/scaler',
    '/api/health',
  ];

  ENDPOINTS.forEach(endpoint => {
    it(`${endpoint}가 200을 반환해야 한다`, async () => {
      const response = await fetch(endpoint);
      expect(response.status).toBe(200);
    });

    it(`${endpoint} 응답이 JSON이어야 한다`, async () => {
      const response = await fetch(endpoint);
      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('application/json');
    });
  });
});
```

---

## 9. 트러블슈팅 가이드

### 문제: 클라이언트 감지 실패

**증상**: `detectExecutionClient` 결과에서 `family: 'unknown'`

**원인 및 해결**:

| 원인 | 확인 방법 | 해결 |
|------|-----------|------|
| `web3_clientVersion` 미지원 | `curl -X POST -d '{"method":"web3_clientVersion"}' <rpc>` | `SENTINAI_CLIENT_FAMILY` 환경변수로 수동 설정 |
| RPC 방화벽 차단 | `curl` 응답 코드 확인 | RPC 포트 허용 및 CORS 설정 |
| 새로운 클라이언트 버전 | 버전 문자열 형식 확인 | `src/lib/client-detector.ts`에 패턴 추가 |

```bash
# 수동 오버라이드 예시 (Besu가 감지 안 될 때)
SENTINAI_CLIENT_FAMILY=besu
SENTINAI_OVERRIDE_TXPOOL_METHOD=txpool_status
```

---

### 문제: Nethermind TxPool 수집 실패

**증상**: `txpool_status method not found` 오류

**원인**: Nethermind는 `parity_pendingTransactions` 사용

```bash
# 해결 방법
SENTINAI_OVERRIDE_TXPOOL_METHOD=parity_pendingTransactions
SENTINAI_OVERRIDE_TXPOOL_PARSER=parity
```

---

### 문제: ZK Proof 지연 알림 오발송

**증상**: proof 생성이 정상인데도 지연 알림 발송

**원인**: 알림 임계값이 너무 낮게 설정됨 (ZK proof는 30분~1시간 소요가 정상)

```bash
# ZK Stack 전용 임계값 조정
ZKSTACK_PROOF_DELAY_WARNING_MS=3600000    # 1시간 후 warning (기본 30분)
ZKSTACK_PROOF_DELAY_CRITICAL_MS=7200000   # 2시간 후 critical (기본 1시간)
```

---

### 문제: L1 RPC Failover 후 K8s env 미업데이트

**증상**: `op-node`가 여전히 다운된 L1 엔드포인트를 사용

**원인**: `L1_PROXYD_ENABLED=false` 또는 K8s 권한 없음

```bash
# Proxyd ConfigMap 업데이트 활성화
L1_PROXYD_ENABLED=true
# K8s ServiceAccount에 ConfigMap 편집 권한 필요
kubectl create rolebinding sentinai-configmap-edit \
  --clusterrole=admin \
  --serviceaccount=default:sentinai
```

---

### 클라이언트별 알려진 제한사항

| 클라이언트 | 제한사항 | 권장 우회 방법 |
|------------|----------|----------------|
| **Nethermind** | `txpool_status` 미지원 | `parity_pendingTransactions` 사용 |
| **Besu** | enterprise 모드에서 `net_peerCount` 비활성화 가능 | `SENTINAI_CAPABILITY_PEER_COUNT=false` |
| **Reth** (초기) | `debug_*` 네임스페이스 불완전 | `SENTINAI_CAPABILITY_DEBUG=false` |
| **Besu** | ZK Stack L1으로 미검증 | 커뮤니티 피드백 모집 중 |

---

> 문서 최종 업데이트: 2026-03-10
> 관련 가이드: [architecture.md](../architecture.md) | [arbitrum-orbit-local-setup.md](../arbitrum-orbit-local-setup.md) | [optimism-l2-sentinai-local-setup.md](../optimism-l2-sentinai-local-setup.md)
