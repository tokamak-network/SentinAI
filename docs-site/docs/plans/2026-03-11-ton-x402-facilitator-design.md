# TON x402 Facilitator Design

> Date: 2026-03-11
> Status: Draft
> Scope: TON ERC-20 on Ethereum mainnet/sepolia, without token contract upgrades, using a same-app facilitator deployment

> Implementation baseline: this English design doc is aligned to the Korean Phase 1 source of truth. If older marketplace/x402 docs still describe an EIP-3009-based TON path, the approval-based pull facilitator defined here takes precedence for TON settlement.

---

## 1. Problem

SentinAI wants to use TON as the settlement asset for x402-protected marketplace APIs.

Constraints:
- TON is already deployed as an ERC-20 token on Ethereum mainnet and Sepolia.
- The deployed TON token does **not** support EIP-3009.
- The token contract must **not** be upgraded or replaced.
- SentinAI still wants an x402-style payment UX:
  - merchant returns HTTP 402
  - buyer signs a payment authorization
  - merchant verifies settlement through a facilitator
  - merchant returns the protected resource only after settlement is accepted

This means the standard EIP-3009 settlement path is unavailable. A custom facilitator-based settlement method is required.

---

## 2. Decision

Use an **approval-based pull facilitator** deployed inside the same SentinAI app.

Summary:
- Buyer performs a one-time `approve()` on the TON ERC-20 contract for the facilitator spender.
- Buyer does **not** sign a token-native authorization.
- Buyer signs a facilitator-defined EIP-712 `PaymentAuthorization`.
- Facilitator verifies the signature and policy constraints, then executes `transferFrom(buyer, merchant, amount)`.

Live Sepolia result recorded on 2026-03-13:
- `merchant != relayer` failed on-chain with `SeigToken: only sender or recipient can transfer`.
- `merchant == relayer == spender` succeeded in live smoke and settled in block `10438414`.
- Phase 1 must therefore treat `merchant == relayer == spender` as a hard runtime constraint for TON settlement.

Why this is the chosen design:
- No changes to the deployed TON token contract
- Merchant receives real TON ERC-20 directly
- Preserves the x402 HTTP flow and facilitator role without requiring a separate service for Phase 1
- Keeps custody low compared with a prefunded balance model

---

## 3. Alternatives Considered

### Option A: Approval-Based Pull Facilitator

Buyer approves facilitator once. Facilitator later pulls exact amounts with `transferFrom`.

Pros:
- No contract changes
- Direct TON settlement to merchant
- Closest to existing x402 mental model

Cons:
- Requires initial on-chain approval
- Facilitator becomes a powerful spender and must be tightly constrained

### Option B: Prefunded Facilitator Balance

Buyer deposits TON into a facilitator vault. Later x402 purchases consume internal balances.

Pros:
- Best recurring-payment UX
- No per-request allowance concerns

Cons:
- Custodial
- Withdrawal/accounting complexity
- Larger trust surface

### Option C: Wrapper Token or Credit Layer

Buyer deposits TON and receives an x402-friendly wrapper asset or credit.

Pros:
- Cleaner protocol design
- Easy to support recurring flows

Cons:
- Not direct TON settlement
- Introduces a new asset and redemption path

### Recommendation

Choose **Option A** for Phase 1.

It is the least invasive path that still results in direct TON ERC-20 settlement without touching the deployed token contract.

---

## 4. High-Level Architecture

```
Buyer Wallet
  ├─ One-time approve(TON, facilitatorSpender, allowance)
  └─ Sign EIP-712 PaymentAuthorization
           │
           ▼
SentinAI App
  ├─ Marketplace API (/api/marketplace/*)
  │   ├─ Returns 402 with facilitator metadata
  │   ├─ Receives X-PAYMENT header
  │   └─ Calls internal facilitator route or orchestrator
  │
  └─ Facilitator API (/api/facilitator/v1/*)
      ├─ Verify EIP-712 signature
      ├─ Validate nonce / deadline / resource / amount / merchant / asset
      ├─ Check allowance and balance
      ├─ Execute transferFrom(buyer, merchant, amount)
      └─ Return signed settlement proof
           │
           ▼
TON ERC-20 Contract
```

