# TON x402 Buyer Integration Guide

> 대상: SentinAI의 TON x402 상품을 구매하는 외부 에이전트 및 buyer SDK 구현자
> 범위: `402 Payment Required` 수신, `approve`, EIP-712 서명, `X-PAYMENT` 재요청, receipt 검증

## 1. 목적

이 문서는 외부 에이전트가 SentinAI의 TON 기반 유료 API를 구매할 때 따라야 하는 최소 통합 절차를 설명한다.

현재 Phase 1 결제 구조는 다음 전제를 가진다.

- 결제 자산은 Ethereum 상의 TON ERC-20이다.
- TON 토큰은 EIP-3009를 지원하지 않는다.
- SentinAI는 same-app facilitator를 사용한다.
- buyer는 facilitator spender에 대해 `approve()`를 선행해야 한다.
- buyer는 TON 토큰 native authorization이 아니라 SentinAI 정의 EIP-712 `PaymentAuthorization`에 서명한다.

---

## 2. 전체 흐름

```text
1. Buyer -> GET /api/marketplace/<product>
2. SentinAI -> 402 Payment Required + paymentRequirements
3. Buyer -> validate merchant/resource/amount/network/spender
4. Buyer -> approve(spender, amount) on TON ERC-20 if allowance is insufficient
5. Buyer -> sign EIP-712 PaymentAuthorization
6. Buyer -> retry GET with X-PAYMENT header
7. SentinAI -> facilitator settlement + paid response
8. Buyer -> verify receipt and optionally confirm settlement status / txHash
```

실제 buyer 구현은 2개의 단계를 분리해서 생각하면 된다.

- 사전 준비: TON allowance 확보
- 요청별 결제: 402 수신 후 authorization 서명과 재요청

---

## 3. 상품 요청 시작

외부 에이전트는 먼저 보호된 상품 endpoint를 일반 GET으로 호출한다.

예시:

```bash
curl https://sentinai.example.com/api/marketplace/sequencer-health
```

결제가 아직 없으면 서버는 `402 Payment Required`를 반환한다.

예시 응답:

```json
{
  "error": "payment_required",
  "scheme": "exact",
  "x402Version": 2,
  "paymentRequirements": {
    "network": "eip155:11155111",
    "asset": "0xa30fe40285B8f5c0457DbC3B7C8A280373c40044",
    "amount": "100000000000000000",
    "resource": "/api/marketplace/sequencer-health",
    "merchant": "0x4444444444444444444444444444444444444444",
    "facilitator": {
      "mode": "same-app",
      "settleUrl": "https://sentinai.example.com/api/facilitator/v1/settle",
      "receiptUrl": "https://sentinai.example.com/api/facilitator/v1/settlements/{settlementId}",
      "spender": "0x7777777777777777777777777777777777777777"
    },
    "authorization": {
      "type": "eip712",
      "domain": {
        "name": "SentinAI x402 TON Facilitator",
        "version": "1",
        "chainId": 11155111,
        "verifyingContract": "0x7777777777777777777777777777777777777777"
      },
      "primaryType": "PaymentAuthorization",
      "types": {
        "PaymentAuthorization": [
          { "name": "buyer", "type": "address" },
          { "name": "merchant", "type": "address" },
          { "name": "asset", "type": "address" },
          { "name": "amount", "type": "uint256" },
          { "name": "resource", "type": "string" },
          { "name": "nonce", "type": "bytes32" },
          { "name": "validAfter", "type": "uint256" },
          { "name": "validBefore", "type": "uint256" }
        ]
      }
    },
    "receipt": {
      "type": "detached-signature",
      "fields": [
        "success",
        "settlementId",
        "chainId",
        "asset",
        "amount",
        "buyer",
        "merchant",
        "resource",
        "txHash",
        "blockNumber",
        "status"
      ]
    }
  }
}
```

buyer는 이 응답을 그대로 사용하지 말고, 최소한 아래 값을 검증해야 한다.

- `network`
- `asset`
- `amount`
- `resource`
- `merchant`
- `facilitator.spender`
- `authorization.domain.chainId`
- `authorization.domain.verifyingContract`

특히 `resource`와 `merchant`는 “지금 구매하려는 상품 1건”과 정확히 일치해야 한다.

