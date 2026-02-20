# ZK L2 Example 실행/세팅/종료 Runbook

기준 날짜: 2026-02-20

이 문서는 `examples/zkstack/` 템플릿 기준으로 로컬 ZK L2를 빠르게 올리고, SentinAI에 연결하고, 안전하게 종료하는 절차를 다룹니다.

---

## 1. 준비

필수:
- Docker / Docker Compose
- `zkstack` CLI 설치
- 본 저장소 루트에서 작업

참고 템플릿:
- `examples/zkstack/.env.example`
- `examples/zkstack/docker-compose.core-only.yml`
- `examples/zkstack/secrets.container.yaml.example`

---

## 2. 세팅

### 2.1 ZK Stack 에코시스템 생성/초기화

```bash
zkstack ecosystem create
cd <YOUR_ECOSYSTEM_DIR>
zkstack ecosystem init --dev
```

초기화 후 다음 경로가 생성됩니다.
- 체인 config 디렉터리: `<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs`

### 2.2 컨테이너용 secrets 파일 생성

```bash
cp /Users/theo/workspace_tokamak/SentinAI/examples/zkstack/secrets.container.yaml.example \
  <YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs/secrets.container.yaml
```

`validator_key`, `node_key`는 체인에서 생성된 실제 값으로 교체합니다.

### 2.3 SentinAI `.env.local` 설정

최소 예시:

```bash
CHAIN_TYPE=zkstack
ZKSTACK_MODE=legacy-era
ORCHESTRATOR_TYPE=docker

L2_RPC_URL=http://localhost:3050
L1_RPC_URLS=http://localhost:8545
ZK_BATCHER_STATUS_URL=http://localhost:8081/status/settlement

DOCKER_COMPOSE_FILE=examples/zkstack/docker-compose.core-only.yml
DOCKER_COMPOSE_PROJECT=zkstack_core
ZKSTACK_EXECUTION_SERVICE=zkstack-core
ZKSTACK_BATCHER_SERVICE=zkstack-core
ZKSTACK_PROVER_SERVICE=zkstack-core
ZKSTACK_COMPONENT_PROFILE=core-only
```

`examples/zkstack/docker-compose.core-only.yml` 실행 시 아래 환경 변수도 함께 필요합니다.
- `HOST_WORKSPACE_ROOT`: 워크스페이스 절대경로 (예: `/Users/theo/workspace_tokamak/SentinAI`)
- `ZKSTACK_CONFIG_DIR`: 체인 config 절대경로 (예: `<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs`)

---

## 3. 실행

아래 순서대로 실행합니다.

### 3.1 L1(reth)/Postgres 실행

`zkstack ecosystem init --dev`가 생성한 compose를 사용합니다.

```bash
cd <YOUR_ECOSYSTEM_DIR>
docker compose up -d reth postgres
```

### 3.2 ZK server-v2 core-only 실행

SentinAI 저장소 루트에서 실행:

```bash
cd /Users/theo/workspace_tokamak/SentinAI
HOST_WORKSPACE_ROOT=/Users/theo/workspace_tokamak/SentinAI \
ZKSTACK_CONFIG_DIR=<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs \
docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core up -d
```

### 3.3 settlement probe 실행(선택, 권장)

```bash
npm run probe:zk:settlement
```

### 3.4 SentinAI 실행

```bash
npm run dev
```

---

## 4. 검증

### 4.1 RPC 확인

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### 4.2 SentinAI 메트릭 확인

```bash
curl -s http://localhost:3002/api/metrics
```

핵심 확인 포인트:
- `chain.type = "zkstack"`
- `components`에 `zksync-server` 표시
- `settlement.enabled = true` (probe 실행 시)

### 4.3 프로세스/컨테이너 확인

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

핵심 컨테이너:
- `zkstack-core`
- `zkstack-apis`
- `reth`
- `postgres`

---

## 5. 종료

### 5.1 SentinAI 종료

```bash
pkill -f 'next dev -p 3002' || true
```

### 5.2 probe 종료

probe를 foreground로 실행했다면 `Ctrl+C`로 종료합니다.

백그라운드 실행 시:

```bash
pkill -f 'zk-settlement-probe.mjs' || true
```

### 5.3 ZK core-only 컨테이너 종료

```bash
cd /Users/theo/workspace_tokamak/SentinAI
HOST_WORKSPACE_ROOT=/Users/theo/workspace_tokamak/SentinAI \
ZKSTACK_CONFIG_DIR=<YOUR_ECOSYSTEM_DIR>/chains/<CHAIN_NAME>/configs \
docker compose -f examples/zkstack/docker-compose.core-only.yml -p zkstack_core down
```

### 5.4 L1/Postgres 종료

```bash
cd <YOUR_ECOSYSTEM_DIR>
docker compose down
```

데이터까지 제거하려면:

```bash
docker compose down -v
```

---

## 6. 트러블슈팅

### Q1. `zkstack-core`는 떠 있는데 `components`가 비어 보임
- `ORCHESTRATOR_TYPE=docker`와 `DOCKER_COMPOSE_FILE` 설정을 확인합니다.
- `ZKSTACK_COMPONENT_PROFILE=core-only`인지 확인합니다.

### Q2. Settlement 카드가 안 보임
- `ZK_BATCHER_STATUS_URL` 설정 여부 확인
- `npm run probe:zk:settlement` 실행 여부 확인

### Q3. 오토스케일링이 적용되지 않음
- `/api/scaler`에서 `autoScalingEnabled` 확인
- cooldown 중인지 확인
- Docker 모드에서 `zkstack-core`가 실행 중인지 확인
