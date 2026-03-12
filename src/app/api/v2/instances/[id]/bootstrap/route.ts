/**
 * v2 Instance Bootstrap Endpoint
 * POST → Transition instance status from 'pending' to 'active'
 *
 * Idempotent: already-active instances return immediately.
 * Auth: requires SENTINAI_API_KEY if set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance, updateInstance } from '@/core/instance-registry';
import { getAgentOrchestrator } from '@/core/agent-orchestrator';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

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

/**
 * Start agents for an instance if not already running.
 */
function ensureAgentsRunning(instanceId: string, protocolId: string, rpcUrl: string): void {
  const orchestrator = getAgentOrchestrator();
  if (!orchestrator.isInstanceRunning(instanceId)) {
    orchestrator.startInstance(instanceId, protocolId, rpcUrl);
    logger.info(`[v2 bootstrap/${instanceId}] AgentOrchestrator started for instance`);
  }
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: 'Authentication failed.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    // Idempotent: already active is fine
    if (instance.status === 'active') {
      ensureAgentsRunning(id, instance.protocolId, instance.connectionConfig.rpcUrl);
      return NextResponse.json({
        data: {
          instanceId: id,
          status: 'active',
          bootstrappedAt: instance.updatedAt,
        },
        meta: meta(),
      });
    }

    const bootstrappedAt = new Date().toISOString();
    await updateInstance(id, { status: 'active' });
    ensureAgentsRunning(id, instance.protocolId, instance.connectionConfig.rpcUrl);

    logger.info(`[v2 bootstrap/${id}] Status transitioned to 'active'`);

    return NextResponse.json({
      data: {
        instanceId: id,
        status: 'active',
        bootstrappedAt,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 POST /instances/${id}/bootstrap] error:`, error);
    return NextResponse.json(
      { error: 'Bootstrap failed.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
