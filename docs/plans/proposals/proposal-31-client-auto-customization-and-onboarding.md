# Proposal 31: EVM Client Customization Framework

> Date: 2026-02-27 (revised 2026-03-08 v2)
> Owner: SentinAI Core
> Scope: 모든 EVM EL 클라이언트를 코드 수정 없이 env var만으로 연동 가능하게 만드는 커스터마이징 프레임워크
> Out of scope: CL (Consensus Layer / Beacon Node), Engine API (JWT 인증 내부 통신)

---

## 1) 핵심 철학

> **"어떤 EVM 클라이언트를 연동하더라도 SentinAI 코드를 수정하지 않고 env var 설정만으로 완전히 동작해야 한다."**

SentinAI는 지금까지 ChainPlugin 시스템으로 체인 스택별(thanos, arbitrum, zkstack 등) 동작을 추상화했다.
그러나 같은 OP Stack이라도 geth를 쓰느냐 reth를 쓰느냐에 따라 RPC 메서드, 응답 구조, txpool 네임스페이스가 다르다.
또한 커스텀 포크, 사내 클라이언트, 아직 지원하지 않는 새 클라이언트를 연동할 때마다 코드를 수정해야 한다면 확장성이 없다.

이 제안의 목표는 두 가지다:

1. **ClientProfile 시스템**: SentinAI가 EL 클라이언트와 상호작용하는 모든 방식(RPC 메서드, 응답 파싱, capability 판단)을 Profile 단위로 추상화한다.
2. **Env var 완전 제어**: 어떤 Profile 필드도 env var로 덮어쓸 수 있다. 알 수 없는 클라이언트도 env var만으로 완전한 연동이 가능하다.

Auto-detection은 편의 기능이다. 실패해도 env var로 전부 구성할 수 있어야 한다.

---

## 2) 현재 상태 및 Gap

### 2.1 기존 ChainPlugin의 범위

`src/chains/types.ts`의 `ChainPlugin` 인터페이스는 다음을 담당한다:

- 컴포넌트 토폴로지 (`components`, `dependencyGraph`)
- K8s 설정 (`k8sComponents`)
- EOA 역할 (`eoaRoles`, `eoaConfigs`)
- AI 프롬프트 (`aiPrompts`)
- 자율화 인텐트 (`getSupportedIntents`, `translateIntentToActions`)

ChainPlugin은 **체인 스택 레벨**의 추상화다. 그러나 **EL 클라이언트 레벨**의 동작(RPC 메서드 선택, 응답 파싱)은 코드 내에 흩어져 있거나 특정 클라이언트를 암묵적으로 가정하고 있다.

### 2.2 핵심 Gap

| Gap | 현재 상태 | 목표 |
|-----|-----------|------|
| txpool 메서드 | `txpool_status` 하드코딩 | env var로 메서드 지정 가능 |
| eth_syncing 파싱 | 단일 파서 | 클라이언트별 파서 선택 가능 |
| L2 동기화 확인 | `optimism_syncStatus` 하드코딩 | env var로 메서드 지정 |
| 피어 카운트 | `net_peerCount` 하드코딩 | fallback 순서 env var 설정 |
| 알 수 없는 클라이언트 | 연동 불가 | env var 완전 구성으로 동작 |
| 커스텀 메트릭 | 코드 수정 필요 | env var로 임의 RPC 메서드 → 메트릭 추가 |
| 컴포넌트 토폴로지 | ChainPlugin 코드 | env var JSON으로 동적 정의 |

---

## 3) ClientProfile 시스템

### 3.1 개념

`ClientProfile`은 SentinAI가 특정 EL 클라이언트와 상호작용하는 모든 방식을 기술하는 설정 객체다.

