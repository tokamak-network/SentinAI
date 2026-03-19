# Arbitrum Orbit Local Setup — SentinAI Integration Guide

This guide covers two deployment paths for monitoring Arbitrum Orbit L2/L3 with SentinAI.

Reference date: 2026-02-24

---

## Choosing a Deployment Path

| | Path A: Full Local Development | Path B: Testnet Contract Deployment |
|--|--|--|
| **Tool** | `nitro-testnode` (Docker Compose) | `create-rollup-eth` (Node.js script) |
| **L1 (parent chain)** | Local geth (port 8545, chainId 31337) | Arbitrum Sepolia (remote) |
| **L2 layer** | Orbit L2 (based on Ethereum L1) | Orbit L3 (based on Arbitrum Sepolia) |
| **Contract deployment** | Handled automatically by testnode | Deployed manually via `npm run dev` |
| **Node execution** | Included automatically via Docker Compose | **Out of scope** (requires separate setup) |
| **SentinAI integration** | Docker orchestrator mode | Provides only EOA addresses and chain ID |
| **Use case** | Fast local development/testing | Rollup contract deployment + obtaining EOA addresses |
| **Prerequisites** | Docker, git | Node.js, wallet funded on Arbitrum Sepolia |

> **Recommendation**: If you are new to this, start with **Path A**. Choose **Path B** if your goal is to verify actual testnet deployment.

---

## Path A: Full Local Development (nitro-testnode)

### A-1. Goal

- Run Arbitrum Orbit L2 fully locally using `nitro-testnode`
- Confirm that L2 RPC (`http://localhost:8547`) responds correctly
- Connect SentinAI with `CHAIN_TYPE=arbitrum`

### A-2. Prerequisites

#### A-2.1 Required Tools

```bash
docker --version          # 20.x or higher
docker compose version    # v2.x (plugin form)
git --version
jq --version
```

#### A-2.2 System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Disk | 20 GB | 50 GB |

> **Note**: Arbitrum Nitro produces a block approximately every 0.25 seconds — 8x faster than OP Stack.

#### A-2.3 nitro-testnode Container Configuration

| Container | Role | Default Port |
|-----------|------|--------------|
| `geth` | Local L1 (Ethereum) | 8545 |
| `redis` | Sequencer coordination | 6379 |
| `sequencer` | nitro-node (sequencer mode) | **8547** |
| `poster` | Batch poster | — |
| `staker-unsafe` | Validator (unsafe mode) | — |
| `blockscout` | Block explorer (optional) | 4000 |

SentinAI component mapping:

| SentinAI Component | Container Name |
|--------------------|----------------|
| `nitro-node` | `sequencer` |
| `batch-poster` | `poster` |
| `validator` | `staker-unsafe` |

### A-3. Starting Arbitrum Orbit L2

#### A-3.1 Clone nitro-testnode

```bash
git clone --recurse-submodules https://github.com/OffchainLabs/nitro-testnode.git
cd nitro-testnode
```

#### A-3.2 Initialize and Start

```bash
./test-node.bash --init --detach
```

`--init`: Deploys rollup contracts on local L1 and generates the genesis state.
`--detach`: Runs in background mode.

> **The first run takes 3–5 minutes.** This includes contract deployment and genesis generation.

#### A-3.3 Verify Containers Started Successfully

```bash
docker compose ps
```

Expected output:

```
NAME              STATUS
geth              Up (healthy)
redis             Up
sequencer         Up (healthy)
poster            Up
staker-unsafe     Up
blockscout        Up       # optional, may not be present
```

### A-4. Verify L2 is Running

```bash
# Check chain ID — expected: "0x66eee" (decimal 412346)
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | jq .result

# Check block production — run twice 1 second apart, should increase by ~4 blocks/sec
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq .result

# Check local L1 — expected: "0x7a69" (31337)
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | jq .result
```

### A-5. Retrieve EOA Addresses

The testnode automatically creates EOA wallets at startup. Retrieve them from the logs:

```bash
# Batch poster address
docker compose logs poster 2>&1 | grep -i "batch poster\|address" | head -5

# Validator address
docker compose logs staker-unsafe 2>&1 | grep -i "staker\|address\|wallet" | head -5
```

