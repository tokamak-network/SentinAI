# Agent Marketplace Operations Runbook

## 목적

이 문서는 SentinAI의 `agent-marketplace` 기능을 운영 환경에 배포하고 검증할 때 필요한 최소 절차를 정리한다.

현재 기준 구현 범위:

- `/marketplace`
- `/api/agent-marketplace/catalog`
- `/api/agent-marketplace/agent.json`
- `/api/agent-marketplace/sequencer-health`
- `/api/agent-marketplace/incident-summary`
- `/api/agent-marketplace/batch-submission-status`
- `/api/agent-marketplace/ops/summary`
- `/api/agent-marketplace/ops/disputes`
- `/api/agent-marketplace/ops/contracts`
- `/v2/marketplace`
- x402 결제 게이트
- 요청 로그 / rate limit / SLA 집계
- ERC-8004 `register(agentURI)` 제출 클라이언트
- reputation batch export 경계

## 사전 조건

필수:

- L2 RPC 연결 가능
- 배포 환경에서 `npm run build` 성공
- 운영용 L1 RPC (`SENTINAI_L1_RPC_URL` 권장)
- Redis (`REDIS_URL`) 연결 가능

선택:

- ERC-8004 등록용 wallet key
- ERC-8004 registry address
- facilitated payment backend

## 핵심 환경변수

```bash
MARKETPLACE_ENABLED=true
MARKETPLACE_PAYMENT_MODE=facilitated
MARKETPLACE_RATE_LIMIT_MAX_REQUESTS=60
MARKETPLACE_RATE_LIMIT_WINDOW_MS=60000

MARKETPLACE_AGENT_URI_BASE=https://sentinai.example.com
MARKETPLACE_WALLET_KEY=0x...
ERC8004_REGISTRY_ADDRESS=0x...
MARKETPLACE_REPUTATION_REGISTRY_ADDRESS=0x...
MARKETPLACE_IPFS_MODE=http
MARKETPLACE_IPFS_UPLOAD_URL=https://pinning.example.com/upload
MARKETPLACE_IPFS_AUTH_TOKEN=secret-token
REDIS_URL=redis://localhost:6379
MARKETPLACE_REPUTATION_ENABLED=true
MARKETPLACE_REPUTATION_SCHEDULE=10 0 * * *

SENTINAI_L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
X402_NETWORK=eip155:11155111
```

개발/스모크 테스트용:

```bash
MARKETPLACE_PAYMENT_MODE=open
```

`open` 모드는 결제 정산 없이도 protected route를 확인할 수 있으므로 첫 배포 검증에 유용하다.

## 배포 순서

1. 환경변수 설정
2. `npm run build`
3. `npm run start` 또는 배포 플랫폼 release
4. `/api/agent-marketplace/catalog` 확인
5. `/api/agent-marketplace/agent.json` 확인
6. protected route 402 challenge 확인
7. `open` 모드 또는 실제 facilitator 경로로 200 응답 확인
8. bootstrap 실행 시 registration warning/success 로그 확인

## 운영 검증 체크리스트

### 0. 운영 콘솔

```bash
open https://sentinai.example.com/v2/marketplace
curl -s https://sentinai.example.com/api/agent-marketplace/ops/summary
curl -s https://sentinai.example.com/api/agent-marketplace/ops/contracts
```

기대 결과:

- `/v2/marketplace`에 `STATUS`, `REQUESTS / 24H`, `BUYERS / 24H`, `LAST BATCH` 카드 존재
- `ops/summary`가 서비스별 request count, recent verified requests, SLA agents를 반환
- `ops/contracts`가 registry / reputation contract 주소와 event name 목록을 반환

`/v2` mock dashboard에서는 좌측 sidebar의 `Marketplace` 항목으로 `/v2/marketplace`에 진입한다.

### 1. 공개 메타데이터

```bash
open https://sentinai.example.com/marketplace
curl -s https://sentinai.example.com/api/agent-marketplace/catalog
curl -s https://sentinai.example.com/api/agent-marketplace/agent.json
```

기대 결과:

- `/marketplace`에 `THIS INSTANCE`, `BROWSE REGISTRY`, `CONNECT GUIDE` 섹션이 존재
- `/marketplace?tab=registry`, `/marketplace?tab=instance`, `/marketplace?tab=guide` deep link가 모두 동작
- `catalog`에 3개 active service 존재
- `agent.json`에 capability 3개 존재
- `endpoint`가 `/api/agent-marketplace`
- 공개 페이지의 서비스/가이드 내용이 `/api/agent-marketplace/*` 기준으로 표기됨

### 2. 결제 챌린지

```bash
curl -i https://sentinai.example.com/api/agent-marketplace/sequencer-health
```

기대 결과:

- HTTP `402`
- `accepts[0].amount` 존재
- `error.code = payment_required`

### 3. open 모드 스모크

```bash
PAYLOAD=$(printf '%s' '{"agentId":"agent-123","scheme":"exact","network":"eip155:11155111","token":"ton","amount":"100000000000000000","authorization":"signed-payload"}' | base64)
curl -s \
  -H "x-payment: ${PAYLOAD}" \
  https://sentinai.example.com/api/agent-marketplace/sequencer-health
```

기대 결과:

- HTTP `200`
- `status`, `healthScore`, `action` 필드 존재

## ERC-8004 등록 동작

부트스트랩 시 아래 조건을 모두 만족하면 `register(agentURI)`를 시도한다.

