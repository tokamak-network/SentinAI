import {
  updateAgentMarketplaceDisputeStatus,
  type AgentMarketplaceDisputeStatus,
} from '@/lib/agent-marketplace/dispute-store';

export const dynamic = 'force-dynamic';

async function updateDispute(
  id: string,
  status: AgentMarketplaceDisputeStatus,
  metadata?: {
    reviewedBy?: string;
    reviewerNote?: string;
  }
) {
  return updateAgentMarketplaceDisputeStatus(id, status, metadata);
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
): Promise<Response> {
  const body = await request.json();
  const { id } = await context.params;

  return Response.json({
    dispute: await updateDispute(id, body.status as AgentMarketplaceDisputeStatus, {
      reviewedBy: body.reviewedBy,
      reviewerNote: body.reviewerNote,
    }),
  });
}

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string }>;
  }
): Promise<Response> {
  const formData = await request.formData();
  const { id } = await context.params;
  const redirectTo = String(formData.get('redirectTo') ?? `/v2/marketplace?dispute=${id}`);

  await updateDispute(id, String(formData.get('status')) as AgentMarketplaceDisputeStatus, {
    reviewedBy: String(formData.get('reviewedBy') ?? ''),
    reviewerNote: String(formData.get('reviewerNote') ?? ''),
  });

  return Response.redirect(new URL(redirectTo, request.url), 303);
}