```typescript
// src/lib/client-profile/types.ts

export interface RpcMethodConfig {
  method: string;
  params?: unknown[];
  /** 응답에서 값을 추출하는 경로 (점 표기법, 예: "result.pending") */
  responsePath?: string;
  /** 값이 없거나 메서드 미지원 시 반환할 기본값 */
  fallback?: unknown;
}

export interface SyncStatusParser {
  type: 'standard' | 'nethermind' | 'op-geth' | 'nitro' | 'custom';
  /**
   * type: 'custom'일 때만 사용.
   * 응답 객체에서 currentBlock, highestBlock, isSyncing을 추출하는 경로
   */
  currentBlockPath?: string;
  highestBlockPath?: string;
  isSyncingPath?: string;
}

export interface ClientProfile {
  /** 클라이언트 식별자 (자동 감지 또는 env var로 지정) */
  clientFamily: string;

  /** RPC 메서드 설정 */
  methods: {
    blockNumber: RpcMethodConfig;
    syncStatus: RpcMethodConfig;
    txPool: RpcMethodConfig | null;         // null = 미지원
    peerCount: RpcMethodConfig | null;      // null = 미지원
    l2SyncStatus: RpcMethodConfig | null;   // null = L1 또는 L2 비특정
    gasPrice: RpcMethodConfig;
    chainId: RpcMethodConfig;
  };

  /** 응답 파싱 전략 */
  parsers: {
    syncStatus: SyncStatusParser;
    txPool: 'txpool' | 'parity' | 'custom' | null;
  };

  /** 이 Profile에서 지원되는 기능 */
  capabilities: {
    supportsTxPool: boolean;
    supportsPeerCount: boolean;
    supportsL2SyncStatus: boolean;
    supportsDebugNamespace: boolean;
  };

  /** Agent Loop에서 사용할 커스텀 메트릭 목록 */
  customMetrics: CustomMetricConfig[];
}

export interface CustomMetricConfig {
  name: string;                 // 내부 메트릭 이름 (예: 'sequencerQueueDepth')
  displayName: string;          // 대시보드 표시명
  method: string;               // RPC 메서드명
  params?: unknown[];
  responsePath: string;         // 응답에서 값 추출 경로
  unit?: string;                // 단위 표시 (예: 'ms', 'txs')
}
```

### 3.2 내장 Profile (Built-in Profiles)

알려진 클라이언트에 대한 Profile을 사전 정의한다. Auto-detection 성공 시 자동으로 로드된다.

```typescript
// src/lib/client-profile/builtin-profiles.ts

export const BUILTIN_PROFILES: Record<string, ClientProfile> = {

  'geth': {
    clientFamily: 'geth',
    methods: {
      blockNumber:   { method: 'eth_blockNumber' },
      syncStatus:    { method: 'eth_syncing' },
      txPool:        { method: 'txpool_status' },
      peerCount:     { method: 'net_peerCount' },
      l2SyncStatus:  null,
      gasPrice:      { method: 'eth_gasPrice' },
      chainId:       { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,  // opt-in
    },
    customMetrics: [],
  },

  'reth': {
    clientFamily: 'reth',
    methods: {
      blockNumber:   { method: 'eth_blockNumber' },
      syncStatus:    { method: 'eth_syncing' },
      txPool:        { method: 'txpool_status' },
      peerCount:     { method: 'net_peerCount' },
      l2SyncStatus:  null,
      gasPrice:      { method: 'eth_gasPrice' },
      chainId:       { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  'nethermind': {
    clientFamily: 'nethermind',
    methods: {
      blockNumber:   { method: 'eth_blockNumber' },
      syncStatus:    { method: 'eth_syncing' },
      // parity_* 네임스페이스 사용
      txPool:        { method: 'parity_pendingTransactions', responsePath: 'result.length' },
      peerCount:     { method: 'net_peerCount' },
      l2SyncStatus:  null,
      gasPrice:      { method: 'eth_gasPrice' },
      chainId:       { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'nethermind' },
      txPool: 'parity',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  'op-geth': {
    clientFamily: 'op-geth',
    methods: {
      blockNumber:   { method: 'eth_blockNumber' },
      syncStatus:    { method: 'eth_syncing' },
      txPool:        { method: 'txpool_status' },
      peerCount:     { method: 'net_peerCount' },
      // OP Stack 전용 L2 동기화 상태
      l2SyncStatus:  { method: 'optimism_syncStatus' },
      gasPrice:      { method: 'eth_gasPrice' },
      chainId:       { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'op-geth' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: true,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  'nitro-node': {
    clientFamily: 'nitro-node',
    methods: {
      blockNumber:   { method: 'eth_blockNumber' },
      syncStatus:    { method: 'eth_syncing' },
      txPool:        { method: 'txpool_status' },
      peerCount:     { method: 'net_peerCount' },
      // Arbitrum Nitro 전용
      l2SyncStatus:  { method: 'arb_getL1BlockNumber' },
      gasPrice:      { method: 'eth_gasPrice' },
      chainId:       { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'nitro' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: true,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

};
```

