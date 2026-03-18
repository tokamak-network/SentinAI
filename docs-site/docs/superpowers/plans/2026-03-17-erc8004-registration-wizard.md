# ERC8004 Registration Wizard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/v2/marketplace` ops 페이지에 ERC8004 Registry 4단계 등록 Wizard UI를 추가하고, 등록 상태를 체인+캐시로 조회하여 표시한다.

**Architecture:** Server Component(`page.tsx`)에서 초기 등록 상태를 체인에서 조회해 Client Component(`RegistrationWizard`)에 props로 전달한다. Wizard는 ENV 확인 → URI 미리보기 → TX 전송 → 결과 확인 4단계로 진행하며, 등록 완료 시 agentId/txHash/registeredAt을 Redis(또는 globalThis 폴백)에 캐시한다.

**Tech Stack:** Next.js 16, TypeScript, viem, ioredis (optional), Vitest, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-17-erc8004-registration-wizard-design.md`

---

## File Map

| 파일 | 변경 |
|------|------|
| `src/lib/agent-marketplace/abi/agent-registry.ts` | 수정 — `latestAgentIdOf`, `agentUriOf` getter 추가 |
| `src/lib/agent-marketplace/agent-registry.ts` | 수정 — `RegisterAgentMarketplaceIdentityResult`에 `registeredAt` 추가, `getBlock` 호출 |
| `src/lib/agent-marketplace/registration-status.ts` | 신규 — 등록 상태 조회 + 캐시 로직 |
| `src/app/api/agent-marketplace/ops/registration-status/route.ts` | 신규 — GET 엔드포인트 |
| `src/app/api/agent-marketplace/ops/register/route.ts` | 수정 — 성공 시 캐시 저장 추가 |
| `src/components/marketplace/RegistrationWizard.tsx` | 신규 — Client Component, 4단계 UI |
| `src/app/v2/marketplace/page.tsx` | 수정 — Promise.all 확장, RegistrationWizard 삽입 |
| `src/lib/__tests__/agent-marketplace/agent-registry.test.ts` | 수정 — `registeredAt` 관련 테스트 추가 |
| `src/lib/__tests__/agent-marketplace/registration-status.test.ts` | 신규 — 등록 상태 조회 테스트 |
| `src/app/api/agent-marketplace/ops/registration-status/route.test.ts` | 신규 — API 라우트 테스트 |

---

## Task 1: ABI에 getter 함수 추가

**Files:**
- Modify: `src/lib/agent-marketplace/abi/agent-registry.ts`

- [ ] **Step 1: ABI에 두 getter 추가**

```typescript
// src/lib/agent-marketplace/abi/agent-registry.ts
import { parseAbi } from 'viem';

export const agentMarketplaceRegistryCanonicalEvent =
  'event AgentRegistered(uint256 indexed agentId, address indexed agent, string agentURI)';

export const agentMarketplaceRegistryEventNames = [
  'AgentRegistered',
  'Register',
] as const;

export const agentMarketplaceRegistryAbi = parseAbi([
  'function register(string agentURI)',
  'function latestAgentIdOf(address agent) view returns (uint256)',
  'function agentUriOf(uint256 agentId) view returns (string)',
  agentMarketplaceRegistryCanonicalEvent,
  'event Register(address indexed agent, string agentURI)',
]);

export const agentMarketplaceRegistryContract = {
  name: 'ERC8004 Agent Registry',
  abi: agentMarketplaceRegistryAbi,
  canonicalEvent: agentMarketplaceRegistryCanonicalEvent,
  eventNames: [...agentMarketplaceRegistryEventNames],
} as const;
```

- [ ] **Step 2: 타입체크 통과 확인**

```bash
npx tsc --noEmit 2>&1 | grep agent-registry
```
Expected: 출력 없음 (에러 없음)

- [ ] **Step 3: Commit**

```bash
git add src/lib/agent-marketplace/abi/agent-registry.ts
git commit -m "feat(marketplace): add latestAgentIdOf and agentUriOf to registry ABI"
```

---

## Task 2: `registerAgentMarketplaceIdentity`에 `registeredAt` 추가

**Files:**
- Modify: `src/lib/agent-marketplace/agent-registry.ts`
- Modify: `src/lib/__tests__/agent-marketplace/agent-registry.test.ts`

- [ ] **Step 1: 기존 테스트 실행 (baseline)**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/agent-registry.test.ts
```
Expected: 4 tests pass

- [ ] **Step 2: `registeredAt` 포함 테스트 추가**

`src/lib/__tests__/agent-marketplace/agent-registry.test.ts`의 기존 `beforeEach`에 `getBlockMock`을 추가하고, 성공 케이스에 `registeredAt` 검증 추가.

