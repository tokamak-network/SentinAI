# AGENTS.md — src/lib/client-profile/

This directory implements the ClientProfile system for Proposal 31.

## Purpose

A ClientProfile describes HOW SentinAI interacts with a specific EVM EL client:
- Which RPC methods to call (blockNumber, syncStatus, txPool, peerCount, l2SyncStatus)
- How to parse responses (standard / nethermind / op-geth / nitro / custom)
- Which capabilities are supported

## Files

| File | Role |
|------|------|
| `types.ts` | ClientProfile, RpcMethodConfig, SyncStatusParser, CustomMetricConfig interfaces |
| `builtin-profiles.ts` | BUILTIN_PROFILES map: geth, reth, nethermind, besu, erigon, op-geth, nitro-node |
| `env-overrides.ts` | buildClientProfileFromEnv(), parseCustomMetricsFromEnv(), parseTopologyFromEnv() |
| `sync-parsers.ts` | NormalizedSyncStatus, parseSyncStatus(), getValueByPath() |
| `index.ts` | Re-exports all public API |

## Key Design Rules

1. **Never throw** from env-override parsers — return null/default on error, log warning
2. **SENTINAI_CLIENT_FAMILY** overrides auto-detection entirely
3. **SENTINAI_OVERRIDE_*** applies on top of any profile (built-in or detected)
4. **Nethermind** uses `parity_pendingTransactions` for txpool, not `txpool_status`
5. **nitro-node** looks like geth in web3_clientVersion — only `arb_blockNumber` probe distinguishes it

## Env Var Naming Convention

```
SENTINAI_CLIENT_FAMILY=<family>
SENTINAI_OVERRIDE_<FIELD>=<value>
SENTINAI_CAPABILITY_<NAME>=true|false
SENTINAI_CUSTOM_METRIC_<N>_<FIELD>=<value>   (N = 1..10)
SENTINAI_COMPONENTS=comp1,comp2,...
SENTINAI_COMPONENT_DEPS=<JSON>
SENTINAI_K8S_LABEL_<component>=<selector>
```
