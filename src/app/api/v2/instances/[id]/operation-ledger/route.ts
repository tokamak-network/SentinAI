import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { listOperationLedger } from '@/core/playbook-system/store';

export const dynamic = 'force-dynamic';
type RouteContext = { params: Promise<{ id: string }> };

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const instance = await getInstance(id);
  if (!instance) {
    return NextResponse.json({ error: '인스턴스를 찾을 수 없습니다.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = Math.min(Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)), 200);
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const { records, total } = await listOperationLedger(id, { limit, offset });

  return NextResponse.json({
    data: {
      instanceId: id,
      records,
      total,
      limit,
      offset,
    },
    meta: meta(),
  });
}
