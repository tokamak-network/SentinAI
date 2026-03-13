import { fetchFromRootApp, type Catalog } from '@/lib/agent-marketplace';

export const revalidate = 60; // ISR

export async function GET() {
  try {
    const catalog = await fetchFromRootApp<Catalog>(
      '/api/agent-marketplace/catalog'
    );
    return Response.json(catalog);
  } catch (error) {
    console.error('[catalog] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch catalog from root app',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
