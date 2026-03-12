import {
  createAgentMarketplaceDispute,
  listAgentMarketplaceDisputes,
} from '@/lib/agent-marketplace/dispute-store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return Response.json({
    disputes: await listAgentMarketplaceDisputes(),
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();

  return Response.json(
    {
      dispute: await createAgentMarketplaceDispute({
        agentId: body.agentId,
        batchHash: body.batchHash,
        merkleRoot: body.merkleRoot,
        requestedScore: body.requestedScore,
        expectedScore: body.expectedScore,
        reason: body.reason,
      }),
    },
    {
      status: 201,
    }
  );
}
