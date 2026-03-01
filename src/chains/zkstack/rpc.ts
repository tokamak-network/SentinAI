export type ZkstackMode = 'legacy-era' | 'os-preview';

export interface ZkstackRpcMethodMap {
  required: string[];
  optional: string[];
  settlement: string[];
  proof: string[];
}

const BASE_METHODS: ZkstackRpcMethodMap = {
  required: [
    'eth_chainId',
    'eth_blockNumber',
    'eth_getBlockByNumber',
    'eth_syncing',
  ],
  optional: [
    'net_peerCount',
    'txpool_status',
    'web3_clientVersion',
  ],
  settlement: [
    'zks_L1BatchNumber',
  ],
  proof: [
    'zks_getL1BatchDetails',
  ],
};

const MODE_OVERRIDES: Record<ZkstackMode, Partial<ZkstackRpcMethodMap>> = {
  'legacy-era': {
    settlement: ['zks_L1BatchNumber'],
    proof: ['zks_getL1BatchDetails'],
  },
  'os-preview': {
    settlement: ['zks_L1BatchNumber'],
    proof: ['zks_getL1BatchDetails'],
  },
};

export interface ZkstackRpcSnapshot {
  latestBlockNumber: number | null;
  l1BatchNumber: number | null;
  l1BatchTimestamp: number | null;
  l1TxCount: number | null;
}

function parseRpcNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  if (!value) return null;

  if (value.startsWith('0x')) {
    const parsedHex = Number.parseInt(value, 16);
    return Number.isFinite(parsedHex) ? parsedHex : null;
  }

  const parsedDec = Number.parseInt(value, 10);
  return Number.isFinite(parsedDec) ? parsedDec : null;
}

export function resolveZkstackMode(mode: string | undefined): ZkstackMode {
  const normalized = mode?.trim().toLowerCase();
  return normalized === 'os-preview' ? 'os-preview' : 'legacy-era';
}

export function getZkstackRpcMethodMap(mode: string | undefined): ZkstackRpcMethodMap {
  const resolvedMode = resolveZkstackMode(mode);
  const overrides = MODE_OVERRIDES[resolvedMode];

  return {
    required: [...BASE_METHODS.required],
    optional: [...BASE_METHODS.optional],
    settlement: [...(overrides.settlement || BASE_METHODS.settlement)],
    proof: [...(overrides.proof || BASE_METHODS.proof)],
  };
}

export function normalizeZkstackRpcSnapshot(raw: Record<string, unknown>): ZkstackRpcSnapshot {
  const l1BatchDetails = (raw.zks_getL1BatchDetails && typeof raw.zks_getL1BatchDetails === 'object')
    ? (raw.zks_getL1BatchDetails as Record<string, unknown>)
    : {};

  return {
    latestBlockNumber: parseRpcNumber(raw.eth_blockNumber),
    l1BatchNumber: parseRpcNumber(raw.zks_L1BatchNumber),
    l1BatchTimestamp: parseRpcNumber(l1BatchDetails.timestamp),
    l1TxCount: parseRpcNumber(l1BatchDetails.l1TxCount),
  };
}