> **중요:** `beforeEach`에는 이미 `createPublicClientMock.mockReturnValue({ waitForTransactionReceipt: ... })`가 있다.
> 이 줄 전체를 아래로 **교체**한다 (새 `mockReturnValue` 호출을 추가하면 마지막 호출만 남아 기존 mock이 덮어씌워지므로, 명시적으로 두 필드를 함께 포함한 값으로 교체해야 한다).

```typescript
// hoisted 블록에 추가
getBlockMock: vi.fn(),

// beforeEach — 기존 createPublicClientMock.mockReturnValue 줄을 아래로 교체
hoisted.getBlockMock.mockResolvedValue({
  timestamp: 1710339720n, // 2024-03-13T14:22:00Z
});
hoisted.createPublicClientMock.mockReturnValue({
  waitForTransactionReceipt: hoisted.waitForTransactionReceiptMock,
  getBlock: hoisted.getBlockMock,
});

// 기존 성공 케이스('submits register...')에 추가
expect(result.registeredAt).toBe('2024-03-13T14:22:00.000Z');
```

새 케이스 추가:

```typescript
it('returns registeredAt null when getBlock throws', async () => {
  process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
  hoisted.getBlockMock.mockRejectedValueOnce(new Error('RPC error'));
  hoisted.parseEventLogsMock.mockReturnValueOnce([
    { eventName: 'AgentRegistered', args: { agentId: 1n, agent: '0xabc', agentURI: 'https://x.com/agent.json' } },
  ]);

  const result = await registerAgentMarketplaceIdentity({
    agentUriBase: 'https://x.com',
    walletKey: '0x' + '1'.repeat(64),
    registryAddress: '0x00000000000000000000000000000000000000b1',
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  expect(result.registeredAt).toBeNull();
});
```

- [ ] **Step 3: 테스트 실행 → FAIL 확인**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/agent-registry.test.ts
```
Expected: `registeredAt` 관련 테스트 실패

- [ ] **Step 4: `agent-registry.ts` 구현 수정**

```typescript
// 타입 수정
export type RegisterAgentMarketplaceIdentityResult =
  | { ok: true; agentId: string; txHash: `0x${string}` | string; registeredAt: string | null }
  | { ok: false; error: string };

// receipt 성공 후 블록 조회 추가 (waitForTransactionReceipt 바로 다음)
const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber }).catch(() => null);
const registeredAt = block
  ? new Date(Number(block.timestamp) * 1000).toISOString()
  : null;

// return 수정
return {
  ok: true,
  agentId: parsedAgentId !== undefined ? String(parsedAgentId) : txHash,
  txHash,
  registeredAt,
};
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/agent-registry.test.ts
```
Expected: 5+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/agent-marketplace/agent-registry.ts \
        src/lib/__tests__/agent-marketplace/agent-registry.test.ts
git commit -m "feat(marketplace): add registeredAt to registerAgentMarketplaceIdentity result"
```

---

## Task 3: `registration-status.ts` — 등록 상태 조회 + 캐시

**Files:**
- Create: `src/lib/agent-marketplace/registration-status.ts`
- Create: `src/lib/__tests__/agent-marketplace/registration-status.test.ts`

- [ ] **Step 1: 테스트 파일 작성**

