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

// ---- wallet address resolution ----

/**
 * Resolve the wallet address for cache keys.
 * Prefers an explicit address parameter, falls back to MARKETPLACE_WALLET_KEY
 * derivation for backward compatibility (server-side bootstrap).
 */
function resolveWalletAddress(walletAddress?: string): string | null {
  if (walletAddress) return walletAddress.toLowerCase();
  const walletKey = process.env.MARKETPLACE_WALLET_KEY?.trim();
  if (!walletKey) return null;
  try {
    return privateKeyToAddress(walletKey as `0x${string}`).toLowerCase();
  } catch {
    return null;
  }
}

// ---- public API ----

/** Clears Redis key (if available) + globalThis fallback */
export async function clearRegistrationCache(walletAddress?: string): Promise<void> {
  globalForCache.__sentinaiRegistrationStatusCache = undefined;
  const address = resolveWalletAddress(walletAddress);
  if (!address) return;
  await redisDel(`${REDIS_KEY_PREFIX}${address}`);
}

/** Saves to Redis (TTL 300s, if available) + globalThis fallback */
export async function saveRegistrationCache(
  status: RegistrationStatus,
  walletAddress?: string,
): Promise<void> {
  globalForCache.__sentinaiRegistrationStatusCache = { value: status, cachedAt: Date.now() };
  const address = resolveWalletAddress(walletAddress);
  if (!address) return;
  await redisSetex(`${REDIS_KEY_PREFIX}${address}`, CACHE_TTL_S, JSON.stringify(status));
}

function buildEnvCheck(): EnvCheck {
  return {
    registryAddress: !!process.env.ERC8004_REGISTRY_ADDRESS?.trim(),
    l1RpcUrl: !!(process.env.SENTINAI_L1_RPC_URL?.trim() || process.env.L1_RPC_URL?.trim()),
  };
}

function resolveChain() {
  return process.env.X402_NETWORK?.trim() === 'eip155:1' ? mainnet : sepolia;
}

/**
 * Get registration status.
 * If walletAddress is provided, uses it for cache lookup and on-chain query.
 * Otherwise falls back to MARKETPLACE_WALLET_KEY derivation.
 */
export async function getRegistrationStatus(walletAddress?: string): Promise<RegistrationStatus> {
  const envCheck = buildEnvCheck();
  const registryAddress = process.env.ERC8004_REGISTRY_ADDRESS?.trim();
  const l1RpcUrl = (process.env.SENTINAI_L1_RPC_URL?.trim() || process.env.L1_RPC_URL?.trim());

  if (!registryAddress || !l1RpcUrl) {
    return {
      registered: false,
      envCheck,
      agentUri: null,
    };
  }

  const address = resolveWalletAddress(walletAddress);
  if (!address) {
    return { registered: false, envCheck, agentUri: null };
  }

  // 1. Redis cache (primary)
  try {
    const redisData = await redisGet(`${REDIS_KEY_PREFIX}${address}`);
    if (redisData) return JSON.parse(redisData) as RegistrationStatus;
  } catch { /* fall through */ }

  // 2. globalThis fallback cache
  const gCached = globalForCache.__sentinaiRegistrationStatusCache;
  if (gCached && Date.now() - gCached.cachedAt <= CACHE_TTL_MS) return gCached.value;

  // 3. On-chain read
  try {
    const publicClient = createPublicClient({
      chain: resolveChain(),
      transport: http(l1RpcUrl, { timeout: 10_000 }),
    });

    const agentIdBigInt = await publicClient.readContract({
      address: registryAddress as `0x${string}`,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'latestAgentIdOf',
      args: [address as `0x${string}`],
    }) as bigint;

    if (agentIdBigInt === BigInt(0)) {
      const result: RegistrationStatus = { registered: false, envCheck, agentUri: null };
      await saveRegistrationCache(result, address);
      return result;
    }

    const onChainUri = await publicClient.readContract({
      address: registryAddress as `0x${string}`,
      abi: agentMarketplaceRegistryAbi,
      functionName: 'agentUriOf',
      args: [agentIdBigInt],
    }) as string;

    const result: RegistrationStatus = {
      registered: true,
      agentId: String(agentIdBigInt),
      agentUri: onChainUri,
      txHash: null,
      registeredAt: null,
      contractAddress: registryAddress,
    };
    await saveRegistrationCache(result, address);
    return result;
  } catch {
    return { registered: false, envCheck, agentUri: null };
  }
}
