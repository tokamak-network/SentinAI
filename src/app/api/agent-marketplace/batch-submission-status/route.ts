import { getAgentMarketplaceService } from '@/lib/agent-marketplace/catalog';
import { composeBatchSubmissionStatusSnapshot } from '@/lib/agent-marketplace/batch-submission-status';
import { withX402 } from '@/lib/agent-marketplace/x402-middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return withX402(
    request,
    getAgentMarketplaceService('batch_submission_status'),
    async () => Response.json(await composeBatchSubmissionStatusSnapshot())
  );
}
