import type { ConnectionConfig, NodeType } from '@/core/types';
import { loadCustomProfiles } from './client-profile/custom-profiles';

export type ClientLayer = 'execution';

export type ExecutionClientFamily =
  | 'geth'
  | 'reth'
  | 'nethermind'
  | 'besu'
  | 'erigon'
  | 'op-geth'
  | 'nitro-node'
  | 'unknown';

export interface DetectedClient {
  layer: ClientLayer;
  /** Best-effort normalized family name */
  family: ExecutionClientFamily;
  /** Best-effort version string (raw) */
  version?: string;
  /** Only for EVM JSON-RPC */
  chainId?: number;
  /** Best-effort syncing state */
  syncing?: boolean;
  /** Best-effort peer count */
  peerCount?: number;
  /** Whether L2-specific sync status is available (op-geth / nitro-node) */
  supportsL2SyncStatus: boolean;
  /** The RPC method used for L2 sync status, or null if not applicable */
  l2SyncMethod: string | null;
  /** Which txpool namespace is supported: 'txpool' (standard), 'parity' (nethermind), or null */
  txpoolNamespace: 'txpool' | 'parity' | null;
  /** Which probes were supported */
  probes: Record<string, boolean>;
  /** Raw responses (for debugging) */
  raw?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rpcCall(
  url: string,
  method: string,
  params: unknown[] = [],
  authToken?: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const data = (await fetchJson(
    url,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    },
    timeoutMs
  )) as { result?: unknown; error?: { message?: string } };

  if (data.error?.message) throw new Error(data.error.message);
  return data.result;
}

function normalizeExecutionFamily(version?: string): ExecutionClientFamily {
  const v = (version ?? '').toLowerCase();
  if (v.includes('geth')) return 'geth';
  if (v.includes('reth')) return 'reth';
  if (v.includes('nethermind')) return 'nethermind';
  if (v.includes('besu')) return 'besu';
  if (v.includes('erigon')) return 'erigon';

  // Check custom profiles loaded from client-profiles.json
  const customProfiles = loadCustomProfiles();
  for (const profile of customProfiles) {
    if (v.includes(profile.detectPattern.toLowerCase())) {
      return profile.clientFamily as ExecutionClientFamily;
    }
  }

  return 'unknown';
}


export async function detectClient(
  config: ConnectionConfig,
  options?: {
    protocolIdHint?: NodeType;
    timeoutMs?: number;
  }
): Promise<DetectedClient> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return detectExecutionClient(config, timeoutMs);
}

export async function detectExecutionClient(
  config: ConnectionConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DetectedClient> {
  const probes: Record<string, boolean> = {};
  const raw: Record<string, unknown> = {};

  let version: string | undefined;
  try {
    const res = await rpcCall(config.rpcUrl, 'web3_clientVersion', [], config.authToken, timeoutMs);
    version = typeof res === 'string' ? res : undefined;
    probes.web3_clientVersion = true;
    raw.web3_clientVersion = res;
  } catch {
    probes.web3_clientVersion = false;
  }

  let chainId: number | undefined;
  try {
    const res = await rpcCall(config.rpcUrl, 'eth_chainId', [], config.authToken, timeoutMs);
    if (typeof res === 'string') {
      chainId = Number.parseInt(res, 16);
    }
    probes.eth_chainId = chainId !== undefined;
    raw.eth_chainId = res;
  } catch {
    probes.eth_chainId = false;
  }

  let syncing: boolean | undefined;
  try {
    const res = await rpcCall(config.rpcUrl, 'eth_syncing', [], config.authToken, timeoutMs);
    // spec: false or object
    syncing = res !== false;
    probes.eth_syncing = true;
    raw.eth_syncing = res;
  } catch {
    probes.eth_syncing = false;
  }

  let peerCount: number | undefined;
  try {
    const res = await rpcCall(config.rpcUrl, 'net_peerCount', [], config.authToken, timeoutMs);
    if (typeof res === 'string') peerCount = Number.parseInt(res, 16);
    probes.net_peerCount = peerCount !== undefined;
    raw.net_peerCount = res;
  } catch {
    probes.net_peerCount = false;
  }

  try {
    const res = await rpcCall(config.rpcUrl, 'admin_peers', [], config.authToken, timeoutMs);
    probes.admin_peers = Array.isArray(res);
    raw.admin_peers = res;
    if (peerCount === undefined && Array.isArray(res)) peerCount = res.length;
  } catch {
    probes.admin_peers = false;
  }

  // txpool probe with parity_* fallback for nethermind
  let txpoolNamespace: 'txpool' | 'parity' | null = null;

  try {
    const res = await rpcCall(config.rpcUrl, 'txpool_status', [], config.authToken, timeoutMs);
    const ok = typeof res === 'object' && res !== null;
    probes.txpool_status = ok;
    raw.txpool_status = res;
    if (ok) txpoolNamespace = 'txpool';
  } catch {
    probes.txpool_status = false;
  }

  if (txpoolNamespace === null) {
    // Nethermind fallback: parity_pendingTransactions
    try {
      const res = await rpcCall(config.rpcUrl, 'parity_pendingTransactions', [], config.authToken, timeoutMs);
      const ok = Array.isArray(res);
      probes.parity_pendingTransactions = ok;
      raw.parity_pendingTransactions = res;
      if (ok) txpoolNamespace = 'parity';
    } catch {
      probes.parity_pendingTransactions = false;
    }
  }

  // L2 fingerprint probes — run AFTER base probes to override family.
  // Order matters: check nitro first (also responds like geth in web3_clientVersion).
  let family: ExecutionClientFamily = normalizeExecutionFamily(version);
  let supportsL2SyncStatus = false;
  let l2SyncMethod: string | null = null;

  try {
    const res = await rpcCall(config.rpcUrl, 'arb_blockNumber', [], config.authToken, timeoutMs);
    if (res !== undefined && res !== null) {
      family = 'nitro-node';
      supportsL2SyncStatus = true;
      l2SyncMethod = 'arb_getL1BlockNumber';
      probes.arb_blockNumber = true;
      raw.arb_blockNumber = res;
    } else {
      probes.arb_blockNumber = false;
    }
  } catch {
    probes.arb_blockNumber = false;
  }

  if (!supportsL2SyncStatus) {
    try {
      const res = await rpcCall(config.rpcUrl, 'optimism_syncStatus', [], config.authToken, timeoutMs);
      if (res !== undefined && res !== null) {
        family = 'op-geth';
        supportsL2SyncStatus = true;
        l2SyncMethod = 'optimism_syncStatus';
        probes.optimism_syncStatus = true;
        raw.optimism_syncStatus = res;
      } else {
        probes.optimism_syncStatus = false;
      }
    } catch {
      probes.optimism_syncStatus = false;
    }
  }

  return {
    layer: 'execution',
    family,
    version,
    chainId,
    syncing,
    peerCount,
    supportsL2SyncStatus,
    l2SyncMethod,
    txpoolNamespace,
    probes,
    raw,
  };
}


