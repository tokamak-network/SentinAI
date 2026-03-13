import { getAgentMarketplaceBatchHistory } from '@/lib/agent-marketplace/batch-history-store';

export const dynamic = 'force-dynamic';

function normalizeLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 10;
  }

  return Math.min(parsed, 50);
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const limit = normalizeLimit(url.searchParams.get('limit'));
  const history = await getAgentMarketplaceBatchHistory();

  return Response.json({
    limit,
    items: history.slice(0, limit),
  });
}
