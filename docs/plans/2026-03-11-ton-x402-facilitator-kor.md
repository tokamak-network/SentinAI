# TON x402 Facilitator 구현 플랜

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** EIP-3009나 토큰 컨트랙트 업그레이드 없이, Ethereum mainnet과 Sepolia의 TON ERC-20 결제를 처리하는 same-app custom x402 facilitator를 구현합니다.

**Architecture:** Buyer는 facilitator spender에 대해 1회 ERC-20 allowance를 부여하고, 이후 구매마다 facilitator가 정의한 EIP-712 `PaymentAuthorization`에 서명합니다. Marketplace API는 같은 SentinAI 앱 내부의 facilitator route로 이 authorization을 전달하고, facilitator는 정책을 검증한 뒤 `transferFrom`을 실행하고 Redis에 settlement 상태를 저장한 뒤 signed settlement proof를 반환합니다. 2026-03-13 Sepolia live smoke 결과, 현재 TON settlement는 `merchant == relayer == spender`일 때만 성공했으므로 Phase 1 구현과 운영 설정은 이 제약을 유지해야 합니다.

**Tech Stack:** TypeScript, viem, Next.js route handlers, Redis, Vitest

---

## 구현 전제

- 이 플랜은 `docs/plans/2026-03-11-ton-x402-facilitator-design-kor.md`를 source of truth로 따릅니다.
- 기존 marketplace/x402 문서에 EIP-3009 기반 설명이 남아 있어도, TON settlement는 approval-based pull facilitator를 기준으로 구현합니다.
- `src/lib/marketplace/x402-middleware.ts`와 기본 marketplace route 골격이 아직 없으면, facilitator 통합 전에 최소 buyer-facing x402 흐름부터 선행 구현해야 합니다.
- Phase 1의 background reconciliation은 same-app in-process scheduler로 구현합니다. 별도 worker는 이 플랜 범위 밖입니다.
- 현재 TON 배포에서는 allowlist merchant address와 relayer/spender address를 동일한 운영자 제어 주소로 맞춰야 합니다.

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
- per-profile RPC URL env
- TON asset address
- Redis nonce/settlement 공통 prefix
- marketplace → facilitator internal call용 auth secret
- merchant allowlist env
- reconciler enabled/cron env

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/config.test.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/types.ts src/lib/marketplace/facilitator/config.ts src/lib/__tests__/marketplace/facilitator/config.test.ts
git commit -m "feat(facilitator): add TON facilitator config profiles"
```

---

### Task 2: EIP-712 PaymentAuthorization과 canonical resource 규칙 정의

**Files:**
- Create: `src/lib/marketplace/facilitator/typed-data.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 1: 실패하는 테스트 작성**

테스트 항목:
- domain field가 올바른지
- typed data에 `buyer`, `merchant`, `asset`, `amount`, `resource`, `nonce`, `validAfter`, `validBefore`가 포함되는지
- resource canonicalization이 동작하는지
- `/api/marketplace/*` path만 허용하는지
- query string, fragment, origin 포함 입력을 거절하는지
- trailing slash 제거가 일관적인지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/typed-data.test.ts`

**Step 3: typed data helper 구현**

Functions:
- `getPaymentAuthorizationDomain(profile)`
- `getPaymentAuthorizationTypes()`
- `canonicalizeResource(resource)`

Canonicalization 규칙:
- path-only resource만 허용
- `/api/marketplace/` prefix 필수
- query string 금지
- fragment 금지
- trailing slash 제거
- 중복 slash 거절

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
- canonicalized resource mismatch
- unsupported network/profile

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

### Task 5: settlement store 추가

**Files:**
- Create: `src/lib/marketplace/facilitator/settlement-store.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- settlement record 생성
- settlement id로 단건 조회
- pending settlement index 조회
- `submitted`에서 `settled` 또는 `failed`로 상태 전이
- chain namespace 분리

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 3: settlement store 구현**

Redis key schema:
- `{prefix}:facilitator:settlement:{chainId}:{settlementId}`
- `{prefix}:facilitator:pending:{chainId}`

