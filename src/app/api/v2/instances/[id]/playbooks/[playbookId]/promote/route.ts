import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getPlaybook, upsertPlaybook } from '@/playbooks/learning/store';
import { APPROVED_THRESHOLD } from '@/playbooks/learning/config';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string; playbookId: string }> };

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;
  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return headerKey === apiKey;
}

/**
 * POST /api/v2/instances/:id/playbooks/:playbookId/promote
 * Kept for backward compatibility — promotes to 'approved' (same as /approve).
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json({ error: 'Authentication failed.', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { id, playbookId } = await context.params;
  const instance = await getInstance(id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const playbook = await getPlaybook(id, playbookId);
  if (!playbook) {
    return NextResponse.json({ error: '플레이북을 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 });
  }

  if (playbook.confidence < APPROVED_THRESHOLD) {
    return NextResponse.json(
      { error: `confidence ${APPROVED_THRESHOLD} 이상에서만 승격이 가능합니다.`, code: 'INVALID_STATE' },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const changedBy: 'operator' | 'agent' | 'system' = body.changedBy === 'agent' ? 'agent' : body.changedBy === 'system' ? 'system' : 'operator';

  const updated = {
    ...playbook,
    reviewStatus: 'approved' as const,
    evolution: {
      version: playbook.evolution.version + 1,
      changelog: [
        ...playbook.evolution.changelog,
        {
          version: playbook.evolution.version + 1,
          timestamp: new Date().toISOString(),
          reason: `Promoted to approved by ${changedBy}`,
          confidenceDelta: 0,
          changedBy,
        },
      ],
    },
  };

  await upsertPlaybook(id, updated);
  return NextResponse.json({ data: updated, meta: meta() });
}
