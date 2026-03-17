import { buildOpsSnapshot } from '@/lib/agent-marketplace/ops-snapshot';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const snapshot = await buildOpsSnapshot();
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Failed to build ops snapshot' },
      { status: 500 },
    );
  }
}
