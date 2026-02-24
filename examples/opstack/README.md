# OP Stack Launcher (Minimal)

This directory keeps only the minimum files needed to run an OP Stack local L2 for SentinAI.

## Kept files

- `.env.example`
- `README.md`
- `scripts/start-op-stack.sh`
- `scripts/fetch-opstack.sh`

All heavy upstream example files are fetched on demand from `ethereum-optimism/docs` and cached under:

- `.cache/opstack/<OPSTACK_UPSTREAM_REF>/create-l2-rollup-example`

## Quick start

```bash
cd /absolute/path/to/SentinAI/examples/opstack
cp .env.example .env
# edit .env (L1_RPC_URL, L1_BEACON_URL, PRIVATE_KEY, L2_CHAIN_ID)

./scripts/start-op-stack.sh
```

## What `start-op-stack.sh` does

1. Validates required `.env` values.
2. Calls `scripts/fetch-opstack.sh`.
3. Fetches pinned upstream example (`OPSTACK_UPSTREAM_REF`) into `.cache/opstack/<ref>/...`.
4. Syncs local `.env` to runtime `.env` via symbolic link.
5. Applies compatibility patches and pins toolchain refs:
   - `OPSTACK_OP_DEPLOYER_REF` (op-deployer release tag)
   - `OPSTACK_OPTIMISM_REF` (optimism ref for op-program prestate)
6. Runs setup if needed (`setup-rollup.sh`) and starts Docker services.
7. Runs L2/L1 connectivity smoke checks.

## Options

```bash
# Re-fetch upstream cache and run
./scripts/start-op-stack.sh --force-fetch

# Force full setup/redeploy
./scripts/start-op-stack.sh --force-setup

# Skip L1 RPC smoke check
./scripts/start-op-stack.sh --skip-l1-test
```

## Expected execution time

- Re-run with existing setup artifacts: ~20s to 90s
- Re-run when containers are already up: ~3s to 15s
- With `--force-fetch`: add ~30s to 2m for upstream fetch/patch
- With `--force-setup`: ~10m to 25m+ (L1 deploy + prestate generation)

Notes:
- The longest step is typically `reproducible-prestate` in `setup-rollup.sh`.
- Sepolia RPC throughput limits (for example HTTP 429 from Alchemy/Infura) can significantly increase total time or cause setup failure.
- To measure your environment directly:

```bash
time ./scripts/start-op-stack.sh
time ./scripts/start-op-stack.sh --force-fetch --force-setup
```

## SentinAI `.env.local` mapping

The launcher prints a ready-to-copy block at the end. EOA addresses are auto-extracted from `deployer/.deployer/state.json` when available:

```bash
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=<printed-runtime-dir>/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example
CHAIN_TYPE=optimism
L2_CHAIN_ID=<your-L2_CHAIN_ID>
L2_RPC_URL=http://localhost:8545
SENTINAI_L1_RPC_URL=<your-L1_RPC_URL>
BATCHER_EOA_ADDRESS=<auto-extracted>
PROPOSER_EOA_ADDRESS=<auto-extracted>
CHALLENGER_EOA_ADDRESS=<auto-extracted>
```

EOA address lines are omitted if `state.json` is missing or does not contain the fields.

## Update policy

- Do not use `latest`.
- Change only pinned refs in `.env` when updating:
  - `OPSTACK_UPSTREAM_REF`
  - `OPSTACK_OP_DEPLOYER_REF`
  - `OPSTACK_OPTIMISM_REF`
- After changing pinned refs, run with full refresh:
  - `./scripts/start-op-stack.sh --force-fetch --force-setup`
- Review fetch logs and startup verification output after ref changes.
