# TON x402 Facilitator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a same-app custom x402 facilitator that settles TON ERC-20 payments on Ethereum mainnet and Sepolia without requiring EIP-3009 or token contract upgrades.

**Architecture:** The buyer grants ERC-20 allowance to the facilitator spender once, then signs a facilitator-defined EIP-712 `PaymentAuthorization` per purchase. Marketplace APIs forward the signed authorization to internal facilitator routes in the same SentinAI app, which validate policy constraints, execute `transferFrom`, store settlement state in Redis, and return a signed settlement proof. Live Sepolia validation on 2026-03-13 showed that current TON settlement only works when `merchant == relayer == spender`, so Phase 1 implementation and operator config must preserve that invariant.

**Tech Stack:** TypeScript, viem, Next.js route handlers, Redis, Vitest

---

## Implementation Preconditions

- This plan follows `docs/plans/2026-03-11-ton-x402-facilitator-design.md` as its execution baseline.
- If older marketplace/x402 docs still mention an EIP-3009-based TON flow, implement the approval-based pull facilitator path instead.
- If `src/lib/marketplace/x402-middleware.ts` and the buyer-facing marketplace route skeleton do not exist yet, implement the minimum x402 request/402/retry flow before facilitator integration.
- Phase 1 background reconciliation runs as a same-app in-process scheduler. A separate worker service is out of scope for this plan.
- For current TON deployment, the allowlist merchant address and the configured relayer/spender address must be the same operator-controlled address.

---

### Task 1: Define shared facilitator types and config

**Files:**
- Create: `src/lib/marketplace/facilitator/types.ts`
- Create: `src/lib/marketplace/facilitator/config.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/config.test.ts`

**Step 1: Write the failing test**

Test that config loads two profiles:
- mainnet TON: `0x2be5e8c109e2197D077D13A82dAead6a9b3433C5`
- sepolia TON: `0xa30fe40285b8f5c0457dbc3b7c8a280373c40044`

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`
Expected: missing module failure

**Step 3: Implement minimal config loader**

Include:
- facilitator address
- relayer private key env
- receipt signing key env
- chain id
- per-profile RPC URL env
- TON asset address
- Redis nonce/settlement shared prefix
- internal auth secret for marketplace to facilitator calls
- merchant allowlist env
- reconciler enabled/cron env

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/types.ts src/lib/marketplace/facilitator/config.ts src/lib/__tests__/marketplace/facilitator/config.test.ts
git commit -m "feat(facilitator): add TON facilitator config profiles"
```

---

### Task 2: Define EIP-712 PaymentAuthorization and canonical resource rules

