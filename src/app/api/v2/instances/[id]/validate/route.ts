/**
 * v2 Instance Connection Validate Endpoint
 * POST → Test RPC/Beacon connectivity + auto-detect client + map capabilities
 *
 * body: { rpcUrl?: string, beaconUrl?: string }
 * Falls back to instance's connectionConfig when body fields are omitted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import {
  validateRpcConnection,
  validateBeaconConnection,
} from '@/core/collectors/connection-validator';
import type { ConnectionConfig } from '@/core/types';
import { getCoreRedis } from '@/core/redis';
import logger from '@/lib/logger';
import { detectClient } from '@/lib/client-detector';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: '인스턴스를 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Override connection config from request body (optional)
    let body: { rpcUrl?: string; beaconUrl?: string } = {};
    try {
      body = await request.json();
    } catch {
      // empty body OK
    }

    const connectionConfig: ConnectionConfig = {
      ...instance.connectionConfig,
      ...(body.rpcUrl && { rpcUrl: body.rpcUrl }),
      ...(body.beaconUrl && { beaconApiUrl: body.beaconUrl }),
    };

    const isBeaconProtocol = instance.protocolId === 'ethereum-cl';

    const validationResult = isBeaconProtocol
      ? await validateBeaconConnection(connectionConfig)
      : await validateRpcConnection(connectionConfig);

    let detectedClient: unknown;
    let mappedCapabilities: unknown;

    if (validationResult.valid) {
      try {
        const detected = await detectClient(connectionConfig, {
          protocolIdHint: instance.protocolId,
        });
        const mapped = mapDetectedClientToCapabilities(detected, instance.protocolId);

        detectedClient = detected;
        mappedCapabilities = mapped;

        const redis = getCoreRedis();
        if (redis) {
          await redis.set(
            `inst:${id}:capabilities`,
            JSON.stringify({
              detectedAt: new Date().toISOString(),
              detectedClient: detected,
              mapped,
              clientVersion: validationResult.clientVersion,
              chainId: validationResult.chainId,
            })
          );
        }
      } catch (capErr) {
        logger.warn(`[v2 validate/${id}] Auto-detect failed:`, capErr);
      }
    }

    return NextResponse.json({
      data: {
        valid: validationResult.valid,
        clientVersion: validationResult.clientVersion,
        chainId: validationResult.chainId,
        detectedClient,
        mappedCapabilities,
        checks: validationResult.checks,
        totalLatencyMs: validationResult.totalLatencyMs,
        error: validationResult.error,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 POST /instances/${id}/validate] error:`, error);
    return NextResponse.json(
      { error: '연결 검증에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
