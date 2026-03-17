# ERC8004 Registration Wizard — Design Spec

> Date: 2026-03-17
> Status: Approved for implementation

## Overview

`/v2/marketplace` ops 페이지에 ERC8004 Registry 등록 4단계 Wizard UI를 추가한다. 운영자가 자신의 SentinAI 인스턴스를 Sepolia registry에 등록하고, 등록 상태를 확인할 수 있다.

---

## 1. 목표

- 운영자가 4단계 플로우(ENV 확인 → URI 미리보기 → TX 전송 → 결과 확인)를 시각적으로 진행할 수 있다.
- 등록 완료 후 agentId, txHash, URI, 등록일시를 조회할 수 있다.
- 재등록(RE-REGISTER)도 동일한 wizard로 수행할 수 있다.

---

## 2. 컴포넌트 구조

```
src/app/v2/marketplace/page.tsx                              (Server Component, 기존 유지)
  └─ src/components/marketplace/RegistrationWizard.tsx       ('use client', 신규)
       └─ RegistrationStatusCard (RegistrationWizard.tsx 내 인라인 컴포넌트)
```

`page.tsx`는 서버에서 초기 등록 상태(`initialStatus`)를 기존 `Promise.all`에 추가하여 병렬 조회한다.

```tsx
// page.tsx — 기존 Promise.all에 getRegistrationStatus() 추가
const [summary, disputes, contracts, registrationStatus] = await Promise.all([
  buildAgentMarketplaceOpsSummary({ fromIso, toIso }),
  listAgentMarketplaceDisputes(),
  Promise.resolve(getAgentMarketplaceContractsStatus()),
  getRegistrationStatus(),   // 신규
]);
return (
  <>
    {/* 기존 섹션들 */}
    <RegistrationWizard initialStatus={registrationStatus} />
  </>
);
```

`MARKETPLACE_WALLET_KEY` 미설정 시 `getRegistrationStatus()`는 즉시 `{ registered: false, envCheck: { walletKey: false, ... } }` 반환 (RPC 호출 없음).

---

## 3. 두 가지 상태

### 3.1 미등록 상태

- 경고 배너: "Not registered on Sepolia registry — Buyers cannot discover this instance."
- "REGISTER TO REGISTRY" 버튼 → 클릭 시 wizard 인플레이스 펼침
- summary stats의 "REGISTRY" 항목: `NOT REGISTERED` (빨간색)

### 3.2 등록 완료 상태

- summary stats의 "REGISTRY" 항목: `REGISTERED ●` (초록색)
- 등록 데이터 row 표시:
  - AGENT ID (강조)
  - REGISTERED URI
  - TX HASH (Etherscan 링크, 클릭 가능)
  - REGISTERED AT (UTC, 취득 불가 시 `-`)
  - CONTRACT (주소 + 네트워크)
- 우상단 "RE-REGISTER" 버튼 → wizard 재실행

---

## 4. Wizard 4단계

### Step 1 — ENV CHECK

서버 API(`GET /api/agent-marketplace/ops/registration-status`)에서 받은 `envCheck` 결과를 표시한다.

- 표시 항목 (각각 `●` 초록 / `✗` 빨강):
  - `ERC8004_REGISTRY_ADDRESS`
  - `MARKETPLACE_AGENT_URI_BASE`
  - `MARKETPLACE_WALLET_KEY` (값 마스킹: `0x••••`)
  - `SENTINAI_L1_RPC_URL`
- 하나라도 `false`이면 NEXT 버튼 비활성화

### Step 2 — AGENT URI PREVIEW

- 정규화된 agentURI 표시: `${MARKETPLACE_AGENT_URI_BASE}/api/agent-marketplace/agent.json`
- `agent.json` endpoint reach 확인 — 서버 API의 `agentUri` 필드로 표시
- 도달 가능: 초록 / 불가: 경고 표시 + 계속 진행 가능

### Step 3 — SEND TX

- 트랜잭션 요약 표시 (Contract, Function `register(agentURI)`, From address, Network: Sepolia)
- "REGISTER NOW" 버튼 → `POST /api/agent-marketplace/ops/register`
- 전송 중: pending 메시지 (응답 대기, 평균 15s)
- 성공/실패 모두 Step 4로 이동

### Step 4 — RESULT

- 성공: agentId + txHash 표시, "DONE" 버튼 → wizard 닫힘 + 등록 완료 상태로 전환
- 실패: 에러 메시지 + "RETRY" 버튼 → Step 3으로 복귀

---

## 5. 데이터 레이어

### 5.1 ABI 확장

`src/lib/agent-marketplace/abi/agent-registry.ts`에 컨트랙트의 public mapping getter를 추가한다.
(컨트랙트에 `public` mapping으로 선언되어 있어 getter가 자동 생성됨)

```typescript
export const agentMarketplaceRegistryAbi = parseAbi([
  'function register(string agentURI)',
  'function latestAgentIdOf(address agent) view returns (uint256)',  // 추가
  'function agentUriOf(uint256 agentId) view returns (string)',       // 추가
  'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)',
  'event Register(address indexed agent, string agentURI)',
]);
```

### 5.2 등록 상태 조회 (`getRegistrationStatus`)