### 3.3 Profile 로딩 우선순위

```
1. SENTINAI_CLIENT_FAMILY env var 지정 → 해당 built-in profile 로드 (auto-detection 건너뜀)
2. Auto-detection 성공 → 감지된 clientFamily의 built-in profile 로드
3. Auto-detection 실패 → 'unknown' 부분 지원 모드 (표준 eth_* 메서드만 사용)
4. 어떤 경우든: SENTINAI_OVERRIDE_* env var가 존재하면 해당 필드를 덮어씀
```

---

## 4) Env Var 완전 제어 스펙

> **설계 원칙**: Profile의 모든 필드는 env var로 덮어쓸 수 있다.
> 알 수 없는 커스텀 클라이언트도 아래 env var만으로 SentinAI와 완전히 연동할 수 있어야 한다.

### 4.1 클라이언트 식별

```bash
# auto-detection을 건너뛰고 profile을 직접 지정
SENTINAI_CLIENT_FAMILY=nethermind        # geth | reth | nethermind | besu | erigon | op-geth | nitro-node | custom

# 'custom'으로 지정 시 아래 override로 모든 동작을 직접 정의
SENTINAI_CLIENT_FAMILY=custom
SENTINAI_CLIENT_DISPLAY_NAME="MyChain Execution Client v2.0"
```

### 4.2 RPC 메서드 오버라이드

```bash
# 블록 높이
SENTINAI_OVERRIDE_BLOCK_NUMBER_METHOD=eth_blockNumber

# 동기화 상태
SENTINAI_OVERRIDE_SYNC_STATUS_METHOD=eth_syncing
# 응답 파서 선택: standard | nethermind | op-geth | nitro | custom
SENTINAI_OVERRIDE_SYNC_STATUS_PARSER=standard
# custom 파서일 때 응답 필드 경로 지정 (점 표기법)
SENTINAI_OVERRIDE_SYNC_CURRENT_BLOCK_PATH=result.currentBlock
SENTINAI_OVERRIDE_SYNC_HIGHEST_BLOCK_PATH=result.highestBlock
SENTINAI_OVERRIDE_SYNC_IS_SYNCING_PATH=result.syncing

# L2 전용 동기화 상태 (없으면 L1 모드)
SENTINAI_OVERRIDE_L2_SYNC_METHOD=optimism_syncStatus
SENTINAI_OVERRIDE_L2_SYNC_SAFE_BLOCK_PATH=result.safe_l2.number
SENTINAI_OVERRIDE_L2_SYNC_L1_REF_BLOCK_PATH=result.current_l1.number

# txpool
SENTINAI_OVERRIDE_TXPOOL_METHOD=parity_pendingTransactions
SENTINAI_OVERRIDE_TXPOOL_PARSER=parity           # txpool | parity | custom
SENTINAI_OVERRIDE_TXPOOL_COUNT_PATH=result.length # custom 파서일 때 카운트 경로

# 피어 카운트
SENTINAI_OVERRIDE_PEER_COUNT_METHOD=net_peerCount
SENTINAI_OVERRIDE_PEER_COUNT_PATH=result          # 응답에서 숫자 추출 경로

# 가스 가격
SENTINAI_OVERRIDE_GAS_PRICE_METHOD=eth_gasPrice
```

### 4.3 Capability 명시적 지정

Auto-detection 결과를 무시하고 capability를 직접 선언한다.

```bash
SENTINAI_CAPABILITY_TXPOOL=true
SENTINAI_CAPABILITY_PEER_COUNT=true
SENTINAI_CAPABILITY_L2_SYNC=true
SENTINAI_CAPABILITY_DEBUG_NAMESPACE=false
```

### 4.4 커스텀 메트릭 (임의 RPC → 대시보드 메트릭)

인덱스(1~10)를 사용해 임의의 RPC 메서드를 메트릭으로 추가할 수 있다.
SentinAI 코드를 건드리지 않고 클라이언트 전용 데이터를 대시보드에 노출한다.

