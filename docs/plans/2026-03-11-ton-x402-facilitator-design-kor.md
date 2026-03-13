# TON x402 Facilitator 설계 문서

> Date: 2026-03-11
> Status: Draft
> Scope: TON ERC-20 on Ethereum mainnet/sepolia, without token contract upgrades, using a same-app facilitator deployment

> 구현 기준: 이 한국어 설계 문서는 TON facilitator 구현의 Phase 1 source of truth입니다. 기존 marketplace/x402 문서에 EIP-3009 기반 설명이 남아 있더라도, TON 정산 방식은 이 문서의 approval-based pull facilitator 정의를 우선합니다.

---

## 1. 문제

SentinAI는 x402로 보호되는 marketplace API의 정산 자산으로 TON을 사용하려고 합니다.

제약 조건:
- TON은 이미 Ethereum mainnet과 Sepolia에 ERC-20 토큰으로 배포되어 있습니다.
- 배포된 TON 토큰은 **EIP-3009를 지원하지 않습니다**.
- 토큰 컨트랙트는 **업그레이드하거나 교체하면 안 됩니다**.
- SentinAI는 여전히 x402 스타일 결제 UX를 원합니다.
  - merchant가 HTTP 402를 반환
  - buyer가 payment authorization에 서명
  - merchant가 facilitator를 통해 정산을 검증
  - merchant는 정산이 승인된 후에만 보호된 리소스를 반환

즉, 표준 EIP-3009 정산 경로는 사용할 수 없습니다. facilitator 기반의 커스텀 정산 방식이 필요합니다.

---

## 2. 결정

같은 SentinAI 앱 내부에 배치되는 **approval-based pull facilitator**를 사용합니다.

요약:
- Buyer는 TON ERC-20 컨트랙트에 대해 facilitator spender를 대상으로 1회 `approve()`를 수행합니다.
- Buyer는 토큰 네이티브 authorization에는 서명하지 않습니다.
- Buyer는 facilitator가 정의한 EIP-712 `PaymentAuthorization`에 서명합니다.
- Facilitator는 서명과 정책 제약을 검증한 뒤 `transferFrom(buyer, merchant, amount)`를 실행합니다.

실체인 Sepolia 결과:
- 2026-03-13 live smoke에서 `merchant != relayer` 구성은 `SeigToken: only sender or recipient can transfer`로 실패했습니다.
- 같은 날 `merchant == relayer == spender` 구성은 성공했고 settlement는 block `10438414`에서 `settled`가 되었습니다.
- 따라서 현재 TON Phase 1은 `merchant == relayer == spender`를 하드 제약으로 취급해야 합니다.

이 설계를 선택한 이유:
- 배포된 TON 토큰 컨트랙트를 변경할 필요가 없습니다.
- Merchant는 실제 TON ERC-20을 직접 수령합니다.
- Phase 1에서 별도 서비스를 강제하지 않으면서 x402 HTTP 흐름과 facilitator 역할을 유지할 수 있습니다.
- prefunded balance 모델보다 custody 부담이 낮습니다.

---

## 3. 고려한 대안

### Option A: Approval-Based Pull Facilitator

Buyer가 facilitator를 승인하고, 이후 facilitator가 `transferFrom`으로 필요한 금액만 당겨옵니다.

장점:
- 컨트랙트 변경이 없습니다.
- Merchant로 직접 TON 정산이 가능합니다.
- 기존 x402 멘탈 모델과 가장 가깝습니다.

단점:
- 최초 1회 온체인 approval이 필요합니다.
- Facilitator가 강한 spender 권한을 가지므로 강하게 제약해야 합니다.

### Option B: Prefunded Facilitator Balance

Buyer가 TON을 facilitator vault에 예치하고, 이후 x402 구매는 내부 잔액을 차감합니다.

장점:
- 반복 결제 UX가 가장 좋습니다.
- 매 요청 allowance를 신경 쓰지 않아도 됩니다.

단점:
- custodial 모델입니다.
- 출금/회계 복잡도가 높습니다.
- 신뢰 표면이 더 커집니다.

### Option C: Wrapper Token or Credit Layer

Buyer가 TON을 예치하고 x402 친화적인 wrapper asset 또는 credit을 받습니다.

장점:
- 프로토콜 설계가 더 깔끔합니다.
- 반복 흐름을 지원하기 쉽습니다.

단점:
- 직접 TON 정산이 아닙니다.
- 새로운 자산과 상환 경로가 생깁니다.

### 권장안

Phase 1에서는 **Option A**를 선택합니다.

