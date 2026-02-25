# Arbitrum Orbit 로컬 설정 — SentinAI 연동 가이드

이 가이드는 Arbitrum Orbit L2/L3를 SentinAI로 모니터링하는 두 가지 배포 경로를 다룹니다.

기준일: 2026-02-24

---

## 배포 경로 선택

| | 경로 A: 완전 로컬 개발 | 경로 B: 테스트넷 컨트랙트 배포 |
|--|--|--|
| **도구** | `nitro-testnode` (Docker Compose) | `create-rollup-eth` (Node.js 스크립트) |
| **L1 (parent chain)** | 로컬 geth (포트 8545, chainId 31337) | Arbitrum Sepolia (원격) |
| **L2 계층** | Orbit L2 (Ethereum L1 기준) | Orbit L3 (Arbitrum Sepolia 기준) |
| **컨트랙트 배포** | testnode 자동 처리 | `npm run dev`로 직접 배포 |
| **노드 실행** | Docker Compose 자동 포함 | **스크립트 범위 밖** (별도 설정 필요) |
| **SentinAI 연동** | Docker 오케스트레이터 모드 | EOA 주소·체인 ID만 제공 |
| **용도** | 빠른 로컬 개발/테스트 | 롤업 컨트랙트 배포 + EOA 주소 획득 |
| **준비물** | Docker, git | Node.js, Arbitrum Sepolia 자금 지갑 |

> **권장**: 처음이라면 **경로 A**로 시작하세요. 실제 테스트넷 배포 검증이 목적이라면 **경로 B**를 선택합니다.

---

## 경로 A: 완전 로컬 개발 (nitro-testnode)

### A-1. 목표

- `nitro-testnode`로 Arbitrum Orbit L2를 로컬에서 완전 실행
- L2 RPC(`http://localhost:8547`) 정상 응답 확인
- `CHAIN_TYPE=arbitrum`으로 SentinAI 연결

### A-2. 사전 준비

#### A-2.1 필요 도구

```bash
docker --version          # 20.x 이상
docker compose version    # v2.x (플러그인 형태)
git --version
jq --version
```

#### A-2.2 시스템 요구사항

| 리소스 | 최소 | 권장 |
|--------|------|------|
| CPU | 4코어 | 8코어 |
| RAM | 8 GB | 16 GB |
| 디스크 | 20 GB | 50 GB |

> **참고**: Arbitrum Nitro는 약 0.25초마다 블록을 생성합니다 — OP Stack 대비 8배 빠릅니다.

#### A-2.3 nitro-testnode 컨테이너 구성

| 컨테이너 | 역할 | 기본 포트 |
|----------|------|-----------|
| `geth` | 로컬 L1 (Ethereum) | 8545 |
| `redis` | 시퀀서 코디네이션 | 6379 |
| `sequencer` | nitro-node (시퀀서 모드) | **8547** |
| `poster` | 배치 포스터 | — |
| `staker-unsafe` | 밸리데이터 (unsafe 모드) | — |
| `blockscout` | 블록 탐색기 (선택사항) | 4000 |

SentinAI 컴포넌트 매핑:

| SentinAI 컴포넌트 | 컨테이너명 |
|-------------------|------------|
| `nitro-node` | `sequencer` |
| `batch-poster` | `poster` |
| `validator` | `staker-unsafe` |

### A-3. Arbitrum Orbit L2 기동

#### A-3.1 nitro-testnode 클론

```bash
git clone --recurse-submodules https://github.com/OffchainLabs/nitro-testnode.git
cd nitro-testnode
```

#### A-3.2 초기화 및 기동

```bash
./test-node.bash --init --detach
```

`--init`: 로컬 L1에 롤업 컨트랙트를 배포하고 제네시스 상태를 생성합니다.
`--detach`: 백그라운드 모드로 실행합니다.

> **첫 실행은 3~5분 소요됩니다.** 컨트랙트 배포 및 제네시스 생성이 포함됩니다.

#### A-3.3 컨테이너 정상 기동 확인

```bash
docker compose ps
```

예상 출력:

```
NAME              STATUS
geth              Up (healthy)
redis             Up
sequencer         Up (healthy)
poster            Up
staker-unsafe     Up
blockscout        Up       # 선택사항, 없을 수 있음
```

### A-4. L2 실행 확인

```bash
# 체인 ID 확인 — 예상: "0x66eee" (10진수 412346)
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | jq .result

# 블록 생성 확인 — 1초 간격으로 두 번 실행, 약 4 블록/초 증가해야 함
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq .result

# 로컬 L1 확인 — 예상: "0x7a69" (31337)
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | jq .result
```