Trust boundary:
- Buyer trusts facilitator only within the limits of ERC-20 allowance and signed authorization policy.
- Merchant trusts facilitator settlement proofs.
- Facilitator must be policy-constrained and auditable even though it is co-located in the same app runtime.

Phase 1 implementation boundary:
- Buyer-facing endpoints remain under `/api/marketplace/*`.
- `/api/facilitator/v1/*` may be routable, but must only accept marketplace-internal calls in practice.
- Phase 1 background reconciliation runs as a same-app in-process scheduler, not as a separate worker service.
- This design assumes SentinAI is deployed as a long-running Node process. Serverless deployment is out of scope.
- Phase 1 TON deployment must use the same SentinAI-controlled address for the allowlist merchant, relayer caller, and buyer-facing spender target.

---

## 5. Payment Flow

### 5.1 One-Time Setup

Buyer performs:

```solidity
approve(facilitatorSpender, allowance)
```

This may be exact-per-purchase, bounded, or high allowance. Phase 1 should support any valid allowance but strongly recommend bounded approvals in UI/docs.

For current TON deployment, `facilitatorSpender` is also the merchant receiver address because the token only accepted settlement when caller and recipient were the same operator-controlled address.

### 5.2 Protected Resource Request

1. Buyer requests `GET /api/marketplace/sequencer-health`
2. Merchant returns `402 Payment Required`
3. Response includes:
   - `asset`
   - `amount`
   - `payTo`
   - `facilitatorPath`
   - `facilitatorAddress`
   - `settlementMethod=evm-approval-transferFrom`
   - for TON Phase 1, `payTo == facilitatorAddress == approved spender`

### 5.3 Buyer Signs PaymentAuthorization

Buyer signs a facilitator-specific EIP-712 message.

### 5.4 Marketplace Calls Facilitator

Marketplace sends the authorization to the internal facilitator component:
- signature
- typed data payload
- internal merchant authentication

### 5.5 Facilitator Settles

Facilitator:
- verifies signature
- verifies policy fields
- checks unused nonce
- checks deadline
- checks asset / merchant / amount / resource
- checks balance and allowance
- executes `transferFrom`

For TON Phase 1, the `merchant` in the signed authorization must equal the relayer caller and the buyer-approved spender. A separate merchant receiver is not supported by the token's current transfer rules.

### 5.6 Marketplace Releases Resource

Marketplace only returns the protected resource after facilitator confirms settlement acceptance.

---

## 6. Typed Data Design

Domain:

```ts
{
  name: 'SentinAI x402 TON Facilitator',
  version: '1',
  chainId,
  verifyingContract: facilitatorAddress,
}
```

Type:

```ts
PaymentAuthorization {
  buyer: address
  merchant: address
  asset: address
  amount: uint256
  resource: string
  nonce: bytes32
  validAfter: uint256
  validBefore: uint256
}
```

Why each field exists:
- `buyer`: token source account
- `merchant`: exact payment recipient; in current TON Phase 1 this must equal the relayer/spender address
- `asset`: chain-specific TON token
- `amount`: exact payment value
- `resource`: binds payment to the purchased API resource
- `nonce`: replay protection
- `validAfter` / `validBefore`: short-lived authorization window

Important design rule:
- `resource` must be canonicalized. Two semantically identical URLs must normalize to the same value or be rejected.

Phase 1 canonical resource rules:
- `resource` must be an absolute path that starts with `/api/marketplace/`.
- Reject any value containing origin, protocol, host, or fragment data.
- Phase 1 does not allow query strings. Reject any value containing `?`.
- Remove a trailing slash, but reject duplicate slashes within the path body.
- The canonicalized value is a path-only string, and the same canonicalization function must run before signing and before settlement verification.
- If paid query-based resources are needed later, add a separate signed field instead of overloading `resource`.

---

## 7. HTTP API Contract

### 7.1 Marketplace 402 Response

Example:

