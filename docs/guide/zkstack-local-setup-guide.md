# ZK Stack-based L2 local deployment guide (based on official documentation)

Base date: 2026-02-20
Reference document: ZKsync official documentation (`docs.zksync.io`)

---

## 1. Purpose

- Deploy local ZKsync chain (L2) with ZK Stack CLI
- Check local RPC normal operation
- Check account funding and basic interactions
- Optionally run Portal/Explorer
- Optionally prepare gateway settlement layer experiment

## 1.1 Execution configuration distinction (important)

The execution path in this guide is divided into two layers.

1) **Required: Run local L2**
- `zkstack ecosystem init --dev`
- `zkstack server --chain <CHAIN_NAME>`
- Purpose: Run the chain itself locally

2) **Optional: Run Probe Server**
- 예: `scripts/zk-settlement-probe.mjs`
- Purpose: To display settlement/prover/batcher status more accurately on the SentinAI dashboard
- Note: Probe is not a prerequisite for L2 execution, but is for improving visualization accuracy.

3) **Select: server-v2 container mode**
- Purpose: Unify SentinAI’s automatic action/state collection on a container basis
- Premise: Only the core runtime (`zkstack-core`, `zkstack-apis`) is operated with docker-compose.
- Note: quickstart default (`zkstack server`) is in process mode, which limits the scope of container awareness.

### Principles for using standard templates

- The `external/zkstack-local/...` file is not directly referenced by the SentinAI runtime.
- Integration is performed based on the `examples/zkstack/` template.
- Recommended starting points:
  - `examples/zkstack/.env.example`
  - `examples/zkstack/docker-compose.core-only.yml`
  - `examples/zkstack/secrets.container.yaml.example`
  - `examples/zkstack/settlement-probe-response.example.json`

---

## 2. Important precautions

As of the official Quickstart, the current `zkstack` CLI path creates **legacy EraVM chains**, not ZKsync OS.
In other words, “local deployment successful” and “ZKsync OS-based operation ready” are not the same.

---

## 3. Advance preparation

First prepare the development dependencies guided by Quickstart.

- Docker + Docker Compose
- Rust / Cargo
- Foundry (used in the deployment stage)

reference:
- Quickstart guides the installation of `zkstack` using the `cargo install ... zkstack` method.
- The Gateway local experiment documentation also guides the use of `zkstackup`.

---

## 4. Local L2 deployment (Quickstart path)

### 4.1 ZK Stack CLI installation

```bash
cargo install --git https://github.com/matter-labs/zksync-era/ --locked zkstack --force
```

### 4.2 Ecosystem creation

```bash
zkstack ecosystem create
```

Recommended choices (based on local practice):

- zksync-era origin: `Clone for me`
- L1 network: `Localhost` (local reth container)
- chain id: default value (e.g. `271`) can be used
- wallet source: `Localhost` (using basic rich wallet)
- proofs: `NoProofs` (for development/testing purposes)
- data availability: choose between Rollup or Validium
- gas token: `Eth`

### 4.3 Ecosystem initialization

```bash
cd <YOUR_ECOSYSTEM_DIRECTORY>
zkstack ecosystem init --dev
```

### 4.4 Chain execution

```bash
zkstack server
```

When configuring multi-chain:

```bash
zkstack server --chain <CHAIN_NAME>
```

---

## 5. Check operation

Default RPC endpoint:

- L2 RPC: `http://localhost:3050`
- (When selecting local reth) L1 RPC: `http://localhost:8545`

### 5.1 Minimum verification (required)

1) Check process/port

```bash
ps aux | rg 'zkstack .*server|zksync_server' | rg -v rg
lsof -i :3050
```

2) Check L2 chain ID

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

3) Check block number

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

Passing criteria:

- The `zkstack server` (or `zksync_server`) process is running.
- `3050` port LISTEN status
- `eth_chainId` matches the chain ID set at creation
- `eth_blockNumber` responds with `0x0` or higher