이 방식은 배포된 TON 토큰을 건드리지 않으면서도 직접 TON ERC-20 정산을 만드는 가장 비침습적인 경로입니다.

---

## 4. 상위 아키텍처

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

신뢰 경계:
- Buyer는 ERC-20 allowance와 자신이 서명한 authorization 정책 범위 안에서만 facilitator를 신뢰합니다.
- Merchant는 facilitator settlement proof를 신뢰합니다.
- Facilitator는 같은 앱 런타임에 공존하더라도 정책 제약 가능하고 감사 가능한 컴포넌트여야 합니다.

Phase 1 구현 경계:
- Buyer-facing endpoint는 계속 `/api/marketplace/*`만 사용합니다.
- `/api/facilitator/v1/*`는 외부 공개 route처럼 보여도 실제로는 marketplace 내부 호출만 허용합니다.
- Phase 1의 background reconciliation은 별도 worker 서비스가 아니라 same-app in-process scheduler로 실행합니다.
- 이 설계는 SentinAI가 장기 실행되는 Node 프로세스로 배포된다는 전제를 둡니다. 서버리스 환경은 범위 밖입니다.
- 현재 TON Phase 1 배포에서는 allowlist merchant, relayer caller, buyer-facing spender를 모두 같은 운영자 제어 주소로 맞춰야 합니다.

---

## 5. 결제 흐름

### 5.1 1회 설정

Buyer는 아래를 수행합니다.

```solidity
approve(facilitatorSpender, allowance)
```

이 allowance는 건별 정확 금액일 수도 있고, 제한된 범위일 수도 있으며, 큰 allowance일 수도 있습니다. Phase 1은 유효한 allowance를 모두 허용하되, UI/문서에서는 bounded approval을 강하게 권장해야 합니다.

### 5.2 보호 리소스 요청

1. Buyer가 `GET /api/marketplace/sequencer-health`를 요청
2. Merchant가 `402 Payment Required` 반환
3. 응답에는 다음이 포함됩니다.
   - `asset`
   - `amount`
   - `payTo`
   - `facilitatorPath`
   - `facilitatorAddress`
   - `settlementMethod=evm-approval-transferFrom`

### 5.3 Buyer가 PaymentAuthorization 서명

Buyer는 facilitator 전용 EIP-712 메시지에 서명합니다.

### 5.4 Marketplace가 Facilitator 호출

Marketplace는 내부 facilitator 컴포넌트에 다음을 전달합니다.
- signature
- typed data payload
- internal merchant authentication

### 5.5 Facilitator 정산

Facilitator는 다음을 수행합니다.
- 서명 검증
- 정책 필드 검증
- nonce 미사용 여부 확인
- deadline 확인
- asset / merchant / amount / resource 확인
- balance 및 allowance 확인
- `transferFrom` 실행

### 5.6 Marketplace가 리소스 반환

Marketplace는 facilitator가 settlement acceptance를 확인한 뒤에만 보호된 리소스를 반환합니다.

---

## 6. Typed Data 설계

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

각 필드의 목적:
- `buyer`: 토큰 원천 계정
- `merchant`: 정확한 결제 수취인
- `asset`: 체인별 TON 토큰
- `amount`: 정확한 결제 금액
- `resource`: 결제가 어떤 API 리소스에 묶이는지 정의
- `nonce`: replay 방지
- `validAfter` / `validBefore`: 짧은 유효 시간 창

중요한 설계 규칙:
- `resource`는 canonicalize 되어야 합니다. 의미상 같은 URL이 서로 다른 문자열로 들어오면 정규화되거나 거절되어야 합니다.

Phase 1 canonical resource 규칙:
- `resource`는 반드시 `/api/marketplace/`로 시작하는 절대 path여야 합니다.
- origin, protocol, host, fragment를 포함하면 거절합니다.
- query string은 Phase 1에서 허용하지 않습니다. `?`가 포함되면 거절합니다.
- trailing slash는 제거하되, path 본문 중복 slash는 허용하지 않고 거절합니다.
- canonicalized 결과는 path-only 문자열이며, 서명 전과 settlement 검증 전에 동일 함수로 계산합니다.
- 향후 query 기반 유료 리소스가 필요하면 `resource`가 아니라 별도 signed field를 추가합니다.

---

## 7. HTTP API 계약

### 7.1 Marketplace 402 응답

예시:

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

### 7.2 Buyer X-PAYMENT Header

base64 인코딩 전 payload 예시:

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
- 입력: authorization, signature, internal merchant auth
- 출력: settlement acceptance + signed proof

