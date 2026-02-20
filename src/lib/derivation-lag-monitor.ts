/**
 * Derivation Lag Monitor
 * Uses optimism_syncStatus to detect L1 derivation delay.
 */

import { createPublicClient, http } from 'viem';
import type { Chain } from 'viem';
import type { DerivationLagResult, LagLevel, SyncStatus } from '@/types/derivation';

const DEFAULT_THRESHOLDS = {
  warning: parseInt(process.env.DERIVATION_LAG_WARNING || '30', 10),
  critical: parseInt(process.env.DERIVATION_LAG_CRITICAL || '120', 10),
  emergency: parseInt(process.env.DERIVATION_LAG_EMERGENCY || '600', 10),
};

function hexToNumber(value?: string): number | null {
  if (!value) return null;
  const normalized = value.startsWith('0x') ? value : `0x${value}`;
  const n = Number.parseInt(normalized, 16);
  return Number.isNaN(n) ? null : n;
}

export function getLagLevel(lag: number | null): LagLevel {
  if (lag === null || lag < 0) return 'unknown';
  if (lag >= DEFAULT_THRESHOLDS.emergency) return 'emergency';
  if (lag >= DEFAULT_THRESHOLDS.critical) return 'critical';
  if (lag >= DEFAULT_THRESHOLDS.warning) return 'warning';
  return 'normal';
}

export async function getSyncStatus(rpcUrl: string, timeoutMs: number = 10_000): Promise<SyncStatus | null> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'optimism_syncStatus',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    });
    const payload = await response.json();
    return payload?.result || null;
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function checkDerivationLag(rpcUrl: string): Promise<DerivationLagResult> {
  const checkedAt = new Date().toISOString();
  const syncStatus = await getSyncStatus(rpcUrl);
  if (!syncStatus) {
    return {
      available: false,
      lag: null,
      level: 'unknown',
      currentL1: null,
      headL1: null,
      unsafeL2: null,
      safeL2: null,
      finalizedL2: null,
      checkedAt,
      message: 'optimism_syncStatus 응답이 없어 derivation lag를 계산하지 못했습니다.',
    };
  }

  const currentL1 = hexToNumber(syncStatus.current_l1?.number);
  const headL1 = hexToNumber(syncStatus.head_l1?.number);
  const unsafeL2 = hexToNumber(syncStatus.unsafe_l2?.number);
  const safeL2 = hexToNumber(syncStatus.safe_l2?.number);
  const finalizedL2 = hexToNumber(syncStatus.finalized_l2?.number);

  const lag = (currentL1 !== null && headL1 !== null) ? Math.max(0, headL1 - currentL1) : null;
  const level = getLagLevel(lag);

  return {
    available: true,
    lag,
    level,
    currentL1,
    headL1,
    unsafeL2,
    safeL2,
    finalizedL2,
    checkedAt,
  };
}

export async function isL1Healthy(
  l1RpcUrl: string,
  l1Chain: Chain
): Promise<{ healthy: boolean; responseTimeMs: number }> {
  const started = Date.now();
  try {
    const client = createPublicClient({ chain: l1Chain, transport: http(l1RpcUrl, { timeout: 10_000 }) });
    await client.getBlockNumber();
    const responseTimeMs = Date.now() - started;
    return { healthy: responseTimeMs < 5000, responseTimeMs };
  } catch {
    return { healthy: false, responseTimeMs: Date.now() - started };
  }
}

