export interface RpcMethodConfig {
  method: string;
  params?: unknown[];
  /** Dot-notation path to extract value from response (e.g. "result.pending") */
  responsePath?: string;
  /** Default value when method is unsupported or returns null */
  fallback?: unknown;
}

export interface SyncStatusParser {
  type: 'standard' | 'nethermind' | 'op-geth' | 'nitro' | 'custom';
  /** Only used when type='custom': dot-notation paths to extract fields */
  currentBlockPath?: string;
  highestBlockPath?: string;
  isSyncingPath?: string;
}

export interface CustomMetricConfig {
  name: string;
  displayName: string;
  method: string;
  params?: unknown[];
  responsePath: string;
  unit?: string;
}

export interface ClientProfile {
  clientFamily: string;
  methods: {
    blockNumber: RpcMethodConfig;
    syncStatus: RpcMethodConfig;
    txPool: RpcMethodConfig | null;
    peerCount: RpcMethodConfig | null;
    l2SyncStatus: RpcMethodConfig | null;
    gasPrice: RpcMethodConfig;
    chainId: RpcMethodConfig;
  };
  parsers: {
    syncStatus: SyncStatusParser;
    txPool: 'txpool' | 'parity' | 'custom' | null;
  };
  capabilities: {
    supportsTxPool: boolean;
    supportsPeerCount: boolean;
    supportsL2SyncStatus: boolean;
    supportsDebugNamespace: boolean;
  };
  customMetrics: CustomMetricConfig[];
}