```bash
# 커스텀 메트릭 1: 시퀀서 큐 깊이 (예: 커스텀 L2 클라이언트)
SENTINAI_CUSTOM_METRIC_1_NAME=sequencerQueueDepth
SENTINAI_CUSTOM_METRIC_1_DISPLAY=Sequencer Queue
SENTINAI_CUSTOM_METRIC_1_METHOD=sequencer_queueDepth
SENTINAI_CUSTOM_METRIC_1_PARAMS=[]
SENTINAI_CUSTOM_METRIC_1_PATH=result.depth
SENTINAI_CUSTOM_METRIC_1_UNIT=txs

# 커스텀 메트릭 2: 배치 제출 대기 시간 (예: 커스텀 batcher)
SENTINAI_CUSTOM_METRIC_2_NAME=batchSubmitLatency
SENTINAI_CUSTOM_METRIC_2_DISPLAY=Batch Submit Latency
SENTINAI_CUSTOM_METRIC_2_METHOD=batcher_submissionLatency
SENTINAI_CUSTOM_METRIC_2_PATH=result.latencyMs
SENTINAI_CUSTOM_METRIC_2_UNIT=ms

# 최대 10개까지 정의 가능 (SENTINAI_CUSTOM_METRIC_1 ~ SENTINAI_CUSTOM_METRIC_10)
```

### 4.5 컴포넌트 토폴로지 오버라이드

기존 ChainPlugin의 컴포넌트 설정을 env var JSON으로 덮어쓸 수 있다.
완전히 새로운 L2 아키텍처도 코드 없이 정의 가능하다.

```bash
# 컴포넌트 목록
SENTINAI_COMPONENTS=execution,sequencer,batcher,proposer

# 의존 관계 (JSON 인코딩)
SENTINAI_COMPONENT_DEPS='{"execution":{"dependsOn":["l1"],"feeds":["sequencer","batcher","proposer"]},"sequencer":{"dependsOn":["execution"],"feeds":[]},"batcher":{"dependsOn":["execution"],"feeds":["l1"]},"proposer":{"dependsOn":["execution"],"feeds":["l1"]}}'

# K8s 레이블 셀렉터 (컴포넌트별)
SENTINAI_K8S_LABEL_execution=app=my-execution-client
SENTINAI_K8S_LABEL_sequencer=app=my-sequencer
SENTINAI_K8S_LABEL_batcher=app=my-batcher
SENTINAI_K8S_LABEL_proposer=app=my-proposer

# EOA 역할
SENTINAI_EOA_ROLES=batcher,proposer
SENTINAI_EOA_ADDRESS_batcher=0xABC...
SENTINAI_EOA_ADDRESS_proposer=0xDEF...
```

### 4.6 이상 탐지 임계값

```bash
# 블록 정체 감지 (초)
SENTINAI_THRESHOLD_BLOCK_PLATEAU_SECONDS=30

# Z-Score 이상 임계값
SENTINAI_THRESHOLD_ZSCORE=3.0

# txpool 위험 임계값 (tx 수)
SENTINAI_THRESHOLD_TXPOOL_DANGER=5000

# 가스 사용률 경고 임계값 (%)
SENTINAI_THRESHOLD_GAS_RATIO_WARN=0.9
```

### 4.7 완전 커스텀 클라이언트 예시 (unknown client)

기존에 없는 완전히 새로운 L2 클라이언트를 env var만으로 연동하는 예시:

```bash
# 새로운 커스텀 L2 클라이언트 연동 - 코드 수정 없음
L2_RPC_URL=http://my-custom-l2-client:8545

SENTINAI_CLIENT_FAMILY=custom
SENTINAI_CLIENT_DISPLAY_NAME="MyChain v1.0 Execution Client"

# 표준 EVM 메서드는 기본값 사용, 커스텀 부분만 오버라이드
SENTINAI_OVERRIDE_TXPOOL_METHOD=mychain_pendingTxCount
SENTINAI_OVERRIDE_TXPOOL_PARSER=custom
SENTINAI_OVERRIDE_TXPOOL_COUNT_PATH=result.pending

SENTINAI_OVERRIDE_L2_SYNC_METHOD=mychain_l2SyncStatus
SENTINAI_OVERRIDE_L2_SYNC_SAFE_BLOCK_PATH=result.safeBlock
SENTINAI_OVERRIDE_L2_SYNC_L1_REF_BLOCK_PATH=result.l1RefBlock

SENTINAI_CAPABILITY_TXPOOL=true
SENTINAI_CAPABILITY_L2_SYNC=true

SENTINAI_CUSTOM_METRIC_1_NAME=proofGenTime
SENTINAI_CUSTOM_METRIC_1_DISPLAY=Proof Generation Time
SENTINAI_CUSTOM_METRIC_1_METHOD=mychain_proofGenerationLatency
SENTINAI_CUSTOM_METRIC_1_PATH=result.avgMs
SENTINAI_CUSTOM_METRIC_1_UNIT=ms

SENTINAI_COMPONENTS=execution,prover,sequencer
SENTINAI_COMPONENT_DEPS='{"execution":{"dependsOn":["l1"],"feeds":["sequencer","prover"]},"prover":{"dependsOn":["execution"],"feeds":["l1"]},"sequencer":{"dependsOn":["execution"],"feeds":[]}}'
```

