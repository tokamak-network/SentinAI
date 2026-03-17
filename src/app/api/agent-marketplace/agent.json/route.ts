import { getAgentMarketplaceCatalogWithOverrides } from '@/lib/agent-marketplace/catalog';
import { toAgentMarketplaceAgentManifest } from '@/lib/agent-marketplace/catalog-response';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const catalog = await getAgentMarketplaceCatalogWithOverrides();
  return Response.json(toAgentMarketplaceAgentManifest(catalog));
}
