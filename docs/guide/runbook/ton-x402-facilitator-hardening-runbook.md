# TON x402 Facilitator Hardening Runbook

## 목적

이 문서는 SentinAI의 TON x402 facilitator를 운영 환경에 올리기 전에 확인해야 하는 hardening 항목을 정리한다.

현재 대상 범위:

- `/api/facilitator/v1/settle`
- `/api/facilitator/v1/settlements/[id]`
- `/api/marketplace/sequencer-health`
- `/api/marketplace/incident-summary`
- `/api/marketplace/batch-submission-status`
- marketplace product registry
- same-app reconciler

이 문서는 코드 구현 여부와 별개로 운영자가 반드시 결정해야 할 정책을 명시한다.

---

## 1. 운영 전제

Phase 1 TON facilitator는 다음 구조를 전제로 한다.

- buyer는 TON ERC-20 `approve(spender, amount)`를 먼저 수행한다
- spender는 facilitator relayer address이다
- buyer는 SentinAI 정의 EIP-712 `PaymentAuthorization`에 서명한다
- facilitator는 서명과 정책을 검증한 뒤 `transferFrom(buyer, merchant, amount)`를 실행한다
- settlement는 `submitted -> settled | failed` lifecycle로 추적된다

운영자가 가장 먼저 받아들여야 하는 사실은 이것이다.

- relayer key는 단순 API key가 아니라 실제 토큰 pull 권한과 직결된 고위험 비밀값이다
- receipt signing key는 settlement 결과에 대한 신뢰 기준이다

---

## 2. 필수 운영 환경변수

```bash
TON_FACILITATOR_SEPOLIA_ENABLED=true
TON_FACILITATOR_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
TON_FACILITATOR_SEPOLIA_ADDRESS=0xRelayerAddress
TON_FACILITATOR_SEPOLIA_RELAYER_KEY=0xRelayerPrivateKey
TON_FACILITATOR_RECEIPT_SIGNING_KEY=0xReceiptSigningPrivateKey
TON_FACILITATOR_REDIS_PREFIX=sentinai:prod
TON_FACILITATOR_INTERNAL_AUTH_SECRET=replace-with-long-random-secret
TON_FACILITATOR_MERCHANT_ALLOWLIST=[{"merchantId":"sequencer-health","address":"0xMerchant","resources":["/api/marketplace/sequencer-health"],"networks":["eip155:11155111"]}]
TON_FACILITATOR_RECONCILER_ENABLED=true
TON_FACILITATOR_RECONCILER_CRON=*/15 * * * * *
REDIS_URL=redis://...
```

정합성 규칙:

- `TON_FACILITATOR_SEPOLIA_ADDRESS`는 `TON_FACILITATOR_SEPOLIA_RELAYER_KEY`의 공개주소와 같아야 한다
- `TON_FACILITATOR_MERCHANT_ALLOWLIST`는 product registry와 정합해야 한다
- `REDIS_URL`이 없으면 운영 배포 기준으로 fail closed가 맞다

---

## 3. Key 관리

### 3.1 Relayer Key

relayer key는 아래 역할을 가진다.

- TON ERC-20 `transferFrom()` 실행
- 실제 spender 권한 행사

운영 규칙:

- relayer key와 receipt signing key를 절대 같은 값으로 두지 않는다
- relayer wallet에는 최소 가스만 유지한다
- relayer address는 buyer-facing `402` 응답에 노출되므로, 노출 자체는 문제 아니지만 private key는 최고 등급으로 보호해야 한다
- 지갑 권한은 facilitator 운영 전용으로 분리한다

권장 보관 방식:

- 클라우드 secret manager
- HSM/KMS 연동이 가능하면 더 좋음
- `.env.local` 또는 배포 시스템 plain-text 변수는 개발 환경에만 제한

### 3.2 Receipt Signing Key

receipt signing key는 아래 역할을 가진다.

- settlement receipt detached signature 생성
- merchant/buyer가 facilitator 결과를 검증하는 루트

운영 규칙:

- relayer key와 반드시 분리
- 회전 주기를 별도로 관리
- signer public address를 운영 문서에 고정

---

## 4. Key Rotation Runbook

### 4.1 Relayer Key Rotation

1. 새 relayer EOA 생성
2. 새 relayer에 소량 ETH 확보
3. `TON_FACILITATOR_SEPOLIA_ADDRESS`, `TON_FACILITATOR_SEPOLIA_RELAYER_KEY` 교체
4. buyer-facing `402`에서 새 spender가 노출되는지 확인
5. 운영자 문서와 buyer guide에 새 spender 공지
6. 기존 buyer allowance가 이전 spender를 가리키는지 모니터링
7. 일정 유예 후 구 relayer 폐기

주의:

- relayer rotation은 buyer allowance와 직접 연결되므로, 사전 공지 없이 교체하면 기존 buyer 결제가 실패한다
- rotation 직후에는 `approve` 재수행 필요 여부를 buyer에게 명확히 안내해야 한다