---

## 5) Auto-Detection (편의 기능)

Auto-detection은 env var 설정 부담을 줄이기 위한 편의 기능이다.
**실패해도 서비스가 부분 지원 모드로 동작해야 한다.**

### 5.1 감지 순서

```
1. web3_clientVersion           → clientFamily 1차 분류
2. L2 fingerprint probe         → nitro/op-geth 재분류 (false positive 방지)
   - arb_blockNumber 성공 → 'nitro-node'
   - optimism_syncStatus 성공 → 'op-geth'
3. built-in profile 로드
4. SENTINAI_OVERRIDE_* env var 적용 (built-in 위에 덮어씀)
```

### 5.2 `web3_clientVersion` 파싱

| 클라이언트 | 응답 예시 | 파싱 결과 |
|------------|-----------|-----------|
| geth | `Geth/v1.13.14-stable/linux-amd64/go1.21.7` | `geth` |
| reth | `reth/v1.2.0/x86_64-unknown-linux-gnu` | `reth` |
| nethermind | `Nethermind/v1.25.3+...` | `nethermind` |
| besu | `besu/v24.3.0/linux-x86_64/...` | `besu` |
| erigon | `erigon/v2.59.0/linux-amd64/go1.21` | `erigon` |
| op-geth | `op-geth/v1.101315.3-stable/...` | `op-geth` |
| nitro-node | `Geth/v1.11.x/...` (**주의: geth로 오감지**) | → 2단계 재분류 |

> nitro-node는 1단계에서 `geth`로 오감지된다. 2단계 fingerprint probe에서만 정확히 구분할 수 있다.

### 5.3 `eth_syncing` 응답 정규화

모든 파서는 동일한 `NormalizedSyncStatus`로 출력한다.

```typescript
export interface NormalizedSyncStatus {
  isSyncing: boolean;
  currentBlock: number | null;
  highestBlock: number | null;
  l2SafeBlock?: number | null;    // op-geth, nitro-node
  l1ReferenceBlock?: number | null;
}
```

| 파서 타입 | 대상 클라이언트 | 파싱 전략 |
|-----------|----------------|-----------|
| `standard` | geth, reth, besu | `false` → 완료, object → `{currentBlock, highestBlock}` |
| `nethermind` | nethermind | `{currentBlockNumber, highestBlockNumber, isSyncing}` 필드명 매핑 |
| `op-geth` | op-geth | standard + `optimism_syncStatus` 병합 |
| `nitro` | nitro-node | standard + `arb_getL1BlockNumber` 병합 |
| `custom` | 커스텀 클라이언트 | env var로 지정한 경로에서 필드 추출 |

### 5.4 `admin_peers` 정책

`admin_peers`는 **optional probe**로만 사용한다. 의존하지 않는다.

- 프로덕션 노드 대부분은 admin 네임스페이스를 비활성화한다.
- `admin_peers` 성공 → `supportsAdminPeers: true` 기록
- 실패 시 → `net_peerCount` fallback
- 둘 다 실패 → `supportsPeerCount: false`, 피어 카운트 카드 비활성화

---

## 6) Capability 두 레이어 통합

기존 `ChainCapabilities` (stack-level)와 이 제안의 `DetectedCapabilities` (runtime-level)은 역할이 다르다.
두 레이어를 AND 조건으로 결합해 최종 `ResolvedFeatures`를 생성한다.

