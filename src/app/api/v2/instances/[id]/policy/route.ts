/**
 * v2 Instance Autonomy Policy Endpoint
 * GET   → Return current autonomy level
 * PATCH → Update autonomy level (stepwise promotion or demotion allowed)
 *
 * Levels (ordered):
 *   observe-only → plan-only → execute-with-approval → full-auto
 *
 * Auth: PATCH requires SENTINAI_API_KEY if set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance, updateInstance } from '@/core/instance-registry';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

// ============================================================
// Autonomy Level Definition
// ============================================================

type AutonomyLevel =
  | 'observe-only'
  | 'plan-only'
  | 'execute-with-approval'
  | 'full-auto';

const LEVEL_ORDER: AutonomyLevel[] = [
  'observe-only',
  'plan-only',
  'execute-with-approval',
  'full-auto',
];

const DEFAULT_LEVEL: AutonomyLevel = 'observe-only';

// ============================================================
// Helpers
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

/** Extract autonomy level stored in instance metadata */
function getAutonomyLevel(metadata?: Record<string, string>): AutonomyLevel {
  const stored = metadata?.autonomyLevel as AutonomyLevel | undefined;
  if (stored && LEVEL_ORDER.includes(stored)) return stored;
  return DEFAULT_LEVEL;
}

type RouteContext = { params: Promise<{ id: string }> };

// ============================================================
// GET /api/v2/instances/[id]/policy
// ============================================================

export async function GET(
  _request: NextRequest,
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

    const currentLevel = getAutonomyLevel(instance.metadata);

    return NextResponse.json({
      data: {
        instanceId: id,
        autonomyLevel: currentLevel,
        availableLevels: LEVEL_ORDER,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/policy] error:`, error);
    return NextResponse.json(
      { error: '정책 조회에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}

// ============================================================
// PATCH /api/v2/instances/[id]/policy
// ============================================================

export async function PATCH(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: '인증에 실패했습니다.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: '인스턴스를 찾을 수 없습니다.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    let body: { autonomyLevel?: string } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: '요청 본문이 올바르지 않습니다.', code: 'BAD_REQUEST' },
        { status: 400 }
      );
    }

    const targetLevel = body.autonomyLevel as AutonomyLevel | undefined;
    if (!targetLevel || !LEVEL_ORDER.includes(targetLevel)) {
      return NextResponse.json(
        {
          error: `autonomyLevel 은 다음 중 하나여야 합니다: ${LEVEL_ORDER.join(', ')}`,
          code: 'VALIDATION_ERROR',
        },
        { status: 400 }
      );
    }

    const currentLevel = getAutonomyLevel(instance.metadata);
    const currentIdx = LEVEL_ORDER.indexOf(currentLevel);
    const targetIdx = LEVEL_ORDER.indexOf(targetLevel);

    // Allow only single-step transitions in either direction
    if (Math.abs(targetIdx - currentIdx) > 1) {
      return NextResponse.json(
        {
          error: `단계적 변경만 허용됩니다. 현재: '${currentLevel}' → 가능한 다음 단계: '${LEVEL_ORDER[currentIdx - 1] ?? '없음'}', '${LEVEL_ORDER[currentIdx + 1] ?? '없음'}'`,
          code: 'INVALID_TRANSITION',
        },
        { status: 422 }
      );
    }

    await updateInstance(id, {
      metadata: { ...instance.metadata, autonomyLevel: targetLevel },
    });

    logger.info(`[v2 policy/${id}] Autonomy level changed: ${currentLevel} → ${targetLevel}`);

    return NextResponse.json({
      data: {
        instanceId: id,
        previousLevel: currentLevel,
        autonomyLevel: targetLevel,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 PATCH /instances/${id}/policy] error:`, error);
    return NextResponse.json(
      { error: '정책 변경에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
