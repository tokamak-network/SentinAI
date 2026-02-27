/**
 * v2 Onboarding Complete Endpoint
 * POST → Idempotent single-call onboarding flow
 *
 * Steps:
 *   1. Validate RPC connection
 *   2. Create (or reuse) instance — idempotent by rpcUrl
 *   3. Detect capabilities
 *   4. Persist capabilities to Redis (inst:{id}:capabilities)
 *   5. Bootstrap: status 'pending' → 'active'
 *
 * Partial success is allowed; errors in steps 3-5 do not abort the response.
 *
 * Auth: requires SENTINAI_API_KEY if set.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listInstances,
  createInstance,
  updateInstance,
} from '@/core/instance-registry';
import { validateRpcConnection } from '@/core/collectors/connection-validator';
import { EvmExecutionCollector } from '@/core/collectors/evm-execution';
import { getCoreRedis } from '@/core/redis';
import type { NodeType, ConnectionConfig } from '@/core/types';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ============================================================
// Auth
// ============================================================

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;

  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return headerKey === apiKey;
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

// ============================================================
// Request body type
// ============================================================

interface OnboardingCompleteBody {
  nodeType: NodeType;
  connectionConfig: ConnectionConfig;
  label?: string;
  operatorId?: string;
}

// ============================================================
// POST /api/v2/onboarding/complete
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: '인증에 실패했습니다.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  let body: OnboardingCompleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바르지 않습니다.', code: 'BAD_REQUEST' },
      { status: 400 }
    );
  }

  if (!body.nodeType || !body.connectionConfig?.rpcUrl) {
    return NextResponse.json(
      {
        error: 'nodeType 과 connectionConfig.rpcUrl 은 필수 항목입니다.',
        code: 'VALIDATION_ERROR',
      },
      { status: 400 }
    );
  }

  const { nodeType, connectionConfig, label, operatorId } = body;
  const errors: string[] = [];

  // ── Step 1: Validate connection ──────────────────────────────
  logger.info('[v2 onboarding] Step 1: validating connection');
  const validation = await validateRpcConnection(connectionConfig).catch((err) => {
    errors.push(`Connection validation error: ${String(err)}`);
    return null;
  });

  if (!validation?.valid) {
    const detail = validation?.error ?? errors[0] ?? 'Connection failed';
    return NextResponse.json(
      {
        error: `RPC 연결 검증에 실패했습니다: ${detail}`,
        code: 'CONNECTION_FAILED',
        checks: validation?.checks ?? [],
      },
      { status: 422 }
    );
  }

  // ── Step 2: Find or create instance (idempotent by rpcUrl) ──
  logger.info('[v2 onboarding] Step 2: find or create instance');

  let instanceId: string;
  let isNew = false;

  const allInstances = await listInstances(operatorId).catch(() => []);
  const existing = allInstances.find(
    (inst) => inst.connectionConfig.rpcUrl === connectionConfig.rpcUrl
  );

  if (existing) {
    instanceId = existing.instanceId;
    logger.info(`[v2 onboarding] Reusing existing instance: ${instanceId}`);
  } else {
    const created = await createInstance({
      operatorId: operatorId ?? 'default',
      protocolId: nodeType,
      displayName: label ?? `Node (${nodeType})`,
      connectionConfig,
    });
    instanceId = created.instanceId;
    isNew = true;
    logger.info(`[v2 onboarding] Created new instance: ${instanceId}`);
  }

  // ── Step 3: Detect capabilities ─────────────────────────────
  logger.info('[v2 onboarding] Step 3: detecting capabilities');

  let detectedClient: string | undefined;
  let detectedCapabilities: Record<string, unknown> | undefined;

  try {
    const collector = new EvmExecutionCollector();
    const caps = await collector.detectCapabilities({
      instanceId,
      operatorId: operatorId ?? 'default',
      protocolId: nodeType,
      displayName: label ?? `Node (${nodeType})`,
      connectionConfig,
      status: 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    detectedClient = caps.clientVersion;
    detectedCapabilities = {
      clientFamily: caps.clientFamily,
      clientVersion: caps.clientVersion,
      chainId: caps.chainId,
      txpoolSupported: caps.txpoolSupported,
      adminPeersSupported: caps.adminPeersSupported,
      debugMetricsSupported: caps.debugMetricsSupported,
      availableMethods: caps.availableMethods,
    };

    // ── Step 4: Persist capabilities to Redis ────────────────
    logger.info('[v2 onboarding] Step 4: persisting capabilities');
    const redis = getCoreRedis();
    if (redis) {
      await redis.set(
        `inst:${instanceId}:capabilities`,
        JSON.stringify({
          ...detectedCapabilities,
          detectedAt: new Date().toISOString(),
        })
      );
    }
  } catch (capErr) {
    const msg = `Capability detection failed: ${String(capErr)}`;
    errors.push(msg);
    logger.warn(`[v2 onboarding] ${msg}`);
  }

  // ── Step 5: Bootstrap — transition to 'active' ───────────
  logger.info('[v2 onboarding] Step 5: bootstrapping instance');

  try {
    const current = allInstances.find((i) => i.instanceId === instanceId);
    if (!existing || current?.status === 'pending') {
      await updateInstance(instanceId, { status: 'active' });
    }
  } catch (bootErr) {
    const msg = `Bootstrap failed: ${String(bootErr)}`;
    errors.push(msg);
    logger.warn(`[v2 onboarding] ${msg}`);
  }

  // ── Response ─────────────────────────────────────────────
  return NextResponse.json({
    data: {
      instanceId,
      isNew,
      dashboardUrl: '/dashboard',
      detectedClient,
      detectedCapabilities,
      nextActions: [
        {
          action: 'set-policy',
          description: '자율 운영 수준을 단계적으로 승격하세요.',
          endpoint: `PATCH /api/v2/instances/${instanceId}/policy`,
        },
        {
          action: 'view-metrics',
          description: '실시간 메트릭을 확인하세요.',
          endpoint: `GET /api/v2/instances/${instanceId}/metrics`,
        },
      ],
      ...(errors.length > 0 && { warnings: errors }),
    },
    meta: meta(),
  });
}
