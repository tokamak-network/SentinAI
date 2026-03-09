/**
 * v2 Onboarding Complete Endpoint
 * POST → Idempotent single-call onboarding flow
 *
 * Steps:
 *   1. Validate RPC/Beacon connection
 *   2. Create (or reuse) instance — idempotent by rpcUrl
 *   3. Auto-detect client
 *   4. Map + persist capabilities to Redis (inst:{id}:capabilities)
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
import { getCoreRedis } from '@/core/redis';
import type { NodeType, ConnectionConfig } from '@/core/types';
import logger from '@/lib/logger';
import { detectClient } from '@/lib/client-detector';
import { mapDetectedClientToCapabilities } from '@/lib/capability-mapper';

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

function normalizeForMatch(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.replace(/\/+$/, '').toLowerCase();
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
      { error: 'Authentication failed.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  let body: OnboardingCompleteBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body.', code: 'BAD_REQUEST' },
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
  const effectiveOperatorId = operatorId ?? 'default';
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

  const allInstances = await listInstances(effectiveOperatorId).catch(() => []);
  const endpoint = normalizeForMatch(connectionConfig.rpcUrl) ?? normalizeForMatch(connectionConfig.beaconApiUrl);
  const existing = allInstances.find((inst) => {
    if (inst.protocolId !== nodeType) return false;
    const existingEndpoint = normalizeForMatch(inst.connectionConfig.rpcUrl)
      ?? normalizeForMatch(inst.connectionConfig.beaconApiUrl);
    return !!endpoint && existingEndpoint === endpoint;
  });

  if (existing) {
    instanceId = existing.instanceId;
    logger.info(`[v2 onboarding] Reusing existing instance: ${instanceId}`);
  } else {
    const created = await createInstance({
      operatorId: effectiveOperatorId,
      protocolId: nodeType,
      displayName: label ?? `Node (${nodeType})`,
      connectionConfig,
    });
    instanceId = created.instanceId;
    isNew = true;
    logger.info(`[v2 onboarding] Created new instance: ${instanceId}`);
  }

  // ── Step 3: Auto-detect client ─────────────────────────────
  logger.info('[v2 onboarding] Step 3: auto-detecting client');

  let detectedClient: unknown;
  let mappedCapabilities: unknown;

  try {
    const detected = await detectClient(connectionConfig, { protocolIdHint: nodeType });
    const mapped = mapDetectedClientToCapabilities(detected, nodeType);

    detectedClient = detected;
    mappedCapabilities = mapped;

    // ── Step 4: Persist capabilities to Redis ────────────────
    logger.info('[v2 onboarding] Step 4: persisting capabilities');
    const redis = getCoreRedis();
    if (redis) {
      await redis.set(
        `inst:${instanceId}:capabilities`,
        JSON.stringify({
          detectedAt: new Date().toISOString(),
          detectedClient: detected,
          mapped,
          clientVersion: validation.clientVersion,
          chainId: validation.chainId,
        })
      );
    }
  } catch (capErr) {
    const msg = `Auto-detect failed: ${String(capErr)}`;
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
      dashboardUrl: '/v2',
      detectedClient,
      mappedCapabilities,
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
