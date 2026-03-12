import { buildAgentMarketplaceOpsSummary } from '@/lib/agent-marketplace/ops-summary';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const toIso = url.searchParams.get('toIso') ?? new Date().toISOString();
  const fromIso = url.searchParams.get('fromIso')
    ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  return Response.json(
    await buildAgentMarketplaceOpsSummary({
      fromIso,
      toIso,
    })
  );
}
