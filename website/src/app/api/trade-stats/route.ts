import { getTradeStats } from '@/lib/trade-stats';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const stats = await getTradeStats();
  return Response.json(stats, {
    headers: { 'Cache-Control': 'public, s-maxage=300' },
  });
}
