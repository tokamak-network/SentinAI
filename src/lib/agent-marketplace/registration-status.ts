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
      txHash: null,
      registeredAt: null,
      contractAddress: registryAddress,
    };
    await saveRegistrationCache(result);
    return result;
  } catch {
    return { registered: false, envCheck, agentUri };
  }
}
