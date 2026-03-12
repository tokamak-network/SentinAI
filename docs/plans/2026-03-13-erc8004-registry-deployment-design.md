# ERC-8004 Registry Deployment Design

**Goal:** Clarify whether SentinAI must deploy its own ERC-8004 registry contract for the agent marketplace, and define the minimum deployment scope required to unblock registration and registry browsing.

## 결론

현재 SentinAI는 자체 ERC-8004 registry 컨트랙트를 배포하거나, 동일한 역할을 하는 외부 registry 배포본을 명시적으로 채택해야 한다.

현재 저장소에는:
- registry ABI 모듈
- `register(agentURI)` write client
- bootstrap registration hook
- contracts status API

가 이미 존재한다.

반면 현재는:
- `ERC8004_REGISTRY_ADDRESS` 기본값이 없음
- 공용 registry 배포본이 저장소 source-of-truth로 고정되어 있지 않음
- `BROWSE REGISTRY`가 읽을 대상 registry가 없음

따라서 현재 단계에서 가장 자연스러운 방향은 **SentinAI가 직접 registry를 배포하고 그 배포본을 source-of-truth로 삼는 것**이다.

## 왜 registry가 필요한가

registry는 agent marketplace에서 세 가지 역할을 한다.

1. 등록 대상
- SentinAI 인스턴스가 `/api/agent-marketplace/agent.json`을 등록할 대상이 필요하다.
- 현재 `registerAgentMarketplaceIdentity()`는 registry address가 있어야만 유효하다.

2. discovery source
- `BROWSE REGISTRY`는 여러 agent marketplace instance를 보여주려면 registry read source가 필요하다.
- registry가 없으면 public registry UI는 영구적으로 placeholder에 머문다.

3. ABI / event source-of-truth
- 현재 코드에는 `AgentRegistered`와 `Register` 둘 다 파싱하는 fallback이 있다.
- 실제 배포 contract가 정해져야 event shape를 고정하고 hardening을 마무리할 수 있다.

## 최소 배포 범위

Phase 1에서 필요한 registry 기능은 작다.

### 필수 기능

- `function register(string agentURI)`
- registration event 1개 이상
- public event indexing 가능

현재 코드 기준 최소 호환 범위:

```solidity
function register(string calldata agentURI) external;
event AgentRegistered(uint256 indexed agentId);
event Register(address indexed agent, string agentURI);
```

중요한 점:
- 두 이벤트를 둘 다 반드시 써야 한다는 뜻은 아니다.
- 현재 런타임은 둘 중 하나만 있어도 fallback으로 파싱 가능하다.
- 하지만 최종적으로는 배포 contract ABI를 source-of-truth로 고정해야 한다.

### Phase 1에서 불필요한 기능

- on-chain metadata mutation UI
- pagination-optimized read methods
- owner-controlled curation
- slashing / dispute logic
- reputation registry와의 강결합

즉, registry는 우선 “등록과 발견”만 하면 된다.

## 권장 배포 전략

### 권장안: SentinAI-managed minimal registry

SentinAI가 최소 registry를 직접 배포한다.

장점:
- 현재 코드와 가장 잘 맞는다
- event/ABI를 우리가 고정할 수 있다
- bootstrap registration과 public registry browse를 같은 contract 기준으로 완성할 수 있다

단점:
- 배포/소유/업그레이드 책임이 생긴다

### 비권장안: 외부 registry 선채택

외부 배포본을 바로 붙이는 방법도 가능하지만, 현재는 ABI와 운영 정책이 고정돼 있지 않다.

문제:
- event shape 차이 가능성
- read path / update path 차이
- 운영 dependency 증가

현재 저장소 상태에서는 이 방식이 오히려 구현을 늦출 가능성이 높다.

## Phase 1 contract requirements

컨트랙트는 아래 요구만 만족하면 충분하다.

### 등록 규칙

- caller address 당 하나 이상의 `agentURI` 등록 가능 여부는 명시적으로 결정해야 한다
- Phase 1 권장은 “마지막 등록값이 최신” 또는 “append-only event log” 중 하나
- SentinAI UI 관점에서는 event log만 안정적으로 읽히면 된다

### 이벤트 규칙

- registration 성공 시 반드시 event emitted
- event에는 최소한 `agent` 또는 `agentId`, 그리고 `agentURI` 복원이 가능해야 한다

### URI 규칙

- `agentURI`는 SentinAI 기준 `/api/agent-marketplace/agent.json`를 가리킨다
- Phase 1 browse UI는 이 URI를 fetch해서 instance metadata를 구성한다

## application side changes unlocked by deployment

registry 배포가 끝나면 아래가 가능해진다.

1. bootstrap registration을 warning-only stub이 아닌 실제 운영 경로로 사용
2. `contracts-status`에 실제 registry address 노출
3. `BROWSE REGISTRY`에서 on-chain registration event scan 구현
4. fetched `agent.json` 기반 multi-instance registry UI 구현
5. fallback event parsing 제거 또는 축소

## deployment output checklist

registry 배포 완료의 정의:

- deployed address 확보
- canonical ABI JSON/TS asset 확보
- emitted registration event shape 확정
- network 확정 (`mainnet` 또는 `sepolia`)
- `ERC8004_REGISTRY_ADDRESS` 운영값 설정
- smoke test:
  - `register(agentURI)` 성공
  - receipt event parse 성공
  - public client log read 성공

## implementation recommendation

다음 순서가 가장 합리적이다.

1. minimal ERC-8004 registry contract spec 확정
2. contract 배포
3. deployed ABI를 저장소 source-of-truth로 반영
4. `registerAgentMarketplaceIdentity()`를 deployed ABI 기준으로 정리
5. `BROWSE REGISTRY` read path 구현

## 결정 사항

- 현재 SentinAI agent marketplace는 registry가 “있으면 좋음”이 아니라, multi-instance discovery와 실제 registration을 위해 **사실상 필요**하다.
- 현재 저장소와 구현 상태를 기준으로는 **SentinAI가 직접 Phase 1 minimal registry를 배포하는 것**이 기본 전략이다.
