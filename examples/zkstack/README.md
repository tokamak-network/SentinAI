# ZK Stack Integration Template for SentinAI

This directory provides a standard example template for reproducing ZK Stack integration without directly depending on the `external/` repository.

## Files

- `.env.example`: Base environment variable template for SentinAI + ZK Stack integration
- `docker-compose.core-only.yml`: Server-v2 template that starts only core runtime services (`zkstack-core`, `zkstack-apis`)
- `secrets.container.yaml.example`: Example secrets file for connecting containerized services to host L1/Postgres
- `settlement-probe-response.example.json`: Example response schema for `ZK_BATCHER_STATUS_URL` probe

## Quick Start

1. Merge template values into `.env.local`.
2. Start `zkstack-core` and `zkstack-apis` using `docker-compose.core-only.yml`.
   - Example:
     - `cp examples/zkstack/secrets.container.yaml.example <ecosystem>/chains/<chain>/configs/secrets.container.yaml`
     - `HOST_WORKSPACE_ROOT=/absolute/path/to/workspace`
     - `ZKSTACK_CONFIG_DIR=/absolute/path/to/<ecosystem>/chains/<chain>/configs`
     - `docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core up -d`
3. Use the default compose created by `zkstack ecosystem init --dev` for L1 (reth) and Postgres.
4. Run the probe server.
   - `npm run probe:zk:settlement`
5. Run SentinAI.
   - `npm run dev`

## Notes

- `external/zkstack-local/...` paths are for reference only. Maintain operational templates in this directory.
- If `ZK_BATCHER_STATUS_URL` is not set, the settlement card is hidden.
- When `ORCHESTRATOR_TYPE=docker` is enabled, you can apply service mapping via `ZKSTACK_*_SERVICE`.
- In the core-only template, default mapping for `execution/batcher/prover` is `zkstack-core`.
