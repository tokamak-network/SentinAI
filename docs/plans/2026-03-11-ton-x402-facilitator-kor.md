# TON x402 Facilitator 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** EIP-3009나 토큰 컨트랙트 업그레이드 없이, Ethereum mainnet과 Sepolia의 TON ERC-20 결제를 처리하는 same-app custom x402 facilitator를 구현합니다.

**Architecture:** Buyer는 facilitator spender에 대해 1회 ERC-20 allowance를 부여하고, 이후 구매마다 facilitator가 정의한 EIP-712 `PaymentAuthorization`에 서명합니다. Marketplace API는 같은 SentinAI 앱 내부의 facilitator route로 이 authorization을 전달하고, facilitator는 정책을 검증한 뒤 `transferFrom`을 실행하고 Redis에 settlement 상태를 저장한 뒤 signed settlement proof를 반환합니다.

**Tech Stack:** TypeScript, viem, Next.js route handlers, Redis, Vitest

---

### Task 1: 공통 facilitator 타입과 config 정의

**Files:**
- Create: `src/lib/marketplace/facilitator/types.ts`
- Create: `src/lib/marketplace/facilitator/config.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/config.test.ts`

**Step 1: 실패하는 테스트 작성**

Config가 두 profile을 로드하는지 테스트합니다.
- mainnet TON: `0x2be5e8c109e2197D077D13A82dAead6a9b3433C5`
- sepolia TON: `0xa30fe40285b8f5c0457dbc3b7c8a280373c40044`

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`  
Expected: missing module failure

**Step 3: 최소 config loader 구현**

포함 항목:
- facilitator address
- relayer private key env
- receipt signing key env
- chain id
- TON asset address
- Redis nonce prefix
- marketplace → facilitator internal call용 auth secret

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/types.ts src/lib/marketplace/facilitator/config.ts src/lib/__tests__/marketplace/facilitator/config.test.ts
git commit -m "feat(facilitator): add TON facilitator config profiles"
```

---

### Task 2: EIP-712 PaymentAuthorization 정의

**Files:**
- Create: `src/lib/marketplace/facilitator/typed-data.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 1: 실패하는 테스트 작성**

테스트 항목:
- domain field가 올바른지
- typed data에 `buyer`, `merchant`, `asset`, `amount`, `resource`, `nonce`, `validAfter`, `validBefore`가 포함되는지
- resource canonicalization이 동작하는지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 3: typed data helper 구현**

Functions:
- `getPaymentAuthorizationDomain(profile)`
- `getPaymentAuthorizationTypes()`
- `canonicalizeResource(resource)`

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/typed-data.ts src/lib/__tests__/marketplace/facilitator/typed-data.test.ts
git commit -m "feat(facilitator): add payment authorization typed data"
```

---

### Task 3: 서명 검증 구현

**Files:**
- Create: `src/lib/marketplace/facilitator/verify-authorization.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- valid signature
- wrong buyer
- wrong merchant
- wrong asset
- wrong amount
- expired authorization
- not-yet-valid authorization

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 3: 검증 구현**

viem으로 signer를 recover하고, 서명된 모든 필드를 exact match로 비교합니다.

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/verify-authorization.ts src/lib/__tests__/marketplace/facilitator/verify-authorization.test.ts
git commit -m "feat(facilitator): verify TON payment authorizations"
```

---

### Task 4: nonce store 추가

**Files:**
- Create: `src/lib/marketplace/facilitator/nonce-store.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- fresh nonce 허용
- reused nonce 거절
- mainnet / sepolia namespace 분리

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 3: nonce store 구현**

Redis를 사용합니다. 같은 앱이 여러 인스턴스로 뜰 수 있으므로 production 경로에서는 in-memory fallback을 허용하지 않습니다.

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/nonce-store.ts src/lib/__tests__/marketplace/facilitator/nonce-store.test.ts
git commit -m "feat(facilitator): add replay-protected nonce store"
```

---

### Task 5: allowance / balance 확인 구현

**Files:**
- Create: `src/lib/marketplace/facilitator/check-funds.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 1: 실패하는 테스트 작성**

viem read를 mock해서 다음을 검증합니다.
- sufficient balance and allowance
- insufficient allowance
- insufficient balance

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 3: balance / allowance read 구현**

Read:
- `balanceOf(buyer)`
- `allowance(buyer, facilitatorSpender)`

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/check-funds.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/check-funds.ts src/lib/__tests__/marketplace/facilitator/check-funds.test.ts
git commit -m "feat(facilitator): validate TON allowance and balance"
```

---

### Task 6: transferFrom settlement executor 구현

**Files:**
- Create: `src/lib/marketplace/facilitator/settle-transfer.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- successful `transferFrom`
- on-chain revert
- wrong merchant address blocked before submission

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 3: settlement executor 구현**

viem wallet client로 아래를 호출합니다.
- `transferFrom(buyer, merchant, amount)`

반환값:
- `txHash`
- `status=submitted`

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/settle-transfer.ts src/lib/__tests__/marketplace/facilitator/settle-transfer.test.ts
git commit -m "feat(facilitator): execute TON transferFrom settlements"
```

---

### Task 7: 온체인 settlement 검증 구현

**Files:**
- Create: `src/lib/marketplace/facilitator/verify-settlement.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- correct TON contract target
- calldata가 `transferFrom(buyer, merchant, amount)`로 decode 되는지
- transaction receipt success
- `Transfer` log가 expected buyer, merchant, amount와 일치하는지
- contract, calldata, event mismatch는 failure 처리되는지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 3: 온체인 검증 구현**

viem을 사용해서 다음을 수행합니다.
- transaction fetch
- transaction receipt fetch
- function data decode
- event log decode

반환 상태:
- `submitted`
- `settled`
- `failed`

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/verify-settlement.ts src/lib/__tests__/marketplace/facilitator/verify-settlement.test.ts
git commit -m "feat(facilitator): verify TON settlements on-chain"
```