구현 항목:
- `createSettlement()`
- `getSettlement()`
- `listPendingSettlements()`
- `markSettlementStatus()`
- production 경로에서 in-memory fallback 금지

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/settlement-store.ts src/lib/__tests__/marketplace/facilitator/settlement-store.test.ts
git commit -m "feat(facilitator): add TON settlement store"
```

---

### Task 6: allowance / balance 확인 구현

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

### Task 7: transferFrom settlement executor 구현

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

### Task 8: 온체인 settlement 검증 구현

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

### Task 9: detached signed settlement receipt 구현

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

detached ECDSA만 사용합니다.

구현 규칙:
- key를 사전순 정렬한 canonical JSON 문자열 생성
- whitespace 없는 canonical JSON 직렬화
- `keccak256(canonicalJsonBytes)` digest 생성
- receipt signing key로 digest 서명
- marketplace는 configured signer address로 검증

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/receipt-signing.ts src/lib/__tests__/marketplace/facilitator/receipt-signing.test.ts
git commit -m "feat(facilitator): sign settlement receipts"
```

---

### Task 10: facilitator HTTP endpoint 구축

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
- merchant allowlist mismatch
- status lookup

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 3: route 구현**

`POST /api/facilitator/v1/settle`는 다음을 수행합니다.
- request parse
- internal marketplace auth 검증
- `x-sentinai-merchant-id` 검증
- profile load
- authorization 검증
- nonce consume
- funds check
- transfer execute
- receipt sign
- settlement record persist
- pending settlement index 등록
- singleton reconciler start 보장

`GET /api/facilitator/v1/settlements/:id`는 다음을 수행합니다.
- stored settlement status 반환
- on-chain verification state 포함
- settlement store만 읽고 계산 중복 금지

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/settle-route.test.ts`

**Step 5: Commit**

```bash
git add src/app/api/facilitator/v1/settle/route.ts src/app/api/facilitator/v1/settlements/[id]/route.ts src/lib/__tests__/marketplace/facilitator/settle-route.test.ts
git commit -m "feat(facilitator): add settlement API routes"
```

---

### Task 11: submitted settlement 백그라운드 reconciliation 추가

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

### Task 12: reconciliation runner 추가

**Files:**
- Create: `src/lib/marketplace/facilitator/reconcile-runner.ts`
- Create: `src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 1: 실패하는 테스트 작성**

커버 항목:
- `ensureFacilitatorReconcilerStarted()`가 최초 1회만 scheduler를 등록하는지
- `TON_FACILITATOR_RECONCILER_ENABLED=false`면 시작하지 않는지
- cron tick이 pending reconciliation을 호출하는지

**Step 2: 테스트가 실패하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 3: runner 구현**

구현 규칙:
- `node-cron` 사용
- 기본 cron: `*/15 * * * * *`
- module-level singleton guard 유지
- `POST /settle` 또는 merchant verification 경로에서 `ensureFacilitatorReconcilerStarted()` 호출

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/facilitator/reconcile-runner.ts src/lib/__tests__/marketplace/facilitator/reconcile-runner.test.ts
git commit -m "feat(facilitator): add settlement reconciler runner"
```

---

### Task 13: merchant-side x402 verification 통합

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
- `x-sentinai-internal-auth`와 `x-sentinai-merchant-id` 전달
- facilitator receipt signature 검증
- `asset`, `amount`, `merchant`, `resource` 비교
- `ensureFacilitatorReconcilerStarted()` 호출

**Step 4: 테스트가 통과하는지 실행**

Run: `npx vitest run src/lib/__tests__/marketplace/facilitator-client.test.ts`

**Step 5: Commit**

```bash
git add src/lib/marketplace/x402-middleware.ts src/lib/marketplace/facilitator-client.ts src/lib/__tests__/marketplace/facilitator-client.test.ts
git commit -m "feat(marketplace): integrate TON facilitator settlement"
```

---

### Task 14: env 문서와 safety default 추가

**Files:**
- Modify: `.env.local.sample`
- Modify: `docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md`

**Step 1: env 문서 추가**

문서화 항목:
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

**Step 2: marketplace 문서 업데이트**

TON settlement가 EIP-3009가 아니라 same-app facilitator route 내부의 approval-based pull 방식임을 기록합니다.

**Step 3: Commit**

```bash
git add .env.local.sample docs/superpowers/specs/2026-03-11-agent-economy-design-kor.md
git commit -m "docs(facilitator): document TON approval-based x402 settlement"
```

---

### Task 15: 전체 검증

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
