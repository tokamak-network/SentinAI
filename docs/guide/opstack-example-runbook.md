# OP Stack Example 실행/검증/종료 Runbook

기준 날짜: 2026-02-20

이 문서는 `examples/opstack/` 템플릿 기준으로 OP Stack 로컬 체인을 SentinAI에 연결하고, 정상 기동 여부를 검증한 뒤 종료하는 절차를 정리합니다.

---

## 1. 준비

필수:
- Docker / Docker Compose
- OP Stack 로컬 compose 환경 (`op-geth`, `op-node`, `op-batcher`, `op-proposer`, `op-challenger`)
- SentinAI 저장소

템플릿:
- `examples/opstack/.env.example`

---

## 2. 세팅

### 2.1 SentinAI `.env.local` 반영

아래 값을 기준으로 `.env.local`을 맞춥니다.

```bash
CHAIN_TYPE=optimism
L2_RPC_URL=http://localhost:8545
L1_RPC_URLS=https://ethereum-sepolia-rpc.publicnode.com,https://sepolia.drpc.org

ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=/absolute/path/to/your-opstack/docker-compose.yml
DOCKER_COMPOSE_PROJECT=opstack-local

NEXT_PUBLIC_NETWORK_NAME=OP Stack Local L2
```

선택(모니터링 확장):

```bash
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...

FAULT_PROOF_ENABLED=true
DISPUTE_GAME_FACTORY_ADDRESS=0x...
```

### 2.2 경로 확인

`DOCKER_COMPOSE_FILE`가 실제 OP Stack compose 파일을 가리키는지 확인합니다.

```bash
test -f /absolute/path/to/your-opstack/docker-compose.yml && echo "OK"
```

---

## 3. 실행

### 3.1 OP Stack 컨테이너 실행

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local up -d
```

### 3.2 SentinAI 실행

```bash
cd /Users/theo/workspace_tokamak/SentinAI
npm run dev
```

---

## 4. 체인 정상 기동 검증

### 4.1 컨테이너 상태

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local ps
```

정상 기준:
- `op-geth`, `op-node`가 `Up`
- 배처/제안자/챌린저가 반복 재시작 없이 `Up`

### 4.2 RPC 응답 확인

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

정상 기준:
- `eth_chainId`가 기대 체인 ID와 일치
- `eth_blockNumber`가 `0x0` 이상, 시간 경과에 따라 증가

### 4.3 블록 증가 확인(연속)

```bash
b1=$(curl -s http://localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -r '.result')
sleep 5
b2=$(curl -s http://localhost:8545 -H 'content-type: application/json' --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq -r '.result')
echo "before=$b1 after=$b2"
```

정상 기준:
- `after >= before`

### 4.4 SentinAI 연결 확인

```bash
curl -s http://localhost:3002/api/metrics | jq '{
  chain: .chain.type,
  blockHeight: .metrics.blockHeight,
  status: .status,
  components: (.components | map(.component))
}'
```

정상 기준:
- `chain = "optimism"`
- `blockHeight`가 `null`이 아님
- `components`에 OP 컴포넌트가 포함됨

---

## 5. 종료

### 5.1 SentinAI 종료

```bash
pkill -f 'next dev -p 3002' || true
```

### 5.2 OP Stack 컨테이너 종료

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local down
```

볼륨까지 정리하려면:

```bash
docker compose -f /absolute/path/to/your-opstack/docker-compose.yml -p opstack-local down -v
```

---

## 6. 자주 겪는 문제

1. `eth_blockNumber`가 증가하지 않음
- `op-node` 로그와 `op-geth` 로그를 확인합니다.
- L1 RPC 제한/오류 여부를 점검합니다.

2. SentinAI `components`가 비거나 일부만 표시됨
- `ORCHESTRATOR_TYPE=docker` 확인
- `DOCKER_COMPOSE_FILE`, `DOCKER_COMPOSE_PROJECT` 값 확인
- compose 서비스명이 `op-geth` 등 기본명과 크게 다르면 매핑 로직 보강이 필요할 수 있습니다.

3. Fault proof 카드가 기대와 다름
- `FAULT_PROOF_ENABLED=true`
- `DISPUTE_GAME_FACTORY_ADDRESS` 설정 여부 확인
