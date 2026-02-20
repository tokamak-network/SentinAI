# Optimism 공식 튜토리얼 기반 L2 → SentinAI 연동 가이드

## 개요
Optimism 공식 튜토리얼 ([create-l2-rollup](https://docs.optimism.io/chain-operators/tutorials/create-l2-rollup/create-l2-rollup))로 배포한 L2는 **표준 OP Stack**이므로 SentinAI 연동이 매우 간단합니다.

---

## ✅ 좋은 소식

**튜토리얼 기반 배포 = 표준 OP Stack**
- ✅ op-geth, op-node, op-batcher, op-proposer, op-challenger (전체 포함)
- ✅ 표준 환경 변수 사용 (OP_* prefix)
- ✅ Docker Compose 또는 K8s 배포 모두 지원
- ✅ **Thanos 플러그인을 거의 그대로 사용 가능**

---

## 🚀 빠른 설정 (5분)

### 1. Chain 정보 수집 (배포 중 생성됨)
튜토리얼 완료 후 다음 정보를 확인하세요:

```bash
# rollup/deployer/ 디렉토리에서
cat intent.toml
```

필요한 정보:
- **Chain ID**: `l2_chain_id = 42069` (예시)
- **L2 RPC URL**: `http://localhost:8545` (op-geth)
- **L1 Chain**: Sepolia

### 2. SentinAI 체인 플러그인 생성

**옵션 A: Thanos 그대로 사용 (가장 간단)**
```bash
cd /path/to/SentinAI

# .env.local만 설정
cat >> .env.local << 'ENVEOF'
# OP Stack L2 from Optimism Tutorial
CHAIN_TYPE=thanos                              # Thanos = 표준 OP Stack
L2_RPC_URL=http://localhost:8545               # op-geth RPC
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com

# EOA Addresses (튜토리얼에서 생성한 주소)
BATCHER_EOA_ADDRESS=0x...                      # 튜토리얼에서 생성
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...                   # Fault Proof 사용 시

# K8s (Docker Compose 사용 시 아래 섹션 참고)
# AWS_CLUSTER_NAME=my-cluster
# K8S_NAMESPACE=default
# K8S_APP_PREFIX=op

# Docker Compose 사용 시
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../rollup/docker-compose.yml  # 튜토리얼 경로
DOCKER_COMPOSE_PROJECT=rollup

# Network Display
NEXT_PUBLIC_NETWORK_NAME=My OP Stack Testnet
ENVEOF
```

**옵션 B: 커스텀 체인 플러그인 (권장 - 정확한 Chain ID)**
```bash
# 1. Thanos 복사
cp -r src/chains/thanos src/chains/my-l2

# 2. Chain 정의 생성
cat > src/chains/my-l2/chain.ts << 'TSEOF'
import { defineChain } from 'viem';

export const myL2Chain = defineChain({
  id: 42069,  // ← intent.toml의 l2_chain_id
  name: 'My OP Stack L2',
  network: 'my-l2',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.L2_RPC_URL || 'http://localhost:8545'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'http://localhost:4000' },  // Blockscout 등
  },
  testnet: true,
});
TSEOF

# 3. index.ts 수정
sed -i "s/chainType = 'thanos'/chainType = 'my-l2'/g" src/chains/my-l2/index.ts
sed -i "s/displayName = 'Thanos L2 Rollup'/displayName = 'My OP Stack L2'/g" src/chains/my-l2/index.ts
sed -i "s/l2Chain: Chain = mainnet/l2Chain: Chain = myL2Chain/g" src/chains/my-l2/index.ts
sed -i "1i import { myL2Chain } from '.\/chain';" src/chains/my-l2/index.ts

# 4. .env.local 설정
echo "CHAIN_TYPE=my-l2" >> .env.local
```

### 3. Private Keys 설정 (선택 - Auto Refill 사용 시)

```bash
# .env.local에 추가 (튜토리얼의 PRIVATE_KEY 재사용 가능)
BATCHER_PRIVATE_KEY=0x...      # Batcher wallet
PROPOSER_PRIVATE_KEY=0x...     # Proposer wallet
CHALLENGER_PRIVATE_KEY=0x...   # Challenger wallet (Fault Proof)

# Treasury wallet (Auto-refill 용)
TREASURY_PRIVATE_KEY=0x...     # 충분한 Sepolia ETH 보유
EOA_BALANCE_WARNING_ETH=0.5
EOA_BALANCE_CRITICAL_ETH=0.1
```

### 4. 배포 환경에 맞게 Orchestrator 설정

**Docker Compose 배포 시:**
```bash
# .env.local
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../rollup/docker-compose.yml
DOCKER_COMPOSE_PROJECT=rollup
```

**K8s 배포 시:**
```bash
# .env.local
ORCHESTRATOR_TYPE=k8s
AWS_CLUSTER_NAME=my-cluster
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
```

---

## 🔍 튜토리얼 배포 후 정보 확인 방법

### Chain ID 확인
```bash
# rollup/deployer/intent.toml
grep "l2_chain_id" rollup/deployer/intent.toml
```

### EOA 주소 확인
```bash
# 튜토리얼 중 생성된 .env 파일
cat rollup/.env | grep -E "ADMIN|BATCHER|PROPOSER"

# 또는 intent.toml
grep -E "batcher_address|proposer_address" rollup/deployer/intent.toml
```

### L2 RPC 확인
```bash
# Docker Compose 사용 시
curl http://localhost:8545 -X POST -H "Content-Type: application/json" \
  --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}'

# 응답: {"jsonrpc":"2.0","id":1,"result":"0xa455"}  (42069 in hex)
```

---

## 📊 SentinAI 모니터링 대상

튜토리얼 배포 시 모니터링되는 컴포넌트:

### 기본 (모든 배포)
- ✅ **op-geth** (Execution)
- ✅ **op-node** (Consensus)
- ✅ **op-batcher** (L1 Batch Submission)
- ✅ **op-proposer** (State Root Proposal)

### Fault Proof 활성화 시
- ✅ **op-challenger** (Dispute Game)

### 모니터링 항목
- Block production (2초 간격 기대)
- Transaction throughput
- L1 RPC health (Sepolia 연결)
- EOA balances (Batcher, Proposer, Challenger)
- Gas prices
- CPU/Memory usage (Docker/K8s)

---

## 🛠️ 배포 타입별 설정

### A. 튜토리얼 Automated Setup 사용 시

```bash
# 1. 튜토리얼 완료
cd docs/create-l2-rollup-example
make up

# 2. SentinAI 설정
cd /path/to/SentinAI
cat >> .env.local << 'EOF'
CHAIN_TYPE=thanos
L2_RPC_URL=http://localhost:8545
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../docs/create-l2-rollup-example/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example

# EOA (example .env에서 복사)
BATCHER_EOA_ADDRESS=<from example .env>
PROPOSER_EOA_ADDRESS=<from example .env>