```typescript
// stack-level (src/chains/types.ts, 기존)
// 이 체인 스택이 특정 기능을 지원하는가 (빌드 타임 결정)
ChainCapabilities.eoaBalanceMonitoring  // EOA 모니터링 지원 여부
ChainCapabilities.autonomousActions     // 자율화 액션 목록

// runtime-level (이 제안, 신규)
// 이 특정 노드 설정이 기능을 실제로 노출하는가 (런타임 결정)
DetectedCapabilities.supportsTxPool
DetectedCapabilities.supportsPeerCount

// 결합 결과
ResolvedFeatures.txpoolMonitoring = stack.eoaBalanceMonitoring && runtime.supportsTxPool
ResolvedFeatures.peerMonitoring   = runtime.supportsPeerCount
```

---

## 7) Instance Control Plane

### 7.1 NodeInstance 저장소

```typescript
export interface NodeInstance {
  instanceId: string;
  nodeType: 'l1-el' | 'l2-el';
  protocolId: string;           // 연결된 ChainPlugin ID
  connectionConfig: {
    rpcUrl: string;
    authType: 'none' | 'bearer' | 'basic';
  };
  clientProfile: ClientProfile; // 감지 or env var로 구성된 최종 profile
  policyProfile: PolicyProfile;
  createdAt: string;
  lastDetectedAt: string;
  lastClientVersion: string;    // 업그레이드 감지용
}
```

Redis namespace: `inst:{id}:meta`, `inst:{id}:metrics:*`, `inst:{id}:anomaly:*`, `inst:{id}:agent:*`

### 7.2 API v2

```
POST   /api/v2/instances                    — 환경변수 기반 인스턴스 자동 생성
POST   /api/v2/instances/{id}/validate      — RPC 연결 + ClientProfile 재구성
GET    /api/v2/instances/{id}/capabilities  — DetectedCapabilities + ResolvedFeatures
GET    /api/v2/instances/{id}/profile       — 현재 활성 ClientProfile (어떤 메서드를 쓰는지)
PATCH  /api/v2/instances/{id}/policy        — 자율화 수준 승격
POST   /api/v2/instances/{id}/bootstrap     — 에이전트 연결 + 대시보드 카드 초기화
POST   /api/v2/onboarding/complete          — detect → profile 구성 → register → bootstrap
GET    /api/subscription/status             — 티어, 체험 종료일, Premium 기능 목록
```

### 7.3 First-Run Bootstrap

- docker run 후 대시보드 최초 접속 시 `/api/v2/onboarding/complete` 내부 자동 호출
- 처리 순서: env var 읽기 → ClientProfile 구성 → auto-detection (SENTINAI_CLIENT_FAMILY 없을 때) → OVERRIDE 적용 → NodeInstance 생성 → ResolvedFeatures 생성 → 대시보드 카드 초기화
- 응답: `instanceId`, `dashboardUrl`, `clientProfile`, `resolvedFeatures`, `nextActions`
- 이미 등록된 경우 멱등 처리

### 7.4 Policy + Safety Binding

- 기본 정책: `observe-only`
- 승격 경로: `plan-only` → `execute-with-approval` → `full-auto`
- 모든 write 액션: `operationId` + post-verify + rollback hook 필수

---

## 8) 온보딩 이후 활용 시나리오

`ClientProfile`과 `ResolvedFeatures`는 온보딩 이후 에이전트 루프 전반에서 활용된다.

### 시나리오 A: 플레이북 자동 선택

```
인시던트 발생 → RCA 실행
→ playbook-matcher가 clientProfile.clientFamily 확인
→ 'nitro-node': arb_* 메서드 기반 복구 플레이북 선택
→ resolvedFeatures.txpoolMonitoring: false (nethermind, parity_* 비활성)
  → txpool 기반 플레이북 제외
```

### 시나리오 B: NLOps 행동 제한

```
"트랜잭션 풀 현황 알려줘"
→ nlops-engine이 resolvedFeatures.txpoolMonitoring 확인
→ true: clientProfile.methods.txPool.method로 RPC 호출
→ false: "이 노드 설정에서는 txpool 데이터를 수집할 수 없습니다" 응답
```

### 시나리오 C: 클라이언트 업그레이드 자동 감지

```
Agent Loop: clientVersion 변경 감지
→ 이전 "reth/v1.0.8" → 현재 "reth/v1.2.0"
→ 재감지 트리거 → 새 Profile 적용 → 대시보드 알림
```

### 시나리오 D: 부분 지원 모드 (감지 실패)