### A-5. EOA 주소 조회

testnode는 시작 시 EOA 지갑을 자동 생성합니다. 로그에서 조회합니다:

```bash
# 배치 포스터 주소
docker compose logs poster 2>&1 | grep -i "batch poster\|address" | head -5

# 밸리데이터 주소
docker compose logs staker-unsafe 2>&1 | grep -i "staker\|address\|wallet" | head -5
```

또는 키스토어를 직접 조회합니다:

```bash
docker compose exec geth geth --datadir /home/user/.ethereum/devchain \
  account list 2>/dev/null
```

> 주소를 조회할 수 없어도 SentinAI는 EOA 잔액 모니터링 없이 블록 메트릭을 수집합니다.

### A-6. SentinAI `.env.local` 설정

```bash
cd /path/to/SentinAI
cp .env.local.sample .env.local
```

`.env.local`에 추가:

```bash
# === L2 RPC ===
L2_RPC_URL=http://localhost:8547

# === 체인 플러그인 ===
CHAIN_TYPE=arbitrum
L2_CHAIN_ID=412346
L2_CHAIN_NAME=Arbitrum Nitro Devnet
L2_IS_TESTNET=true
# nitro-testnode는 로컬 geth를 사용하므로 L1_CHAIN=sepolia로 설정
# (SentinAI의 viem 체인 참조용, 실제 L1 연결에 사용되지 않음)
L1_CHAIN=sepolia

# === 컨테이너 오케스트레이터 (Docker 모드) ===
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/path/to/nitro-testnode/docker-compose.yml
DOCKER_COMPOSE_PROJECT=nitro-testnode

# === Docker 서비스명 오버라이드 ===
ARB_NODE_SERVICE=sequencer
ARB_BATCHPOSTER_SERVICE=poster
ARB_VALIDATOR_SERVICE=staker-unsafe

# === AI 프로바이더 (최소 하나 필수) ===
ANTHROPIC_API_KEY=sk-ant-...

# === EOA 잔액 모니터링 (A-5에서 조회한 값, 없으면 생략 가능) ===
# BATCH_POSTER_EOA_ADDRESS=0x...
# VALIDATOR_EOA_ADDRESS=0x...

# === 대시보드 표시 ===
NEXT_PUBLIC_NETWORK_NAME=Arbitrum Nitro Devnet
```

---

## 경로 B: 롤업 컨트랙트 배포 (create-rollup-eth)

`examples/arbitrum-orbit/create-rollup-eth`는 **Node.js TypeScript 스크립트**로,
Arbitrum Sepolia에 Orbit 롤업 컨트랙트를 배포합니다.

**이 스크립트가 하는 일:**
- `@arbitrum/chain-sdk`로 롤업 컨트랙트를 Arbitrum Sepolia에 배포
- 배치 포스터 / 밸리데이터 EOA 주소 생성 또는 사용
- 새로운 Orbit 체인 ID 생성

**이 스크립트가 하지 않는 일:**
- Docker 컨테이너 실행 ❌
- nitro-node / batch-poster / validator 프로세스 실행 ❌
- SentinAI 자동 설정 ❌

> **계층 구조**: 이 예제는 Arbitrum Sepolia를 parent chain으로 사용합니다.
> 배포되는 체인은 **Orbit L3** (Arbitrum Sepolia 위의 체인)입니다.

### B-1. 사전 준비

- Node.js 20+
- Arbitrum Sepolia 테스트 ETH가 있는 배포자 지갑
  - Faucet: https://www.alchemy.com/faucets/arbitrum-sepolia
- Arbitrum Sepolia RPC 엔드포인트 (Alchemy, Infura 등)

### B-2. create-rollup-eth 실행

```bash
cd examples/arbitrum-orbit/create-rollup-eth
npm install
cp .env.example .env
```

`.env` 파일을 편집합니다:

```bash
# 필수: 배포자 개인키 (Arbitrum Sepolia 자금 있는 지갑)
DEPLOYER_PRIVATE_KEY=0x...

# 권장: 타임아웃 방지를 위한 Arbitrum Sepolia RPC
PARENT_CHAIN_RPC=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY

# 선택: 미입력 시 실행마다 새 키 자동 생성 — 재사용하려면 반드시 명시
BATCH_POSTER_PRIVATE_KEY=0x...
VALIDATOR_PRIVATE_KEY=0x...
```

롤업 배포를 실행합니다:

```bash
# 고수준 흐름 (권장)
npm run dev

# 또는 저수준 트랜잭션 흐름
npm run dev:low-level
```

### B-3. 배포 결과 → SentinAI 변수 매핑

