/**
 * Operator Aggregator
 *
 * Fetches per-operator ops-snapshot data from multiple SentinAI instances in parallel.
 * Operators are read from the /api/agent-marketplace/catalog endpoint (single-operator fallback)
 * or from an on-chain registry (Phase 1: ERC8004 registry-browse).
 *
 * Cache: 5 minutes TTL.
 */

export interface OperatorSnapshot {
  address: string;
  name?: string;
  agentUri: string;
  status: 'online' | 'offline' | 'degraded';
  cpuMean?: number;
  memoryGiB?: number;
  activeAnomalies?: number;
  serviceCount?: number;
  version?: string;
  chain?: string;
  fetchedAt: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

interface CacheEntry {
  operators: OperatorSnapshot[];
  cachedAt: number;
}

const globalForAggregator = globalThis as typeof globalThis & {
  __sentinaiOperatorAggregatorCache?: CacheEntry;
};

function getCache(): CacheEntry | null {
  const entry = globalForAggregator.__sentinaiOperatorAggregatorCache;
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) return null;
  return entry;
}

function setCache(operators: OperatorSnapshot[]): void {
  globalForAggregator.__sentinaiOperatorAggregatorCache = {
    operators,
    cachedAt: Date.now(),
  };
}

/** Fetches ops-snapshot from a single operator endpoint with timeout. */
async function fetchOperatorSnapshot(agentUri: string, address: string): Promise<OperatorSnapshot> {
  const baseUrl = agentUri.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const [snapshotRes, catalogRes] = await Promise.allSettled([
      fetch(`${baseUrl}/api/agent-marketplace/ops-snapshot.json`, { signal: controller.signal }),
      fetch(`${baseUrl}/api/agent-marketplace/catalog`, { signal: controller.signal }),
    ]);

    clearTimeout(timer);

    // Parse snapshot
    let cpuMean: number | undefined;
    let memoryGiB: number | undefined;
    let activeAnomalies: number | undefined;
    let version: string | undefined;
    let chain: string | undefined;

    if (snapshotRes.status === 'fulfilled' && snapshotRes.value.ok) {
      try {
        const snap = await snapshotRes.value.json();
        cpuMean = snap.metrics?.cpu?.mean;
        memoryGiB = snap.scaling?.currentMemoryGiB;
        activeAnomalies = snap.anomalies?.activeCount ?? 0;
        version = snap.version;
        chain = snap.chain?.displayName;
      } catch { /* ignore parse error */ }
    }

    // Parse catalog for service count
    let serviceCount: number | undefined;
    let name: string | undefined;
    if (catalogRes.status === 'fulfilled' && catalogRes.value.ok) {
      try {
        const cat = await catalogRes.value.json();
        serviceCount = cat.services?.length;
        name = cat.agent?.operator;
      } catch { /* ignore parse error */ }
    }

    // Determine status
    const snapshotOk = snapshotRes.status === 'fulfilled' && snapshotRes.value.ok;
    const catalogOk = catalogRes.status === 'fulfilled' && catalogRes.value.ok;
    const status: OperatorSnapshot['status'] =
      snapshotOk && catalogOk ? 'online'
        : snapshotOk || catalogOk ? 'degraded'
        : 'offline';

    return {
      address,
      name,
      agentUri,
      status,
      cpuMean,
      memoryGiB,
      activeAnomalies,
      serviceCount,
      version,
      chain,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    clearTimeout(timer);
    return {
      address,
      agentUri,
      status: 'offline',
      fetchedAt: new Date().toISOString(),
    };
  }
}

/**
 * Returns a list of operator snapshots, using a 5-minute in-memory cache.
 * In Phase 1, the operator list is sourced from the local catalog (single operator fallback).
 * Phase 3 will replace this with ERC8004 registry-browse.
 */
export async function getOperators(
  operatorList?: Array<{ address: string; agentUri: string }>
): Promise<OperatorSnapshot[]> {
  const cached = getCache();
  if (cached) return cached.operators;

  // Fallback: build a single-operator list from env
  const list =
    operatorList ??
    (() => {
      const agentUri =
        process.env.NEXT_PUBLIC_OPERATOR_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3002';
      const address = process.env.NEXT_PUBLIC_OPERATOR_ADDRESS ?? '0x0000000000000000000000000000000000000000';
      return [{ address, agentUri }];
    })();

  const results = await Promise.all(
    list.map(({ address, agentUri }) => fetchOperatorSnapshot(agentUri, address))
  );

  setCache(results);
  return results;
}
