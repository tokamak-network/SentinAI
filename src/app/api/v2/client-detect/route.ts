import { NextResponse } from 'next/server';
import { detectExecutionClient } from '@/lib/client-detector';

export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'rpcUrl is required' }, { status: 400 });
  }

  const { rpcUrl } = (body as Record<string, unknown>) ?? {};
  if (!rpcUrl || typeof rpcUrl !== 'string' || rpcUrl.trim() === '') {
    return NextResponse.json({ error: 'rpcUrl is required' }, { status: 400 });
  }

  try {
    const result = await detectExecutionClient({ rpcUrl: rpcUrl.trim() });
    return NextResponse.json({
      data: {
        family: result.family,
        txpoolNamespace: result.txpoolNamespace,
        supportsL2SyncStatus: result.supportsL2SyncStatus,
        l2SyncMethod: result.l2SyncMethod,
        clientVersion: result.version ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: '감지 실패', detail: message }, { status: 500 });
  }
}