```
web3_clientVersion 미노출 (로드밸런서, 프록시 등)
→ clientFamily: 'unknown'
→ 표준 eth_* 메서드만 사용 (eth_blockNumber, eth_chainId, eth_syncing)
→ 대시보드: "클라이언트를 감지할 수 없습니다. 기본 모니터링 모드로 실행 중입니다."
→ 사용자가 SENTINAI_CLIENT_FAMILY=geth 설정 시 full capability 활성화
```

### 시나리오 E: 커스텀 메트릭 실시간 수집

```
SENTINAI_CUSTOM_METRIC_1_METHOD=mychain_proofGenerationLatency 설정
→ Agent Loop이 매 30초마다 해당 RPC 호출
→ SENTINAI_CUSTOM_METRIC_1_PATH=result.avgMs에서 값 추출
→ 대시보드에 "Proof Generation Time" 카드로 표시
→ 이상 탐지 파이프라인에 메트릭 자동 등록 (Z-Score 적용)
```

---

## 9) Self-Hosted Tier 모델 (Honor System)

> SentinAI는 self-hosted이며 사용자가 서버 코드와 LLM API 키를 모두 보유한다.
> 기술적 강제(feature gate throw)는 코드 한 줄 수정으로 우회 가능하다.
> 실질적 가치는 맞춤 설정 서비스와 팀 동행이며, 이는 계약으로 보호된다.

| 티어 | 가격 | 내용 |
|------|------|------|
| General | 무료 | self-hosted, 모든 기능 사용 가능, 커뮤니티 지원 (GitHub Issues) |
| Premium | $299/체인/월 | 맞춤 설정 + 팀 동행 (90일 무료 체험) |
| Enterprise | 협의 | 전담 엔지니어, 커스텀 개발, NDA, 다중 체인 할인 |

Premium 상세:
- **[맞춤 설정]** 커스텀 ClientProfile 작성 — 운영 환경 특화 메서드/파서 SentinAI 팀이 직접 구성
- **[맞춤 설정]** 커스텀 플레이북 작성 + 이상 탐지 임계값 튜닝
- **[팀 동행]** 전용 Slack 채널, 인시던트 co-response, 월 1회 운영 리뷰
- **[우선 접근]** 신규 EL 클라이언트 built-in profile 우선 지원

---

## 10) 6-Week Execution Plan

### Week 1: ClientProfile 코어 + Built-in Profiles

1. `ClientProfile`, `RpcMethodConfig`, `SyncStatusParser`, `CustomMetricConfig` 타입 정의
2. Built-in profiles 구현 (geth, reth, nethermind, op-geth, nitro-node)
3. `web3_clientVersion` 파싱 모듈 + L2 fingerprint probe
4. `eth_syncing` 정규화 모듈 (5개 파서 타입)
5. 단위 테스트: 클라이언트별 mock 응답 → 올바른 Profile 로드 확인

### Week 2: Env Var 오버라이드 레이어

1. `SENTINAI_CLIENT_FAMILY` → built-in profile 로드 로직
2. `SENTINAI_OVERRIDE_*` env var → Profile 필드 덮어쓰기 로직
3. `SENTINAI_CAPABILITY_*` env var → DetectedCapabilities 명시적 지정
4. `SENTINAI_CUSTOM_METRIC_1~10` env var → CustomMetricConfig 파싱 + 등록
5. `SENTINAI_COMPONENTS` + `SENTINAI_COMPONENT_DEPS` env var → 토폴로지 오버라이드
6. 단위 테스트: unknown 클라이언트를 env var만으로 완전 구성하는 케이스

### Week 3: NodeInstance + API v2 + Policy Binding

1. `NodeInstance` 타입 및 Redis 저장소 구현
2. `POST /api/v2/instances/validate` (ClientProfile 구성 + RPC 연결 확인)
3. `GET /api/v2/instances/{id}/profile` (활성 ClientProfile 반환)
4. `ResolvedFeatures` 결합 로직 (ChainCapabilities × DetectedCapabilities)
5. `observe-only` 기본 정책 + 승격 경로 구현
6. `POST /api/v2/onboarding/complete` 전체 시퀀스 구현

### Week 4: Dashboard 통합 + 커스텀 메트릭 표시

1. First-Run Bootstrap → ResolvedFeatures 기반 대시보드 카드 자동 활성화/비활성화
2. `SENTINAI_CUSTOM_METRIC_*` 메트릭 → 대시보드 카드 동적 렌더링
3. Agent Loop에 커스텀 메트릭 수집 + 이상 탐지 자동 등록
4. `clientVersion` 변경 감지 → 재감지 트리거
5. 부분 지원 모드 UX (clientFamily: 'unknown' 상태)

