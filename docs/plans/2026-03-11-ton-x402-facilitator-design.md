# TON x402 Facilitator Design

> Date: 2026-03-11
> Status: Draft
> Scope: TON ERC-20 on Ethereum mainnet/sepolia, without token contract upgrades

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

Use an **approval-based pull facilitator**.

Summary:
- Buyer performs a one-time `approve()` on the TON ERC-20 contract for the facilitator spender.
- Buyer does **not** sign a token-native authorization.
- Buyer signs a facilitator-defined EIP-712 `PaymentAuthorization`.
- Facilitator verifies the signature and policy constraints, then executes `transferFrom(buyer, merchant, amount)`.

Why this is the chosen design:
- No changes to the deployed TON token contract
- Merchant receives real TON ERC-20 directly
- Preserves the x402 HTTP flow and facilitator role
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
Merchant API (/api/marketplace/*)
  ├─ Returns 402 with facilitator metadata
  ├─ Receives X-PAYMENT header
  └─ Calls facilitator settle API
           │
           ▼
TON Facilitator
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
- Facilitator must be policy-constrained and auditable.

---

## 5. Payment Flow

### 5.1 One-Time Setup

Buyer performs:

```solidity
approve(facilitatorSpender, allowance)
```

This may be exact-per-purchase, bounded, or high allowance. Phase 1 should support any valid allowance but strongly recommend bounded approvals in UI/docs.

### 5.2 Protected Resource Request

1. Buyer requests `GET /api/marketplace/sequencer-health`
2. Merchant returns `402 Payment Required`
3. Response includes:
   - `asset`
   - `amount`
   - `payTo`
   - `facilitatorUrl`
   - `facilitatorAddress`
   - `settlementMethod=evm-approval-transferFrom`

### 5.3 Buyer Signs PaymentAuthorization

Buyer signs a facilitator-specific EIP-712 message.

### 5.4 Merchant Calls Facilitator

Merchant sends the authorization to facilitator:
- signature
- typed data payload
- merchant authentication

### 5.5 Facilitator Settles

Facilitator:
- verifies signature
- verifies policy fields
- checks unused nonce
- checks deadline
- checks asset / merchant / amount / resource
- checks balance and allowance
- executes `transferFrom`

### 5.6 Merchant Releases Resource

Merchant only returns the protected resource after facilitator confirms settlement acceptance.

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
- `merchant`: exact payment recipient
- `asset`: chain-specific TON token
- `amount`: exact payment value
- `resource`: binds payment to the purchased API resource
- `nonce`: replay protection
- `validAfter` / `validBefore`: short-lived authorization window

Important design rule:
- `resource` must be canonicalized. Two semantically identical URLs must normalize to the same value or be rejected.

---

## 7. HTTP API Contract

### 7.1 Merchant 402 Response

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
        "facilitatorUrl": "https://facilitator.example.com",
        "facilitatorAddress": "0xFacilitator...",
        "requiredAllowanceTarget": "0xFacilitator..."
      }
    }
  ]
}
```

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

### 7.3 Facilitator API

`POST /v1/settle`
- Input: authorization, signature, merchant auth
- Output: settlement acceptance + signed proof

`GET /v1/settlements/:settlementId`
- Input: settlement id
- Output: `pending | settled | failed` plus proof details

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
- Merchant verifies the facilitator signature

Merchant minimum checks:
- `success === true`
- `asset`, `amount`, `merchant`, and `resource` match exactly
- `txHash` exists
- facilitator signature is valid

---

## 9. Security Model

### 9.1 Main Risks

- Over-broad ERC-20 allowance
- Replay via nonce reuse
- Merchant spoofing
- Resource spoofing
- Facilitator compromise
- Gas griefing / failed settlement loops

### 9.2 Required Controls

- Nonce is one-time-use per buyer
- `validBefore` is short, default <= 300 seconds
- `resource` is canonicalized before signing and before settlement
- `merchant` must be registered or allowlisted
- `amount` must be exact
- `asset` must be chain/profile constrained
- Facilitator only transfers the exact requested amount
- Facilitator timeout must fail closed on merchant side

### 9.3 Operational Controls

- Redis-backed nonce store
- Relayer wallet separated from merchant wallet
- Structured audit logs for every settlement attempt
- Rate limiting per buyer, merchant, and IP
- Support circuit-breaker by asset or merchant

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

---

## 11. Sync vs Strict Settlement Modes

### Sync Mode

Merchant returns resource once facilitator submits the settlement transaction successfully.

Pros:
- Lower latency
- Better API UX

Cons:
- Settlement can still revert later

### Strict Mode

Merchant waits for at least 1 confirmation before returning resource.

Pros:
- Stronger correctness

Cons:
- Slower user experience

### Recommendation

Use **sync mode** in Phase 1, but include:
- signed facilitator receipt
- optional settlement status polling
- merchant-side ability to switch selective routes to strict mode later

---

## 12. Why This Works Without Upgrading TON

The deployed TON ERC-20 does not need native signature-based transfer support.

The facilitator takes over the missing authorization layer:
- token contract only performs `transferFrom`
- facilitator verifies off-chain payment authorization
- buyer’s prior `approve()` makes token movement possible

This shifts authorization logic from the token contract to the facilitator service while preserving direct TON settlement.

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