### 4.2 Receipt Signing Key Rotation

1. 새 receipt signing key 생성
2. 서버 env 교체
3. signer address를 운영 문서와 verifier 쪽 참조값에 반영
4. 짧은 유예 기간 동안 old/new signer를 동시에 수용할지 정책 결정

권장:

- receipt key rotation은 relayer rotation보다 덜 파괴적이지만 verifier 호환성 문제가 생길 수 있다
- buyer/merchant verifier가 signer allowlist를 가진다면 구/신 signer 병행 허용 창을 두는 편이 좋다

---

## 5. Rate Limit 정책

현재 same-app facilitator는 고가치 경로이므로 일반 API와 같은 rate limit로 두면 안 된다.

최소 권장:

- `/api/facilitator/v1/settle`
  - merchantId 단위 제한
  - source IP 단위 제한
  - nonce 재사용 감지 시 즉시 거절
- `/api/facilitator/v1/settlements/[id]`
  - polling 허용
  - 과도한 조회는 제한

초기 권장값:

- `settle`: merchantId당 분당 30, IP당 분당 60
- `settlements/:id`: IP당 분당 120

중요:

- buyer-facing `/api/marketplace/*`와 facilitator 내부 route는 분리해서 계측해야 한다
- 단일 rate limit만 두면 실제 장애 시 병목 원인을 구분하기 어렵다

---

## 6. Audit Log 기준

facilitator 운영에서 audit log는 선택이 아니라 필수다.

최소 로그 필드:

- request time
- merchantId
- buyer
- merchant
- asset
- amount
- resource
- nonce
- chainId / network
- settlementId
- txHash
- status transition
- failure reason

권장 추가 필드:

- requester IP
- internal auth principal
- receipt signer
- reconciler run timestamp

로그 분류:

- authorization validation failure
- nonce replay rejection
- insufficient allowance / balance
- tx submission success
- tx submission failure
- reconciliation settled
- reconciliation failed

---

## 7. Failed Settlement 대응 정책

운영자는 `submitted` 이후 실패를 반드시 별도 사고로 다뤄야 한다.

### 실패 유형

1. `authorization rejected`
- invalid signature
- expired window
- resource mismatch

2. `funding failure`
- insufficient balance
- insufficient allowance

3. `submission failure`
- RPC outage
- gas estimation failure
- revert before broadcast

4. `post-submission failure`
- broadcast 되었지만 receipt 기준 실패
- replacement 또는 dropped tx
- reconciliation 결과 `failed`

### 대응 원칙

- `authorization rejected`, `funding failure`는 buyer 재시도 유도
- `submission failure`는 facilitator/operator 문제로 간주
- `post-submission failure`는 반드시 `settlementId` 기준 추적

권장 운영 행동:

1. `failed` settlement를 별도 알림 채널에 전송
2. `failureReason`을 operator가 읽을 수 있는 형태로 저장
3. 자동 재시도 가능 유형과 수동 개입 필요 유형을 분리

초기 정책 예시:

- invalid signature: 재시도 없음
- insufficient allowance: buyer 재승인 후 재시도
- RPC timeout before broadcast: operator 확인 후 단건 재시도 가능
- on-chain revert: root cause 분류 후 재시도 금지

---

## 8. Reconciliation 운영

reconciler는 payment path의 일부다. 배경 작업이 아니라 최종 정산 확인 레이어다.

운영 체크:

- `TON_FACILITATOR_RECONCILER_ENABLED=true`
- cron 실행 여부
- pending settlement 개수
- oldest pending age
- failed settlement 수

권장 알림:

- pending settlement age > 5m
- failed settlement count > 0
- Redis read/write failure
- RPC provider 오류율 상승

---

## 9. Launch Checklist

운영 배포 전 최소 체크:

- [ ] relayer key와 receipt signing key 분리
- [ ] relayer address와 spender address 일치 확인
- [ ] merchant allowlist와 product registry 정합 확인
- [ ] `REDIS_URL` 설정
- [ ] reconciler enabled 확인
- [ ] `402` 응답에 spender/domain/types 노출 확인
- [ ] buyer guide 최신 spender 반영 확인
- [ ] live smoke 수행
- [ ] failed settlement 알림 경로 확인

---

## 10. 권장 후속 작업

아직 문서화만 되었거나 후속 구현이 필요한 항목:

- facilitator route 전용 rate-limit 코드
- audit log sink 정식 저장소 연결
- receipt signer rotation용 dual-signer 수용 정책
- failed settlement operator dashboard
- mainnet rollout 전 Sepolia live smoke 기록 축적

이 문서는 “지금 있는 구현을 안전하게 운영하기 위한 최소 기준”이다. 운영자가 이 기준을 충족하지 못하면 live traffic 투입을 미루는 편이 맞다.
