import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('fs');

import * as fs from 'fs';
import {
  loadCustomProfiles,
  getCustomProfile,
  mergeWithBuiltins,
} from '../client-profile/custom-profiles';
import type { ClientProfile } from '../client-profile/types';

const mockReadFileSync = vi.mocked(fs.readFileSync);

const BUILTIN_GETH: ClientProfile = {
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
  parsers: { syncStatus: { type: 'standard' }, txPool: 'txpool' },
  capabilities: {
    supportsTxPool: true,
    supportsPeerCount: true,
    supportsL2SyncStatus: false,
    supportsDebugNamespace: false,
  },
  customMetrics: [],
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadCustomProfiles', () => {
  it('returns [] when file not found', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(loadCustomProfiles()).toEqual([]);
  });

  it('returns [] when file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not-json' as unknown as Buffer);
    expect(loadCustomProfiles()).toEqual([]);
  });

  it('returns [] when file contains non-array JSON', () => {
    mockReadFileSync.mockReturnValue('{"key":"value"}' as unknown as Buffer);
    expect(loadCustomProfiles()).toEqual([]);
  });

  it('parses a valid JSON array', () => {
    const profiles = [
      {
        clientFamily: 'ethrex',
        detectPattern: 'ethrex',
        methods: { txPool: null, l2SyncStatus: null },
        capabilities: { supportsTxPool: false, supportsL2SyncStatus: false },
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(profiles) as unknown as Buffer);
    const result = loadCustomProfiles();
    expect(result).toHaveLength(1);
    expect(result[0].clientFamily).toBe('ethrex');
  });
});

describe('getCustomProfile', () => {
  it('returns the matching profile', () => {
    const profiles = [
      {
        clientFamily: 'ethrex',
        detectPattern: 'ethrex',
        methods: { txPool: null, l2SyncStatus: null },
        capabilities: { supportsTxPool: false, supportsL2SyncStatus: false },
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(profiles) as unknown as Buffer);
    const result = getCustomProfile('ethrex');
    expect(result?.clientFamily).toBe('ethrex');
  });

  it('returns undefined for unknown family', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(getCustomProfile('unknown-client')).toBeUndefined();
  });
});

describe('mergeWithBuiltins', () => {
  it('returns builtins unchanged when no custom profiles', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = mergeWithBuiltins({ geth: BUILTIN_GETH });
    expect(Object.keys(result)).toEqual(['geth']);
  });

  it('adds custom profiles to builtins map', () => {
    const profiles = [
      {
        clientFamily: 'ethrex',
        detectPattern: 'ethrex',
        methods: { txPool: null, l2SyncStatus: null },
        capabilities: { supportsTxPool: false, supportsL2SyncStatus: false },
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(profiles) as unknown as Buffer);
    const result = mergeWithBuiltins({ geth: BUILTIN_GETH });
    expect(Object.keys(result)).toContain('geth');
    expect(Object.keys(result)).toContain('ethrex');
    expect(result.ethrex.clientFamily).toBe('ethrex');
  });

  it('custom profile overrides builtin with same family name', () => {
    const profiles = [
      {
        clientFamily: 'geth',
        detectPattern: 'custom-geth',
        methods: { txPool: { method: 'custom_txpool' }, l2SyncStatus: null },
        capabilities: { supportsTxPool: true, supportsL2SyncStatus: false },
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(profiles) as unknown as Buffer);
    const result = mergeWithBuiltins({ geth: BUILTIN_GETH });
    expect(result.geth.methods.txPool?.method).toBe('custom_txpool');
  });

  it('maps txPool and l2SyncStatus methods correctly', () => {
    const profiles = [
      {
        clientFamily: 'my-client',
        detectPattern: 'my-client',
        methods: {
          txPool: { method: 'custom_txpool_status' },
          l2SyncStatus: { method: 'custom_syncStatus' },
        },
        capabilities: { supportsTxPool: true, supportsL2SyncStatus: true },
      },
    ];
    mockReadFileSync.mockReturnValue(JSON.stringify(profiles) as unknown as Buffer);
    const result = mergeWithBuiltins({});
    expect(result['my-client'].methods.txPool?.method).toBe('custom_txpool_status');
    expect(result['my-client'].methods.l2SyncStatus?.method).toBe('custom_syncStatus');
    expect(result['my-client'].capabilities.supportsTxPool).toBe(true);
    expect(result['my-client'].capabilities.supportsL2SyncStatus).toBe(true);
  });
});
