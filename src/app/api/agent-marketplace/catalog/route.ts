import { NextResponse } from 'next/server';
import {
  getAgentMarketplaceCatalogWithOverrides,
} from '@/lib/agent-marketplace/catalog';
import {
  toPublicAgentMarketplaceCatalogResponse,
} from '@/lib/agent-marketplace/catalog-response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const catalog = await getAgentMarketplaceCatalogWithOverrides();
  return NextResponse.json(toPublicAgentMarketplaceCatalogResponse(catalog));
}
