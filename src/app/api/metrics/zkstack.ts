import { normalizeZkstackRpcSnapshot } from '@/chains/zkstack/rpc';

export interface ZkstackMetricFields {
  l1BatchNumber: number | null;
  l1BatchTimestamp: number | null;
  l1TxCount: number | null;
}

interface JsonRpcResponse {
  result?: unknown;
  error?: { message?: string };
}

async function rpcCall(url: string, method: string, params: unknown[], timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`rpc-http-${response.status}`);
    }

    const json = await response.json() as JsonRpcResponse;
    if (json.error) {
      throw new Error(json.error.message || `rpc-error-${method}`);
    }

    return json.result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchZkstackMetricFields(
  chainType: string,
  rpcUrl: string,
  timeoutMs: number
): Promise<Partial<ZkstackMetricFields>> {
  if (chainType !== 'zkstack') return {};

  const [batchNumber, batchDetails] = await Promise.allSettled([
    rpcCall(rpcUrl, 'zks_L1BatchNumber', [], timeoutMs),
    rpcCall(rpcUrl, 'zks_getL1BatchDetails', [0], timeoutMs),
  ]);

  const snapshot = normalizeZkstackRpcSnapshot({
    zks_L1BatchNumber: batchNumber.status === 'fulfilled' ? batchNumber.value : null,
    zks_getL1BatchDetails: batchDetails.status === 'fulfilled' ? batchDetails.value : null,
  });

  return {
    l1BatchNumber: snapshot.l1BatchNumber,
    l1BatchTimestamp: snapshot.l1BatchTimestamp,
    l1TxCount: snapshot.l1TxCount,
  };
}