- `MARKETPLACE_ENABLED=true`
- `MARKETPLACE_AGENT_URI_BASE` 설정
- `MARKETPLACE_WALLET_KEY` 설정
- `ERC8004_REGISTRY_ADDRESS` 설정
- `SENTINAI_L1_RPC_URL` 또는 `L1_RPC_URL` 설정

등록 성공 시:

- 현재 구현은 receipt log에서 우선 `AgentRegistered(uint256 agentId)`를 파싱하고, 없으면 대체 시그니처 `Register(address agent, string agentURI)`도 시도한다.
- 두 이벤트 모두 없으면 마지막 fallback으로 `txHash`를 registration identifier처럼 반환한다.

등록 실패 시:

- bootstrap은 실패하지 않는다.
- warning만 남기고 본체 인스턴스 bootstrap은 계속 진행한다.

## SLA / Reputation 운영 포인트

request log는 middleware 레벨에서 기록되며 Redis를 source-of-truth로 사용한다.

기록 필드:

- `agentId`
- `serviceKey`
- `timestamp`
- `latencyMs`
- `verificationResult`
- `success`

현재 reputational trust는 두 단계로 나뉜다.

1. 오프체인 SLA 집계
2. IPFS 업로드 + on-chain root submission

현재 scheduler 연결:

- `MARKETPLACE_REPUTATION_ENABLED=true`일 때만 활성화
- 기본 cron: `10 0 * * *` (UTC)
- 전일 00:00:00 ~ 23:59:59.999 UTC 구간을 집계 대상으로 사용
- request log는 Redis 키 `sentinai:agent-marketplace:request-logs`에 저장된다
- 이전 reputation score는 Redis 키 `sentinai:agent-marketplace:reputation:scores`에서 읽고 쓴다
- scheduler는 `previousScores`를 강제로 덮어쓰지 않으므로, Redis에 저장된 이전 score가 다음 일일 batch의 기준값이 된다
- `REDIS_URL`이 없거나 Redis 읽기/쓰기가 실패하면 batch publish는 즉시 실패한다

### Dispute Review Workflow

- 운영자는 `/v2/marketplace`의 `DISPUTES` 패널에서 현재 분쟁 요청을 본다
- 생성 API: `POST /api/agent-marketplace/ops/disputes`
- 상태 변경 API: `PATCH /api/agent-marketplace/ops/disputes/[id]`
- 현재 상태 전이:
  - `open -> reviewed | resolved | rejected`
  - `reviewed -> resolved | rejected`
  - `resolved`, `rejected`는 terminal state
- 현재 분쟁 UI는 operator review 용이며, on-chain dispute execution UI는 아직 없다

### Canonical ABI Assets

- Registry ABI: `src/lib/agent-marketplace/abi/agent-registry.ts`
- Reputation ABI: `src/lib/agent-marketplace/abi/reputation-registry.ts`
- Contracts status: `GET /api/agent-marketplace/ops/contracts`
- runtime receipt parsing은 canonical ABI를 우선 사용하고, 문서화된 alternate event signatures를 계속 허용한다

아직 구현되지 않은 것:

- dispute UI / resolution flow

## 장애 대응

### catalog는 열리는데 paid route가 모두 402만 반환

가능 원인:

- `x-payment` 누락
- 잘못된 base64 payload
- amount mismatch

확인:

- `catalog.services[*].payment.amount`
- 클라이언트가 보내는 `amount`
- `MARKETPLACE_PAYMENT_MODE`

### bootstrap은 성공하지만 registry 등록이 안 됨

가능 원인:

- `MARKETPLACE_ENABLED` 미설정
- registry 관련 env 누락
- L1 RPC 미설정
- wallet key 형식 오류
- receipt reverted

확인:

- 앱 warning 로그
- `MARKETPLACE_AGENT_URI_BASE`
- `ERC8004_REGISTRY_ADDRESS`
- `SENTINAI_L1_RPC_URL`

### reputation batch는 생성되는데 IPFS 또는 root submission이 실패함

가능 원인:

- `REDIS_URL` 미설정 또는 Redis 접근 실패
- `MARKETPLACE_IPFS_MODE` 미설정
- `MARKETPLACE_IPFS_UPLOAD_URL` 또는 `MARKETPLACE_IPFS_AUTH_TOKEN` 누락
- `MARKETPLACE_REPUTATION_REGISTRY_ADDRESS` 누락
- L1 RPC 미설정
- wallet key 형식 오류

확인:

- `redis-cli ping`
- Redis에 `sentinai:agent-marketplace:reputation:scores` 키가 저장되는지 여부
- IPFS upload endpoint 응답 본문에 `cid` 존재 여부
- `submitMerkleRoot(address[],uint8[],bytes32,string)` ABI와 배포 컨트랙트 일치 여부
- receipt event가 `MerkleRootSubmitted(bytes32 merkleRoot, string batchHash)` 또는 대체 시그니처 `RootSubmitted(bytes32 root, string batchHash)` 중 어느 쪽인지 확인
- receipt status가 `success`인지 여부

### 429 rate_limited가 예상보다 빨리 발생

확인:

- `MARKETPLACE_RATE_LIMIT_MAX_REQUESTS`
- `MARKETPLACE_RATE_LIMIT_WINDOW_MS`
- 동일 `agentId`/`serviceKey` 재사용 여부

## 권장 다음 단계

1. `/v2/marketplace`를 기존 top-level navigation에 연결
2. dispute review 패널에 filtering / detail drawer 추가
3. public website `/marketplace`를 현재 `agent-marketplace` catalog 기준으로 재정렬