배포 완료 후 다음 값을 기록합니다:

| 항목 | 확인 방법 | SentinAI 변수 |
|------|-----------|---------------|
| Orbit 체인 ID | 스크립트 로그의 `chainId` 출력값 | `L2_CHAIN_ID` |
| 배치 포스터 주소 | `.env`의 `BATCH_POSTER_PRIVATE_KEY`에서 파생 | `BATCH_POSTER_EOA_ADDRESS` |
| 밸리데이터 주소 | `.env`의 `VALIDATOR_PRIVATE_KEY`에서 파생 | `VALIDATOR_EOA_ADDRESS` |
| 배치 포스터 개인키 | `.env`의 `BATCH_POSTER_PRIVATE_KEY` | `BATCH_POSTER_PRIVATE_KEY` (자동충전 시) |
| 밸리데이터 개인키 | `.env`의 `VALIDATOR_PRIVATE_KEY` | `VALIDATOR_PRIVATE_KEY` (자동충전 시) |

개인키에서 주소를 확인하는 방법:

```bash
node -e "
const { privateKeyToAccount } = require('viem/accounts');
console.log(new Date().toISOString(), privateKeyToAccount(process.env.BATCH_POSTER_PRIVATE_KEY).address);
"
```

### B-4. SentinAI `.env.local` 설정

`create-rollup-eth`가 제공하는 것은 **체인 ID와 EOA 주소**뿐입니다.
`ORCHESTRATOR_TYPE`, `DOCKER_COMPOSE_FILE`, `ARB_*_SERVICE` 등 노드 실행 관련 변수는
별도로 실행하는 nitro 노드 환경에 맞게 설정합니다.

```bash
cd /path/to/SentinAI
cp .env.local.sample .env.local
```

```bash
# === L2 RPC (별도 실행하는 nitro-node RPC) ===
L2_RPC_URL=http://<nitro-node-host>:<port>

# === 체인 플러그인 (create-rollup-eth 출력값 사용) ===
CHAIN_TYPE=arbitrum
L2_CHAIN_ID=<B-3에서 기록한 체인 ID>
L2_CHAIN_NAME=My Orbit Chain
L2_IS_TESTNET=true
# Arbitrum Sepolia의 parent chain = Ethereum Sepolia
# SentinAI L1 모니터링은 Ethereum mainnet/sepolia를 지원하므로 sepolia로 설정
L1_CHAIN=sepolia

# === 오케스트레이터 (노드 실행 환경에 맞게) ===
# create-rollup-eth와 무관 — nitro 노드를 어떻게 실행하느냐에 따라 결정
# ORCHESTRATOR_TYPE=docker  → Docker Compose로 노드 실행 시
# ORCHESTRATOR_TYPE=k8s     → Kubernetes로 노드 실행 시

# === AI 프로바이더 (최소 하나 필수) ===
ANTHROPIC_API_KEY=sk-ant-...

# === EOA 잔액 모니터링 (B-3에서 기록한 값) ===
BATCH_POSTER_EOA_ADDRESS=0x...
VALIDATOR_EOA_ADDRESS=0x...

# === EOA 자동 충전 (선택사항) ===
# BATCH_POSTER_PRIVATE_KEY=0x...
# VALIDATOR_PRIVATE_KEY=0x...

# === 대시보드 표시 ===
NEXT_PUBLIC_NETWORK_NAME=My Orbit Chain
```

> **현재 제한사항**: SentinAI의 L1 모니터링은 Ethereum mainnet/sepolia만 지원합니다.
> Arbitrum Sepolia를 parent chain으로 사용하는 경우, L1 블록 높이 메트릭은
> Ethereum Sepolia 기준으로 표시됩니다.

### B-5. nitro 노드 실행 (create-rollup-eth 범위 밖)

`create-rollup-eth`는 컨트랙트 배포만 하며 노드를 실행하지 않습니다.
배포된 롤업 컨트랙트로 실제 노드를 실행하려면 공식 가이드를 참고하세요:

