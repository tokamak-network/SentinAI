/**
 * L1 Node Metrics Collector
 * Collects L1 EVM node metrics, adapting to detected client capabilities.
 */

import type { DetectedClient } from '@/lib/client-detector';

export type L1DeploymentType = 'k8s' | 'docker' | 'external';

export interface L1NodeMetrics {
  /** Latest block number */
  blockHeight: number;
  /** Seconds between latest and parent block */
  blockInterval: number;
  /** Number of connected peers */
  peerCount: number;
  /** Whether the node is currently syncing */
  syncing: boolean;
  /** highestBlock - currentBlock; 0 when fully synced */
  syncGap: number;
  /** Pending transactions in mempool; -1 if unsupported by client */
  txPoolPending: number;
  /** Queued transactions in mempool; -1 if unsupported by client */
  txPoolQueued: number;
  /** Current base fee in wei (0n on pre-EIP-1559 chains) */
  baseFee: bigint;
  /** CPU usage percent; 0 if external deployment */
  cpuUsage: number;
  /** Memory usage percent; 0 if external deployment */
  memoryPercent: number;
}

interface RpcBlock {
  number: string;
  timestamp: string;
  baseFeePerGas?: string;
}

interface SyncStatus {
  currentBlock: string;
  highestBlock: string;
}

const RPC_TIMEOUT_MS = 8_000;

async function rpcCall(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
    });
    const data = await res.json() as { result?: unknown; error?: { message?: string } };
    if (data.error?.message) throw new Error(data.error.message);
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

async function getBlockHeight(url: string): Promise<number> {
  const hex = await rpcCall(url, 'eth_blockNumber') as string;
  return parseInt(hex, 16);
}

async function getBlock(url: string, tag: string | number): Promise<RpcBlock> {
  const param = typeof tag === 'number' ? `0x${tag.toString(16)}` : tag;
  return await rpcCall(url, 'eth_getBlockByNumber', [param, false]) as RpcBlock;
}

async function getPeerCount(url: string): Promise<number> {
  try {
    const hex = await rpcCall(url, 'net_peerCount') as string;
    return parseInt(hex, 16);
  } catch {
    return 0;
  }
}

async function getSyncStatus(url: string): Promise<{ syncing: boolean; syncGap: number }> {
  try {
    const result = await rpcCall(url, 'eth_syncing');
    if (!result) return { syncing: false, syncGap: 0 };
    const s = result as SyncStatus;
    const current = parseInt(s.currentBlock, 16);
    const highest = parseInt(s.highestBlock, 16);
    return { syncing: true, syncGap: Math.max(0, highest - current) };
  } catch {
    return { syncing: false, syncGap: 0 };
  }
}

async function getTxPool(
  url: string,
  namespace: DetectedClient['txpoolNamespace']
): Promise<{ pending: number; queued: number }> {
  if (!namespace) return { pending: -1, queued: -1 };
  try {
    if (namespace === 'txpool') {
      const status = await rpcCall(url, 'txpool_status') as { pending: string; queued: string };
      return {
        pending: parseInt(status.pending, 16),
        queued: parseInt(status.queued, 16),
      };
    }
    // parity namespace (Nethermind, Besu)
    const pending = await rpcCall(url, 'parity_pendingTransactions', [null]) as unknown[];
    const count = Array.isArray(pending) ? pending.length : Object.keys(pending as object).length;
    return { pending: count, queued: 0 };
  } catch {
    return { pending: -1, queued: -1 };
  }
}

/**
 * Collect L1 node metrics, adapting to the detected client's capabilities.
 *
 * @param rpcUrl         - HTTP RPC endpoint of the L1 node
 * @param client         - Result of detectExecutionClient()
 * @param deploymentType - Determines resource metric availability
 */
export async function collectL1NodeMetrics(
  rpcUrl: string,
  client: DetectedClient,
  deploymentType: L1DeploymentType
): Promise<L1NodeMetrics> {
  const blockHeight = await getBlockHeight(rpcUrl);
  const latestBlock = await getBlock(rpcUrl, 'latest');
  const parentBlock = await getBlock(rpcUrl, blockHeight - 1);

  const latestTs = parseInt(latestBlock.timestamp, 16);
  const parentTs = parseInt(parentBlock.timestamp, 16);
  const blockInterval = Math.max(0, latestTs - parentTs);
  const baseFee = latestBlock.baseFeePerGas ? BigInt(latestBlock.baseFeePerGas) : 0n;

  const [peerCount, syncStatus, txPool] = await Promise.all([
    getPeerCount(rpcUrl),
    getSyncStatus(rpcUrl),
    getTxPool(rpcUrl, client.txpoolNamespace),
  ]);

  // Resource metrics are injected by the calling context (K8s metrics API or Docker stats)
  const cpuUsage = deploymentType !== 'external' ? 0 : 0;
  const memoryPercent = deploymentType !== 'external' ? 0 : 0;

  return {
    blockHeight,
    blockInterval,
    peerCount,
    syncing: syncStatus.syncing,
    syncGap: syncStatus.syncGap,
    txPoolPending: txPool.pending,
    txPoolQueued: txPool.queued,
    baseFee,
    cpuUsage,
    memoryPercent,
  };
}