**Files:**
- Create: `src/lib/marketplace/facilitator/typed-data.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 1: Write the failing test**

Test:
- domain fields are correct
- typed data contains `buyer`, `merchant`, `asset`, `amount`, `resource`, `nonce`, `validAfter`, `validBefore`
- resource canonicalization works
- only `/api/marketplace/*` paths are accepted
- inputs containing query strings, fragments, or origins are rejected
- trailing slash removal is consistent

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 3: Implement typed data helpers**

Functions:
- `getPaymentAuthorizationDomain(profile)`
- `getPaymentAuthorizationTypes()`
- `canonicalizeResource(resource)`

Canonicalization rules:
- only path-only resources are allowed
- `/api/marketplace/` prefix is required
- query strings are rejected
- fragments are rejected
- trailing slash is removed
- duplicate slashes are rejected

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/typed-data.ts src/lib/__tests__/marketplace/facilitator/typed-data.test.ts
git commit -m "feat(facilitator): add payment authorization typed data"
```

---

### Task 3: Implement signature verification

**Files:**
- Create: `src/lib/marketplace/facilitator/verify-authorization.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 1: Write the failing test**

Cover:
- valid signature
- wrong buyer
- wrong merchant
- wrong asset
- wrong amount
- expired authorization
- not-yet-valid authorization
- canonicalized resource mismatch
- unsupported network/profile

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 3: Implement verification**

Use viem to recover signer and compare all signed fields exactly.

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/verify-authorization.ts src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts
git commit -m "feat(facilitator): verify TON payment authorizations"
```

---

### Task 4: Add nonce store

**Files:**
- Create: `src/lib/marketplace/facilitator/nonce-store.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 1: Write the failing test**

Cover:
- fresh nonce accepted
- reused nonce rejected
- mainnet and sepolia namespaces are isolated

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 3: Implement nonce store**

Back it with Redis. Do not allow in-memory fallback in production paths because the same app may run multiple instances.

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/nonce-store.ts src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts
git commit -m "feat(facilitator): add replay-protected nonce store"
```

---

### Task 5: Add settlement store

**Files:**
- Create: `src/lib/marketplace/facilitator/settlement-store.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 1: Write the failing test**

Cover:
- settlement record creation
- single settlement lookup by settlement id
- pending settlement index lookup
- status transition from `submitted` to `settled` or `failed`
- chain namespace isolation

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 3: Implement settlement store**

Redis key schema:
- `{prefix}:facilitator:settlement:{chainId}:{settlementId}`
- `{prefix}:facilitator:pending:{chainId}`

Implementation:
- `createSettlement()`
- `getSettlement()`
- `listPendingSettlements()`
- `markSettlementStatus()`
- no in-memory fallback in production paths

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/settlement-store.ts src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts
git commit -m "feat(facilitator): add TON settlement store"
```

---

### Task 6: Implement allowance and balance checks

**Files:**
- Create: `src/lib/marketplace/facilitator/check-funds.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 1: Write the failing test**

Mock viem reads for:
- sufficient balance and allowance
- insufficient allowance
- insufficient balance

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 3: Implement balance and allowance reads**

Read:
- `balanceOf(buyer)`
- `allowance(buyer, facilitatorSpender)`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/check-funds.ts src/lib/__tests__/marketplace/facilitator/check-funds.test.ts
git commit -m "feat(facilitator): validate TON allowance and balance"
```

---

### Task 7: Implement transferFrom settlement executor

**Files:**
- Create: `src/lib/marketplace/facilitator/settle-transfer.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 1: Write the failing test**

Cover:
- successful `transferFrom`
- on-chain revert
- wrong merchant address blocked before submission

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 3: Implement settlement executor**

Use viem wallet client to call:
- `transferFrom(buyer, merchant, amount)`

Return:
- `txHash`
- `status=submitted`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/settle-transfer.ts src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts
git commit -m "feat(facilitator): execute TON transferFrom settlements"
```

---

### Task 8: Implement on-chain settlement verification

**Files:**
- Create: `src/lib/marketplace/facilitator/verify-settlement.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 1: Write the failing test**

Cover:
- correct TON contract target
- calldata decodes to `transferFrom(buyer, merchant, amount)`
- transaction receipt success
- `Transfer` log matches expected buyer, merchant, and amount
- mismatch in contract, calldata, or event causes failure

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 3: Implement on-chain verification**

Use viem to:
- fetch transaction
- fetch transaction receipt
- decode function data
- decode event logs

Return one of:
- `submitted`
- `settled`
- `failed`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/verify-settlement.ts src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts
git commit -m "feat(facilitator): verify TON settlements on-chain"
```

---

### Task 9: Implement detached signed settlement receipts

**Files:**
- Create: `src/lib/marketplace/facilitator/receipt-signing.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 1: Write the failing test**

Cover:
- receipt signing
- receipt verification
- tampered receipt rejection

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 3: Implement receipt signing**

Use detached ECDSA only.

Rules:
- create canonical JSON with lexicographically sorted keys
- serialize without whitespace
- hash `keccak256(canonicalJsonBytes)`
- sign the digest with the receipt signing key
- verify against the configured signer address on the marketplace side

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/receipt-signing.ts src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts
git commit -m "feat(facilitator): sign settlement receipts"
```

---

### Task 10: Build facilitator HTTP endpoints

**Files:**
- Create: `src/app/api/facilitator/v1/settle/route.ts`
- Create: `src/app/api/facilitator/v1/settlements/[id]/route.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 1: Write the failing route tests**

Cover:
- valid settle request
- invalid signature
- nonce replay
- insufficient allowance
- missing internal auth
- merchant allowlist mismatch
- status lookup

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 3: Implement the routes**

`POST /api/facilitator/v1/settle` should:
- parse request
- verify internal marketplace auth
- verify `x-sentinai-merchant-id`
- load profile
- verify authorization
- consume nonce
- check funds
- execute transfer
- sign receipt
- persist settlement record
- register the pending settlement index
- ensure the singleton reconciler is started

`GET /api/facilitator/v1/settlements/:id` should:
- return stored settlement status, including on-chain verification state
- read from the settlement store only, with no duplicated recomputation

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 5: Commit**

```bash
git add src/app/api/facilitator/v1/settle/route.ts src/app/api/facilitator/v1/settlements/[id]/route.ts src/lib/__tests__/marketplace/facilitator/settle-route.test.ts
git commit -m "feat(facilitator): add settlement API routes"
```

---

### Task 11: Add background reconciliation for submitted settlements

**Files:**
- Create: `src/lib/marketplace/facilitator/reconcile-settlements.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 1: Write the failing test**

Cover:
- submitted settlement becomes settled after successful on-chain verification
- submitted settlement becomes failed after receipt mismatch or revert
- already final settlements are skipped

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 3: Implement reconciliation**

Behavior:
- load submitted settlements
- call `verifySettlement()`
- persist `settled` or `failed`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/reconcile-settlements.ts src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts
git commit -m "feat(facilitator): reconcile submitted TON settlements"
```

---

### Task 12: Add reconciliation runner

**Files:**
- Create: `src/lib/marketplace/facilitator/reconcile-runner.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 1: Write the failing test**

Cover:
- `ensureFacilitatorReconcilerStarted()` registers the scheduler only once
- it does not start when `TON_FACILITATOR_RECONCILER_ENABLED=false`
- each cron tick invokes pending reconciliation

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 3: Implement runner**

Rules:
- use `node-cron`
- default cron: `*/15 * * * * *`
- keep a module-level singleton guard
- call `ensureFacilitatorReconcilerStarted()` from `POST /settle` or merchant verification paths

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/reconcile-runner.ts src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts
git commit -m "feat(facilitator): add settlement reconciler runner"
```

