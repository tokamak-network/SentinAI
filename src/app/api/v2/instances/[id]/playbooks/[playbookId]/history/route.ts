import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { getPlaybook } from '@/core/playbook-system/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string; playbookId: string }> };

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

export async function GET(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id, playbookId } = await context.params;

  const instance = await getInstance(id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const playbook = await getPlaybook(id, playbookId);
  if (!playbook) {
    return NextResponse.json({ error: '플레이북을 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 });
  }

  return NextResponse.json({
    data: {
      instanceId: id,
      playbookId,
      confidence: playbook.confidence,
      reviewStatus: playbook.reviewStatus,
      performance: playbook.performance,
      timeline: playbook.evolution.changelog,
    },
    meta: meta(),
  });
}
