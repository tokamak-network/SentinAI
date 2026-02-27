/**
 * v2 Instances Collection Endpoint
 * GET  → List all instances (authToken masked)
 * POST → Register a new instance
 *
 * Auth: POST requires SENTINAI_API_KEY if set. GET is public.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  listInstances,
  createInstance,
} from '@/core/instance-registry';
import { maskConnectionConfig } from '@/core/security';
import type { CreateNodeInstanceDto, NodeInstance } from '@/core/types';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ============================================================
// Auth Helper
// ============================================================

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true; // no auth configured

  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return headerKey === apiKey;
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

// ============================================================
// GET /api/v2/instances
// ============================================================

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const operatorId = url.searchParams.get('operatorId') ?? undefined;

    const instances = await listInstances(operatorId);
    const masked = instances.map((inst: NodeInstance) => ({
      ...inst,
      connectionConfig: maskConnectionConfig(inst.connectionConfig),
    }));

    return NextResponse.json({ data: masked, meta: meta() });
  } catch (error) {
    logger.error('[v2 GET /instances] error:', error);
    return NextResponse.json(
      { error: '인스턴스 목록 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// ============================================================
// POST /api/v2/instances
// ============================================================

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: '인증에 실패했습니다.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  try {
    let body: CreateNodeInstanceDto;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '요청 본문이 올바르지 않습니다.', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }

    if (!body.protocolId || !body.displayName || !body.connectionConfig?.rpcUrl) {
      return NextResponse.json(
        {
          error: 'protocolId, displayName, connectionConfig.rpcUrl 은 필수 항목입니다.',
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const instance = await createInstance(body);
    const masked = {
      ...instance,
      connectionConfig: maskConnectionConfig(instance.connectionConfig),
    };

    return NextResponse.json({ data: masked, meta: meta() }, { status: 201 });
  } catch (error) {
    logger.error('[v2 POST /instances] error:', error);
    return NextResponse.json(
      { error: '인스턴스 생성에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
