# ZK Stack 기반 L2 로컬 배포 가이드 (공식 문서 기반)

기준 날짜: 2026-02-20  
기준 문서: ZKsync 공식 문서 (`docs.zksync.io`)

---

## 1. 목적

- ZK Stack CLI로 로컬 ZKsync 체인(L2) 배포
- 로컬 RPC 정상 동작 확인
- 계정 펀딩 및 기본 상호작용 확인
- 선택적으로 Portal/Explorer 실행
- 선택적으로 Gateway 정산 레이어 실험 준비

---

## 2. 중요 주의사항

공식 Quickstart 기준, 현재 `zkstack` CLI 경로는 **ZKsync OS가 아닌 legacy EraVM 체인**을 생성합니다.  
즉, "로컬 배포 성공"과 "ZKsync OS 기반 운영 준비 완료"는 동일하지 않습니다.

---

## 3. 사전 준비

Quickstart에서 안내하는 개발 의존성을 먼저 준비합니다.

- Docker + Docker Compose
- Rust / Cargo
- Foundry (배포 단계에서 사용)

참고:
- Quickstart는 `zkstack` 설치를 `cargo install ... zkstack` 방식으로 안내합니다.
- Gateway 로컬 실험 문서는 `zkstackup` 사용도 안내합니다.

---

## 4. 로컬 L2 배포 (Quickstart 경로)

### 4.1 ZK Stack CLI 설치

```bash
cargo install --git https://github.com/matter-labs/zksync-era/ --locked zkstack --force
```

### 4.2 에코시스템 생성

```bash
zkstack ecosystem create
```

권장 선택(로컬 실습 기준):

- zksync-era origin: `Clone for me`
- L1 network: `Localhost` (로컬 reth 컨테이너)
- chain id: 기본값(예: `271`) 사용 가능
- wallet source: `Localhost` (기본 rich wallet 활용)
- proofs: `NoProofs` (개발/테스트 용도)
- data availability: Rollup 또는 Validium 중 선택
- gas token: `Eth`

### 4.3 에코시스템 초기화

```bash
cd <YOUR_ECOSYSTEM_DIRECTORY>
zkstack ecosystem init --dev
```

### 4.4 체인 실행

```bash
zkstack server
```

멀티 체인 구성 시:

```bash
zkstack server --chain <CHAIN_NAME>
```

---

## 5. 동작 확인

기본 RPC 엔드포인트:

- L2 RPC: `http://localhost:3050`
- (로컬 reth 선택 시) L1 RPC: `http://localhost:8545`

### 5.1 최소 검증 (필수)

1) 프로세스/포트 확인

```bash
ps aux | rg 'zkstack .*server|zksync_server' | rg -v rg
lsof -i :3050
```

2) L2 체인 ID 확인

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

3) 블록 번호 확인

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

통과 기준:

- `zkstack server`(또는 `zksync_server`) 프로세스가 실행 중
- `3050` 포트 LISTEN 상태
- `eth_chainId`가 생성 시 설정한 chain ID와 일치
- `eth_blockNumber`가 `0x0` 이상으로 응답

### 5.2 실행 상태 검증 (권장)

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"zks_L1BatchNumber","params":[],"id":1}'
```

통과 기준:

- `eth_syncing`가 `false`
- `zks_L1BatchNumber`가 `0x0` 이상으로 응답

### 5.3 로컬 reth(L1) 연동 검증 (로컬 L1 사용 시)

```bash
curl -s http://localhost:8545 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

통과 기준:

- L1 RPC가 정상 응답(예: Localhost reth는 `0x9`)

### 5.4 실측 예시 (본 저장소 기준)

아래 값이 확인되면, "로컬 L2 기동 + RPC 정상 + 배치 파이프라인 동작"으로 판단할 수 있습니다.

- `eth_chainId` = `0x10f` (271)
- `eth_blockNumber` = `0x2` (또는 그 이상)
- `eth_syncing` = `false`
- `zks_L1BatchNumber` = `0x1` (또는 그 이상)
- `http://localhost:8545 eth_chainId` = `0x9`

### 5.5 원클릭 검증 스크립트

반복 검증이 필요하면 아래 스크립트를 사용합니다.

```bash
./scripts/verify-zkstack-local.sh
```

환경이 다르면 기대값을 환경 변수로 오버라이드할 수 있습니다.

```bash
L2_RPC_URL=http://localhost:3050 \
L1_RPC_URL=http://localhost:8545 \
EXPECTED_L2_CHAIN_ID=0x10f \
EXPECTED_L1_CHAIN_ID=0x9 \
./scripts/verify-zkstack-local.sh
```

출력 규칙:

- `PASS`: 검증 통과
- `WARN`: 환경 의존 이슈 가능성 있음 (예: L1 미사용)
- `FAIL`: 즉시 조치 필요 (예: chainId 불일치, RPC 응답 실패)

---

## 6. 계정 펀딩 및 상호작용

### 6.1 로컬 rich account 사용

```bash
zkstack dev rich-account --chain <CHAIN_NAME>
```

### 6.2 브리지 예시 (zksync-cli)

```bash
zksync-cli bridge deposit \
  --rpc=http://localhost:3050 \
  --l1-rpc=http://localhost:8545
```