`GET /api/facilitator/v1/settlements/:settlementId`
- 입력: settlement id
- 출력: `pending | settled | failed`와 proof 상세

설계 규칙:
- Buyer는 facilitator route를 직접 호출하지 않습니다.
- Facilitator route는 marketplace handler 또는 allowlisted internal caller만 접근하는 내부 결제 endpoint여야 합니다.

필수 internal auth 계약:
- Marketplace는 `x-sentinai-internal-auth` 헤더에 `TON_FACILITATOR_INTERNAL_AUTH_SECRET` 값을 넣어 전달합니다.
- Marketplace는 `x-sentinai-merchant-id` 헤더에 내부 merchant 식별자를 넣어 전달합니다.
- Facilitator는 header secret과 merchant allowlist를 둘 다 검증해야 합니다.
- secret 또는 merchant id가 없으면 `401` 또는 `403`으로 실패합니다.

`POST /api/facilitator/v1/settle` request body 최소 shape:

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

### 7.4 온체인 검증

Facilitator acceptance만으로는 충분하지 않습니다. settlement는 온체인에서도 검증 가능해야 합니다.

최소 온체인 검증 단계:
- transaction의 `to` 주소가 선택된 profile의 TON ERC-20 컨트랙트인지 확인
- calldata를 decode해서 `transferFrom(buyer, merchant, amount)` 호출인지 확인
- transaction receipt의 `status == 1` 확인
- ERC-20 `Transfer` 이벤트를 decode해서 다음을 확인
  - `from == buyer`
  - `to == merchant`
  - `value == amount`

Settlement lifecycle:
- `submitted`: transaction broadcast 성공
- `mined`: transaction이 온체인에 포함됨
- `settled`: mined 되었고 decode된 transfer가 기대한 buyer, merchant, amount와 일치
- `failed`: revert, timeout, replacement failure, decode mismatch

Phase 1 권장안:
- Marketplace route는 저지연을 위해 sync mode에서 `submitted`를 사용할 수 있음
- Facilitator는 백그라운드에서 `settled` 또는 `failed`가 될 때까지 계속 검증해야 함
- `GET /api/facilitator/v1/settlements/:settlementId`는 최신 온체인 검증 상태를 노출해야 함

---

## 8. Settlement Proof

최소 facilitator 응답:

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

권장 사항:
- Facilitator는 이 응답에 자체 서비스 키로 서명
- Marketplace는 facilitator signature를 검증

Phase 1 receipt 포맷 결정:
- Phase 1은 detached ECDSA signature를 사용합니다.
- Receipt payload는 canonical JSON 문자열로 직렬화합니다.
- canonical JSON은 key를 사전순으로 정렬하고 whitespace 없이 직렬화합니다.
- Facilitator는 `keccak256(canonicalJsonBytes)`를 receipt signing key로 서명합니다.
- Marketplace는 configured receipt signer address로 동일 digest를 검증합니다.
- JWS는 Phase 1 범위 밖입니다.

권장 persisted settlement 필드:

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

Marketplace 최소 확인 항목:
- `success === true`
- `asset`, `amount`, `merchant`, `resource` exact match
- `txHash` 존재
- facilitator signature 유효

### 8.1 Settlement Store

Settlement 상태는 nonce store와 별개의 Redis-backed settlement store에 저장합니다.

필수 key schema:
- settlement record: `{prefix}:facilitator:settlement:{chainId}:{settlementId}`
- pending settlement index: `{prefix}:facilitator:pending:{chainId}`
- nonce key: `{prefix}:facilitator:nonce:{chainId}:{buyer}:{nonce}`

필수 persisted fields:
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

설계 규칙:
- `GET /api/facilitator/v1/settlements/:settlementId`는 반드시 settlement store를 읽습니다.
- Background reconciler는 pending index를 기준으로 submitted settlement만 순회합니다.
- Production 경로에서는 process memory fallback을 허용하지 않습니다.

### 8.2 Merchant Allowlist Source Of Truth

Merchant allowlist는 env 하나로 파싱 가능한 JSON 배열을 source of truth로 사용합니다.

권장 env shape:

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

검증 규칙:
- `x-sentinai-merchant-id`가 allowlist에 존재해야 합니다.
- authorization의 `merchant`가 allowlist address와 exact match여야 합니다.
- authorization의 `resource`가 allowlisted resource 중 하나여야 합니다.
- authorization의 `network`는 허용된 profile과 일치해야 합니다.

---

## 9. 보안 모델

### 9.1 주요 리스크

