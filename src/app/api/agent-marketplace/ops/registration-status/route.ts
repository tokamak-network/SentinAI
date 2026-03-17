import { getRegistrationStatus } from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const wallet = url.searchParams.get('wallet') ?? undefined;
  const status = await getRegistrationStatus(wallet);
  return Response.json(status);
}
