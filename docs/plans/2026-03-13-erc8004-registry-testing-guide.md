# ERC-8004 Registry Testing Guide

**Goal:** Capture the testing scenarios and execution guide for the SentinAI ERC-8004 registry so deployment and validation can be resumed later without rediscovering the workflow.

## 목적

이 문서는 SentinAI의 ERC-8004 registry contract와 앱 연동을 나중에 검증할 때 필요한 테스트 시나리오와 실행 순서를 정리한다.

범위:
- contract 단위 테스트
- deployment script 검증
- post-deploy smoke test
- app registration path 검증
- regression / failure scenario 점검

## 테스트 단계 요약

권장 순서:

1. local contract tests
2. local deployment script test
3. testnet deploy
4. post-deploy contract smoke
5. app env wiring
6. bootstrap registration smoke
7. future browse-registry read test

## 1. Local Contract Tests

### 목적

contract 초안 자체가 최소 요구사항을 만족하는지 확인한다.

### 실행 명령

```bash
cd contracts/agent-marketplace
forge test
```

### 현재 기대 결과

- `SentinAIERC8004Registry.t.sol`
  - monotonic `agentId`
  - latest registration storage
  - canonical + legacy event emission
  - empty URI revert
  - oversized URI revert
- `DeploySentinAIERC8004Registry.t.sol`
  - deploy script의 `deploy()`가 fresh instance 반환

### 실패 시 확인

- `foundry.toml`
- `lib/forge-std`
- import path
- pragma / solc version mismatch

## 2. Deployment Script Dry Validation

### 목적

실제 broadcast 전 deploy script가 깨지지 않는지 확인한다.

### 최소 확인

```bash
cd contracts/agent-marketplace
forge test --match-test test_deploy_returnsFreshRegistryInstance
```

### 추가 권장

배포 세션에서 아래를 dry-run으로 확인한다.

```bash
forge script script/DeploySentinAIERC8004Registry.s.sol:DeploySentinAIERC8004Registry \
  --rpc-url "$SENTINAI_L1_RPC_URL"
```

주의:
- 실제 옵션 조합은 배포 시점 Foundry 버전에 맞게 다시 확인한다
- dry-run 성공 후에만 `--broadcast`를 붙인다

## 3. Testnet Deploy Scenario

### 사전 조건

- `DEPLOYER_PRIVATE_KEY`
- `SENTINAI_L1_RPC_URL`
- 권장 testnet: sepolia

### 실행 명령

```bash
cd contracts/agent-marketplace
forge script script/DeploySentinAIERC8004Registry.s.sol:DeploySentinAIERC8004Registry \
  --rpc-url "$SENTINAI_L1_RPC_URL" \
  --broadcast
```

### 기록해야 할 결과

- deployed contract address
- tx hash
- network
- deploy timestamp
- commit hash
- final ABI

## 4. Post-Deploy Contract Smoke

### 목적

배포된 contract가 실제 RPC 상에서 registration event를 남기는지 확인한다.

### 시나리오

1. test wallet로 `register(agentURI)` 호출
2. tx receipt 확인
3. emitted event 확인
4. RPC log scan 가능 여부 확인

### 확인 포인트

- `AgentRegistered(agentId, agent, agentURI)` event 존재 여부
- legacy `Register(agent, agentURI)` event 존재 여부
- `agentId`가 1부터 증가하는지
- `agentURI`가 손상 없이 남는지

## 5. App Env Wiring

### 목적

배포 결과를 앱에 연결할 준비를 끝낸다.

### 필요한 값

```bash
ERC8004_REGISTRY_ADDRESS=0x...
SENTINAI_L1_RPC_URL=https://...
MARKETPLACE_AGENT_URI_BASE=https://sentinai.example.com
MARKETPLACE_WALLET_KEY=0x...
```

### 확인 포인트

- `src/lib/agent-marketplace/abi/agent-registry.ts`의 canonical ABI가 deployed ABI와 일치하는지
- event parsing fallback이 여전히 필요한지
- `ops/contracts`에서 address가 노출되는지

## 6. Bootstrap Registration Smoke

### 목적

앱이 부팅 시 registry에 자기 `agent.json`을 실제로 등록하는지 확인한다.

### 시나리오

1. app env 주입
2. bootstrap 실행
3. registration tx 성공 여부 확인
4. receipt parsing 결과 확인

### 기대 결과

- warning-only skip가 아니라 실제 submit path 실행
- `register(agentURI)` 성공
- `agentId` 또는 tx hash 반환
- app 로그에 registration success 남음

### 관련 테스트 재실행

```bash
npx vitest run \
  src/lib/__tests__/agent-marketplace/agent-registry.test.ts \
  src/lib/__tests__/first-run-bootstrap.test.ts
```

## 7. Browse Registry Follow-Up Test

### 목적

나중에 `BROWSE REGISTRY`를 실제 registry event scan으로 구현할 때 필요한 검증 기준을 미리 정해둔다.

### 시나리오

1. registry에서 registration logs 조회
2. `agentURI` 추출
3. 각 `agentURI` fetch
4. `agent.json` parse
5. UI row 구성

### 검증 항목

- 중복 registration 처리
- 같은 address의 최신 registration 판별
- fetch 실패한 URI 처리
- invalid `agent.json` 격리

## Failure Scenarios

반드시 나중에 점검할 것:

1. `DEPLOYER_PRIVATE_KEY` 누락
2. `SENTINAI_L1_RPC_URL` 오타 또는 rate limit
3. receipt 성공인데 event parsing 실패
4. deployed ABI와 app ABI 불일치
5. bootstrap registration은 성공했지만 `agentURI`가 잘못됨
6. browse 단계에서 일부 `agent.json` fetch 실패

## Deferred Until Deployment Session

지금은 문서화만 하고 실행은 보류한다.

보류 이유:
- 현재 배포용 private key / RPC가 세션에 없음
- testnet 배포 결과(address/ABI)가 아직 없음
- browse-registry read path는 registry deploy 이후 작업이 더 적절함

## Resume Checklist

배포 세션 재개 시 아래 순서로 시작한다.

1. `forge test`
2. deploy script dry-run
3. testnet deploy
4. deployed ABI/address 기록
5. app env wiring
6. bootstrap smoke
7. registry browse implementation planning