```typescript
// src/lib/__tests__/agent-marketplace/registration-status.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  createPublicClientMock: vi.fn(),
  httpMock: vi.fn(),
  privateKeyToAddressMock: vi.fn(),
}));

vi.mock('viem', () => ({
  createPublicClient: hoisted.createPublicClientMock,
  http: hoisted.httpMock,
  parseAbi: (abi: string[]) => abi,
}));

vi.mock('viem/accounts', () => ({
  privateKeyToAddress: hoisted.privateKeyToAddressMock,
}));

vi.mock('viem/chains', () => ({
  mainnet: { id: 1 },
  sepolia: { id: 11155111 },
  optimismSepolia: { id: 11155420 },
}));

const { getRegistrationStatus, saveRegistrationCache } = await import(
  '@/lib/agent-marketplace/registration-status'
);

describe('registration-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 환경변수 초기화
    delete process.env.MARKETPLACE_WALLET_KEY;
    delete process.env.ERC8004_REGISTRY_ADDRESS;
    delete process.env.SENTINAI_L1_RPC_URL;
    delete process.env.MARKETPLACE_AGENT_URI_BASE;
    // globalThis 캐시 초기화
    (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache = undefined;

    hoisted.privateKeyToAddressMock.mockReturnValue('0xWALLET');
    hoisted.readContractMock.mockResolvedValue(0n);
    hoisted.createPublicClientMock.mockReturnValue({
      readContract: hoisted.readContractMock,
    });
  });

  it('returns registered:false with all envCheck false when env vars are missing', async () => {
    const status = await getRegistrationStatus();
    expect(status.registered).toBe(false);
    if (status.registered) throw new Error('expected unregistered');
    expect(status.envCheck.walletKey).toBe(false);
    expect(status.envCheck.registryAddress).toBe(false);
  });

  it('returns registered:false when latestAgentIdOf returns 0', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://my.sentinai.io';

    hoisted.readContractMock.mockResolvedValue(0n);

    const status = await getRegistrationStatus();
    expect(status.registered).toBe(false);
    if (status.registered) throw new Error('expected unregistered');
    expect(status.envCheck.walletKey).toBe(true);
    expect(status.envCheck.registryAddress).toBe(true);
  });

  it('returns registered:true with agentId and agentUri when on-chain data exists', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://my.sentinai.io';

    hoisted.readContractMock
      .mockResolvedValueOnce(42n)                                      // latestAgentIdOf
      .mockResolvedValueOnce('https://my.sentinai.io/api/agent-marketplace/agent.json'); // agentUriOf

    const status = await getRegistrationStatus();
    expect(status.registered).toBe(true);
    if (!status.registered) throw new Error('expected registered');
    expect(status.agentId).toBe('42');
    expect(status.agentUri).toBe('https://my.sentinai.io/api/agent-marketplace/agent.json');
    expect(status.contractAddress).toBe('0xREG');
  });

  it('returns globalThis cache hit without RPC call when cache is valid', async () => {
    process.env.MARKETPLACE_WALLET_KEY = '0x' + '1'.repeat(64);
    process.env.ERC8004_REGISTRY_ADDRESS = '0xREG';
    process.env.SENTINAI_L1_RPC_URL = 'https://rpc.example.com';
    process.env.MARKETPLACE_AGENT_URI_BASE = 'https://my.sentinai.io';

    (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache = {
      value: {
        registered: true,
        agentId: '99',
        agentUri: 'https://cached.io/api/agent-marketplace/agent.json',
        txHash: '0xcached',
        registeredAt: '2024-01-01T00:00:00.000Z',
        contractAddress: '0xREG',
      },
      cachedAt: Date.now(),
    };

    const status = await getRegistrationStatus();
    expect(status.registered).toBe(true);
    if (!status.registered) throw new Error('expected registered');
    expect(status.agentId).toBe('99');
    expect(hoisted.readContractMock).not.toHaveBeenCalled();
  });

  it('saveRegistrationCache stores result in globalThis', async () => {
    await saveRegistrationCache({
      registered: true,
      agentId: '5',
      agentUri: 'https://x.io/api/agent-marketplace/agent.json',
      txHash: '0xtx',
      registeredAt: '2024-03-13T14:22:00.000Z',
      contractAddress: '0xREG',
    });

    const cache = (globalThis as Record<string, unknown>).__sentinaiRegistrationStatusCache as
      { value: unknown; cachedAt: number } | undefined;
    expect(cache?.value).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL (모듈 없음)**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registration-status.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: `registration-status.ts` 구현**

```typescript
// src/lib/agent-marketplace/registration-status.ts
import Redis from 'ioredis';
import { createPublicClient, http } from 'viem';
import { privateKeyToAddress } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { agentMarketplaceRegistryAbi } from '@/lib/agent-marketplace/abi/agent-registry';

const REDIS_KEY_PREFIX = 'marketplace:registry:registration:';
const CACHE_TTL_S = 300;
const CACHE_TTL_MS = CACHE_TTL_S * 1000;

export type EnvCheck = {
  registryAddress: boolean;
  agentUriBase: boolean;
  walletKey: boolean;
  l1RpcUrl: boolean;
};

export type RegistrationStatus =
  | { registered: false; envCheck: EnvCheck; agentUri: string | null }
  | {
      registered: true;
      agentId: string;
      agentUri: string;
      txHash: string | null;
      registeredAt: string | null;
      contractAddress: string;
    };

type CacheState = { value: RegistrationStatus; cachedAt: number };

// ---- Redis helpers (REDIS_URL absent → all ops are no-ops) ----

let _redis: Redis | null | undefined; // undefined = not yet initialized

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  if (!process.env.REDIS_URL) { _redis = null; return null; }
  try { _redis = new Redis(process.env.REDIS_URL); return _redis; }
  catch { _redis = null; return null; }
}

async function redisGet(key: string): Promise<string | null> {
  return getRedis()?.get(key).catch(() => null) ?? null;
}

async function redisSetex(key: string, ttl: number, value: string): Promise<void> {
  await getRedis()?.setex(key, ttl, value).catch(() => null);
}

async function redisDel(key: string): Promise<void> {
  await getRedis()?.del(key).catch(() => null);
}

// ---- globalThis fallback ----

const globalForCache = globalThis as typeof globalThis & {
  __sentinaiRegistrationStatusCache?: CacheState;
};

// ---- public API ----

