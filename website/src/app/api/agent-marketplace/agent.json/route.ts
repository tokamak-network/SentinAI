import { fetchFromRootApp, type AgentManifest } from '@/lib/agent-marketplace';

export const revalidate = 60; // ISR

export async function GET() {
  try {
    const manifest = await fetchFromRootApp<AgentManifest>(
      '/api/agent-marketplace/agent.json'
    );
    return Response.json(manifest);
  } catch (error) {
    console.error('[agent.json] root app error:', error);
    return new Response(
      JSON.stringify({
        error: 'upstream_error',
        message: 'Failed to fetch agent manifest from root app',
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