- 과도한 ERC-20 allowance
- nonce 재사용에 의한 replay
- Merchant spoofing
- Resource spoofing
- Facilitator compromise
- Gas griefing / failed settlement loops
- same-app runtime compromise가 payment code까지 확장되는 문제
- 온체인 tx success와 기대 settlement 파라미터 불일치

### 9.2 필수 통제

- Nonce는 buyer 기준 1회만 사용
- `validBefore`는 짧게, 기본 <= 300초
- `resource`는 서명 전/정산 전 모두 canonicalize
- `merchant`는 등록 또는 allowlist 필요
- `amount`는 exact match
- `asset`은 chain/profile 제약 필요
- Facilitator는 exact requested amount만 이동
- Facilitator timeout은 marketplace 측에서 fail closed
- Facilitator route는 internal auth가 필요하고 buyer-facing endpoint가 아니어야 함
- Nonce와 settlement 상태는 process memory가 아니라 Redis 같은 외부 상태에 저장
- Settlement는 calldata와 `Transfer` 이벤트가 expected buyer, merchant, amount와 일치하기 전까지 final로 표시하면 안 됨

### 9.3 운영 통제

- Redis-backed nonce store
- Redis-backed settlement store
- Relayer wallet과 merchant wallet 분리
- Receipt signing key와 relayer key 분리
- 모든 settlement 시도에 대한 structured audit log
- Buyer, merchant, IP 기준 rate limiting
- Asset 또는 merchant 단위 circuit-breaker
- Reconciler singleton guard로 scheduler 중복 실행 방지

---

## 10. Mainnet / Sepolia Profile

### Ethereum Mainnet
- TON asset: `0x2be5e8c109e2197D077D13A82dAead6a9b3433C5`
- network: `eip155:1`

### Ethereum Sepolia
- TON asset: `0xa30fe40285b8f5c0457dbc3b7c8a280373c40044`
- network: `eip155:11155111`

설계 규칙:
- Mainnet과 Sepolia를 서로 다른 facilitator profile로 취급
- Config, nonce namespace, rate limit, relayer balance를 분리

필수 env 계약:
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

## 11. Sync vs Strict Settlement Mode

### Sync Mode

Marketplace는 facilitator가 settlement transaction을 성공적으로 submit하면 즉시 리소스를 반환합니다.

장점:
- 낮은 지연
- 더 좋은 API UX

단점:
- 이후 settlement가 revert될 수 있음

### Strict Mode

Marketplace는 최소 1 confirmation 이후에만 리소스를 반환합니다.

장점:
- 더 강한 정확성

단점:
- 사용자 경험이 느려짐

### 권장안

Phase 1에서는 **sync mode**를 사용하되 다음을 포함합니다.
- signed facilitator receipt
- optional settlement status polling
- marketplace 측에서 일부 route를 strict mode로 전환할 수 있는 여지
- submit 이후 필수 백그라운드 온체인 검증

실행 모델:
- `POST /api/facilitator/v1/settle`와 merchant verification 경로는 `ensureFacilitatorReconcilerStarted()`를 호출합니다.
- 이 함수는 module-level singleton guard를 사용해 `node-cron` 작업을 한 번만 등록합니다.
- 기본 cron은 `*/15 * * * * *`로 15초마다 pending settlement를 검사합니다.
- Scheduler가 비활성화되어 있으면 settlement 상태는 `submitted`에 머물 수 있으므로 production에서는 `TON_FACILITATOR_RECONCILER_ENABLED=true`가 기본값입니다.

---

## 12. TON 업그레이드 없이 가능한 이유

배포된 TON ERC-20은 네이티브 signature-based transfer를 지원할 필요가 없습니다.

빠진 authorization layer를 facilitator가 대신 수행합니다.
- token contract는 `transferFrom`만 수행
- facilitator는 오프체인 payment authorization을 검증
- buyer의 사전 `approve()`가 실제 토큰 이동을 가능하게 만듦

즉, authorization 로직을 token contract에서 co-located facilitator component로 옮기면서 direct TON settlement를 유지하는 방식입니다.

---

## 13. 범위 외

- 토큰 컨트랙트 업그레이드
- Phase 1에서 wrapper-token settlement
- 완전 trustless settlement
- Multi-facilitator routing
- On-chain escrow
- Refund protocol

---

## 14. 외부 참고 자료

- x402 facilitator concepts: `https://docs.x402.org/core-concepts/facilitator`
- x402 network/token support: `https://docs.x402.org/core-concepts/network-and-token-support`
- approval/relayer-style x402 example: `https://github.com/ChaosChain/chaoschain-x402`
