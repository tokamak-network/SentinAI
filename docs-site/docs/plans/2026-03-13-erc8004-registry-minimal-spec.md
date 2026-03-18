# ERC-8004 Registry Minimal Spec

**Goal:** Define the smallest viable ERC-8004-compatible registry contract that SentinAI can deploy to support marketplace registration and future registry browsing.

## 목적

이 문서는 SentinAI agent marketplace가 Phase 1에서 필요로 하는 최소 registry contract 요구사항을 고정한다.

이 spec의 목적은 세 가지다.

1. SentinAI 인스턴스가 `/api/agent-marketplace/agent.json`을 on-chain registry에 등록할 수 있어야 한다.
2. 이후 `BROWSE REGISTRY`에서 등록된 instance 목록을 읽을 수 있어야 한다.
3. 현재 앱 코드의 ABI / receipt parsing / bootstrap registration 경로와 충돌하지 않아야 한다.

## 현재 앱이 기대하는 인터페이스

현재 코드 기준 source-of-truth:
- ABI: `src/lib/agent-marketplace/abi/agent-registry.ts`
- registration client: `src/lib/agent-marketplace/agent-registry.ts`

현재 앱은 최소한 아래를 기대한다.

```solidity
function register(string calldata agentURI) external;
```

그리고 receipt parsing은 아래 event 둘 중 하나를 허용한다.

```solidity
event AgentRegistered(uint256 indexed agentId);
event Register(address indexed agent, string agentURI);
```

## 권장 canonical interface

Phase 1 배포본의 canonical interface는 아래를 권장한다.

```solidity
interface IERC8004RegistryMinimal {
    function register(string calldata agentURI) external returns (uint256 agentId);

    event AgentRegistered(
        uint256 indexed agentId,
        address indexed agent,
        string agentURI
    );
}
```

### 이유

- `agentId`가 있으면 앱이 address가 아닌 안정적인 registry identifier를 가질 수 있다.
- `agent`가 있으면 address 기반 검색과 de-duplication이 쉬워진다.
- `agentURI`가 event에 포함되면 browse 시 event log만으로 metadata endpoint를 복원할 수 있다.

## backward compatibility

현재 앱은 `AgentRegistered(uint256 indexed agentId)` 또는 `Register(address indexed agent, string agentURI)`를 파싱하도록 작성되어 있다.

따라서 Phase 1 배포는 아래 둘 중 하나를 선택할 수 있다.

### 옵션 A. 권장

`AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)`

장점:
- Phase 2 browse 구현이 쉬움
- event 하나로 모든 정보 확보 가능

주의:
- 현재 앱 ABI는 이 event shape를 아직 그대로 반영하지 않으므로, 배포 후 canonical ABI 업데이트가 필요하다.

### 옵션 B. 임시 호환

현재 코드와 완전히 동일한 이벤트 집합:

```solidity
event AgentRegistered(uint256 indexed agentId);
event Register(address indexed agent, string agentURI);
```

장점:
- 현재 receipt parsing과 바로 호환

단점:
- 이벤트가 분리돼 있어 source-of-truth가 약함
- 장기적으로는 canonical event 하나로 정리하는 편이 낫다

## 상태 모델

Phase 1에서는 복잡한 storage가 필요 없다.

최소 권장 상태:

```solidity
uint256 public nextAgentId;
mapping(uint256 => address) public agentOwnerOf;
mapping(uint256 => string) public agentUriOf;
mapping(address => uint256) public latestAgentIdOf;
```

## 등록 규칙

Phase 1 권장 규칙은 아래다.

1. 모든 caller는 `register(agentURI)`를 호출할 수 있다.
2. 호출할 때마다 새 `agentId`를 발급한다.
3. `latestAgentIdOf[msg.sender]`는 가장 최근 등록값을 가리킨다.
4. 이전 등록은 삭제하지 않는다.

이 방식의 장점:
- append-only event log가 생긴다
- browse 시 history와 latest를 모두 계산할 수 있다
- overwrite semantics를 on-chain storage에서 복잡하게 처리하지 않아도 된다

## validation rules

최소 validation:

1. `agentURI`는 빈 문자열이면 안 된다.
2. 너무 긴 문자열은 제한한다.

권장:
- `bytes(agentURI).length > 0`
- `bytes(agentURI).length <= 512`

Phase 1에서는 URI 형식 전체를 on-chain에서 엄격 검증할 필요는 없다.
HTTP/HTTPS 여부, `/api/agent-marketplace/agent.json` suffix 여부는 application layer에서 다룬다.

## access control

Phase 1에서는 owner-only registration이 필요 없다.

권장:
- permissionless registration

이유:
- marketplace discovery의 목적과 맞다
- bootstrap registration이 단순해진다
- operator allowlist는 Phase 2 이후 필요 시 추가 가능하다

## browse requirements

향후 `BROWSE REGISTRY` 구현을 위해 배포본은 아래 조건을 만족해야 한다.

1. registration event를 RPC log scan으로 읽을 수 있어야 한다
2. emitted event만으로 `agentURI` 복원이 가능해야 한다
3. address 또는 `agentId` 기준 latest registration을 계산할 수 있어야 한다

그래서 Phase 1 기준으로는 event payload에 `agentURI` 포함이 매우 중요하다.

## non-goals

이 spec은 아래를 포함하지 않는다.

- reputation registry 통합
- dispute logic
- curation / moderation
- token payments
- fee collection
- metadata verification
- off-chain signature verification

## recommended deployment target

우선순위:

1. Sepolia 또는 테스트 성격의 L1
2. 이후 mainnet

현재 앱은 `X402_NETWORK`가 `eip155:1`이면 mainnet, 그 외는 sepolia 쪽으로 해석하므로, Phase 1은 sepolia 정렬이 가장 안전하다.

## app integration impact

배포 후 앱에서 해야 하는 일:

1. deployed ABI를 `src/lib/agent-marketplace/abi/agent-registry.ts`에 반영
2. event parsing fallback을 canonical ABI 기준으로 단순화
3. `ERC8004_REGISTRY_ADDRESS` 운영값 설정
4. bootstrap registration smoke test 수행
5. 이후 registry browse read path 추가

## decision

SentinAI Phase 1 registry는 다음 원칙을 따른다.

- write path는 `register(string agentURI)` 하나로 최소화한다
- registration은 permissionless로 둔다
- browse를 위해 event에 `agentURI`를 포함하는 canonical event를 우선 고려한다
- 앱은 deployed ABI를 source-of-truth로 다시 정렬한다