```json
{
  "x402Version": 2,
  "error": "Payment Required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:1",
      "resource": "/api/marketplace/sequencer-health",
      "maxAmountRequired": "100000000000000000",
      "payTo": "0xMerchant...",
      "asset": "0x2be5e8c109e2197D077D13A82dAead6a9b3433C5",
      "extra": {
        "settlementMethod": "evm-approval-transferFrom",
        "facilitatorPath": "/api/facilitator/v1/settle",
        "facilitatorAddress": "0xFacilitator...",
        "requiredAllowanceTarget": "0xFacilitator..."
      }
    }
  ]
}
```

Phase 1 consistency rule:
- `payTo`, `extra.facilitatorAddress`, and `extra.requiredAllowanceTarget` must resolve to the same address on TON.

### 7.2 Buyer X-PAYMENT Header

Example payload before base64 encoding:

```json
{
  "x402Version": 2,
  "scheme": "exact",
  "network": "eip155:1",
  "payload": {
    "authorization": {
      "buyer": "0xBuyer...",
      "merchant": "0xMerchant...",
      "asset": "0x2be5e8c109e2197D077D13A82dAead6a9b3433C5",
      "amount": "100000000000000000",
      "resource": "/api/marketplace/sequencer-health",
      "nonce": "0x...",
      "validAfter": 1741680000,
      "validBefore": 1741680300
    },
    "signature": "0x..."
  }
}
```

### 7.3 Internal Facilitator API

`POST /api/facilitator/v1/settle`
- Input: authorization, signature, internal merchant auth
- Output: settlement acceptance + signed proof

`GET /api/facilitator/v1/settlements/:settlementId`
- Input: settlement id
- Output: `pending | settled | failed` plus proof details

Design rule:
- Buyer never calls facilitator routes directly.
- Facilitator routes are internal payment endpoints exposed only to marketplace handlers or allowlisted internal callers.

Required internal auth contract:
- Marketplace sends `x-sentinai-internal-auth` with the `TON_FACILITATOR_INTERNAL_AUTH_SECRET` value.
- Marketplace sends `x-sentinai-merchant-id` with the internal merchant identifier.
- Facilitator must validate both the shared secret and the merchant allowlist entry.
- Missing secret or merchant id must fail closed with `401` or `403`.

Minimum `POST /api/facilitator/v1/settle` request body:

```json
{
  "network": "eip155:1",
  "authorization": {
    "buyer": "0xBuyer...",
    "merchant": "0xMerchant...",
    "asset": "0x2be5e8c109e2197D077D13A82dAead6a9b3433C5",
    "amount": "100000000000000000",
    "resource": "/api/marketplace/sequencer-health",
    "nonce": "0x...",
    "validAfter": 1741680000,
    "validBefore": 1741680300
  },
  "signature": "0x..."
}
```

### 7.4 On-Chain Verification

Facilitator acceptance is not sufficient by itself. Settlement must also be verifiable on-chain.

Minimum on-chain verification steps:
- Confirm the transaction `to` address is the configured TON ERC-20 contract for the selected profile
- Decode calldata and confirm the call is `transferFrom(buyer, merchant, amount)`
- Confirm transaction receipt `status == 1`
- Decode the ERC-20 `Transfer` event and confirm:
  - `from == buyer`
  - `to == merchant`
  - `value == amount`

Settlement lifecycle:
- `submitted`: transaction broadcast successfully
- `mined`: transaction included on-chain
- `settled`: mined and decoded transfer matches expected buyer, merchant, and amount
- `failed`: revert, timeout, replacement failure, or decoded mismatch

Phase 1 recommendation:
- Marketplace routes may use `submitted` in sync mode for low latency
- Facilitator must continue background verification until final `settled` or `failed`
- `GET /api/facilitator/v1/settlements/:settlementId` must expose the latest on-chain verified state

---

## 8. Settlement Proof

Minimum facilitator response:

```json
{
  "success": true,
  "settlementId": "uuid-or-hash",
  "chainId": 1,
  "asset": "0x2be5e8c109e2197D077D13A82dAead6a9b3433C5",
  "amount": "100000000000000000",
  "buyer": "0xBuyer...",
  "merchant": "0xMerchant...",
  "resource": "/api/marketplace/sequencer-health",
  "txHash": "0x...",
  "blockNumber": 12345678,
  "status": "submitted"
}
```

Recommended:
- Facilitator signs this response with its own service key
- Marketplace verifies the facilitator signature

Phase 1 receipt format decision:
- Phase 1 uses a detached ECDSA signature.
- The receipt payload is serialized as a canonical JSON string.
- Canonical JSON sorts keys lexicographically and omits whitespace.
- Facilitator signs `keccak256(canonicalJsonBytes)` with the receipt signing key.
- Marketplace verifies the same digest against the configured receipt signer address.
- JWS is out of scope for Phase 1.

Recommended persisted settlement fields:

```json
{
  "settlementId": "stl_123",
  "chainId": 1,
  "asset": "0x2be5e8c109e2197D077D13A82dAead6a9b3433C5",
  "buyer": "0xBuyer...",
  "merchant": "0xMerchant...",
  "amount": "100000000000000000",
  "resource": "/api/marketplace/sequencer-health",
  "txHash": "0x...",
  "txStatus": "submitted",
  "receiptStatus": null,
  "confirmedBlock": null,
  "transferVerified": false
}
```

Marketplace minimum checks:
- `success === true`
- `asset`, `amount`, `merchant`, and `resource` match exactly
- `txHash` exists
- facilitator signature is valid

### 8.1 Settlement Store

Settlement state lives in a Redis-backed settlement store that is separate from the nonce store.

Required key schema:
- settlement record: `{prefix}:facilitator:settlement:{chainId}:{settlementId}`
- pending settlement index: `{prefix}:facilitator:pending:{chainId}`
- nonce key: `{prefix}:facilitator:nonce:{chainId}:{buyer}:{nonce}`

Required persisted fields:
- `settlementId`
- `chainId`
- `network`
- `merchantId`
- `asset`
- `buyer`
- `merchant`
- `amount`
- `resource`
- `nonce`
- `txHash`
- `status`
- `txStatus`
- `receiptSignature`
- `confirmedBlock`
- `transferVerified`
- `failureReason`
- `createdAt`
- `updatedAt`

Design rules:
- `GET /api/facilitator/v1/settlements/:settlementId` must read from the settlement store.
- The background reconciler iterates only submitted settlements from the pending index.
- Production paths must not fall back to process memory.

### 8.2 Merchant Allowlist Source Of Truth

Use a single env-backed JSON array as the source of truth for the merchant allowlist.

Recommended env shape:

```json
[
  {
    "merchantId": "sequencer-health",
    "address": "0xMerchant...",
    "resources": ["/api/marketplace/sequencer-health"],
    "networks": ["eip155:1", "eip155:11155111"]
  }
]
```

Validation rules:
- `x-sentinai-merchant-id` must exist in the allowlist.
- The authorization `merchant` must exactly match the allowlisted address.
- The authorization `resource` must be one of the allowlisted resources.
- The authorization `network` must match an allowed facilitator profile.
- For current TON Phase 1, the allowlisted address must also equal the configured relayer/spender address.

---

## 9. Security Model

### 9.1 Main Risks

- Over-broad ERC-20 allowance
- Replay via nonce reuse
- Merchant spoofing
- Resource spoofing
- Facilitator compromise
- Gas griefing / failed settlement loops
- Same-app runtime compromise reaching payment code
- On-chain tx success mismatch versus expected settlement parameters

### 9.2 Required Controls

- Nonce is one-time-use per buyer
- `validBefore` is short, default <= 300 seconds
- `resource` is canonicalized before signing and before settlement
- `merchant` must be registered or allowlisted
- `amount` must be exact
- `asset` must be chain/profile constrained
- Facilitator only transfers the exact requested amount
- Facilitator timeout must fail closed on marketplace side
- Facilitator routes require internal auth and must not be exposed as buyer-facing endpoints
- Nonce and settlement state must live in Redis or equivalent external state, never process memory
- Settlement must not be marked final until calldata and `Transfer` event are verified against expected buyer, merchant, and amount