---

## 4. Allowance 확인과 approve

buyer는 TON ERC-20 contract에서 현재 allowance를 조회해야 한다.

조회 대상:

- owner: buyer address
- spender: `paymentRequirements.facilitator.spender`

allowance가 `amount`보다 작으면 먼저 `approve()`를 실행한다.

개념 예시:

```solidity
approve(spender, amount)
```

권장 정책:

- 가장 안전한 방식은 exact approval 또는 bounded approval
- unlimited approval은 피하는 편이 좋다

주의:

- `spender`는 TON token contract 주소가 아니다
- `spender`는 facilitator가 실제 `transferFrom()`를 실행하는 relayer/spender 주소다

---

## 5. EIP-712 PaymentAuthorization 생성

buyer는 `402` 응답에 포함된 domain/types를 기준으로 typed data를 만든다.

메시지 필드 예시:

```json
{
  "buyer": "0xBuyerAddress",
  "merchant": "0x4444444444444444444444444444444444444444",
  "asset": "0xa30fe40285B8f5c0457DbC3B7C8A280373c40044",
  "amount": "100000000000000000",
  "resource": "/api/marketplace/sequencer-health",
  "nonce": "0x8f4d8d0e2f2acb1d4b7b3f6a6d2f2a1d5b7c3e4f9a0b1c2d3e4f5a6b7c8d9e0f",
  "validAfter": "1741833000",
  "validBefore": "1741833300"
}
```

필드 규칙:

- `buyer`: 서명 주체이자 TON source account
- `merchant`: `402` 응답의 merchant와 동일
- `asset`: `402` 응답의 asset과 동일
- `amount`: `402` 응답의 amount와 동일
- `resource`: `402` 응답의 resource와 동일한 canonical path
- `nonce`: 요청마다 새로 생성하는 32-byte 값
- `validAfter`, `validBefore`: 짧은 시간 범위 권장

권장 만료 창:

- `validAfter = now - 30s`
- `validBefore = now + 300s`

---

## 6. X-PAYMENT payload 생성

buyer는 authorization message와 signature를 포함하는 payment payload를 만든 뒤 base64 인코딩해서 `X-PAYMENT` 헤더에 넣는다.

예시 payload:

```json
{
  "network": "eip155:11155111",
  "authorization": {
    "buyer": "0xBuyerAddress",
    "merchant": "0x4444444444444444444444444444444444444444",
    "asset": "0xa30fe40285B8f5c0457DbC3B7C8A280373c40044",
    "amount": "100000000000000000",
    "resource": "/api/marketplace/sequencer-health",
    "nonce": "0x8f4d8d0e2f2acb1d4b7b3f6a6d2f2a1d5b7c3e4f9a0b1c2d3e4f5a6b7c8d9e0f",
    "validAfter": "1741833000",
    "validBefore": "1741833300"
  },
  "signature": "0xSignedTypedData"
}
```

전송 형태:

```http
X-PAYMENT: <base64-encoded-json>
```

주의:

- `network`와 message 내부 `merchant/asset/amount/resource`가 402 응답과 달라지면 실패해야 한다
- buyer SDK는 임의 필드 재조합보다 402 응답값을 그대로 복사해 쓰는 쪽이 안전하다

---

## 7. 결제 재요청

buyer는 동일한 상품 endpoint에 `X-PAYMENT`를 붙여 다시 요청한다.

예시:

```bash
curl https://sentinai.example.com/api/marketplace/sequencer-health \
  -H "X-PAYMENT: <base64-encoded-json>"
```

성공 시 응답 예시:

```json
{
  "data": {
    "service": "sequencer-health",
    "network": "eip155:11155111",
    "status": "healthy",
    "latestIncident": null,
    "settlement": {
      "settlementId": "stl_123",
      "txHash": "0xSettlementTransactionHash",
      "status": "submitted"
    }
  }
}
```

여기서 `status=submitted`는 facilitator가 settlement를 접수했고 tx를 제출했다는 뜻이다.

Phase 1에서는 buyer가 필요하면 `receiptUrl` 또는 on-chain `txHash` 확인으로 최종 상태를 다시 조회할 수 있다.

---

## 8. Receipt 및 settlement 검증