---

### Task 13: Integrate merchant-side x402 verification

**Files:**
- Modify: `src/lib/marketplace/x402-middleware.ts`
- Create: `src/lib/marketplace/facilitator-client.ts`
- Create: `src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 1: Write the failing test**

Cover:
- merchant forwards TON payment payload to facilitator
- merchant accepts valid signed receipt
- merchant rejects mismatched receipt fields

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 3: Implement facilitator client**

Merchant-side flow:
- parse X-PAYMENT
- call internal facilitator `/api/facilitator/v1/settle`
- send `x-sentinai-internal-auth` and `x-sentinai-merchant-id`
- verify facilitator receipt signature
- compare `asset`, `amount`, `merchant`, `resource`
- call `ensureFacilitatorReconcilerStarted()`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/x402-middleware.ts src/lib/marketplace/facilitator-client.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
git commit -m "feat(marketplace): integrate TON facilitator settlement"
```

---

### Task 14: Add env docs and safety defaults

**Files:**
- Modify: `.env.local.sample`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design.md`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md`

**Step 1: Add env docs**

Document:
- `TON_FACILITATOR_MAINNET_ENABLED`
- `TON_FACILITATOR_MAINNET_RPC_URL`
- `TON_FACILITATOR_MAINNET_ADDRESS`
- `TON_FACILITATOR_SEPOLIA_ENABLED`
- `TON_FACILITATOR_SEPOLIA_RPC_URL`
- `TON_FACILITATOR_SEPOLIA_ADDRESS`
- `TON_FACILITATOR_MAINNET_RELAYER_KEY`
- `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`
- `TON_FACILITATOR_RECEIPT_SIGNING_KEY`
- `TON_FACILITATOR_REDIS_PREFIX`
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`
- `TON_FACILITATOR_INTERNAL_AUTH_SECRET`
- `TON_FACILITATOR_RECONCILER_ENABLED`
- `TON_FACILITATOR_RECONCILER_CRON`

**Step 2: Update marketplace docs**

Record that TON settlement now uses approval-based pull inside same-app facilitator routes, not EIP-3009.

**Step 3: Commit**

```bash
git add .env.local.sample docs/superpowers/specs/2026-03-11-agent-economy-design.md docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md
git commit -m "docs(facilitator): document TON approval-based x402 settlement"
```

---

### Task 15: Full verification

**Files:**
- Existing files from prior tasks

**Step 1: Run focused facilitator tests**

Run:
```bash
npx vitest run src/lib/__tests__/marketplace/facilitator
```

Expected: all facilitator tests pass

**Step 2: Run marketplace settlement tests**

Run:
```bash
npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
```

Expected: pass

**Step 3: Run lint**

Run:
```bash
npm run lint
```

Expected: no new errors

**Step 4: Run build**

Run:
```bash
npm run build
```

Expected: no type or route errors

**Step 5: Manual smoke test**

Manual flow:
1. Approve facilitator spender on Sepolia TON
2. Request marketplace endpoint without payment, confirm 402
3. Sign `PaymentAuthorization`
4. Retry with `X-PAYMENT`
5. Confirm internal facilitator route submits `transferFrom`
6. Confirm marketplace returns 200
7. Confirm settlement later transitions to `settled` after on-chain verification

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(facilitator): add TON approval-based x402 facilitator"
```
