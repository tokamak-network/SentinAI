# SentinAIERC8004Registry 개발자 명세

> 상태: 배포 완료, Sepolia 검증 완료
> 작성일: 2026-03-13
> 대상 컨트랙트: `SentinAIERC8004Registry`
> 체인: Sepolia (`11155111`)
> 주소: `0x64c8f8cB66657349190c7AF783f8E0254dCF1467`
> Etherscan: <https://sepolia.etherscan.io/address/0x64c8f8cb66657349190c7af783f8e0254dcf1467>

---

## 1. 목적

`SentinAIERC8004Registry`는 SentinAI agent marketplace의 Phase 1 discovery 레이어를 위한 최소 registry 컨트랙트다.

이 컨트랙트의 역할은 세 가지다.

1. SentinAI 인스턴스가 자신의 `agent.json` endpoint를 온체인에 등록할 수 있게 한다.
2. 이후 `BROWSE REGISTRY`에서 등록된 agent marketplace instance를 탐색할 수 있는 소스가 된다.
3. 앱의 bootstrap registration 및 receipt parsing 경로에 대해 실제 배포 기준 ABI/source-of-truth를 제공한다.

이 문서는 현재 배포된 컨트랙트의 개발자 기준 명세이며, 구현과 연동은 이 문서를 우선 참조한다.

## 2. 배포 정보

### 2.1 네트워크

- Network: Sepolia
- Chain ID: `11155111`

### 2.2 배포 결과

- Contract address: `0x64c8f8cB66657349190c7AF783f8E0254dCF1467`
- Deploy tx hash: `0x9b9a78bde9b19b168bedddea86bc226c26206a858521495963cae80e297eb33a`
- Deployer: `0xD7D57ba9F40629d48c4009a87654CDDa8A5433E9`
- Verification status: `Pass - Verified`

### 2.3 앱 연동 환경변수

```bash
ERC8004_REGISTRY_ADDRESS=0x64c8f8cB66657349190c7AF783f8E0254dCF1467
SENTINAI_L1_RPC_URL=https://...
MARKETPLACE_AGENT_URI_BASE=https://your-instance.example.com
MARKETPLACE_WALLET_KEY=0x...
```

## 3. 설계 원칙

### 3.1 최소 인터페이스

Phase 1 registry는 write path를 `register(string agentURI)` 하나로 최소화한다.

이유:
- bootstrap registration 구현이 단순해진다
- ABI surface가 작아 verify와 운영이 쉽다
- public browse는 event scan으로 충분히 구성할 수 있다

### 3.2 permissionless registration

등록은 owner-only가 아니라 permissionless다.

이유:
- registry의 목적이 “발견”이기 때문이다
- 특정 운영자 allowlist를 Phase 1 온체인 레이어에 넣을 필요가 없다
- 인스턴스별 self-registration이 가능해야 bootstrap 연동이 단순하다

### 3.3 append-only registration

같은 address가 여러 번 등록할 수 있으며, 등록 시마다 새 `agentId`를 발급한다.

이유:
- registration history 보존
- latest registration 계산 가능
- overwrite semantics를 on-chain에서 복잡하게 처리할 필요가 없음

## 4. 컨트랙트 인터페이스

### 4.1 Solidity 시그니처

```solidity
function register(string calldata agentURI) external returns (uint256 agentId);
```

### 4.2 상태 변수

```solidity
uint256 public constant MAX_AGENT_URI_LENGTH = 512;
uint256 public nextAgentId = 1;

mapping(uint256 => address) public agentOwnerOf;
mapping(uint256 => string) public agentUriOf;
mapping(address => uint256) public latestAgentIdOf;
```

### 4.3 커스텀 에러

```solidity
error EmptyAgentURI();
error AgentUriTooLong(uint256 length, uint256 maxLength);
```

### 4.4 이벤트

```solidity
event AgentRegistered(
    uint256 indexed agentId,
    address indexed agent,
    string agentURI
);

event Register(address indexed agent, string agentURI);
```

이중 이벤트를 쓰는 이유:
- `AgentRegistered`는 canonical event다
- `Register`는 기존 앱 fallback parsing 및 레거시 호환을 위해 함께 emit 된다

## 5. 등록 플로우

`register(agentURI)`의 동작은 아래와 같다.

1. `agentURI` 길이를 검사한다.
2. 빈 문자열이면 `EmptyAgentURI()`로 revert 한다.
3. 512 bytes 초과면 `AgentUriTooLong(length, 512)`로 revert 한다.
4. 현재 `nextAgentId`를 새 `agentId`로 사용한다.
5. `nextAgentId`를 1 증가시킨다.
6. `agentOwnerOf[agentId] = msg.sender`
7. `agentUriOf[agentId] = agentURI`
8. `latestAgentIdOf[msg.sender] = agentId`
9. `AgentRegistered(agentId, msg.sender, agentURI)` emit
10. `Register(msg.sender, agentURI)` emit
11. 새 `agentId`를 반환한다.

## 6. 저장소 의미

### 6.1 `nextAgentId`

- 다음 등록에 사용할 monotonic identifier
- 초기값은 `1`

### 6.2 `agentOwnerOf`

- 특정 `agentId`의 등록 주체 address
- browse 및 audit 시 사용

### 6.3 `agentUriOf`

- 특정 `agentId`가 가리키는 metadata URI
- 보통 SentinAI에서는 `/api/agent-marketplace/agent.json` endpoint를 가리킨다

예시:

```text
https://sentinai.example.com/api/agent-marketplace/agent.json
```

### 6.4 `latestAgentIdOf`

