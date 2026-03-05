# Blockchain Infrastructure Rules

> IF 블록체인 인프라 → READ this file

## L1/L2 RPC Separation

- Separate `SentinAI internal L1 RPC` (monitoring) and `L2 node L1 RPC` (via Proxyd) through different env/function paths.
- Never share RPC endpoints between SentinAI monitoring and L2 node operations.

## Chain Plugin Contracts

- Chain capability metadata must be the single source of truth for dashboard/API/MCP exposure.
- Adding a new chain = 4 files in `src/chains/<chain>/` (index, components, prompts, playbooks).
- When chain plugin imports `viem/chains`, ALL test mocks for `viem/chains` must export every chain used by the plugin.

## Operational Safety

- Optional autonomy modules must degrade gracefully and never break the core scaling loop.
- Heartbeat guardrails should include in-process watchdog (`detect -> alert -> recovery attempt`).
- Watchdog alerting and auto-recovery paths must enforce independent cooldown windows.
- K8s token caching must respect the real `expirationTimestamp` from AWS EKS, not hardcoded TTL.
