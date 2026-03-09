/**
 * v2 Instance ClientProfile Endpoint
 * GET → Returns the active ClientProfile for an instance.
 *
 * Resolution priority:
 * 1. SENTINAI_CLIENT_FAMILY env var → load that built-in profile + env overrides
 * 2. Detected family from Redis (inst:{id}:capabilities) → load built-in profile + env overrides
 * 3. Unknown fallback → minimal standard eth_* profile
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getCoreRedis } from '@/core/redis';
import { BUILTIN_PROFILES, buildClientProfileFromEnv, getClientFamilyFromEnv } from '@/lib/client-profile';
import type { ClientProfile } from '@/lib/client-profile';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

const UNKNOWN_PROFILE: ClientProfile = {
  clientFamily: 'unknown',
  methods: {
    blockNumber: { method: 'eth_blockNumber' },
    syncStatus: { method: 'eth_syncing' },
    txPool: null,
    peerCount: { method: 'net_peerCount' },
    l2SyncStatus: null,
    gasPrice: { method: 'eth_gasPrice' },
    chainId: { method: 'eth_chainId' },
  },
  parsers: {
    syncStatus: { type: 'standard' },
    txPool: null,
  },
  capabilities: {
    supportsTxPool: false,
    supportsPeerCount: true,
    supportsL2SyncStatus: false,
    supportsDebugNamespace: false,
  },
  customMetrics: [],
};

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // 1. SENTINAI_CLIENT_FAMILY env var takes priority
    const envFamily = getClientFamilyFromEnv();
    if (envFamily) {
      const base = BUILTIN_PROFILES[envFamily];
      const clientProfile = buildClientProfileFromEnv(base);
      return NextResponse.json({
        data: { instanceId: id, clientProfile, source: 'env' },
        meta: meta(),
      });
    }

    // 2. Try detected family from Redis
    const redis = getCoreRedis();
    if (redis) {
      try {
        const raw = await redis.get(`inst:${id}:capabilities`);
        if (raw) {
          const caps = JSON.parse(raw) as { detectedClient?: { family?: string } };
          const detectedFamily = caps.detectedClient?.family;
          if (detectedFamily && detectedFamily !== 'unknown') {
            const base = BUILTIN_PROFILES[detectedFamily];
            const clientProfile = buildClientProfileFromEnv(base);
            return NextResponse.json({
              data: { instanceId: id, clientProfile, source: 'detected' },
              meta: meta(),
            });
          }
        }
      } catch (err) {
        logger.warn({ err, instanceId: id }, 'Failed to read capabilities from Redis for profile endpoint');
      }
    }

    // 3. Unknown fallback
    const clientProfile = buildClientProfileFromEnv(UNKNOWN_PROFILE);
    return NextResponse.json({
      data: { instanceId: id, clientProfile, source: 'unknown' },
      meta: meta(),
    });
  } catch (err) {
    logger.error({ err, instanceId: id }, 'Profile endpoint error');
    return NextResponse.json({ error: '서버 오류', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