- 특정 address의 가장 최근 등록 `agentId`
- 동일 address의 재등록이 가능하기 때문에 latest lookup 용도로만 사용한다

## 7. 이벤트 규약

### 7.1 Canonical event

```solidity
event AgentRegistered(
    uint256 indexed agentId,
    address indexed agent,
    string agentURI
);
```

의도:
- event 하나만으로 browse 구현에 필요한 핵심 정보를 복원할 수 있게 한다
- `agentId`, `agent`, `agentURI`를 한 번에 제공한다

### 7.2 Legacy-compatible event

```solidity
event Register(address indexed agent, string agentURI);
```

의도:
- 기존 앱 코드의 fallback parsing을 유지한다
- canonical ABI 정렬 이전/이후 모두 운영 중단 없이 호환하도록 돕는다

## 8. 앱 연동 규약

### 8.1 Bootstrap registration

SentinAI 앱은 아래 조건을 모두 만족하면 bootstrap 시 registry 등록을 시도할 수 있다.

- `MARKETPLACE_ENABLED=true`
- `MARKETPLACE_AGENT_URI_BASE` 설정
- `MARKETPLACE_WALLET_KEY` 설정
- `ERC8004_REGISTRY_ADDRESS` 설정
- `SENTINAI_L1_RPC_URL` 설정

등록 대상 URI는 보통 다음 규칙을 따른다.

```text
${MARKETPLACE_AGENT_URI_BASE}/api/agent-marketplace/agent.json
```

### 8.2 앱 ABI source-of-truth

관련 앱 파일:

- `src/lib/agent-marketplace/abi/agent-registry.ts`
- `src/lib/agent-marketplace/agent-registry.ts`
- `src/lib/agent-marketplace/contracts-status.ts`

현재 앱은 canonical event와 legacy event를 모두 허용한다.

즉:
- 우선 `AgentRegistered(agentId, agent, agentURI)`를 파싱
- 없으면 `Register(agent, agentURI)`를 fallback으로 파싱

### 8.3 Contracts status API

운영 UI에서 registry 상태는 아래 API로 노출된다.

```text
GET /api/agent-marketplace/ops/contracts
```

배포 후 `ERC8004_REGISTRY_ADDRESS`를 설정하면 `/v2/marketplace`의 contracts 패널에도 실제 주소가 노출된다.

## 9. Browse Registry 구현 가이드

향후 `BROWSE REGISTRY` 실데이터 연결은 아래 순서를 기준으로 구현한다.

1. registry event scan
2. `AgentRegistered` 또는 `Register`에서 `agentURI` 추출
3. 각 `agentURI` fetch
4. `agent.json` parse
5. address 또는 `agentId` 기준 latest registration 결정
6. UI row 구성

이때 고려할 사항:

- 중복 등록 처리
- 동일 address의 최신 등록 선택
- fetch 실패한 URI 격리
- invalid `agent.json` 격리

## 10. 보안 및 제약

### 10.1 on-chain validation 범위

Phase 1에서 on-chain은 아래만 검증한다.

- empty URI 금지
- 과도한 길이 금지

HTTP/HTTPS 여부, URI suffix, metadata schema 적합성은 off-chain application layer 책임이다.

### 10.2 access control

- owner gating 없음
- moderator gating 없음
- fee collection 없음

Phase 1 registry는 discovery용 최소 레이어이며, curation/검증 레이어가 아니다.

### 10.3 비목표

이 컨트랙트는 아래를 해결하지 않는다.

- reputation storage
- dispute resolution
- payment settlement
- metadata authenticity verification
- allowlist governance
- pagination-optimized on-chain reads

## 11. 테스트 및 검증 기준

### 11.1 로컬 Foundry 테스트

```bash
cd contracts/agent-marketplace
forge test
```

현재 확인된 항목:

- monotonic `agentId`
- latest registration storage
- canonical + legacy event emission
- empty URI revert
- oversized URI revert
- deploy script의 `deploy()` 동작

### 11.2 배포 검증

실행한 배포 명령:

```bash
forge script script/DeploySentinAIERC8004Registry.s.sol:DeploySentinAIERC8004Registry \
  --rpc-url "$SENTINAI_L1_RPC_URL" \
  --broadcast
```

실행한 verify 명령:

```bash
forge verify-contract \
  --chain-id 11155111 \
  --etherscan-api-key "$ETHERSCAN_API_KEY" \
  --watch \
  0x64c8f8cB66657349190c7AF783f8E0254dCF1467 \
  SentinAIERC8004Registry.sol:SentinAIERC8004Registry
```

결과:
- Sepolia 배포 성공
- Etherscan verification 성공

## 12. 후속 작업

이 명세 이후 남은 주요 작업:

1. 앱 환경에 `ERC8004_REGISTRY_ADDRESS` 운영값 반영
2. bootstrap registration smoke test
3. `BROWSE REGISTRY` on-chain read path 구현
4. 필요 시 deployed ABI 기준으로 앱 fallback parsing 축소

## 13. Source of Truth

이 명세는 아래 산출물과 함께 유지한다.

- 컨트랙트 구현: `contracts/agent-marketplace/SentinAIERC8004Registry.sol`
- 배포 스크립트: `contracts/agent-marketplace/script/DeploySentinAIERC8004Registry.s.sol`
- Foundry 테스트: `contracts/agent-marketplace/test/*.t.sol`
- 앱 ABI 모듈: `src/lib/agent-marketplace/abi/agent-registry.ts`

문서와 구현이 충돌할 경우, 배포된 컨트랙트 코드와 verified source를 우선하고 이 문서를 즉시 갱신해야 한다.
