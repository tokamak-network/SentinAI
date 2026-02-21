# L2 based on Optimism official tutorial → SentinAI integration guide

## outline
The L2 distributed through Optimism's official tutorial ([create-l2-rollup](https://docs.optimism.io/chain-operators/tutorials/create-l2-rollup/create-l2-rollup)) is **standard OP Stack**, so SentinAI integration is very simple.

---

## ✅ Good news

**Tutorial-based deployment = Standard OP Stack**
- ✅ op-geth, op-node, op-batcher, op-proposer, op-challenger (including all)
- ✅ Use standard environment variables (OP_* prefix)
- ✅ Supports both Docker Compose or K8s deployments
- ✅ **Thanos plugins can be used almost as is**

---

## 🚀 Quick setup (5 minutes)

### 1. Chain information collection (created during distribution)
After completing the tutorial, check the following information:

```bash
# In the rollup/deployer/ directory
cat intent.toml
```

Information needed:
- **Chain ID**: `l2_chain_id = 42069` (example)
- **L2 RPC URL**: `http://localhost:8545` (op-geth)
- **L1 Chain**: Sepolia

### 2. Create SentinAI chain plugin

**Option A: Use Thanos as is (simplest)**
```bash
cd /path/to/SentinAI

# Set only .env.local
cat >> .env.local << 'ENVEOF'
# OP Stack L2 from Optimism Tutorial
CHAIN_TYPE=thanos                              # Thanos = 표준 OP Stack
L2_RPC_URL=http://localhost:8545               # op-geth RPC
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com

# EOA Addresses (addresses created in the tutorial)
BATCHER_EOA_ADDRESS=0x... # Created in tutorial
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x... # When using Fault Proof

# K8s (see section below when using Docker Compose)
# AWS_CLUSTER_NAME=my-cluster
# K8S_NAMESPACE=default
# K8S_APP_PREFIX=op

# When using Docker Compose
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../rollup/docker-compose.yml # Tutorial path
DOCKER_COMPOSE_PROJECT=rollup

# Network Display
NEXT_PUBLIC_NETWORK_NAME=My OP Stack Testnet
ENVEOF
```

**Option B: Custom Chain Plugin (Recommended - Correct Chain ID)**
```bash
#1. Copy Thanos
cp -r src/chains/thanos src/chains/my-l2

# 2. Create Chain definition
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

# 3. Modify index.ts
sed -i "s/chainType = 'thanos'/chainType = 'my-l2'/g" src/chains/my-l2/index.ts
sed -i "s/displayName = 'Thanos L2 Rollup'/displayName = 'My OP Stack L2'/g" src/chains/my-l2/index.ts
sed -i "s/l2Chain: Chain = mainnet/l2Chain: Chain = myL2Chain/g" src/chains/my-l2/index.ts
sed -i "1i import { myL2Chain } from '.\/chain';" src/chains/my-l2/index.ts

# 4. .env.local settings
echo "CHAIN_TYPE=my-l2" >> .env.local
```

### 3. Private Keys Settings (Optional - When using Auto Refill)

```bash
# Add to .env.local (can reuse PRIVATE_KEY from tutorial)
BATCHER_PRIVATE_KEY=0x...      # Batcher wallet
PROPOSER_PRIVATE_KEY=0x...     # Proposer wallet
CHALLENGER_PRIVATE_KEY=0x...   # Challenger wallet (Fault Proof)

# Treasury wallet (Auto-refill 용)
TREASURY_PRIVATE_KEY=0x... # Have enough Sepolia ETH
EOA_BALANCE_WARNING_ETH=0.5
EOA_BALANCE_CRITICAL_ETH=0.1
```

### 4. Set up Orchestrator according to the deployment environment

**When deploying Docker Compose:**
```bash
# .env.local
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../rollup/docker-compose.yml
DOCKER_COMPOSE_PROJECT=rollup
```

**When deploying K8s:**
```bash
# .env.local
ORCHESTRATOR_TYPE=k8s
AWS_CLUSTER_NAME=my-cluster
K8S_NAMESPACE=default
K8S_APP_PREFIX=op
```

---

## 🔍 How to check information after distributing the tutorial

### Check Chain ID
```bash
# rollup/deployer/intent.toml
grep "l2_chain_id" rollup/deployer/intent.toml
```

### Verify EOA address
```bash
# .env file created during the tutorial
cat rollup/.env | grep -E "ADMIN|BATCHER|PROPOSER"

# or intent.toml
grep -E "batcher_address|proposer_address" rollup/deployer/intent.toml
```

### Check L2 RPC
```bash
# When using Docker Compose
curl http://localhost:8545 -X POST -H "Content-Type: application/json" \
  --data '{"method":"eth_chainId","params":[],"id":1,"jsonrpc":"2.0"}'

# 응답: {"jsonrpc":"2.0","id":1,"result":"0xa455"}  (42069 in hex)
```

---

## 📊 SentinAI monitoring target

Components monitored during tutorial deployment:

### Basic (all distributions)
- ✅ **op-geth** (Execution)
- ✅ **op-node** (Consensus)
- ✅ **op-batcher** (L1 Batch Submission)
- ✅ **op-proposer** (State Root Proposal)

### When Fault Proof is enabled
- ✅ **op-challenger** (Dispute Game)

### Monitoring items
- Block production (expect every 2 seconds)
- Transaction throughput
- L1 RPC health (Sepolia connection)
- EOA balances (Batcher, Proposer, Challenger)
- Gas prices
- CPU/Memory usage (Docker/K8s)

---

## 🛠️ Settings by distribution type

### A. Tutorial When using Automated Setup

```bash
# 1. Complete the tutorial
cd docs/create-l2-rollup-example
make up

# 2. SentinAI Settings
cd /path/to/SentinAI
cat >> .env.local << 'EOF'
CHAIN_TYPE=thanos
L2_RPC_URL=http://localhost:8545
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=../docs/create-l2-rollup-example/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example

# EOA (copy from example .env)
BATCHER_EOA_ADDRESS=<from example .env>
PROPOSER_EOA_ADDRESS=<from example .env>