### Week 5: 통합 테스트 (4 클라이언트 + custom)

1. geth (L1) 전체 플로우
2. reth (L1) 전체 플로우
3. op-geth (L2, OP Stack) 전체 플로우
4. nitro-node (L2, Arbitrum) 전체 플로우
5. **custom 클라이언트**: env var만으로 구성 → 커스텀 메트릭 수집 → 이상 탐지 동작
6. nethermind: parity_* fallback + ResolvedFeatures 확인
7. Connect 마법사 (랜딩): docker run 명령어 + .env.local 렌더링

### Week 6: Hardening + Docs + Rollout

1. 에러 분류 정비 (인증 실패 / 네트워크 차단 / 메서드 미지원 / 부분 지원 모드)
2. 보안 검토 (credential storage, mask, rotation)
3. Env var 완전 레퍼런스 문서 (`ENV_GUIDE.md` 통합)
4. self-hosted 설치 가이드 업데이트 (커스텀 클라이언트 연동 예시 포함)
5. `/api/subscription/status` + feature nudge 배너

---

## 11) Acceptance Criteria (DoD)

1. 다음 5가지 시나리오에서 온보딩이 10분 내 완료된다:
   - geth (L1)
   - reth (L1)
   - op-geth (L2, OP Stack)
   - nitro-node (L2, Arbitrum)
   - **unknown 커스텀 클라이언트 (env var만으로 구성)**
2. `SENTINAI_CLIENT_FAMILY=custom` + `SENTINAI_OVERRIDE_*` 설정만으로 built-in profile 없는 클라이언트가 완전히 동작한다.
3. `SENTINAI_CUSTOM_METRIC_1_*` 설정으로 추가한 메트릭이 대시보드에 표시되고 이상 탐지에 자동 등록된다.
4. nethermind는 `parity_*` fallback을 통해 txpool 데이터를 수집한다.
5. `GET /api/v2/instances/{id}/profile`이 현재 활성 ClientProfile을 반환한다 (어떤 메서드를 쓰는지 확인 가능).
6. 기본 정책은 `observe-only`이며 승인 없이 write action이 실행되지 않는다.
7. `web3_clientVersion` 미노출 노드가 부분 지원 모드로 대시보드에 접근 가능하다.
8. 클라이언트 업그레이드(버전 변경) 시 Agent Loop이 자동으로 재감지를 트리거한다.
9. `npm run lint`, `npx tsc --noEmit`, `npm run test:run`, 핵심 e2e가 모두 통과한다.

---

## 12) Risks and Mitigations

| 위험 | 구체적 상황 | 대응 |
|------|-------------|------|
| nitro 오감지 | `web3_clientVersion`이 `Geth/...`로 응답 | L2 fingerprint probe(arb_blockNumber)를 먼저 실행해 재분류 |
| `admin_peers` 미노출 | 프로덕션 기본 설정에서 admin 비활성화 | optional probe만, `net_peerCount` fallback 의무화 |
| nethermind txpool | `txpool_*` 미지원 | probe 순서: txpool_status → parity_pendingTransactions |
| 로드밸런서 뒤 노드 | 응답 클라이언트 불일치 | `clientFamily: 'unknown'` fallback + 사용자에게 수동 지정 안내 |
| 커스텀 메트릭 응답 경로 오류 | env var path가 잘못됨 | path 검증 + 값 추출 실패 시 메트릭 null 처리 (에러 없이 계속) |
| 클라이언트 업그레이드 | capabilities 무효화 | clientVersion 변경 감지 → 자동 재감지 |
| env var JSON 파싱 실패 | SENTINAI_COMPONENT_DEPS 형식 오류 | 파싱 실패 시 기존 ChainPlugin 토폴로지로 fallback + 경고 로그 |

---

## 13) Out of Scope

1. CL (Consensus Layer / Beacon Node) 감지 및 통합
2. Engine API (JWT 인증) 프로브 — L2 내부 통신 포트, 별도 제안으로 다룸
3. 비EVM 체인 범용 자동 감지
4. 다중 인스턴스(HA) 집계 — Phase 3 멀티테넌트 설계에서 다룸
5. 신규 결제/요금제 정책 변경
