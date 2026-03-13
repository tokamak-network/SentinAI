import { NextRequest, NextResponse } from 'next/server';
import { loadFacilitatorConfig } from '@/lib/marketplace/facilitator/config';
import { getSettlement } from '@/lib/marketplace/facilitator/settlement-store';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const config = loadFacilitatorConfig();
    const internalAuth = request.headers.get('x-sentinai-internal-auth');
    if (!internalAuth || internalAuth !== config.internalAuthSecret) {
      return NextResponse.json({ error: 'Unauthorized facilitator request' }, { status: 401 });
    }

    const { id } = await context.params;
    const chainId = Number(request.nextUrl.searchParams.get('chainId') ?? '1');
    const settlement = await getSettlement(config.redisPrefix, chainId, id);
    if (!settlement) {
      return NextResponse.json({ error: 'Settlement not found' }, { status: 404 });
    }

    return NextResponse.json(settlement);
  } catch (error) {
    logger.error('[facilitator/settlements GET] error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch settlement' },
      { status: 500 }
    );
  }
}
