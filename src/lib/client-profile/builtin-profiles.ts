import type { ClientProfile } from './types';

export const BUILTIN_PROFILES: Record<string, ClientProfile> = {
  geth: {
    clientFamily: 'geth',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  reth: {
    clientFamily: 'reth',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  nethermind: {
    clientFamily: 'nethermind',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'parity_pendingTransactions', responsePath: 'result.length' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'nethermind' },
      txPool: 'parity',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  besu: {
    clientFamily: 'besu',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  erigon: {
    clientFamily: 'erigon',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: null,
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'standard' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: false,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  'op-geth': {
    clientFamily: 'op-geth',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: { method: 'optimism_syncStatus' },
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'op-geth' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: true,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },

  'nitro-node': {
    clientFamily: 'nitro-node',
    methods: {
      blockNumber: { method: 'eth_blockNumber' },
      syncStatus: { method: 'eth_syncing' },
      txPool: { method: 'txpool_status' },
      peerCount: { method: 'net_peerCount' },
      l2SyncStatus: { method: 'arb_getL1BlockNumber' },
      gasPrice: { method: 'eth_gasPrice' },
      chainId: { method: 'eth_chainId' },
    },
    parsers: {
      syncStatus: { type: 'nitro' },
      txPool: 'txpool',
    },
    capabilities: {
      supportsTxPool: true,
      supportsPeerCount: true,
      supportsL2SyncStatus: true,
      supportsDebugNamespace: false,
    },
    customMetrics: [],
  },
};