buyer는 결제 성공 응답을 받은 뒤 아래 항목을 다시 검증하는 것이 좋다.

- `settlementId`
- `txHash`
- `status`
- facilitator detached receipt 서명
- receipt 안의 `chainId`
- receipt 안의 `asset`
- receipt 안의 `amount`
- receipt 안의 `merchant`
- receipt 안의 `resource`

최소 검증 규칙:

- 내가 서명한 authorization의 `merchant/amount/resource/asset`와 receipt가 정확히 일치해야 한다
- receipt의 `chainId`는 `402` 응답의 chain과 일치해야 한다
- `txHash`가 있으면 직접 RPC로 transaction receipt를 조회할 수 있다

추가 확인 endpoint 예시:

```text
GET /api/facilitator/v1/settlements/{settlementId}?chainId=11155111
```

---

## 9. 권장 buyer SDK 인터페이스

외부 buyer SDK는 아래 수준의 함수 분리가 있으면 충분하다.

```ts
type PaymentRequirements = {
  network: string;
  asset: `0x${string}`;
  amount: string;
  resource: string;
  merchant: `0x${string}`;
  facilitator: {
    settleUrl: string;
    receiptUrl: string;
    spender: `0x${string}`;
  };
  authorization: {
    type: 'eip712';
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    primaryType: 'PaymentAuthorization';
    types: Record<string, Array<{ name: string; type: string }>>;
  };
};

async function fetchPaymentRequirements(resourceUrl: string): Promise<PaymentRequirements>;
async function ensureAllowance(input: {
  asset: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}): Promise<void>;
async function signAuthorization(input: {
  requirements: PaymentRequirements;
  buyer: `0x${string}`;
}): Promise<{ payloadBase64: string }>;
async function fetchPaidResource(resourceUrl: string, paymentHeader: string): Promise<unknown>;
```

핵심 원칙:

- buyer SDK는 서버가 준 `paymentRequirements`를 source of truth로 취급
- SDK 내부 상수로 merchant/resource를 다시 정의하지 않음

---

## 10. TypeScript 예제

아래 예제는 `viem` 기반 buyer SDK의 최소 happy path를 보여준다.

```ts
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  parseAbiItem,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

type PaymentRequirements = {
  network: string;
  asset: `0x${string}`;
  amount: string;
  resource: string;
  merchant: `0x${string}`;
  facilitator: {
    settleUrl: string;
    receiptUrl: string;
    spender: `0x${string}`;
  };
  authorization: {
    type: 'eip712';
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: `0x${string}`;
    };
    primaryType: 'PaymentAuthorization';
    types: Record<string, Array<{ name: string; type: string }>>;
  };
};

type PaymentAuthorization = {
  buyer: `0x${string}`;
  merchant: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  resource: string;
  nonce: `0x${string}`;
  validAfter: bigint;
  validBefore: bigint;
};

function randomNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function fetchPaymentRequirements(resourceUrl: string): Promise<PaymentRequirements> {
  const response = await fetch(resourceUrl);
  if (response.status !== 402) {
    throw new Error(`Expected 402, received ${response.status}`);
  }

  const body = (await response.json()) as { paymentRequirements?: PaymentRequirements };
  if (!body.paymentRequirements) {
    throw new Error('Missing paymentRequirements in 402 response');
  }
  return body.paymentRequirements;
}

async function ensureAllowance(input: {
  rpcUrl: string;
  buyerKey: `0x${string}`;
  asset: `0x${string}`;
  spender: `0x${string}`;
  amount: bigint;
}) {
  const account = privateKeyToAccount(input.buyerKey);
  const publicClient = createPublicClient({
    transport: http(input.rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    transport: http(input.rpcUrl),
  });

  const allowance = await publicClient.readContract({
    address: input.asset,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [account.address, input.spender],
  });

  if (allowance >= input.amount) {
    return;
  }

  const hash = await walletClient.writeContract({
    address: input.asset,
    abi: erc20Abi,
    functionName: 'approve',
    args: [input.spender, input.amount],
  });

  await publicClient.waitForTransactionReceipt({ hash });
}

async function buildPaymentHeader(input: {
  buyerKey: `0x${string}`;
  requirements: PaymentRequirements;
}) {
  const account = privateKeyToAccount(input.buyerKey);
  const now = Math.floor(Date.now() / 1000);

  const authorization: PaymentAuthorization = {
    buyer: getAddress(account.address),
    merchant: getAddress(input.requirements.merchant),
    asset: getAddress(input.requirements.asset),
    amount: BigInt(input.requirements.amount),
    resource: input.requirements.resource,
    nonce: randomNonce(),
    validAfter: BigInt(now - 30),
    validBefore: BigInt(now + 300),
  };

  const signature = await account.signTypedData({
    domain: input.requirements.authorization.domain,
    types: input.requirements.authorization.types,
    primaryType: input.requirements.authorization.primaryType,
    message: authorization,
  });

  const payload = {
    network: input.requirements.network,
    authorization: {
      ...authorization,
      amount: authorization.amount.toString(),
      validAfter: authorization.validAfter.toString(),
      validBefore: authorization.validBefore.toString(),
    },
    signature,
  };

  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

async function fetchPaidResource(input: {
  resourceUrl: string;
  paymentHeader: string;
}) {
  const response = await fetch(input.resourceUrl, {
    headers: {
      'x-payment': input.paymentHeader,
    },
  });

  if (!response.ok) {
    throw new Error(`Paid request failed with ${response.status}`);
  }

  return response.json();
}

async function buySequencerHealth() {
  const resourceUrl = 'https://sentinai.example.com/api/marketplace/sequencer-health';
  const rpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com';
  const buyerKey = process.env.BUYER_KEY as `0x${string}`;

  const requirements = await fetchPaymentRequirements(resourceUrl);
  await ensureAllowance({
    rpcUrl,
    buyerKey,
    asset: requirements.asset,
    spender: requirements.facilitator.spender,
    amount: BigInt(requirements.amount),
  });

  const paymentHeader = await buildPaymentHeader({
    buyerKey,
    requirements,
  });

  const result = await fetchPaidResource({
    resourceUrl,
    paymentHeader,
  });

  console.log(result);
}
```

