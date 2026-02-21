# ZK L2 Example Execution/Setting/End Runbook

Base date: 2026-02-20

This document covers the procedures for quickly raising a local ZK L2, connecting to SentinAI, and shutting down safely, based on the `examples/zkstack/` template.

---

## 1. Preparation

essential:
- Docker / Docker Compose
- Install `zkstack` CLI
- Working from the root of this repository

Reference template:
- `examples/zkstack/.env.example`
- `examples/zkstack/docker-compose.core-only.yml`
- `examples/zkstack/secrets.container.yaml.example`

---

## 2. Settings

### 2.1 ZK Stack ecosystem creation/initialization

```bash
zkstack ecosystem create
cd <YOUR_ECOSYSTEM_DIR>
zkstack ecosystem init --dev
```

After initialization, the following paths are created:
- Chain config directory: `<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs`

### 2.2 Create secrets file for container

```bash
cp /Users/theo/workspace_tokamak/SentinAI/examples/zkstack/secrets.container.yaml.example \
  <YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs/secrets.container.yaml
```

Replace `validator_key` and `node_key` with actual values ​​generated from the chain.

### 2.3 SentinAI `.env.local` settings

Minimal example:

```bash
CHAIN_TYPE=zkstack
ZKSTACK_MODE=legacy-era
ORCHESTRATOR_TYPE=docker

L2_RPC_URL=http://localhost:3050
L1_RPC_URLS=http://localhost:8545
ZK_BATCHER_STATUS_URL=http://localhost:8081/status/settlement

DOCKER_COMPOSE_FILE=examples/zkstack/docker-compose.core-only.yml
DOCKER_COMPOSE_PROJECT=zkstack_core
ZKSTACK_EXECUTION_SERVICE=zkstack-core
ZKSTACK_BATCHER_SERVICE=zkstack-core
ZKSTACK_PROVER_SERVICE=zkstack-core
ZKSTACK_COMPONENT_PROFILE=core-only
```

When running `examples/zkstack/docker-compose.core-only.yml`, the environment variables below are also required.
- `HOST_WORKSPACE_ROOT`: Workspace absolute path (e.g. `/Users/theo/workspace_tokamak/SentinAI`)
- `ZKSTACK_CONFIG_DIR`: Chain config absolute path (e.g. `<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs`)

---

## 3. Run

Execute in the order below.

### 3.1 L1(reth)/Postgres execution

Use compose created by `zkstack ecosystem init --dev`.

```bash
cd <YOUR_ECOSYSTEM_DIR>
docker compose up -d reth postgres
```

### 3.2 ZK server-v2 core-only 실행

Run from SentinAI repository root:

```bash
cd /Users/theo/workspace_tokamak/SentinAI
HOST_WORKSPACE_ROOT=/Users/theo/workspace_tokamak/SentinAI \
ZKSTACK_CONFIG_DIR=<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs \
docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core up -d
```

### 3.3 Run settlement probe (optional, recommended)

```bash
npm run probe:zk:settlement
```

### 3.4 Running SentinAI

```bash
npm run dev
```

---

## 4. Verification

### 4.1 RPC Verification

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### 4.2 Check SentinAI metrics

```bash
curl -s http://localhost:3002/api/metrics
```

Key confirmation points:
- `chain.type = "zkstack"`
- Show `zksync-server` in `components`
- `settlement.enabled = true` (when running probe)

### 4.3 Process/Container Verification

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Core container:
- `zkstack-core`
- `zkstack-apis`
- `reth`
- `postgres`

---

## 5. End

### 5.1 End of SentinAI

```bash
pkill -f 'next dev -p 3002' || true
```

### 5.2 Probe termination

If you run the probe in the foreground, exit with `Ctrl+C`.

When running in the background:

```bash
pkill -f 'zk-settlement-probe.mjs' || true
```

### 5.3 ZK core-only container termination

```bash
cd /Users/theo/workspace_tokamak/SentinAI
HOST_WORKSPACE_ROOT=/Users/theo/workspace_tokamak/SentinAI \
ZKSTACK_CONFIG_DIR=<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs \
docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core down
```

### 5.4 L1/Postgres shutdown

```bash
cd <YOUR_ECOSYSTEM_DIR>
docker compose down
```

To also remove data:

```bash
docker compose down -v
```

---

## 6. Troubleshooting

### Q1. `zkstack-core` is floating but `components` appears empty
- Check the settings `ORCHESTRATOR_TYPE=docker` and `DOCKER_COMPOSE_FILE`.
- Check if `ZKSTACK_COMPONENT_PROFILE=core-only`.

### Q2. Settlement card not visible
- Check whether `ZK_BATCHER_STATUS_URL` is set.
- Check whether `npm run probe:zk:settlement` is executed.

### Q3. Autoscaling is not applied
- Check `autoScalingEnabled` in `/api/scaler`
Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
Error 500 (Server Error)!!1500.That’s an error.There was an error. Please try again later.That’s all we know.
