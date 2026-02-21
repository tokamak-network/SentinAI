# OP Stack Integration Template for SentinAI

This directory provides a standard example template for connecting a local OP Stack chain to SentinAI.

## Files

- `.env.example`: Base environment variable template for SentinAI + OP Stack integration

## Quick Start

1. Start your OP Stack chain (including `op-geth`, `op-node`, `op-batcher`, `op-proposer`, and `op-challenger`).
2. Configure `.env.local` using `examples/opstack/.env.example` as a reference.
3. Start SentinAI.
   - `npm run dev`
4. Verify integration status.
   - `curl -s http://localhost:3002/api/metrics`

## Notes

- `DOCKER_COMPOSE_FILE` must be set to the absolute path of your actual OP Stack compose file.
- If Docker service names differ from default component names (`op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger`), some status collection/actions may be limited.
- To use dispute game monitoring, set `FAULT_PROOF_ENABLED=true` and configure `DISPUTE_GAME_FACTORY_ADDRESS`.
