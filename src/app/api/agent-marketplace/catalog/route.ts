import { NextResponse } from 'next/server';
import {
  getAgentMarketplaceCatalog,
} from '@/lib/agent-marketplace/catalog';
import {
  toPublicAgentMarketplaceCatalogResponse,
} from '@/lib/agent-marketplace/catalog-response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    toPublicAgentMarketplaceCatalogResponse(getAgentMarketplaceCatalog())
  );
}
