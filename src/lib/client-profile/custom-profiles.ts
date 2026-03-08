import * as fs from 'fs';
import type { ClientProfile } from './types';

export interface CustomClientProfile {
  clientFamily: string;
  detectPattern: string;
  methods: {
    txPool?: { method: string } | null;
    l2SyncStatus?: { method: string } | null;
  };
  capabilities: {
    supportsTxPool: boolean;
    supportsL2SyncStatus: boolean;
  };
}

function getProfilesPath(): string {
  return process.env.CLIENT_PROFILES_PATH ?? './client-profiles.json';
}

export function loadCustomProfiles(): CustomClientProfile[] {
  const filePath = getProfilesPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as CustomClientProfile[];
  } catch {
    return [];
  }
}

export function getCustomProfile(family: string): CustomClientProfile | undefined {
  return loadCustomProfiles().find((p) => p.clientFamily === family);
}

export function mergeWithBuiltins(
  builtins: Record<string, ClientProfile>,
): Record<string, ClientProfile> {
  const customs = loadCustomProfiles();
  if (customs.length === 0) return builtins;

  const merged: Record<string, ClientProfile> = { ...builtins };

  for (const custom of customs) {
    const txPoolMethod = custom.methods.txPool?.method ?? null;
    const l2SyncMethod = custom.methods.l2SyncStatus?.method ?? null;

    merged[custom.clientFamily] = {
      clientFamily: custom.clientFamily,
      methods: {
        blockNumber: { method: 'eth_blockNumber' },
        syncStatus: { method: 'eth_syncing' },
        txPool: txPoolMethod ? { method: txPoolMethod } : null,
        peerCount: { method: 'net_peerCount' },
        l2SyncStatus: l2SyncMethod ? { method: l2SyncMethod } : null,
        gasPrice: { method: 'eth_gasPrice' },
        chainId: { method: 'eth_chainId' },
      },
      parsers: {
        syncStatus: { type: 'standard' },
        txPool: txPoolMethod ? 'txpool' : null,
      },
      capabilities: {
        supportsTxPool: custom.capabilities.supportsTxPool,
        supportsPeerCount: false,
        supportsL2SyncStatus: custom.capabilities.supportsL2SyncStatus,
        supportsDebugNamespace: false,
      },
      customMetrics: [],
    };
  }

  return merged;
}