---

## 7. Portal / Explorer 실행 (선택)

### 7.1 Portal

```bash
zkstack portal
```

기본 포트: `http://localhost:3030`

### 7.2 Explorer

```bash
zkstack explorer init
zkstack explorer backend --chain <CHAIN_NAME>
zkstack explorer run
```

기본 포트: `http://localhost:3010`

---

## 8. Gateway 경로 (선택)

Gateway는 선택적 정산/증명 집계 레이어입니다.  
공식 문서 기준으로 체인은 초기에는 Ethereum 정산으로 시작하고, 이후 Gateway로 전환할 수 있습니다.

Gateway 로컬 실험 문서에서 안내하는 핵심 선행 절차:

```bash
foundryup-zksync -C 27360d4c8
zkstackup
zkstack ecosystem create
cd <YOUR_ECOSYSTEM_DIRECTORY>
zkstack ecosystem init --dev
```

주의:

- Gateway 전환은 체인 배포/정산 구성에 영향을 주므로 테스트 환경에서 먼저 검증
- 체인 운영 모드(`legacy-era` vs `os-preview`)를 분리해 검증

---

## 9. 자주 겪는 이슈

1. `zkstack ecosystem init`가 오래 걸림
- Rust 빌드/컨테이너 초기화가 포함되어 초기 1회는 오래 걸릴 수 있음

2. Docker 리소스 부족
- Docker 메모리/디스크 할당 증가 후 재시도

3. RPC는 열렸는데 트랜잭션 테스트 실패
- 계정 L2 잔액 부족 가능성 큼 → rich account/bridge 단계 재확인

4. Gateway 실험 시 버전 불일치
- 문서에 명시된 `foundry-zksync` 커밋과 `zkstack` 최신 버전 조합 재확인

### 9.1 실행 검증 트러블슈팅 분기

아래 순서대로 확인하면 대부분의 기동 실패를 빠르게 분리할 수 있습니다.

1) 증상: `curl localhost:3050` 연결 실패

확인:

```bash
ps aux | rg 'zkstack .*server|zksync_server' | rg -v rg
lsof -i :3050
```

원인(주요):

- `zkstack server` 미실행
- 다른 프로세스가 3050 포트 점유
- 서버 시작 직후(아직 바인딩 전)

조치:

- `zkstack server --chain <CHAIN_NAME>` 재실행
- 포트 충돌 프로세스 종료 후 재기동
- 10~20초 대기 후 재시도

2) 증상: `eth_chainId` 불일치

확인:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
```

원인(주요):

- 다른 체인/다른 ecosystem 서버에 연결
- `--chain` 인자 없이 기본 체인으로 실행

조치:

- `zkstack server --chain <CHAIN_NAME>`로 명시 실행
- `chains/<CHAIN_NAME>/configs/general.yaml`의 chain id와 결과값 대조

3) 증상: `eth_blockNumber`가 계속 `0x0`

확인:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"zks_L1BatchNumber","params":[],"id":1}'
```

원인(주요):

- 초기화 직후라 아직 배치 생성 전
- L1 연동 불가로 배치 진행 정지

조치:

- 30~60초 후 재확인
- `http://localhost:8545`에서 `eth_chainId` 응답 확인
- `docker ps`로 postgres/reth 컨테이너 상태 확인

4) 증상: `eth_syncing`이 장시간 `true`

확인:

```bash
curl -s http://localhost:3050 \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","method":"eth_syncing","params":[],"id":1}'
```

원인(주요):

- 초기 동기화 지연
- 로컬 머신 리소스 부족(CPU/메모리/디스크)

조치:

- Docker 메모리/디스크 증설
- 불필요한 컨테이너/프로세스 정리 후 재시작

5) 증상: `ecosystem init --dev`에서 `forge --zksync` 관련 오류

확인:

```bash
forge --version
forge build --help | rg zksync
```

원인(주요):

- 일반 Foundry(`forge`)가 먼저 잡혀 `--zksync` 옵션 미지원

조치:

- `foundryup-zksync` 설치/업데이트
- `which forge` 확인 후 PATH 우선순위 조정

6) 증상: `ts-node`/TSConfig 충돌로 초기화 실패

확인:

```bash
echo $TS_NODE_PROJECT
```

원인(주요):

- 상위 워크스페이스의 `tsconfig`가 zkstack 스크립트 실행에 간섭

조치:

- 체인 코드베이스 내부 전용 TS config 생성
- `TS_NODE_PROJECT=<local-tsconfig-path> zkstack ecosystem init --dev`로 실행

---

## 10. 참고 문서 (공식)

- ZK Stack Quickstart: https://docs.zksync.io/zk-stack/running/quickstart
- Interact with your chain: https://docs.zksync.io/zk-stack/running/using-a-local-zk-chain
- ZK Stack Components: https://docs.zksync.io/zk-stack/components
- ZKsync OS Server: https://docs.zksync.io/zk-stack/components/server
- ZKsync Gateway (ZK Stack): https://docs.zksync.io/zk-stack/running/gateway-settlement-layer
- Gateway Overview (Protocol): https://docs.zksync.io/zksync-protocol/gateway
