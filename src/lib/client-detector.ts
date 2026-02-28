import type { ConnectionConfig, NodeType } from '@/core/types';

export type ClientLayer = 'execution' | 'consensus';

export type ExecutionClientFamily =
  | 'geth'
  | 'reth'
  | 'nethermind'
  | 'besu'
  | 'erigon'
  | 'unknown';

export type ConsensusClientFamily =
  | 'lighthouse'
  | 'prysm'
  | 'teku'
  | 'nimbus'
  | 'lodestar'
  | 'unknown';

export interface DetectedClient {
  layer: ClientLayer;
  /** Best-effort normalized family name */
  family: ExecutionClientFamily | ConsensusClientFamily;
  /** Best-effort version string (raw) */
  version?: string;
  /** Only for EVM JSON-RPC */
  chainId?: number;
  /** Best-effort syncing state */
  syncing?: boolean;
  /** Best-effort peer count */
  peerCount?: number;
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
  return 'unknown';
}

function normalizeConsensusFamily(version?: string): ConsensusClientFamily {
  const v = (version ?? '').toLowerCase();
  if (v.includes('lighthouse')) return 'lighthouse';
  if (v.includes('prysm')) return 'prysm';
  if (v.includes('teku')) return 'teku';
  if (v.includes('nimbus')) return 'nimbus';
  if (v.includes('lodestar')) return 'lodestar';
  return 'unknown';
}

function inferLayer(protocolId?: NodeType): ClientLayer | undefined {
  if (!protocolId) return undefined;
  if (protocolId === 'ethereum-cl') return 'consensus';
  return 'execution';
}

export async function detectClient(
  config: ConnectionConfig,
  options?: {
    protocolIdHint?: NodeType;
    timeoutMs?: number;
  }
): Promise<DetectedClient> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const hintedLayer = inferLayer(options?.protocolIdHint);

  if (hintedLayer === 'consensus' || config.beaconApiUrl) {
    return detectConsensusClient(config, timeoutMs);
  }

  // Default to EVM JSON-RPC
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

  // Optional txpool probe (best effort)
  try {
    const res = await rpcCall(config.rpcUrl, 'txpool_status', [], config.authToken, timeoutMs);
    probes.txpool_status = typeof res === 'object' && res !== null;
    raw.txpool_status = res;
  } catch {
    probes.txpool_status = false;
  }

  return {
    layer: 'execution',
    family: normalizeExecutionFamily(version),
    version,
    chainId,
    syncing,
    peerCount,
    probes,
    raw,
  };
}

export async function detectConsensusClient(
  config: ConnectionConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<DetectedClient> {
  const baseUrl = config.beaconApiUrl ?? config.rpcUrl;
  const probes: Record<string, boolean> = {};
  const raw: Record<string, unknown> = {};

  let version: string | undefined;
  try {
    const data = (await fetchJson(`${baseUrl}/eth/v1/node/version`, { method: 'GET' }, timeoutMs)) as {
      data?: { version?: string };
    };
    version = data.data?.version;
    probes['/eth/v1/node/version'] = !!version;
    raw['/eth/v1/node/version'] = data;
  } catch {
    probes['/eth/v1/node/version'] = false;
  }

  let syncing: boolean | undefined;
  try {
    const data = (await fetchJson(`${baseUrl}/eth/v1/node/syncing`, { method: 'GET' }, timeoutMs)) as {
      data?: { is_syncing?: boolean };
    };
    syncing = data.data?.is_syncing;
    probes['/eth/v1/node/syncing'] = typeof syncing === 'boolean';
    raw['/eth/v1/node/syncing'] = data;
  } catch {
    probes['/eth/v1/node/syncing'] = false;
  }

  let peerCount: number | undefined;
  try {
    const data = (await fetchJson(`${baseUrl}/eth/v1/node/peer_count`, { method: 'GET' }, timeoutMs)) as {
      data?: { connected?: string };
    };
    const connected = data.data?.connected;
    if (connected && /^[0-9]+$/.test(connected)) peerCount = Number.parseInt(connected, 10);
    probes['/eth/v1/node/peer_count'] = peerCount !== undefined;
    raw['/eth/v1/node/peer_count'] = data;
  } catch {
    probes['/eth/v1/node/peer_count'] = false;
  }

  return {
    layer: 'consensus',
    family: normalizeConsensusFamily(version),
    version,
    syncing,
    peerCount,
    probes,
    raw,
  };
}
