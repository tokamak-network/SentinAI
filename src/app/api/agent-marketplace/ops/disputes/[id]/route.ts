import {
  updateAgentMarketplaceDisputeStatus,
  type AgentMarketplaceDisputeStatus,
} from '@/lib/agent-marketplace/dispute-store';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
): Promise<Response> {
  const body = await request.json();
  const { id } = await context.params;

  return Response.json({
    dispute: await updateAgentMarketplaceDisputeStatus(
      id,
      body.status as AgentMarketplaceDisputeStatus
    ),
  });
}