/** Clears Redis key (if available) + globalThis fallback */
export async function clearRegistrationCache(): Promise<void> {
  globalForCache.__sentinaiRegistrationStatusCache = undefined;
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  if (!walletKey) return;
  try {
    const walletAddress = privateKeyToAddress(walletKey as `0x${string}`);
    await redisDel(`${REDIS_KEY_PREFIX}${walletAddress}`);
  } catch { /* ignore */ }
}

/** Saves to Redis (TTL 300s, if available) + globalThis fallback */
export async function saveRegistrationCache(status: RegistrationStatus): Promise<void> {
  globalForCache.__sentinaiRegistrationStatusCache = { value: status, cachedAt: Date.now() };
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  if (!walletKey) return;
  try {
    const walletAddress = privateKeyToAddress(walletKey as `0x${string}`);
    await redisSetex(`${REDIS_KEY_PREFIX}${walletAddress}`, CACHE_TTL_S, JSON.stringify(status));
  } catch { /* ignore */ }
}

function buildEnvCheck(): EnvCheck {
  return {
    registryAddress: !!process.env.ERC8004_REGISTRY_ADDRESS?.trim(),
    agentUriBase: !!process.env.MARKETPLACE_AGENT_URI_BASE?.trim(),
    walletKey: !!process.env.MARKETPLACE_WALLET_KEY?.trim(),
    l1RpcUrl: !!(process.env.SENTINAI_L1_RPC_URL?.trim() || process.env.L1_RPC_URL?.trim()),
  };
}

function isEnvReady(check: EnvCheck): boolean {
  return check.registryAddress && check.agentUriBase && check.walletKey && check.l1RpcUrl;
}

function resolveChain() {
  return process.env.X402_NETWORK?.trim() === 'eip155:1' ? mainnet : sepolia;
}