이 예제에서 운영 환경에 맞게 교체해야 하는 값:

- `resourceUrl`
- `rpcUrl`
- `BUYER_KEY`

SDK로 일반화할 때는 `fetchPaymentRequirements`, `ensureAllowance`, `buildPaymentHeader`, `fetchPaidResource` 네 함수를 그대로 분리해서 쓰면 된다.

---

## 11. 실패 처리 규칙

buyer 구현은 아래 실패를 구분해서 다루는 편이 좋다.

### 402 재발행

가능 원인:

- allowance 부족
- 서명 만료
- nonce 재사용
- amount/resource mismatch

권장 처리:

- 서버 응답의 `error`와 최신 `paymentRequirements`를 다시 읽고 새 authorization 생성

### On-chain submitted 이후 최종 실패

가능 원인:

- transaction revert
- replacement 실패
- reconciliation 결과 `failed`

권장 처리:

- `settlementId` 기준으로 상태 조회
- 자동 재시도 전에 operator 정책 확인

### 사용자 지갑 거절

가능 원인:

- `approve` 거절
- typed-data 서명 거절

권장 처리:

- buyer에게 명확히 “approval rejected” 또는 “signature rejected”로 표시

---

## 12. 보안 체크리스트

buyer SDK 또는 외부 에이전트는 아래 규칙을 지켜야 한다.

- `402` 응답을 받은 origin과 실제 재요청 origin이 같은지 확인
- `merchant`, `resource`, `amount`, `asset`, `spender`를 명시적으로 비교
- approval은 가능하면 exact 또는 bounded allowance 사용
- `validBefore`가 짧은 authorization만 사용
- receipt 또는 settlement 조회를 통해 제출 결과를 재검증

---

## 13. 운영자에게 요청해야 하는 정보

외부 buyer가 통합을 시작하려면 운영자로부터 아래를 받아야 한다.

- 구매할 상품 endpoint 목록
- 사용하는 network
- TON asset address
- 예시 `402` 응답
- buyer가 approve해야 하는 spender address
- receipt 검증 방식
- settlement 상태 조회 endpoint

운영자가 이 정보를 buyer에게 제공하지 않으면, 외부 에이전트는 결제 행위의 정당성을 독립적으로 검증하기 어렵다.