---

### Task 8: signed settlement receipt 구현

**Files:**
- Create: `src/lib/marketplace/facilitator/receipt-signing.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- receipt signing
- receipt verification
- tampered receipt rejection

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 3: receipt signing 구현**

다음 중 하나를 사용합니다.
- canonical JSON에 대한 detached ECDSA signature
- compact JWS style payload

최소 surface area를 위해 detached signature를 권장합니다.

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/receipt-signing.ts src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts
git commit -m "feat(facilitator): sign settlement receipts"
```

---

### Task 9: facilitator HTTP endpoint 구축

**Files:**
- Create: `src/app/api/facilitator/v1/settle/route.ts`
- Create: `src/app/api/facilitator/v1/settlements/[id]/route.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 1: 실패하는 route 테스트 작성**

커버 항목:
- valid settle request
- invalid signature
- nonce replay
- insufficient allowance
- missing internal auth
- status lookup

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 3: route 구현**

`POST /api/facilitator/v1/settle`는 다음을 수행합니다.
- request parse
- internal marketplace auth 검증
- profile load
- authorization 검증
- nonce consume
- funds check
- transfer execute
- receipt sign
- settlement record persist

`GET /api/facilitator/v1/settlements/:id`는 다음을 수행합니다.
- stored settlement status 반환
- on-chain verification state 포함

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 5: Commit**

```bash
git add src/app/api/facilitator/v1/settle/route.ts src/app/api/facilitator/v1/settlements/[id]/route.ts src/lib/__tests__/marketplace/facilitator/settle-route.test.ts
git commit -m "feat(facilitator): add settlement API routes"
```

---

### Task 10: submitted settlement 백그라운드 reconciliation 추가

**Files:**
- Create: `src/lib/marketplace/facilitator/reconcile-settlements.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- submitted settlement가 successful on-chain verification 후 settled가 되는지
- submitted settlement가 receipt mismatch 또는 revert 후 failed가 되는지
- 이미 final 상태인 settlement는 skip 되는지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 3: reconciliation 구현**

동작:
- submitted settlement 로드
- `verifySettlement()` 호출
- `settled` 또는 `failed` 상태 persist

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/reconcile-settlements.ts src/lib/__tests__/marketplace/facilitator/reconcile-settlements.test.ts
git commit -m "feat(facilitator): reconcile submitted TON settlements"
```

---

### Task 11: merchant-side x402 verification 통합

**Files:**
- Modify: `src/lib/marketplace/x402-middleware.ts`
- Create: `src/lib/marketplace/facilitator-client.ts`
- Create: `src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- merchant가 TON payment payload를 facilitator로 전달하는지
- merchant가 valid signed receipt를 허용하는지
- merchant가 mismatched receipt field를 거절하는지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 3: facilitator client 구현**

Merchant-side flow:
- `X-PAYMENT` parse
- internal facilitator `/api/facilitator/v1/settle` 호출
- facilitator receipt signature 검증
- `asset`, `amount`, `merchant`, `resource` 비교

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/x402-middleware.ts src/lib/marketplace/facilitator-client.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
git commit -m "feat(marketplace): integrate TON facilitator settlement"
```

---

### Task 12: env 문서와 safety default 추가

**Files:**
- Modify: `.env.local.sample`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design.md`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md`

**Step 1: env 문서 추가**

문서화 항목:
- `TON_FACILITATOR_MAINNET_ENABLED`
- `TON_FACILITATOR_SEPOLIA_ENABLED`
- `TON_FACILITATOR_MAINNET_RELAYER_KEY`
- `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`
- `TON_FACILITATOR_RECEIPT_SIGNING_KEY`
- `TON_FACILITATOR_REDIS_PREFIX`
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`
- `TON_FACILITATOR_INTERNAL_AUTH_SECRET`

**Step 2: marketplace 문서 업데이트**

TON settlement가 EIP-3009가 아니라 same-app facilitator route 내부의 approval-based pull 방식임을 기록합니다.

**Step 3: Commit**

```bash
git add .env.local.sample docs/superpowers/specs/2026-03-11-agent-economy-design.md docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md
git commit -m "docs(facilitator): document TON approval-based x402 settlement"
```

---

### Task 13: 전체 검증

**Files:**
- 이전 태스크 전체

**Step 1: focused facilitator 테스트 실행**

Run:
```bash
npx vitest run src/lib/__tests__/marketplace/facilitator
```

Expected: all facilitator tests pass

**Step 2: marketplace settlement 테스트 실행**

Run:
```bash
npx vitest run src/lib/__tests__/marketplace/x402-middleware.test.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
```

Expected: pass

**Step 3: lint 실행**

Run:
```bash
npm run lint
```

Expected: no new errors

**Step 4: build 실행**

Run:
```bash
npm run build
```

Expected: no type or route errors

**Step 5: 수동 스모크 테스트**

수동 흐름:
1. Sepolia TON에서 facilitator spender approve
2. payment 없이 marketplace endpoint 요청, 402 확인
3. `PaymentAuthorization` 서명
4. `X-PAYMENT`와 함께 재시도
5. internal facilitator route가 `transferFrom`을 submit하는지 확인
6. marketplace가 200을 반환하는지 확인
7. 이후 settlement가 온체인 검증 후 `settled`로 전이되는지 확인

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat(facilitator): add TON approval-based x402 facilitator"
```