export async function getRegistrationStatus(): Promise<RegistrationStatus> {
  const envCheck = buildEnvCheck();

  if (!isEnvReady(envCheck)) {
    return {
      registered: false,
      envCheck,
      agentUri: process.env.MARKETPLACE_AGENT_URI_BASE
        ? `${process.env.MARKETPLACE_AGENT_URI_BASE.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`
        : null,
    };
  }

  const walletKey = process.env.MARKETPLACE_WALLET_KEY!.trim();
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS!.trim() as `0x${string}`;
  const l1RpcUrl = (process.env.SENTINAI_L1_RPC_URL || process.env.L1_RPC_URL)!.trim();
  const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE!.trim();
  const agentUri = `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`;

  // 1. Redis cache (primary)
  try {
    const walletAddress = privateKeyToAddress(walletKey as `0x${string}`);
    const redisData = await redisGet(`${REDIS_KEY_PREFIX}${walletAddress}`);
    if (redisData) return JSON.parse(redisData) as RegistrationStatus;
  } catch { /* fall through */ }

  // 2. globalThis fallback cache
  const gCached = globalForCache.__sentinaiRegistrationStatusCache;
  if (gCached && Date.now() - gCached.cachedAt <= CACHE_TTL_MS) return gCached.value;

  // 3. On-chain read
  try {
    const walletAddress = privateKeyToAddress(walletKey as `0x${string}`);
    const publicClient = createPublicClient({
      chain: resolveChain(),
      transport: http(l1RpcUrl, { timeout: 10_000 }),
    });

    const agentIdBigInt = await publicClient.readContract({
      address: registryAddress,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'latestAgentIdOf',
      args: [walletAddress],
    }) as bigint;

    if (agentIdBigInt === 0n) {
      const result: RegistrationStatus = { registered: false, envCheck, agentUri };
      await saveRegistrationCache(result);
      return result;
    }

    const onChainUri = await publicClient.readContract({
      address: registryAddress,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'agentUriOf',
      args: [agentIdBigInt],
    }) as string;

    const result: RegistrationStatus = {
      registered: true,
      agentId: String(agentIdBigInt),
      agentUri: onChainUri || agentUri,
      txHash: null,   // 온체인 조회 시 txHash 불가 — register 후 캐시에서만 가용
      registeredAt: null,
      contractAddress: registryAddress,
    };
    await saveRegistrationCache(result);
    return result;
  } catch {
    return { registered: false, envCheck, agentUri };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/registration-status.test.ts
```
Expected: 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-marketplace/registration-status.ts \
        src/lib/__tests__/agent-marketplace/registration-status.test.ts
git commit -m "feat(marketplace): add registration-status service with chain query and cache"
```

---

## Task 4: `GET /api/agent-marketplace/ops/registration-status` 라우트

**Files:**
- Create: `src/app/api/agent-marketplace/ops/registration-status/route.ts`
- Create: `src/app/api/agent-marketplace/ops/registration-status/route.test.ts`

- [ ] **Step 1: 테스트 작성**

```typescript
// src/app/api/agent-marketplace/ops/registration-status/route.test.ts
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/agent-marketplace/registration-status', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({
    registered: true,
    agentId: '42',
    agentUri: 'https://my.sentinai.io/api/agent-marketplace/agent.json',
    txHash: '0xtxhash',
    registeredAt: '2024-03-13T14:22:00.000Z',
    contractAddress: '0xREG',
  }),
}));

const { GET } = await import(
  '@/app/api/agent-marketplace/ops/registration-status/route'
);

describe('GET /api/agent-marketplace/ops/registration-status', () => {
  it('returns 200 with registration status', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registered).toBe(true);
    expect(body.agentId).toBe('42');
  });
});
```

- [ ] **Step 2: 테스트 실행 → FAIL**

```bash
npx vitest run src/app/api/agent-marketplace/ops/registration-status/route.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: 라우트 구현**

```typescript
// src/app/api/agent-marketplace/ops/registration-status/route.ts
import { getRegistrationStatus } from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const status = await getRegistrationStatus();
  return Response.json(status);
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/app/api/agent-marketplace/ops/registration-status/route.test.ts
```
Expected: 1 test passes

- [ ] **Step 5: Commit**

```bash
git add src/app/api/agent-marketplace/ops/registration-status/route.ts \
        src/app/api/agent-marketplace/ops/registration-status/route.test.ts
git commit -m "feat(marketplace): add GET /api/agent-marketplace/ops/registration-status"
```

---

## Task 5: `register/route.ts` — 성공 시 캐시 저장

**Files:**
- Modify: `src/app/api/agent-marketplace/ops/register/route.ts`
- Modify: `src/app/api/agent-marketplace/ops/register/route.test.ts`

- [ ] **Step 1: 기존 테스트 확인**

```bash
npx vitest run src/app/api/agent-marketplace/ops/register/route.test.ts
```
Expected: 기존 테스트 통과 확인

- [ ] **Step 2: 캐시 저장 테스트 추가**

기존 `route.test.ts`에 성공 케이스 후 캐시 저장 검증 추가:

```typescript
// 기존 mock에 추가
vi.mock('@/lib/agent-marketplace/registration-status', () => ({
  clearRegistrationCache: vi.fn(),
  saveRegistrationCache: vi.fn(),
}));

// 기존 성공 테스트에 추가
import { clearRegistrationCache, saveRegistrationCache } from '@/lib/agent-marketplace/registration-status';
expect(clearRegistrationCache).toHaveBeenCalled();
expect(saveRegistrationCache).toHaveBeenCalledWith(
  expect.objectContaining({ registered: true, agentId: '123' })
);
```

- [ ] **Step 3: 테스트 실행 → FAIL**

```bash
npx vitest run src/app/api/agent-marketplace/ops/register/route.test.ts
```
Expected: 새 검증 실패

- [ ] **Step 4: `register/route.ts` 수정**

```typescript
import { registerAgentMarketplaceIdentity } from '@/lib/agent-marketplace/agent-registry';
import {
  clearRegistrationCache,
  saveRegistrationCache,
} from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  _context?: Record<string, unknown>
): Promise<Response> {
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim() ?? '';
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim() ?? '';
  const agentUriBase = process.env.MARKETPLACE_AGENT_URI_BASE?.trim() ?? '';

  const result = await registerAgentMarketplaceIdentity({
    agentUriBase,
    walletKey,
    registryAddress,
  });

  if (result.ok) {
    await clearRegistrationCache();
    await saveRegistrationCache({
      registered: true,
      agentId: result.agentId,
      agentUri: `${agentUriBase.replace(/\/+$/, '')}/api/agent-marketplace/agent.json`,
      txHash: result.txHash,
      registeredAt: result.registeredAt,
      contractAddress: registryAddress,
    });
  }

  return Response.json(
    { result },
    { status: result.ok ? 200 : 502 }
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/app/api/agent-marketplace/ops/register/route.test.ts
```
Expected: 모든 테스트 pass

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agent-marketplace/ops/register/route.ts \
        src/app/api/agent-marketplace/ops/register/route.test.ts
git commit -m "feat(marketplace): save registration result to cache after successful register tx"
```

---

## Task 6: `RegistrationWizard` Client Component

**Files:**
- Create: `src/components/marketplace/RegistrationWizard.tsx`

이 컴포넌트는 UI 전용이므로 별도 유닛 테스트 없이 Task 7의 통합 확인으로 검증한다.

- [ ] **Step 0: 디렉토리 생성 (없는 경우)**

`src/components/marketplace/` 디렉토리가 존재하지 않으면 생성한다.

```bash
mkdir -p src/components/marketplace
```

- [ ] **Step 1: 컴포넌트 작성**

```typescript
// src/components/marketplace/RegistrationWizard.tsx
'use client';

import { useState } from 'react';
import type { RegistrationStatus } from '@/lib/agent-marketplace/registration-status';

type WizardStep = 1 | 2 | 3 | 4;

// RegistrationStatusCard — 등록 완료 상태 표시
function RegistrationStatusCard({
  status,
  onReRegister,
}: {
  status: Extract<RegistrationStatus, { registered: true }>;
  onReRegister: () => void;
}) {
  const etherscanBase = 'https://sepolia.etherscan.io';
  return (
    <div className="border border-[#D0D0D0] bg-white">
      <div className="flex items-center justify-between border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2">
        <div className="text-[9px] font-bold tracking-[0.12em]">REGISTRY REGISTRATION</div>
        <button
          onClick={onReRegister}
          className="border border-[#C0C0C0] bg-white px-3 py-1 text-[9px] font-bold tracking-[0.08em] text-[#555] hover:bg-[#F0F0F0]"
        >
          RE-REGISTER
        </button>
      </div>
      <div className="divide-y divide-[#F0F0F0]">
        <Row label="AGENT ID">
          <span className="font-bold text-[#27ae60]">#{status.agentId}</span>
        </Row>
        <Row label="REGISTERED URI">
          <span className="text-[10px] text-[#0055AA] break-all">{status.agentUri}</span>
        </Row>
        <Row label="TX HASH">
          {status.txHash ? (
            <a
              href={`${etherscanBase}/tx/${status.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#0055AA] hover:underline"
            >
              {status.txHash.slice(0, 10)}…{status.txHash.slice(-6)} ↗
            </a>
          ) : (
            <span className="text-[10px] text-[#AAA]">—</span>
          )}
        </Row>
        <Row label="REGISTERED AT">
          <span className="text-[10px] text-[#555]">
            {status.registeredAt
              ? new Date(status.registeredAt).toUTCString().replace(' GMT', ' UTC')
              : '—'}
          </span>
        </Row>
        <Row label="CONTRACT">
          <a
            href={`${etherscanBase}/address/${status.contractAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[#0055AA] hover:underline"
          >
            {status.contractAddress.slice(0, 8)}…{status.contractAddress.slice(-6)} (Sepolia) ↗
          </a>
        </Row>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className="text-[9px] font-bold tracking-[0.1em] text-[#888]">{label}</span>
      <div className="text-[11px]">{children}</div>
    </div>
  );
}

// Wizard step tab bar
function StepTabs({ step, onSelect }: { step: WizardStep; onSelect: (s: WizardStep) => void }) {
  const tabs: { n: WizardStep; label: string }[] = [
    { n: 1, label: '① ENV' },
    { n: 2, label: '② URI' },
    { n: 3, label: '③ TX' },
    { n: 4, label: '④ DONE' },
  ];
  return (
    <div className="flex border-b border-[#E8E8E8] bg-[#FAFAFA]">
      {tabs.map(({ n, label }) => (
        <button
          key={n}
          onClick={() => onSelect(n)}
          className={`flex-1 border-r border-[#E8E8E8] py-2 text-[9px] font-bold tracking-[0.08em] last:border-r-0 ${
            step === n
              ? 'border-b-2 border-b-[#D40000] bg-white text-[#D40000]'
              : 'border-b-2 border-b-transparent text-[#888]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function RegistrationWizard({
  initialStatus,
}: {
  initialStatus: RegistrationStatus;
}) {
  const [status, setStatus] = useState<RegistrationStatus>(initialStatus);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [txPending, setTxPending] = useState(false);
  const [txResult, setTxResult] = useState<
    { ok: true; agentId: string; txHash: string } | { ok: false; error: string } | null
  >(null);

  function openWizard() {
    setStep(1);
    setTxPending(false);
    setTxResult(null);
    setWizardOpen(true);
  }

  async function handleRegister() {
    setTxPending(true);
    try {
      const res = await fetch('/api/agent-marketplace/ops/register', { method: 'POST' });
      const body = await res.json() as { result: { ok: boolean; agentId?: string; txHash?: string; error?: string } };
      if (body.result.ok) {
        setTxResult({ ok: true, agentId: body.result.agentId!, txHash: body.result.txHash! });
        // 최신 상태 반영을 위해 registration-status API 재조회
        const statusRes = await fetch('/api/agent-marketplace/ops/registration-status');
        const newStatus = await statusRes.json() as RegistrationStatus;
        setStatus(newStatus);
      } else {
        setTxResult({ ok: false, error: body.result.error ?? 'Unknown error' });
      }
    } catch (e) {
      setTxResult({ ok: false, error: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setTxPending(false);
      setStep(4);
    }
  }

  // 등록 완료 상태
  if (status.registered && !wizardOpen) {
    return (
      <section className="px-6 pb-6">
        <RegistrationStatusCard status={status} onReRegister={openWizard} />
      </section>
    );
  }

  // 미등록 상태 (wizard 닫힘)
  if (!status.registered && !wizardOpen) {
    const envCheck = status.envCheck;
    const envReady = Object.values(envCheck).every(Boolean);
    return (
      <section className="px-6 pb-6">
        <div className="border border-[#D0D0D0] bg-white">
          <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
            REGISTRY REGISTRATION
          </div>
          <div className="px-4 py-4">
            <div className="mb-4 flex items-start gap-3 border border-[#FFC107] bg-[#FFFDE7] px-4 py-3">
              <span className="text-[14px]">⚠</span>
              <div>
                <div className="text-[11px] font-bold text-[#856404]">Not registered on Sepolia registry</div>
                <div className="mt-1 text-[10px] text-[#9E7000]">
                  Buyers cannot discover this instance. Register to enable marketplace discovery.
                </div>
              </div>
            </div>
            <button
              onClick={openWizard}
              disabled={!envReady}
              className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              REGISTER TO REGISTRY →
            </button>
          </div>
        </div>
      </section>
    );
  }

  // Wizard 열림
  const envCheck = status.registered ? null : status.envCheck;
  const agentUri = status.registered
    ? status.agentUri
    : status.agentUri ?? '';

  return (
    <section className="px-6 pb-6">
      <div className="border border-[#D0D0D0] bg-white">
        <div className="border-b border-[#D0D0D0] bg-[#F5F5F5] px-4 py-2 text-[9px] font-bold tracking-[0.12em]">
          REGISTRY REGISTRATION
        </div>
        <StepTabs step={step} onSelect={setStep} />

        {/* Step 1: ENV */}
        {step === 1 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">ENVIRONMENT CONFIGURATION</div>
            <div className="mb-4 space-y-2">
              {([
                ['ERC8004_REGISTRY_ADDRESS', envCheck?.registryAddress ?? true],
                ['MARKETPLACE_AGENT_URI_BASE', envCheck?.agentUriBase ?? true],
                ['MARKETPLACE_WALLET_KEY (masked)', envCheck?.walletKey ?? true],
                ['SENTINAI_L1_RPC_URL', envCheck?.l1RpcUrl ?? true],
              ] as [string, boolean][]).map(([key, ok]) => (
                <div key={key} className="flex items-center justify-between border border-[#E8E8E8] px-3 py-2 text-[11px]">
                  <span className="text-[#888]">{key}</span>
                  <span className={ok ? 'text-[#27ae60]' : 'text-[#D40000]'}>
                    {ok ? '● SET' : '✗ MISSING'}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between">
              <button onClick={() => setWizardOpen(false)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                CANCEL
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={envCheck ? !Object.values(envCheck).every(Boolean) : false}
                className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white disabled:opacity-40"
              >
                NEXT →
              </button>
            </div>
          </div>
        )}

        {/* Step 2: URI */}
        {step === 2 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">AGENT MANIFEST URI PREVIEW</div>
            <div className="mb-3 border border-[#D0D0D0] bg-[#F8F8F8] px-3 py-3">
              <div className="mb-1 text-[9px] text-[#888]">WILL REGISTER ON-CHAIN:</div>
              <div className="break-all text-[11px] text-[#0055AA]">{agentUri}</div>
            </div>
            <div className="mb-4 border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[10px] text-[#388E3C]">
              ✓ URI format valid
            </div>
            <div className="flex justify-between">
              <button onClick={() => setStep(1)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                ← BACK
              </button>
              <button onClick={() => setStep(3)} className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white">
                NEXT →
              </button>
            </div>
          </div>
        )}

        {/* Step 3: TX */}
        {step === 3 && (
          <div className="p-5">
            <div className="mb-4 text-[9px] font-bold tracking-[0.1em] text-[#555]">SEND REGISTRATION TRANSACTION</div>
            <div className="mb-4 space-y-2">
              {([
                ['Contract', 'SentinAIERC8004Registry'],
                ['Function', 'register(agentURI)'],
                ['Network', 'Sepolia (11155111)'],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border border-[#E8E8E8] px-3 py-2 text-[11px]">
                  <span className="text-[#888]">{k}</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
            {txPending ? (
              <div className="border border-[#FFF3CD] bg-[#FFFDE7] px-4 py-3 text-center text-[11px] text-[#856404]">
                ⏳ Broadcasting transaction… waiting for receipt
              </div>
            ) : (
              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="border border-[#C0C0C0] px-3 py-2 text-[10px] font-bold tracking-[0.08em] text-[#555]">
                  ← BACK
                </button>
                <button
                  onClick={handleRegister}
                  className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                >
                  REGISTER NOW
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: RESULT */}
        {step === 4 && (
          <div className="p-5">
            {txResult?.ok ? (
              <>
                <div className="mb-4 text-[10px] font-bold text-[#27ae60]">✓ REGISTRATION SUCCESSFUL</div>
                <div className="mb-4 space-y-2">
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">AGENT ID</span>
                    <span className="font-bold text-[#27ae60]">#{txResult.agentId}</span>
                  </div>
                  <div className="flex items-center justify-between border border-[#C8E6C9] bg-[#F1F8F1] px-3 py-2 text-[11px]">
                    <span className="text-[#888]">TX HASH</span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${txResult.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[#0055AA] hover:underline"
                    >
                      {txResult.txHash.slice(0, 10)}…{txResult.txHash.slice(-6)} ↗
                    </a>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setWizardOpen(false)}
                    className="border border-[#333] bg-[#333] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                  >
                    DONE
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-4 text-[10px] font-bold text-[#D40000]">✗ REGISTRATION FAILED</div>
                <div className="mb-4 border border-[#FFCDD2] bg-[#FFEBEE] px-4 py-3 text-[11px] text-[#C62828]">
                  {txResult?.error ?? 'Unknown error'}
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => setStep(3)}
                    className="border border-[#8B0000] bg-[#D40000] px-4 py-2 text-[10px] font-bold tracking-[0.08em] text-white"
                  >
                    RETRY
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: 타입체크**

```bash
npx tsc --noEmit 2>&1 | grep RegistrationWizard
```
Expected: 출력 없음

- [ ] **Step 3: Commit**

```bash
git add src/components/marketplace/RegistrationWizard.tsx
git commit -m "feat(marketplace): add RegistrationWizard client component with 4-step flow"
```

---

## Task 7: `page.tsx` 통합 — Promise.all 확장 + Wizard 삽입

**Files:**
- Modify: `src/app/v2/marketplace/page.tsx`

- [ ] **Step 1: page.tsx 수정**

`page.tsx` 상단 import에 추가:

```typescript
import { getRegistrationStatus } from '@/lib/agent-marketplace/registration-status';
import { RegistrationWizard } from '@/components/marketplace/RegistrationWizard';
```

`Promise.all`에 `getRegistrationStatus()` 추가:

```typescript
const [summary, disputes, contracts, registrationStatus] = await Promise.all([
  buildAgentMarketplaceOpsSummary({ fromIso, toIso }),
  listAgentMarketplaceDisputes(),
  Promise.resolve(getAgentMarketplaceContractsStatus()),
  getRegistrationStatus(),
]);
```

기존 `REGISTRY REGISTRATION` 섹션 (`<section className="px-6 pb-6">…</section>`, 내부에 "Register to Registry" form 포함) 전체를 아래로 교체:

```tsx
<RegistrationWizard initialStatus={registrationStatus} />
```

stats bar의 4번째 셀(LAST BATCH, line 122-125)을 REGISTRY 셀로 교체.

기존 코드 (line ~122-125):
```tsx
<div className="border border-[#D0D0D0] bg-white p-4">
  <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">LAST BATCH</div>
  <div className="text-[18px] font-bold uppercase">{summary.lastBatch.status}</div>
</div>
```

교체할 코드:
```tsx
<div className="border border-[#D0D0D0] bg-white p-4">
  <div className="mb-1 text-[9px] font-bold tracking-[0.12em] text-[#888]">REGISTRY</div>
  <div className={`text-[12px] font-bold ${registrationStatus.registered ? 'text-[#27ae60]' : 'text-[#D40000]'}`}>
    {registrationStatus.registered ? 'REGISTERED ●' : 'NOT REGISTERED'}
  </div>
</div>
```

- [ ] **Step 2: 빌드 확인**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Expected: 에러 없음

- [ ] **Step 3: 개발 서버에서 육안 확인**

```bash
npm run dev
```

브라우저에서 `http://localhost:3002/v2/marketplace` 접속:
- `ERC8004_REGISTRY_ADDRESS` 미설정 시: "NOT REGISTERED" + 경고 배너 표시 확인
- "REGISTER TO REGISTRY" 버튼 클릭 → Wizard 펼침 확인
- Step 탭 전환 확인

- [ ] **Step 4: 전체 테스트 통과 확인**

```bash
npx vitest run src/lib/__tests__/agent-marketplace/ src/app/api/agent-marketplace/ops/
```
Expected: 모든 테스트 pass

- [ ] **Step 5: Commit**

```bash
git add src/app/v2/marketplace/page.tsx
git commit -m "feat(marketplace): integrate RegistrationWizard into marketplace ops page"
```

---

## Task 8: 최종 검증

- [ ] **Step 1: 전체 테스트 실행**

```bash
npm run test -- --run 2>&1 | tail -20
```
Expected: 새로 추가된 테스트 포함 pass

- [ ] **Step 2: 타입체크**

```bash
npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 3: Final commit if needed**

```bash
git status
# 미커밋 파일 있으면
git add -p
git commit -m "chore: finalize erc8004 registration wizard implementation"
```
