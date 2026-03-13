# TON x402 Facilitator Testing Guide

## Purpose

This guide captures the testing scenarios and operator steps for the TON x402 facilitator flow in SentinAI.

Use this document when:
- preparing Sepolia test values
- validating the buyer-facing `402 Payment Required` flow
- running the live facilitator smoke script later
- reviewing whether the current implementation is production-ready

This guide documents the plan only. It does not imply that live Sepolia validation has already been completed.

## Current Scope

The implemented surface currently covers:
- buyer-facing protected product route: `/api/marketplace/sequencer-health`
- internal facilitator settle route: `/api/facilitator/v1/settle`
- internal settlement read route: `/api/facilitator/v1/settlements/:id`
- merchant-side facilitator verification
- Redis-backed settlement state and reconciler
- Sepolia smoke script: `npm run smoke:ton:facilitator`

## Preconditions

Before running live tests, prepare these items:

- a Sepolia RPC endpoint
- Redis reachable by the app
- a relayer EOA with Sepolia ETH for gas
- a separate receipt signing private key
- a buyer EOA with Sepolia TON balance
- a merchant receiver address
- a buyer allowance from the buyer EOA to the relayer EOA

Required env fields:
- `TON_FACILITATOR_SEPOLIA_ENABLED`
- `TON_FACILITATOR_SEPOLIA_RPC_URL`
- `TON_FACILITATOR_SEPOLIA_ADDRESS`
- `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`
- `TON_FACILITATOR_RECEIPT_SIGNING_KEY`
- `TON_FACILITATOR_REDIS_PREFIX`
- `TON_FACILITATOR_INTERNAL_AUTH_SECRET`
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`
- `TON_FACILITATOR_SMOKE_BUYER_KEY`
- `TON_FACILITATOR_SMOKE_MERCHANT_ID`
- `TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS`
- `TON_FACILITATOR_SMOKE_RESOURCE`
- `TON_FACILITATOR_SMOKE_AMOUNT`

## Test Layers

### 1. Focused Automated Tests

Goal:
- verify pure logic and route behavior without real chain dependencies

Command:

```bash
npx vitest run \
  src/app/api/marketplace/sequencer-health/route.test.ts \
  src/lib/__tests__/marketplace/facilitator \
  src/lib/__tests__/marketplace/facilitator-client.test.ts \
  src/lib/__tests__/marketplace/x402-middleware.test.ts \
  src/lib/__tests__/marketplace/facilitator-smoke.test.ts
```

Expected:
- all focused facilitator tests pass
- `sequencer-health` route returns `402` when `X-PAYMENT` is missing
- paid path verifies through merchant-side facilitator logic

### 2. Static Verification

Goal:
- catch TypeScript, route wiring, and lint regressions

Commands:

```bash
npm run lint
npm run build
```

Expected:
- `lint` exits successfully
- `build` exits successfully
- existing repository warnings may remain, but no new blocking errors should appear

### 3. Local Buyer-Facing Flow Check

Goal:
- inspect the actual `402 Payment Required` response shape before touching Sepolia

Start the app:

```bash
npm run dev
```

Call the protected route without payment:

```bash
curl -i http://localhost:3002/api/marketplace/sequencer-health
```

Expected:
- HTTP status `402`
- response includes:
  - `network`
  - `asset`
  - `amount`
  - `merchant`
  - `resource`
  - `facilitator.spender`
  - EIP-712 `domain`
  - EIP-712 `types`

Review points:
- spender matches relayer EOA
- merchant matches allowlist
- resource matches `/api/marketplace/sequencer-health`
- network is `eip155:11155111`

## Live Sepolia Scenarios

### Scenario A. Happy Path

Goal:
- prove the complete marketplace purchase flow works end to end

Steps:
1. Start the app with facilitator env loaded.
2. Ensure the buyer has enough Sepolia TON.
3. Ensure the buyer has approved `TON_FACILITATOR_SEPOLIA_ADDRESS`.
4. Run:

```bash
npm run smoke:ton:facilitator
```

Expected:
- buyer balance check passes
- allowance check passes
- authorization signing passes
- facilitator settle route returns receipt
- settlement record is readable
- settlement ends in `submitted` or `settled`
- if reconciler runs in time, final status becomes `settled`

Success evidence:
- receipt contains `settlementId`
- receipt contains `txHash`
- settlement record shows matching buyer, merchant, amount, and resource

### Scenario B. Missing Allowance

Goal:
- verify the system fails before settlement submission when the buyer has not approved the relayer

Setup:
- buyer holds enough TON
- buyer allowance to relayer is zero or below the required amount

Run:

```bash
npm run smoke:ton:facilitator
```

Expected:
- script fails at allowance check
- no settlement transaction is submitted

### Scenario C. Wrong Merchant Allowlist

Goal:
- prove that mismatched merchant configuration is rejected before payment execution

Setup:
- set `TON_FACILITATOR_SMOKE_MERCHANT_ADDRESS` to a value that does not match the allowlist entry

Run:

```bash
npm run smoke:ton:facilitator
```

Expected:
- script fails before settlement submission
- error points to merchant allowlist mismatch

### Scenario D. Invalid Buyer Payment Header

Goal:
- verify that the product route stays protected when the buyer sends an invalid `X-PAYMENT`

Method:
- manually alter a signed `PaymentAuthorization`
- retry the protected route with the tampered `X-PAYMENT`

Expected:
- route returns `402`
- response still includes payment requirements for retry

### Scenario E. Reconciliation Lag

Goal:
- verify the system handles `submitted` state correctly before final settlement confirmation

Setup:
- use normal happy-path config
- run the smoke script during a normal reconciler interval

Expected:
- initial facilitator receipt may say `submitted`
- later settlement reads move to `settled`
- no silent disappearance from Redis pending state

## Validation Checklist

Use this checklist during live verification:

- `402` route returns correct payment requirements
- spender equals relayer EOA public address
- buyer approves the spender, not the TON token contract
- buyer signs the exact resource path
- facilitator verifies signature and replay nonce
- on-chain transfer uses `transferFrom(buyer, merchant, amount)`
- signed settlement receipt verifies locally
- settlement read route returns the stored record
- `submitted -> settled` transition works

## Known Current Limits

- only one buyer-facing paid product route is implemented: `/api/marketplace/sequencer-health`
- there is no external buyer SDK yet
- the smoke script is prepared but live Sepolia execution may still expose operational issues not covered by unit tests
- relayer EOA is the spender in Phase 1; this is simpler operationally but should be reviewed again before production rollout

## Recommended Next Test Order

Run later in this exact order:

1. Focused automated tests
2. `npm run lint`
3. `npm run build`
4. Local `curl` check for `402 Payment Required`
5. Live Sepolia smoke with valid allowance
6. Negative Sepolia checks:
   - missing allowance
   - wrong merchant allowlist
   - tampered payment header

## Result Recording Template

When tests are eventually run, record results under `docs/verification/` with:
- date
- env target
- commit or branch
- exact commands
- pass/fail summary
- tx hash if live settlement occurred
- screenshots or raw JSON only when needed
