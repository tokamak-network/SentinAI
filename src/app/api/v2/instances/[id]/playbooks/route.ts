import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { listPlaybooks } from '@/core/playbook-system/store';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  const instance = await getInstance(id);
  if (!instance) {
    return NextResponse.json({ error: 'Instance not found.', code: 'NOT_FOUND' }, { status: 404 });
  }

  const playbooks = await listPlaybooks(id);
  return NextResponse.json({ data: { instanceId: id, playbooks }, meta: meta() });
}