### 5.2 Verify execution status (recommended)

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"zks_L1BatchNumber","params":[],"id":1}'
```

Passing criteria:

- `eth_syncing`가 `false`
- `zks_L1BatchNumber` responds with `0x0` or higher

### 5.3 Verification of local reth (L1) integration (when using local L1)

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

Passing criteria:

- L1 RPC responds normally (e.g. Localhost reth is `0x9`)

### 5.4 Actual measurement example (based on this repository)

If the values ​​below are confirmed, it can be judged as “local L2 startup + RPC normal + batch pipeline operation”.

- `eth_chainId` = `0x10f` (271)
- `eth_blockNumber` = `0x2` (or higher)
- `eth_syncing` = `false`
- `zks_L1BatchNumber` = `0x1` (or higher)
- `http://localhost:8545 eth_chainId` = `0x9`

### 5.5 One-click verification script

If repeated verification is required, use the script below.

```bash
./scripts/verify-zkstack-local.sh
```

If your environment is different, you can override the expected value with an environment variable.

```bash
L2_RPC_URL=http://localhost:3050 \
L1_RPC_URL=http://localhost:8545 \
EXPECTED_L2_CHAIN_ID=0x10f \
EXPECTED_L1_CHAIN_ID=0x9 \
./scripts/verify-zkstack-local.sh
```

Output rules:

- `PASS`: Verification passed
- `WARN`: Possible environment-dependent issues (e.g. L1 not used)
- `FAIL`: Immediate action required (e.g. chainId mismatch, RPC response failure)

### 5.6 Probe Server (optional, for dashboard advanced state)

Even if only the local L2 is run, the chain operates normally.
However, to accurately display the settlement card and `batcher/prover` status on the SentinAI dashboard, additionally run a probe.

```bash
npm run probe:zk:settlement
```

Default endpoint:
- `http://localhost:8081/status/settlement`

SentinAI integration example:

```bash
CHAIN_TYPE=zkstack \
ZKSTACK_MODE=legacy-era \
ZK_BATCHER_STATUS_URL=http://localhost:8081/status/settlement \
L2_RPC_URL=http://localhost:3050 \
L1_RPC_URLS=http://localhost:8545 \
npm run dev
```

caution:
- If `ZK_BATCHER_STATUS_URL` is not set, the settlement card will be hidden.
- This is an operation based on the principle of “not displaying unsupported/inaccurate data.”

### 5.7 server-v2 container mode integration (optional)

Set when using SentinAI in container orchestration mode.

```bash
ORCHESTRATOR_TYPE=docker
```

ZK Stack service name mapping (with default values):

- `ZKSTACK_EXECUTION_SERVICE` (default: `zkstack-core`)
- `ZKSTACK_BATCHER_SERVICE` (default: `zkstack-core`)
- `ZKSTACK_PROVER_SERVICE` (default: `zkstack-core`)
- `ZKSTACK_COMPONENT_PROFILE` (default: `core-only` in docker mode)

SentinAI implementation example:

```bash
CHAIN_TYPE=zkstack \
ORCHESTRATOR_TYPE=docker \
DOCKER_COMPOSE_FILE=/path/to/docker-compose.core-only.yml \
ZKSTACK_EXECUTION_SERVICE=zkstack-core \
ZKSTACK_BATCHER_SERVICE=zkstack-core \
ZKSTACK_PROVER_SERVICE=zkstack-core \
ZKSTACK_COMPONENT_PROFILE=core-only \
ZK_BATCHER_STATUS_URL=http://localhost:8081/status/settlement \
L2_RPC_URL=http://localhost:3050 \
L1_RPC_URLS=http://localhost:8545 \
npm run dev
```

explanation:
- If `zk-batcher` is not an independent container but an internal component of `server-v2`, it maps to `ZKSTACK_BATCHER_SERVICE=zkstack-core`.
- In core-only templates, `zk-prover` is also displayed based on the `zkstack-core` state.

---

## 6. Account Funding and Interaction

### 6.1 Using local rich account

```bash
zkstack dev rich-account --chain <CHAIN_NAME>
```

### 6.2 Bridge example (zksync-cli)

```bash
zksync-cli bridge deposit \
  --rpc=http://localhost:3050 \
  --l1-rpc=http://localhost:8545
```

---

## 7. Run Portal/Explorer (optional)

### 7.1 Portal

```bash
zkstack portal
```

Default port: `http://localhost:3030`

### 7.2 Explorer