Or query the keystore directly:

```bash
docker compose exec geth geth --datadir /home/user/.ethereum/devchain \
  account list 2>/dev/null
```

> Even if addresses cannot be retrieved, SentinAI will collect block metrics without EOA balance monitoring.

### A-6. SentinAI `.env.local` Configuration

```bash
cd /path/to/SentinAI
cp .env.local.sample .env.local
```

Add the following to `.env.local`:

```bash
# === L2 RPC ===
L2_RPC_URL=http://localhost:8547

# === Chain Plugin ===
CHAIN_TYPE=arbitrum
L2_CHAIN_ID=412346
L2_CHAIN_NAME=Arbitrum Nitro Devnet
L2_IS_TESTNET=true
# nitro-testnode uses a local geth, so set L1_CHAIN=sepolia
# (used as a viem chain reference in SentinAI, not for actual L1 connection)
L1_CHAIN=sepolia

# === Container Orchestrator (Docker mode) ===
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/path/to/nitro-testnode/docker-compose.yml
DOCKER_COMPOSE_PROJECT=nitro-testnode

# === Docker Service Name Overrides ===
ARB_NODE_SERVICE=sequencer
ARB_BATCHPOSTER_SERVICE=poster
ARB_VALIDATOR_SERVICE=staker-unsafe

# === AI Provider (at least one required) ===
ANTHROPIC_API_KEY=sk-ant-...

# === EOA Balance Monitoring (values from A-5, can be omitted if unavailable) ===
# BATCH_POSTER_EOA_ADDRESS=0x...
# VALIDATOR_EOA_ADDRESS=0x...

# === Dashboard Display ===
NEXT_PUBLIC_NETWORK_NAME=Arbitrum Nitro Devnet
```

---

## Path B: Rollup Contract Deployment (create-rollup-eth)

`examples/arbitrum-orbit/create-rollup-eth` is a **Node.js TypeScript script** that deploys Orbit rollup contracts to Arbitrum Sepolia.

**What this script does:**
- Deploys rollup contracts to Arbitrum Sepolia using `@arbitrum/chain-sdk`
- Generates or uses existing batch poster / validator EOA addresses
- Generates a new Orbit chain ID

**What this script does NOT do:**
- Run Docker containers ❌
- Start nitro-node / batch-poster / validator processes ❌
- Auto-configure SentinAI ❌

> **Layer structure**: This example uses Arbitrum Sepolia as the parent chain.
> The deployed chain is an **Orbit L3** (a chain on top of Arbitrum Sepolia).

### B-1. Prerequisites

- Node.js 20+
- A deployer wallet with test ETH on Arbitrum Sepolia
  - Faucet: https://www.alchemy.com/faucets/arbitrum-sepolia
- An Arbitrum Sepolia RPC endpoint (Alchemy, Infura, etc.)

### B-2. Run create-rollup-eth

```bash
cd examples/arbitrum-orbit/create-rollup-eth
npm install
cp .env.example .env
```

Edit the `.env` file:

```bash
# Required: deployer private key (wallet funded on Arbitrum Sepolia)
DEPLOYER_PRIVATE_KEY=0x...

# Recommended: Arbitrum Sepolia RPC to avoid timeouts
PARENT_CHAIN_RPC=https://arb-sepolia.g.alchemy.com/v2/YOUR_KEY

# Optional: if not set, new keys are generated on each run — specify explicitly to reuse
BATCH_POSTER_PRIVATE_KEY=0x...
VALIDATOR_PRIVATE_KEY=0x...
```

Run the rollup deployment:

```bash
# High-level flow (recommended)
npm run dev

# Or low-level transaction flow
npm run dev:low-level
```

### B-3. Deployment Output → SentinAI Variable Mapping

After deployment completes, record the following values:

| Item | How to find it | SentinAI Variable |
|------|----------------|-------------------|
| Orbit chain ID | `chainId` output in script logs | `L2_CHAIN_ID` |
| Batch poster address | Derived from `BATCH_POSTER_PRIVATE_KEY` in `.env` | `BATCH_POSTER_EOA_ADDRESS` |
| Validator address | Derived from `VALIDATOR_PRIVATE_KEY` in `.env` | `VALIDATOR_EOA_ADDRESS` |
| Batch poster private key | `BATCH_POSTER_PRIVATE_KEY` in `.env` | `BATCH_POSTER_PRIVATE_KEY` (for auto-refill) |
| Validator private key | `VALIDATOR_PRIVATE_KEY` in `.env` | `VALIDATOR_PRIVATE_KEY` (for auto-refill) |

To derive an address from a private key:

```bash
node -e "
const { privateKeyToAccount } = require('viem/accounts');
console.log(new Date().toISOString(), privateKeyToAccount(process.env.BATCH_POSTER_PRIVATE_KEY).address);
"
```

### B-4. SentinAI `.env.local` Configuration

`create-rollup-eth` only provides the **chain ID and EOA addresses**.
Variables related to node execution — `ORCHESTRATOR_TYPE`, `DOCKER_COMPOSE_FILE`, `ARB_*_SERVICE`, etc. — should be configured according to the environment where your nitro nodes are running.

```bash
cd /path/to/SentinAI
cp .env.local.sample .env.local
```

```bash
# === L2 RPC (RPC of the separately running nitro-node) ===
L2_RPC_URL=http://<nitro-node-host>:<port>

# === Chain Plugin (use values from create-rollup-eth output) ===
CHAIN_TYPE=arbitrum
L2_CHAIN_ID=<chain ID recorded in B-3>
L2_CHAIN_NAME=My Orbit Chain
L2_IS_TESTNET=true
# The parent chain of Arbitrum Sepolia is Ethereum Sepolia.
# SentinAI L1 monitoring supports Ethereum mainnet/sepolia, so set sepolia.
L1_CHAIN=sepolia

# === Orchestrator (configure according to how your nitro node is running) ===
# Unrelated to create-rollup-eth — determined by how the nitro node is executed
# ORCHESTRATOR_TYPE=docker  → if running the node via Docker Compose
# ORCHESTRATOR_TYPE=k8s     → if running the node via Kubernetes

# === AI Provider (at least one required) ===
ANTHROPIC_API_KEY=sk-ant-...

# === EOA Balance Monitoring (values recorded in B-3) ===
BATCH_POSTER_EOA_ADDRESS=0x...
VALIDATOR_EOA_ADDRESS=0x...

# === EOA Auto-Refill (optional) ===
# BATCH_POSTER_PRIVATE_KEY=0x...
# VALIDATOR_PRIVATE_KEY=0x...

# === Dashboard Display ===
NEXT_PUBLIC_NETWORK_NAME=My Orbit Chain
```

> **Current limitation**: SentinAI's L1 monitoring only supports Ethereum mainnet/sepolia.
> If Arbitrum Sepolia is used as the parent chain, L1 block height metrics will be
> displayed based on Ethereum Sepolia.

### B-5. Running the nitro Node (out of scope for create-rollup-eth)

`create-rollup-eth` only deploys contracts and does not run any nodes.
To run an actual node against the deployed rollup contracts, refer to the official guides:

- [Run an Orbit Node](https://docs.arbitrum.io/run-arbitrum-node/run-full-node)
- [Run a Batch Poster](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-node-runners/run-batch-poster)

---

## Common: Starting and Verifying SentinAI

### Start the SentinAI Development Server

```bash
cd /path/to/SentinAI
npm run dev
```

Access the dashboard at: **http://localhost:3002**

### Verify the Metrics API

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '{
  status: .status,
  l2BlockHeight: .metrics.l2BlockHeight,
  chainType: .chainType,
  errors: (.errors // [])
}'
```

Expected response:

```json
{
  "status": "healthy",
  "l2BlockHeight": 12345,
  "chainType": "arbitrum",
  "errors": []
}
```

### Verify Component Topology

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '.components // .pods'
```

You should see `nitro-node`, `batch-poster`, and `validator` listed.

### Verify the Agent Loop

```bash
curl -s 'http://localhost:3002/api/agent-loop' | jq '{
  enabled: .enabled,
  cycleCount: .cycleCount,
  lastCycleAt: .lastCycleAt
}'
```

After 1 minute, `cycleCount` should be 2 or higher.

---

## Key Differences from Optimism Setup

| Item | Optimism (OP Stack) | Arbitrum Orbit |
|------|---------------------|----------------|
| L2 RPC port | 8545 | **8547** |
| `CHAIN_TYPE` | `optimism` | **`arbitrum`** |
| Primary execution container | `op-geth` | **`sequencer`** |
| Batch poster container | `op-batcher` | **`poster`** |
| Proposer/validator container | `op-proposer` | **`staker-unsafe`** |
| EOA variable (batcher) | `BATCHER_EOA_ADDRESS` | **`BATCH_POSTER_EOA_ADDRESS`** |
| EOA variable (proposer) | `PROPOSER_EOA_ADDRESS` | **`VALIDATOR_EOA_ADDRESS`** |
| Block production interval | ~2 seconds | **~0.25 seconds** |

---

## Common Issues

### `nitro-testnode` Initialization Failure

```
Error: could not fetch parent chain id
```

**Cause**: `PARENT_CHAIN_RPC` (if configured) is unreachable, or the local geth is not yet ready.

**Fix**: Wait a few seconds and retry, or check the geth logs:

```bash
docker compose logs geth --tail=20
```

---

### L2 RPC Connection Refused

```
curl: (7) Failed to connect to localhost port 8547
```

**Cause**: The `sequencer` container is still starting up or has crashed.

**Fix**:

```bash
docker compose ps sequencer
docker compose logs sequencer --tail=30
# If stopped, re-initialize
./test-node.bash --init --detach
```

---

### SentinAI Shows `chainType: "thanos"`

**Cause**: `CHAIN_TYPE=arbitrum` is missing from `.env.local`.

**Fix**: Add `CHAIN_TYPE=arbitrum` and restart with `npm run dev`.

---

### Block Height Is Not Increasing

**Cause**: `L2_RPC_URL` is pointing to the wrong port (e.g., `8545` instead of `8547`).

**Fix**:

```bash
curl -s http://localhost:8547 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

---

### Docker Compose Restart Is Not Working

SentinAI auto-recovery calls `docker compose restart <service>`.
If the service name does not match what is defined in `DOCKER_COMPOSE_FILE`, it will fail.

**Fix**:

```bash
docker compose config --services
# Update env variables with the service names shown in output
ARB_NODE_SERVICE=sequencer
ARB_BATCHPOSTER_SERVICE=poster
ARB_VALIDATOR_SERVICE=staker-unsafe
```

---

### Anomaly Detection Keeps Triggering

**Cause**: False positive Z-score alerts due to the 0.25-second block interval during initialization.

**Fix**: This is expected behavior during the warm-up period (~2 minutes). It will resolve once the ring buffer (60 data points) stabilizes.

---

## Shutdown and Cleanup

Stop L2 but keep volumes (for fast restart):

```bash
cd /path/to/nitro-testnode
docker compose down
```

Full reset including volumes:

```bash
docker compose down -v
```

Stop SentinAI: press `Ctrl+C` in the terminal.

---

## Reference Links

- [Arbitrum Orbit Overview](https://docs.arbitrum.io/get-started/overview)
- [nitro-testnode GitHub](https://github.com/OffchainLabs/nitro-testnode)
- [Orbit Quickstart](https://docs.arbitrum.io/launch-orbit-chain/orbit-quickstart)
- [Arbitrum Nitro Architecture](https://docs.arbitrum.io/how-arbitrum-works/inside-arbitrum-nitro)
- [Run an Orbit Node](https://docs.arbitrum.io/run-arbitrum-node/run-full-node)
- [Run a Batch Poster](https://docs.arbitrum.io/launch-arbitrum-chain/arbitrum-node-runners/run-batch-poster)
- [examples/arbitrum-orbit/create-rollup-eth/](https://github.com/tokamak-network/SentinAI/tree/main/examples/arbitrum-orbit/create-rollup-eth/) — rollup deployment example in this repository
