# TON x402 Facilitator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a custom x402 facilitator that settles TON ERC-20 payments on Ethereum mainnet and Sepolia without requiring EIP-3009 or token contract upgrades.

**Architecture:** The buyer grants ERC-20 allowance to the facilitator spender once, then signs a facilitator-defined EIP-712 `PaymentAuthorization` per purchase. Merchant APIs forward the signed authorization to the facilitator, which validates policy constraints, executes `transferFrom`, stores settlement state, and returns a signed settlement proof.

**Tech Stack:** TypeScript, viem, Next.js/Node route handlers, Redis, Vitest

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
- chain id
- TON asset address
- Redis nonce prefix

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/types.ts src/lib/marketplace/facilitator/config.ts src/lib/__tests__/marketplace/facilitator/config.test.ts
git commit -m "feat(facilitator): add TON facilitator config profiles"
```

---

### Task 2: Define EIP-712 PaymentAuthorization

**Files:**
- Create: `src/lib/marketplace/facilitator/typed-data.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 1: Write the failing test**

Test:
- domain fields are correct
- typed data contains `buyer`, `merchant`, `asset`, `amount`, `resource`, `nonce`, `validAfter`, `validBefore`
- resource canonicalization works

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 3: Implement typed data helpers**

Functions:
- `getPaymentAuthorizationDomain(profile)`
- `getPaymentAuthorizationTypes()`
- `canonicalizeResource(resource)`

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

Back it with Redis if configured, otherwise in-memory fallback for dev.

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/nonce-store.ts src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts
git commit -m "feat(facilitator): add replay-protected nonce store"
```

---

### Task 5: Implement allowance and balance checks

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

### Task 6: Implement transferFrom settlement executor

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

### Task 7: Implement signed settlement receipts

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

Use either:
- detached ECDSA signature over canonical JSON
or
- compact JWS style payload

Prefer detached signature for minimal surface area.

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/receipt-signing.ts src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts
git commit -m "feat(facilitator): sign settlement receipts"
```

---

### Task 8: Build facilitator HTTP endpoints

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
- status lookup

**Step 2: Run the test to confirm failure**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 3: Implement the routes**

`POST /v1/settle` should:
- parse request
- load profile
- verify authorization
- consume nonce
- check funds
- execute transfer
- sign receipt
- persist settlement record

`GET /v1/settlements/:id` should:
- return stored settlement status

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 5: Commit**

```bash
git add src/app/api/facilitator/v1/settle/route.ts src/app/api/facilitator/v1/settlements/[id]/route.ts src/lib/__tests__/marketplace/facilitator/settle-route.test.ts
git commit -m "feat(facilitator): add settlement API routes"
```

---

### Task 9: Integrate merchant-side x402 verification

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
- call facilitator `/v1/settle`
- verify facilitator receipt signature
- compare `asset`, `amount`, `merchant`, `resource`

**Step 4: Run the test to confirm it passes**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/x402-middleware.ts src/lib/marketplace/facilitator-client.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
git commit -m "feat(marketplace): integrate TON facilitator settlement"
```

---

### Task 10: Add env docs and safety defaults

**Files:**
- Modify: `.env.local.sample`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design.md`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md`

**Step 1: Add env docs**

Document:
- `TON_FACILITATOR_MAINNET_ENABLED`
- `TON_FACILITATOR_SEPOLIA_ENABLED`
- `TON_FACILITATOR_MAINNET_RELAYER_KEY`
- `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`
- `TON_FACILITATOR_RECEIPT_SIGNING_KEY`
- `TON_FACILITATOR_REDIS_PREFIX`
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`

**Step 2: Update marketplace docs**

Record that TON settlement now uses approval-based pull, not EIP-3009.

**Step 3: Commit**

```bash
git add .env.local.sample docs/superpowers/specs/2026-03-11-agent-economy-design.md docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md
git commit -m "docs(facilitator): document TON approval-based x402 settlement"
```

---

### Task 11: Full verification

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
5. Confirm facilitator submits `transferFrom`
6. Confirm merchant returns 200

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(facilitator): add TON approval-based x402 facilitator"
```
