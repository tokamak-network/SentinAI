# Optimism L2 실행부터 SentinAI 연결까지 (로컬 가이드)

이 문서는 Optimism 공식 튜토리얼 기반 예제를 로컬에서 실행하고, SentinAI를 해당 L2에 연결하는 전체 절차를 다룹니다.

기준 날짜: 2026-02-20

---

## 1. 목표

- OP Stack L2를 로컬에서 실행
- L2 RPC(`http://localhost:8545`)가 정상 응답하는지 검증
- SentinAI를 로컬 L2에 연결
- SentinAI API(`/api/metrics`)에서 정상 메트릭 확인

---

## 2. 사전 준비

필수 도구:

- Docker / Docker Compose
- Git
- `make`
- `jq`

확인:

```bash
docker --version
docker compose version
git --version
make --version
jq --version
```

L1(Sepolia) 준비:

- Sepolia RPC URL
- 배포용 지갑 Private Key (충분한 Sepolia ETH 필요)

---

## 3. Optimism L2 생성

### 3.1 예제 코드 가져오기

```bash
cd /Users/theo/workspace_tokamak/SentinAI
mkdir -p external
cd external
git clone --depth 1 https://github.com/ethereum-optimism/docs.git
cd docs/create-l2-rollup-example
```

### 3.2 환경 파일 설정

```bash
cp .example.env .env
```

`.env`에서 최소 항목 수정:

- `L1_RPC_URL`
- `L1_BEACON_URL`
- `PRIVATE_KEY` (0x prefix 제거된 키)
- `L2_CHAIN_ID` (예: 42069)

### 3.3 배포 및 기동

```bash
make init
make setup
```

성공 후:

```bash
make up
```

---

## 4. 최신 이미지 호환성 체크 (중요)

2026-02 기준, 기본 `docker-compose.yml`의 버전 조합으로 아래 이슈가 발생할 수 있습니다.

- `op-node`가 `rollup.json` 신규 필드를 파싱하지 못함
- `op-geth`가 `invalid eip-1559 params in extradata`로 종료
- `op-node` RPC 포트가 `9545`인데 서비스들이 `8547`을 참조

아래를 반영하면 안정적으로 동작합니다.

### 4.1 `op-node`/`op-geth` 이미지 최신화

`docker-compose.yml`에서:

- `op-node` 이미지: `.../op-node:latest`
- `op-geth` 이미지: `.../op-geth:latest`

### 4.2 `op-node` RPC 포트 정합

`docker-compose.yml`에서:

- `op-node` 포트 매핑: `8547:9545`
- `op-node` 실행 인자: `--rpc.port=9545`
- `op-node` healthcheck URL: `http://localhost:9545`
- `proposer/challenger`의 `--rollup-rpc=http://op-node:9545`

추가로 아래 파일도 `8547 -> 9545`로 수정:

- `batcher/.env`의 `OP_BATCHER_ROLLUP_RPC`
- `dispute-mon/.env`의 `ROLLUP_RPC`

### 4.3 dispute-mon 주소 변수 반영

루트 `.env`에 아래 값이 있어야 `dispute-mon`이 재시작 루프 없이 뜹니다.

- `ROLLUP_RPC=http://op-node:9545`
- `PROPOSER_ADDRESS=...`
- `CHALLENGER_ADDRESS=...`
- `GAME_FACTORY_ADDRESS=...`

값은 `dispute-mon/.env`와 `deployer/.deployer/intent.toml`에서 확인할 수 있습니다.

### 4.4 볼륨 초기화 후 재기동

```bash
docker-compose down -v
docker-compose up -d --wait
```

---

## 5. L2 실행 검증

```bash
make status
make test-l1
make test-l2
```

추가 검증:

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

예상:

- `eth_chainId` = `0xa455` (42069)
- `eth_blockNumber` 값이 시간에 따라 증가

---

## 6. SentinAI 연결

`/Users/theo/workspace_tokamak/SentinAI/.env.local`에 아래를 반영합니다.

```bash
# L2 RPC
L2_RPC_URL=http://localhost:8545
CHAIN_TYPE=optimism

# Docker orchestrator
ORCHESTRATOR_TYPE=docker
DOCKER_COMPOSE_FILE=external/docs/create-l2-rollup-example/docker-compose.yml
DOCKER_COMPOSE_PROJECT=create-l2-rollup-example

# EOA (intent.toml 기준)
BATCHER_EOA_ADDRESS=0x...
PROPOSER_EOA_ADDRESS=0x...
CHALLENGER_EOA_ADDRESS=0x...

# 로컬에서는 proxyd 경로 비활성 권장
L1_PROXYD_ENABLED=false
```

---

## 7. SentinAI 연결 검증

### 7.1 서버 실행

```bash
cd /Users/theo/workspace_tokamak/SentinAI
npm run dev
```

### 7.2 메트릭 API 확인

```bash
curl -s 'http://localhost:3002/api/metrics' | jq '{
  status: .status,
  blockHeight: .metrics.blockHeight,
  errors: (.errors // [])
}'
```

예상:

- `status: "healthy"`
- `blockHeight`가 null이 아님
- `errors`가 비어 있음

---

## 8. 자주 겪는 문제

1. `unknown field "minBaseFee"` 또는 `daFootprintGasScalar`
- 원인: `op-node` 버전이 오래됨
- 조치: `op-node:latest` 사용

2. `invalid eip-1559 params in extradata`
- 원인: `op-geth` 버전 불일치
- 조치: `op-geth:latest` 사용 후 `down -v`

3. `op-node`는 떠 있는데 `batcher/proposer`가 `op-node:8547` 연결 실패
- 원인: 최신 `op-node` 내부 RPC 포트가 `9545`
- 조치: 관련 모든 `rollup-rpc` 값을 `op-node:9545`로 통일

4. `dispute-mon`이 `invalid address`로 재시작
- 원인: 루트 `.env`의 주소 변수 미설정
- 조치: `PROPOSER_ADDRESS`, `CHALLENGER_ADDRESS`, `GAME_FACTORY_ADDRESS` 설정

---

## 9. 종료 및 정리

L2 중지:

```bash
cd /Users/theo/workspace_tokamak/SentinAI/external/docs/create-l2-rollup-example
docker-compose down
```

볼륨까지 제거:

```bash
docker-compose down -v
```

SentinAI 종료: 실행 터미널에서 `Ctrl+C`