- [Orbit 노드 실행 가이드](https://docs.arbitrum.io/run-arbitrum-node/run-full-node)
- [Batch Poster 실행](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-node-runners/run-batch-poster)

---

## 공통: SentinAI 기동 및 확인

### SentinAI 개발 서버 기동

```bash
cd /path/to/SentinAI
npm run dev
```

대시보드 접속: **http://localhost:3002**

### 메트릭 API 확인

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '{
  status: .status,
  l2BlockHeight: .metrics.l2BlockHeight,
  chainType: .chainType,
  errors: (.errors // [])
}'
```

예상 응답:

```json
{
  "status": "healthy",
  "l2BlockHeight": 12345,
  "chainType": "arbitrum",
  "errors": []
}
```

### 컴포넌트 토폴로지 확인

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '.components // .pods'
```

`nitro-node`, `batch-poster`, `validator`가 표시되어야 합니다.

### 에이전트 루프 확인

```bash
curl -s 'http://localhost:3002/api/agent-loop' | jq '{
  enabled: .enabled,
  cycleCount: .cycleCount,
  lastCycleAt: .lastCycleAt
}'
```

1분 후 `cycleCount`가 2 이상이어야 합니다.

---

## Optimism 설정과의 주요 차이점

| 항목 | Optimism (OP Stack) | Arbitrum Orbit |
|------|---------------------|----------------|
| L2 RPC 포트 | 8545 | **8547** |
| `CHAIN_TYPE` | `optimism` | **`arbitrum`** |
| 주 실행 컨테이너 | `op-geth` | **`sequencer`** |
| 배치 포스터 컨테이너 | `op-batcher` | **`poster`** |
| 프로포저/밸리데이터 컨테이너 | `op-proposer` | **`staker-unsafe`** |
| EOA 변수 (배처) | `BATCHER_EOA_ADDRESS` | **`BATCH_POSTER_EOA_ADDRESS`** |
| EOA 변수 (프로포저) | `PROPOSER_EOA_ADDRESS` | **`VALIDATOR_EOA_ADDRESS`** |
| 블록 생성 주기 | ~2초 | **~0.25초** |

---

## 자주 발생하는 문제

### `nitro-testnode` 초기화 실패

```
Error: could not fetch parent chain id
```

**원인**: `PARENT_CHAIN_RPC` (설정된 경우)에 접근할 수 없거나 로컬 geth가 준비되지 않은 상태.

**해결**: 몇 초 대기 후 재시도, 또는 geth 로그 확인:

```bash
docker compose logs geth --tail=20
```

---

### L2 RPC 연결 거부

```
curl: (7) Failed to connect to localhost port 8547
```

**원인**: `sequencer` 컨테이너가 시작 중이거나 크래시 상태.

**해결**:

```bash
docker compose ps sequencer
docker compose logs sequencer --tail=30
# 종료된 경우 재초기화
./test-node.bash --init --detach
```

---

### SentinAI가 `chainType: "thanos"` 표시

**원인**: `.env.local`에 `CHAIN_TYPE=arbitrum`이 없음.

**해결**: `CHAIN_TYPE=arbitrum` 추가 후 `npm run dev` 재시작.

---

### 블록 높이가 증가하지 않음

**원인**: `L2_RPC_URL`이 잘못된 포트(예: `8547` 대신 `8545`).

**해결**:

```bash
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

---

### Docker Compose 재시작이 작동하지 않음

SentinAI 자동 복구는 `docker compose restart <service>`를 호출합니다.
서비스명이 `DOCKER_COMPOSE_FILE`과 일치하지 않으면 실패합니다.

**해결**:

```bash
docker compose config --services
# 출력된 서비스명으로 env 업데이트
ARB_NODE_SERVICE=sequencer
ARB_BATCHPOSTER_SERVICE=poster
ARB_VALIDATOR_SERVICE=staker-unsafe
```

---

### 이상 탐지가 계속 발동됨

**원인**: 0.25초 블록 간격으로 인한 초기 Z-score 오탐.

**해결**: 워밍업(~2분) 동안 예상 동작입니다. 링 버퍼(60개 포인트)가 안정화되면 해소됩니다.

---

## 종료 및 정리

L2를 중지하되 볼륨 유지 (빠른 재시작):

```bash
cd /path/to/nitro-testnode
docker compose down
```

볼륨 포함 전체 초기화:

```bash
docker compose down -v
```

SentinAI 중지: 터미널에서 `Ctrl+C`

---

## 참고 링크

- [Arbitrum Orbit 개요](https://docs.arbitrum.io/get-started/overview)
- [nitro-testnode GitHub](https://github.com/OffchainLabs/nitro-testnode)
- [Orbit 퀵스타트](https://docs.arbitrum.io/launch-orbit-chain/orbit-quickstart)
- [Arbitrum Nitro 아키텍처](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro)
- [Orbit 노드 실행 가이드](https://docs.arbitrum.io/run-arbitrum-node/run-full-node)
- [Batch Poster 실행](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-node-runners/run-batch-poster)
- [examples/arbitrum-orbit/create-rollup-eth/](../../examples/arbitrum-orbit/create-rollup-eth/) — 이 저장소의 롤업 배포 예제
