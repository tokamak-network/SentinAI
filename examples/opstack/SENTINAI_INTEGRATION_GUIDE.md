# OP Stack Docker L2 + SentinAI Integration Guide

This guide explains how to:
- run a local OP Stack L2 from `examples/opstack`
- connect SentinAI to that running L2
- verify end-to-end status

## 1. Prerequisites

- Docker (with Docker Compose plugin)
- `make`
- `jq`
- `git`
- Sepolia RPC endpoint and Beacon endpoint
- Sepolia ETH in the deployment wallet

Check tools:

```bash
docker --version
docker compose version
make --version
jq --version
git --version
```

## 2. Configure L2 deployment environment

Move into the example directory:

```bash
cd /absolute/path/to/SentinAI/examples/opstack
```

Create local env file:

```bash
cp .env.example .env
```

Edit `.env` and set at least these values:

```bash
# Option A: Infura
L1_RPC_URL="https://sepolia.infura.io/v3/<INFURA_API_KEY>"
L1_BEACON_URL="https://ethereum-sepolia-beacon-api.publicnode.com"

# Option B: Alchemy
# L1_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/<ALCHEMY_API_KEY>"
# L1_BEACON_URL="https://ethereum-sepolia-beacon-api.publicnode.com"

# Required private key (without 0x prefix)
PRIVATE_KEY="<PRIVATE_KEY_WITHOUT_0X>"

# Custom test chain id (example)
L2_CHAIN_ID="42069"
```

## 3. Deploy and run OP Stack L2 (Docker)

Preferred one-click flow:

```bash
./scripts/start-op-stack.sh
```

One-click behavior:
- First run: initializes binary/setup and starts services.
- Re-run: skips expensive setup if deployment artifacts already exist.
- Force full setup/redeploy:

```bash
./scripts/start-op-stack.sh --force-setup
```

Makefile aliases:

```bash
make start-op-stack
make start-op-stack-force
```

Manual fallback (step-by-step):

```bash
make init
make setup
make up
```

## 4. Verify L2 services

Check service status:

```bash
make status
```

Expected: `op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger`, `dispute-mon` are running.

Check L1/L2 connectivity:

```bash
make test-l1
make test-l2
```

Check L2 RPC manually:

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Expected:
- `eth_chainId` matches your configured `L2_CHAIN_ID`
- `eth_blockNumber` is not null and increases over time

## 5. Configure SentinAI

Open `<repo-root>/.env.local` and apply values based on `examples/opstack/.env.example`.

Minimum required values:

```bash
CHAIN_TYPE=optimism
L2_RPC_URL=http://localhost:8545
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org

ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/absolute/path/to/SentinAI/examples/opstack/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example

NEXT_PUBLIC_NETWORK_NAME=OP Stack Local L2
```

Optional fault-proof and EOA monitoring:

```bash
# Optional EOA addresses
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...

# Optional dispute game
FAULT_PROOF_ENABLED=true
DISPUTE_GAME_FACTORY_ADDRESS=0x...
```

Address sources after `make setup`:

```bash
# Dispute game factory
jq -r '.opChainDeployments[0].DisputeGameFactoryProxy' deployer/.deployer/state.json

# Proposer/challenger addresses
jq -r '.appliedIntent.chains[0].roles.proposer' deployer/.deployer/state.json
jq -r '.appliedIntent.chains[0].roles.challenger' deployer/.deployer/state.json
```

## 6. Start SentinAI and verify integration

Start SentinAI:

```bash
cd /absolute/path/to/SentinAI
npm run dev
```

Check metrics:

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  status: .status,
  chain: .chain.type,
  blockHeight: .metrics.blockHeight,
  errors: (.errors // [])
}'
```

Expected:
- `status` is `healthy`
- `chain` is `optimism`
- `blockHeight` is not null
- `errors` is empty or not critical

## 7. Stop and cleanup

Stop L2 services:

```bash
cd /absolute/path/to/SentinAI/examples/opstack
make down
```

Remove containers and volumes:

```bash
make clean
```

Stop SentinAI dev server with `Ctrl+C` in the SentinAI terminal.

## 8. Troubleshooting quick checks

- `make setup` fails:
  - verify Sepolia ETH balance of deployment wallet
  - verify `L1_RPC_URL`, `L1_BEACON_URL`, and `PRIVATE_KEY`
- `make up` starts but components restart repeatedly:
  - check logs with `make logs` and `make logs-op-node`
  - ensure ports `8545`, `8546`, `8551`, `8547`, `7300` are free
- SentinAI shows no OP components:
  - verify `ORCHESTRATOR_TYPE=docker`
  - verify `DOCKER_COMPOSE_FILE` absolute path
  - verify compose project name matches `DOCKER_COMPOSE_PROJECT`
