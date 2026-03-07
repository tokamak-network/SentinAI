export interface NormalizedSyncStatus {
  isSyncing: boolean;
  currentBlock: number | null;
  highestBlock: number | null;
  l2SafeBlock?: number | null;
  l1ReferenceBlock?: number | null;
}

/** Extract a value from a nested object using dot-notation path (e.g. "data.block.number") */
export function getValueByPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // Handle hex strings
    if (v.startsWith('0x') || v.startsWith('0X')) {
      const n = Number.parseInt(v, 16);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseStandard(raw: unknown): NormalizedSyncStatus {
  // eth_syncing: false (not syncing) or object { startingBlock, currentBlock, highestBlock }
  if (raw === false) {
    return { isSyncing: false, currentBlock: null, highestBlock: null };
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return {
      isSyncing: true,
      currentBlock: toNumber(obj.currentBlock),
      highestBlock: toNumber(obj.highestBlock),
    };
  }
  return { isSyncing: false, currentBlock: null, highestBlock: null };
}

function parseNethermind(raw: unknown): NormalizedSyncStatus {
  // Nethermind eth_syncing: false or { currentBlockNumber, highestBlockNumber, isSyncing }
  if (raw === false) {
    return { isSyncing: false, currentBlock: null, highestBlock: null };
  }
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    const isSyncing = obj.isSyncing === true;
    return {
      isSyncing,
      currentBlock: toNumber(obj.currentBlockNumber),
      highestBlock: toNumber(obj.highestBlockNumber),
    };
  }
  return { isSyncing: false, currentBlock: null, highestBlock: null };
}

function parseOpGeth(raw: unknown): NormalizedSyncStatus {
  // op-geth eth_syncing is standard; L2-specific data comes from optimism_syncStatus separately
  return parseStandard(raw);
}

function parseNitro(raw: unknown): NormalizedSyncStatus {
  // Arbitrum Nitro eth_syncing is also standard
  return parseStandard(raw);
}

function parseCustom(
  raw: unknown,
  paths: {
    currentBlockPath?: string;
    highestBlockPath?: string;
    isSyncingPath?: string;
  }
): NormalizedSyncStatus {
  if (raw === false) {
    return { isSyncing: false, currentBlock: null, highestBlock: null };
  }

  const isSyncingRaw = paths.isSyncingPath ? getValueByPath(raw, paths.isSyncingPath) : undefined;
  const isSyncing = isSyncingRaw !== undefined ? Boolean(isSyncingRaw) : raw !== false;

  const currentBlock = paths.currentBlockPath
    ? toNumber(getValueByPath(raw, paths.currentBlockPath))
    : null;

  const highestBlock = paths.highestBlockPath
    ? toNumber(getValueByPath(raw, paths.highestBlockPath))
    : null;

  return { isSyncing, currentBlock, highestBlock };
}

/**
 * Normalize an eth_syncing raw response into a standard SentinAI format.
 * Supports 5 parser types: standard, nethermind, op-geth, nitro, custom.
 */
export function parseSyncStatus(
  raw: unknown,
  parserType: 'standard' | 'nethermind' | 'op-geth' | 'nitro' | 'custom',
  customPaths?: {
    currentBlockPath?: string;
    highestBlockPath?: string;
    isSyncingPath?: string;
  }
): NormalizedSyncStatus {
  switch (parserType) {
    case 'standard':
      return parseStandard(raw);
    case 'nethermind':
      return parseNethermind(raw);
    case 'op-geth':
      return parseOpGeth(raw);
    case 'nitro':
      return parseNitro(raw);
    case 'custom':
      return parseCustom(raw, customPaths ?? {});
  }
}
