# Self-Hosted First Onboarding Guide

This guide describes the **automatic first-run onboarding** flow for self-hosted SentinAI.

## Goal

Run container with RPC env vars once, and SentinAI will automatically:

1. Detect client type and chain capability
2. Register instance (idempotent)
3. Activate dashboard card

## Required Environment Variables

At least one endpoint is required:

- `L2_RPC_URL` (preferred for L2)
- `SENTINAI_L2_RPC_URL` (alias)
- `SENTINAI_L1_RPC_URL` or `L1_RPC_URL` (L1 EL)
- `CL_BEACON_URL` or `SENTINAI_L1_BEACON_URL` (L1 CL)

Optional:

- `SENTINAI_AUTO_BOOTSTRAP=true|false` (default: true)

## Docker Run Example

```bash
docker run --rm -p 8080:8080 \
  -e L2_RPC_URL=https://your-l2-rpc.example.com \
  -e SENTINAI_L1_RPC_URL=https://your-l1-rpc.example.com \
  sentinai:local
```

## What happens on first boot

During app startup (`src/instrumentation.ts`):

- scheduler initializes
- first-run bootstrap executes once per process
- if endpoint is valid, instance becomes `active`

If no onboarding env vars are present, bootstrap is skipped safely.

## Verify after startup

1. Open dashboard: `/v2`
2. Check instance list has 1 active instance
3. Optional API check:

```bash
curl -s http://localhost:8080/api/v2/instances | jq
```

## Optional: Real RPC Integration Test

Run this test with your real RPC URL:

```bash
SENTINAI_REAL_RPC_URL=https://your-rpc.example.com \
SENTINAI_REAL_NODE_TYPE=opstack-l2 \
npm run test:real-rpc:onboarding
```

- The test is skipped when `SENTINAI_REAL_RPC_URL` is not set.
- Use this for self-hosted verification without modifying default mock-based CI tests.
