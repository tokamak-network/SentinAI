export const dynamic = 'force-dynamic';

import { getDiscoveredAgents } from '@/lib/agent-marketplace/discovery';
import type { DiscoveryAgentsResponse } from '@/types/discovery';

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);

    const rawPage = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const rawPageSize = Number.parseInt(searchParams.get('pageSize') ?? '10', 10);

    const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
    const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(rawPageSize, 1), 50) : 10;

    const result = await getDiscoveredAgents({ page, pageSize });

    const body: DiscoveryAgentsResponse = {
      ok: true,
      agents: result.agents,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
      discoveredAt: result.discoveredAt,
    };

    return Response.json(body);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'Discovery agents failed' },
      { status: 500 }
    );
  }
}
