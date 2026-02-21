# From running Optimism L2 to connecting SentinAI (local guide)

This document covers the complete procedure for running the Optimism official tutorial-based example locally and connecting SentinAI to its L2.

Base date: 2026-02-20

---

## 1. Goal

- Run OP Stack L2 locally
- Verify that L2 RPC (`http://localhost:8545`) responds normally
- Connect SentinAI to local L2
- Check normal metrics in SentinAI API (`/api/metrics`)

---

## 2. Advance preparation

Required tools:

- Docker / Docker Compose
- Git
- `make`
- `jq`

check:

```bash
docker --version
docker compose version
git --version
make --version
jq --version
```

Prepare L1 (Sepolia):

- Sepolia RPC URL
- Distribution wallet Private Key (sufficient Sepolia ETH required)

---

## 3. Optimism L2 generation

### 3.1 Get example code

```bash
cd /Users/theo/workspace_tokamak/SentinAI
mkdir -p external
cd external
git clone --depth 1 https://github.com/ethereum-optimism/docs.git
cd docs/create-l2-rollup-example
```

### 3.2 Environment file settings

```bash
cp .example.env .env
```

Modify minimal entries in `.env`:

- `L1_RPC_URL`
- `L1_BEACON_URL`
- `PRIVATE_KEY` (key with 0x prefix removed)
- `L2_CHAIN_ID` (e.g. 42069)

### 3.3 Deployment and startup

```bash
make init
make setup
```

After success:

```bash
make up
```

---

## 4. Check latest image compatibility (important)

As of 2026-02, the following issues may occur depending on the version combination of the default `docker-compose.yml`.

- `op-node` fails to parse new field `rollup.json`
- `op-geth` ends with `invalid eip-1559 params in extradata`
- The `op-node` RPC port is `9545`, but services refer to `8547`.

If the following is reflected, it will operate stably.

### 4.1 Updated `op-node`/`op-geth` images

In `docker-compose.yml`:

- `op-node` image: `.../op-node:latest`
- `op-geth` image: `.../op-geth:latest`

### 4.2 `op-node` RPC port matching

In `docker-compose.yml`:

- `op-node` port mapping: `8547:9545`
- `op-node` execution argument: `--rpc.port=9545`
- `op-node` healthcheck URL: `http://localhost:9545`
- `propose/challenger`의 `--rollup-rpc=http://op-node:9545`

Additionally, the file below was also modified to `8547 -> 9545`:

- `batcher/.env`의 `OP_BATCHER_ROLLUP_RPC`
- `dispute-mon/.env`의 `ROLLUP_RPC`

### 4.3 Reflection of dispute-mon address variable

The root `.env` must contain the values ​​below for `dispute-mon` to run without a restart loop.

- `ROLLUP_RPC=http://op-node:9545`
- `PROPOSER_ADDRESS=...`
- `CHALLENGER_ADDRESS=...`
- `GAME_FACTORY_ADDRESS=...`

Values ​​can be found in `dispute-mon/.env` and `deployer/.deployer/intent.toml`.

### 4.4 Restart after volume initialization

```bash
docker-compose down -v
docker-compose up -d --wait
```

---

## 5. L2 execution verification

```bash
make status
make test-l1
make test-l2
```

Additional verification:

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

expectation:

- `eth_chainId` = `0xa455` (42069)
- `eth_blockNumber` value increases over time

---

## 6. SentinAI connection

The following is reflected in `/Users/theo/workspace_tokamak/SentinAI/.env.local`.

```bash
# L2 RPC
L2_RPC_URL=http://localhost:8545
CHAIN_TYPE=optimism

# Docker orchestrator
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=external/docs/create-l2-rollup-example/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example

# EOA (based on intent.toml)
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...

# Recommended to disable proxyd path locally
L1_PROXYD_ENABLED=false
```

---

## 7. SentinAI connection verification

### 7.1 Running the server

```bash
cd /Users/theo/workspace_tokamak/SentinAI
npm run dev
```

### 7.2 Check Metric API

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '{
  status: .status,
  blockHeight: .metrics.blockHeight,
  errors: (.errors // [])
}'
```

expectation:

- `status: "healthy"`
- `blockHeight` is not null
- `errors` is empty

---

## 8. Frequently encountered problems

1. `unknown field "minBaseFee"` 또는 `daFootprintGasScalar`
- Cause: `op-node` version is out of date.
- Action: Use `op-node:latest`

2. `invalid eip-1559 params in extradata`
- Cause: `op-geth` version mismatch
- Action: Use `op-geth:latest` and then `down -v`

3. `op-node` is running, but `batcher/proposer` fails to connect to `op-node:8547`
- Cause: The latest `op-node` internal RPC port is `9545`.
- Action: Unify all related `rollup-rpc` values ​​to `op-node:9545`

4. `dispute-mon` restarts with `invalid address`
- Cause: Address variable of root `.env` not set
- 조치: `PROPOSER_ADDRESS`, `CHALLENGER_ADDRESS`, `GAME_FACTORY_ADDRESS` 설정

---

## 9. Shutdown and cleanup

L2 stop:

```bash
cd /Users/theo/workspace_tokamak/SentinAI/external/docs/create-l2-rollup-example
docker-compose down
```

Remove up to volume:

```bash
docker-compose down -v
```

Exit SentinAI: Run `Ctrl+C` in terminal