```bash
zkstack explorer init
zkstack explorer backend --chain <CHAIN_NAME>
zkstack explorer run
```

Default port: `http://localhost:3010`

---

## 8. Gateway route (optional)

Gateway is an optional settlement/proof aggregation layer.
Based on the official documentation, the chain will initially start with Ethereum settlement and can then switch to Gateway.

Key prerequisite steps guided by the Gateway local experiment documentation:

```bash
foundryup-zksync -C 27360d4c8
zkstackup
zkstack ecosystem create
cd <YOUR_ECOSYSTEM_DIRECTORY>
zkstack ecosystem init --dev
```

caution:

- Gateway conversion affects chain distribution/settlement configuration, so verify it first in a test environment
- Separately verify chain operation modes (`legacy-era` vs `os-preview`)

---

## 9. Frequently encountered issues

1. `zkstack ecosystem init` takes a long time
- The first time may take a long time as it includes Rust build/container initialization.

2. Docker resource shortage
- Retry after increasing Docker memory/disk allocation

3. RPC is opened but transaction test fails
- There is a high possibility that the account L2 balance is insufficient → Recheck the rich account/bridge level

4. Version mismatch during gateway experiment
- Recheck the combination of the `foundry-zksync` commit and the latest version of `zkstack` specified in the documentation.

### 9.1 Execution Verification Troubleshooting Branch

Most maneuver failures can be quickly isolated by checking the steps below.

1) Symptom: `curl localhost:3050` connection failure

check:

```bash
ps aux | rg 'zkstack .*server|zksync_server' | rg -v rg
lsof -i :3050
```

Causes (main):

- `zkstack server` not running
- Another process is occupying port 3050
- Immediately after server startup (before binding)

action:

- `zkstack server --chain <CHAIN_NAME>` 재실행
- Restart after terminating the port conflict process
- Wait 10~20 seconds and retry

2) Symptom: `eth_chainId` mismatch

check:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

Causes (main):

- Connect to other chains/other ecosystem servers
- Run as default chain without `--chain` argument

action:

- Execute explicitly with `zkstack server --chain <CHAIN_NAME>`
- Compare results with chain id in `chains/<CHAIN_NAME>/configs/general.yaml`

3) Symptom: `eth_blockNumber` continues to be `0x0`

check:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"zks_L1BatchNumber","params":[],"id":1}'
```

Causes (main):

- Immediately after initialization, before batch creation
- Deployment progress stopped due to inability to link to L1

action:

- Recheck after 30~60 seconds
- Check `eth_chainId` response at `http://localhost:8545`
- Check postgres/reth container status with `docker ps`

4) Symptom: `eth_syncing` is `true` for a long time

check:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
```

Causes (main):

- Initial synchronization delay
- Insufficient local machine resources (CPU/Memory/Disk)

action:

- Docker memory/disk expansion
- Restart after cleaning up unnecessary containers/processes

5) Symptom: Error related to `forge --zksync` in `ecosystem init --dev`

check:

```bash
forge --version
forge build --help | rg zksync
```

Causes (main):

- General Foundry (`forge`) was caught first, so `--zksync` option is not supported.

action:

- Install/update `foundryup-zksync`
- Adjust PATH priority after checking `which forge`

6) Symptom: Initialization fails due to `ts-node`/TSConfig conflict.

check:

```bash
echo $TS_NODE_PROJECT
```

Causes (main):

- `tsconfig` in the parent workspace interferes with zkstack script execution.

action:

- Create TS config for exclusive use within the chain code base
- Run with `TS_NODE_PROJECT=<local-tsconfig-path> zkstack ecosystem init --dev`

---

## 10. Reference document (official)

- ZK Stack Quickstart: https://docs.zksync.io/zk-stack/running/quickstart
- Interact with your chain: https://docs.zksync.io/zk-stack/running/using-a-local-zk-chain
- ZK Stack Components: https://docs.zksync.io/zk-stack/components
- ZKsync OS Server: https://docs.zksync.io/zk-stack/components/server
- ZKsync Gateway (ZK Stack): https://docs.zksync.io/zk-stack/running/gateway-settlement-layer
- Gateway Overview (Protocol): https://docs.zksync.io/zksync-protocol/gateway
