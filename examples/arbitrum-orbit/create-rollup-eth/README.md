# Arbitrum Orbit Example (ETH Gas Token Rollup)

This directory provides a runnable Arbitrum Orbit deployment example for the ETH gas token flow, based on the official Arbitrum Chain SDK sample.

## Source Reference

- Arbitrum docs overview: https://docs.arbitrum.io/get-started/overview
- Orbit deploy guide: https://docs.arbitrum.io/launch-orbit-chain/how-tos/orbit-sdk-deploying-rollup-chain
- Upstream sample: https://github.com/OffchainLabs/arbitrum-chain-sdk/tree/main/examples/create-rollup-eth

## Files

- `.env.example`: required and optional deployment keys/RPC
- `index.ts`: high-level rollup deployment flow (`createRollup`)
- `low_level.ts`: low-level transaction flow for the same deployment
- `package.json`, `tsconfig.json`: local runtime/tooling config

## Quick Start

1. Install dependencies.
   - `npm install`
2. Copy the env template.
   - `cp .env.example .env`
3. Fill required env vars.
   - `DEPLOYER_PRIVATE_KEY` (required)
   - `PARENT_CHAIN_RPC` (recommended to avoid timeout)
4. Run the example.
   - High-level flow: `npm run dev`
   - Low-level flow: `npm run dev:low-level`

## Environment Variables

Required:
- `DEPLOYER_PRIVATE_KEY`

Optional (auto-generated if empty):
- `BATCH_POSTER_PRIVATE_KEY`
- `VALIDATOR_PRIVATE_KEY`

Optional (recommended):
- `PARENT_CHAIN_RPC`

## Notes

- This sample focuses on Orbit rollup contract deployment and does not bootstrap full node infrastructure by itself.
- If you see timeout errors, use a stable RPC endpoint for the parent chain.
- Ensure the deployer account has sufficient funds on the selected parent chain.