### 9.3 Operational Controls

- Redis-backed nonce store
- Redis-backed settlement store
- Receipt signing key separated from relayer key
- For current TON Phase 1, relayer wallet and merchant receiver must be the same address
- Structured audit logs for every settlement attempt
- Rate limiting per buyer, merchant, and IP
- Support circuit-breaker by asset or merchant
- Reconciler singleton guard to prevent duplicate scheduler registration

---

## 10. Mainnet and Sepolia Profiles

### Ethereum Mainnet
- TON asset: `0x2be5e8c109e2197D077D13A82dAead6a9b3433C5`
- network: `eip155:1`

### Ethereum Sepolia
- TON asset: `0xa30fe40285b8f5c0457dbc3b7c8a280373c40044`
- network: `eip155:11155111`

Design rule:
- Treat mainnet and sepolia as separate facilitator profiles
- Separate config, nonce namespaces, rate limits, and relayer balances

Required env contract:
- `TON_FACILITATOR_MAINNET_ENABLED`
- `TON_FACILITATOR_MAINNET_RPC_URL`
- `TON_FACILITATOR_MAINNET_RELAYER_KEY`
- `TON_FACILITATOR_MAINNET_ADDRESS`
- `TON_FACILITATOR_SEPOLIA_ENABLED`
- `TON_FACILITATOR_SEPOLIA_RPC_URL`
- `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`
- `TON_FACILITATOR_SEPOLIA_ADDRESS`
- `TON_FACILITATOR_RECEIPT_SIGNING_KEY`
- `TON_FACILITATOR_REDIS_PREFIX`
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`
- `TON_FACILITATOR_INTERNAL_AUTH_SECRET`
- `TON_FACILITATOR_RECONCILER_ENABLED`
- `TON_FACILITATOR_RECONCILER_CRON`

---

## 11. Sync vs Strict Settlement Modes

### Sync Mode

Marketplace returns resource once facilitator submits the settlement transaction successfully.

Pros:
- Lower latency
- Better API UX

Cons:
- Settlement can still revert later

### Strict Mode

Marketplace waits for at least 1 confirmation before returning resource.

Pros:
- Stronger correctness

Cons:
- Slower user experience

### Recommendation

Use **sync mode** in Phase 1, but include:
- signed facilitator receipt
- optional settlement status polling
- marketplace-side ability to switch selective routes to strict mode later
- mandatory background on-chain verification after submission

Execution model:
- `POST /api/facilitator/v1/settle` and merchant verification paths call `ensureFacilitatorReconcilerStarted()`.
- This function uses a module-level singleton guard to register a `node-cron` job only once.
- The default cron is `*/15 * * * * *`, checking pending settlements every 15 seconds.
- If the scheduler is disabled, settlements may remain in `submitted`, so production defaults should keep `TON_FACILITATOR_RECONCILER_ENABLED=true`.

---

## 12. Why This Works Without Upgrading TON

The deployed TON ERC-20 does not need native signature-based transfer support.

The facilitator takes over the missing authorization layer:
- token contract only performs `transferFrom`
- facilitator verifies off-chain payment authorization
- buyer’s prior `approve()` makes token movement possible

This shifts authorization logic from the token contract to the co-located facilitator component while preserving direct TON settlement.

Current live-smoke caveat:
- The token did not accept a third-party spender model in practice.
- Phase 1 works only because the operator-controlled relayer/spender is also the final merchant receiver.

---

## 13. Out of Scope

- Token contract upgrades
- Wrapper-token settlement for Phase 1
- Fully trustless settlement
- Multi-facilitator routing
- On-chain escrow
- Refund protocol

---

## 14. External References

- x402 facilitator concepts: `https://docs.x402.org/core-concepts/facilitator`
- x402 network/token support: `https://docs.x402.org/core-concepts/network-and-token-support`
- approval/relayer-style x402 example: `https://github.com/ChaosChain/chaoschain-x402`