```
1. 필수 env 없음 → { registered: false, envCheck: {...false}, agentUri: null } 즉시 반환

2. Redis 캐시 조회: key = marketplace:registry:registration:{walletAddress}, TTL 300s
   → hit: 즉시 반환
   → miss: 다음 단계

3. walletAddress = privateKeyToAddress(MARKETPLACE_WALLET_KEY)
   Sepolia RPC:
     agentId = latestAgentIdOf(walletAddress)   → uint256
     agentId === 0n → 미등록 반환

4. agentId > 0:
     agentUri = agentUriOf(agentId)
     txHash 는 RPC로 취득 불가 → Redis/globalThis 저장값 우선, 없으면 null

5. Redis 저장 (TTL 300s) + 반환
```

Redis 없는 경우: `globalThis.__sentinaiRegistrationStatusCache` 인메모리 폴백 (TTL 300s).

### 5.3 txHash 및 registeredAt 저장

`registerAgentMarketplaceIdentity`의 반환 타입을 확장하여 `registeredAt`을 포함한다.
`publicClient`가 이미 함수 내부에 존재하므로, `receipt` 수신 직후 `getBlock`을 추가 호출한다.

```typescript
// agent-registry.ts — RegisterAgentMarketplaceIdentityResult 확장
export type RegisterAgentMarketplaceIdentityResult =
  | { ok: true; agentId: string; txHash: `0x${string}` | string; registeredAt: string | null }
  | { ok: false; error: string };

// 내부 구현 — receipt 수신 후
const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
const registeredAt = block ? new Date(Number(block.timestamp) * 1000).toISOString() : null;
```

`register/route.ts`는 성공 결과를 받은 직후 동일 Redis 키(`marketplace:registry:registration:{walletAddress}`)에
`{ agentId: String(agentId), txHash, registeredAt }` 를 저장한다 (TTL 300s).

- `agentId` 는 viem이 `bigint`로 반환하므로 **반드시 `String(agentId)`로 변환** 후 저장/반환
  (JSON 직렬화 오류 방지)
- 취득 실패 시 `registeredAt: null` → UI에서 `-` 표시

### 5.4 캐시 갱신 (최초 등록 및 재등록 모두 동일하게 적용)

등록 성공 시:
1. 기존 Redis 키(`marketplace:registry:registration:{walletAddress}`) 삭제
2. 새 결과(`agentId`, `txHash`, `registeredAt`)로 즉시 재저장 (TTL 300s)

이 절차는 최초 등록과 RE-REGISTER 모두에 동일하게 적용된다.

### 5.5 반환 타입

```typescript
type EnvCheck = {
  registryAddress: boolean;
  agentUriBase: boolean;
  walletKey: boolean;
  l1RpcUrl: boolean;
};

type RegistrationStatus =
  | {
      registered: false;
      envCheck: EnvCheck;
      agentUri: string | null;
    }
  | {
      registered: true;
      agentId: string;
      agentUri: string;
      txHash: string | null;
      registeredAt: string | null; // ISO8601, 취득 불가 시 null
      contractAddress: string;
    };
```

---

## 6. API 엔드포인트

| Method | Path | 역할 |
|--------|------|------|
| `GET` | `/api/agent-marketplace/ops/registration-status` | 등록 상태 조회 (체인 + 캐시) |
| `POST` | `/api/agent-marketplace/ops/register` | 등록 TX 전송 + 결과 캐시 저장 (기존 수정) |

---

## 7. UI 위치 및 레이아웃

`/v2/marketplace` 페이지의 "REGISTRY REGISTRATION" 섹션을 교체.

**등록 완료 상태:**
```
[STATUS] [REQUESTS/24H] [BUYERS/24H] [REGISTRY: REGISTERED●]
──────────────────────────────────────────────────────────────
REGISTRY REGISTRATION                             [RE-REGISTER]
  AGENT ID       #42
  REGISTERED URI https://…/agent.json
  TX HASH        0x9b9a… ↗
  REGISTERED AT  2026-03-13 14:22 UTC
  CONTRACT       0x64c8… (Sepolia)
──────────────────────────────────────────────────────────────
RECENT VERIFIED REQUESTS …
```

**미등록 상태:**
```
[REGISTRY: NOT REGISTERED]
──────────────────────────────────────────────────────────────
REGISTRY REGISTRATION
  ⚠ Not registered — Buyers cannot discover this instance.
  [REGISTER TO REGISTRY →]

  ↓ (버튼 클릭 시 wizard 인플레이스 펼침)

  ① ENV  ② URI  ③ TX  ④ DONE
  ────────────────────────────
  [step content]
──────────────────────────────────────────────────────────────
```

---

## 8. 비목표

- 등록 내역 히스토리 (latest만 표시)
- 등록 URI 수동 편집
- 멀티 지갑 지원

---

## 9. 파일 목록

| 파일 | 상태 |
|------|------|
| `src/components/marketplace/RegistrationWizard.tsx` | 신규 (`'use client'`, `RegistrationStatusCard` 인라인 포함) |
| `src/app/api/agent-marketplace/ops/registration-status/route.ts` | 신규 |
| `src/lib/agent-marketplace/registration-status.ts` | 신규 (조회 로직 + 캐시) |
| `src/lib/agent-marketplace/abi/agent-registry.ts` | 수정 (getter 2개 추가) |
| `src/app/api/agent-marketplace/ops/register/route.ts` | 수정 (결과 캐시 저장 추가) |
| `src/app/v2/marketplace/page.tsx` | 수정 (`RegistrationWizard` 삽입, `Promise.all` 확장) |
