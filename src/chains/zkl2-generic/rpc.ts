export type ZkL2Network = 'zkl2-generic' | 'scroll' | 'linea' | 'polygon-zkevm';

export interface ZkL2RpcMethodMap {
  required: string[];
  optional: string[];
  settlement: string[];
  proof: string[];
}

const BASE_METHODS: ZkL2RpcMethodMap = {
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
  settlement: [],
  proof: [],
};

const NETWORK_METHODS: Record<ZkL2Network, Partial<ZkL2RpcMethodMap>> = {
  'zkl2-generic': {
    settlement: ['eth_getBlockByNumber'],
    proof: [],
  },
  scroll: {
    settlement: ['rollup_getInfo'],
    proof: ['scroll_getBlockTraceByNumberOrHash'],
  },
  linea: {
    settlement: ['linea_getTransactionExclusionStatusV1'],
    proof: ['linea_getProof'],
  },
  'polygon-zkevm': {
    settlement: ['zkevm_batchNumber', 'zkevm_virtualBatchNumber'],
    proof: ['zkevm_verifiedBatchNumber'],
  },
};

export interface ZkL2RpcSnapshot {
  latestBlockNumber: number | null;
  settlementBatchNumber: number | null;
  virtualBatchNumber: number | null;
  verifiedBatchNumber: number | null;
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

export function resolveZkL2Network(chainType: string): ZkL2Network {
  const key = chainType.trim().toLowerCase();
  if (key === 'scroll') return 'scroll';
  if (key === 'linea') return 'linea';
  if (key === 'polygon-zkevm' || key === 'zkevm') return 'polygon-zkevm';
  return 'zkl2-generic';
}

export function getZkL2RpcMethodMap(chainType: string): ZkL2RpcMethodMap {
  const network = resolveZkL2Network(chainType);
  const overrides = NETWORK_METHODS[network];

  return {
    required: [...BASE_METHODS.required],
    optional: [...BASE_METHODS.optional],
    settlement: [...(overrides.settlement || [])],
    proof: [...(overrides.proof || [])],
  };
}

export function normalizeZkL2RpcSnapshot(chainType: string, raw: Record<string, unknown>): ZkL2RpcSnapshot {
  const network = resolveZkL2Network(chainType);

  if (network === 'polygon-zkevm') {
    return {
      latestBlockNumber: parseRpcNumber(raw.eth_blockNumber),
      settlementBatchNumber: parseRpcNumber(raw.zkevm_batchNumber),
      virtualBatchNumber: parseRpcNumber(raw.zkevm_virtualBatchNumber),
      verifiedBatchNumber: parseRpcNumber(raw.zkevm_verifiedBatchNumber),
    };
  }

  return {
    latestBlockNumber: parseRpcNumber(raw.eth_blockNumber),
    settlementBatchNumber: null,
    virtualBatchNumber: null,
    verifiedBatchNumber: null,
  };
}
