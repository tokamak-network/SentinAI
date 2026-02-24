# OP Stack Create L2 Rollup Example (Docker)

This directory is a Docker-based OP Stack L2 deployment example for local operation.
It is based on Optimism's official tutorial and example repository.

- Tutorial: https://docs.optimism.io/chain-operators/tutorials/create-l2-rollup/create-l2-rollup
- Upstream example: https://github.com/ethereum-optimism/docs/tree/main/create-l2-rollup-example

## What this example deploys

- `op-geth` (execution client)
- `op-node` (rollup node)
- `op-batcher`
- `op-proposer`
- `op-challenger`
- `dispute-mon`

The L2 services run locally in Docker. L1 contract deployment and data publishing use Sepolia RPC endpoints configured in `.env`.

## Prerequisites

- Docker (with Docker Compose plugin)
- `make`
- `jq`
- `git`
- Sepolia RPC + Beacon RPC
- Sepolia ETH in the deployment wallet

## Quick start

```bash
cd /absolute/path/to/SentinAI/examples/opstack
cp .env.example .env
# Edit .env: L1_RPC_URL, L1_BEACON_URL, PRIVATE_KEY, L2_CHAIN_ID

./scripts/start-op-stack.sh
make status
make test-l1
make test-l2
```

One-click behavior:
- First run: downloads `op-deployer` (if missing), deploys/contracts/configures, then starts services.
- Later runs: reuses existing deployment artifacts and only starts/stabilizes services.
- To force full redeploy: `./scripts/start-op-stack.sh --force-setup`
- Makefile alias is also available: `make start-op-stack` / `make start-op-stack-force`

## Common commands

```bash
# Show status
make status

# Follow all logs
make logs

# Follow logs from one service
make logs-op-node

# Stop
make down

# Remove containers and volumes
make clean
```

## Service ports

| Service | Port | Purpose |
| --- | --- | --- |
| `op-geth` | `8545` | L2 HTTP RPC |
| `op-geth` | `8546` | L2 WS RPC |
| `op-geth` | `8551` | Auth RPC for `op-node` |
| `op-node` | `8547` | Rollup RPC |
| `op-node` | `9222` | P2P |
| `dispute-mon` | `7300` | Metrics |

## Connect SentinAI

1. Open `<repo-root>/.env.local`.
2. Set values using `examples/opstack/.env.example`.
3. Ensure:

```bash
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/absolute/path/to/SentinAI/examples/opstack/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example
L2_RPC_URL=http://localhost:8545
CHAIN_TYPE=optimism
```

4. Start SentinAI:

```bash
cd /absolute/path/to/SentinAI
npm run dev
```

5. Verify:

```bash
curl -s http://localhost:3002/api/metrics | jq '{status: .status, blockHeight: .metrics.blockHeight, errors: (.errors // [])}'
```

## Notes

- This example keeps `op-node` P2P disabled by default (`--p2p.disable`) for single-node local runs.
- For production/public networking, remove `--p2p.disable` and configure P2P advertise/listen settings.
- Never commit real private keys to version control.

## Detailed Guide

- `SENTINAI_INTEGRATION_GUIDE.md` includes end-to-end steps from L2 deployment to SentinAI integration and verification.
