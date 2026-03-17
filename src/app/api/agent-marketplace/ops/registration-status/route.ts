import { getRegistrationStatus } from '@/lib/agent-marketplace/registration-status';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const status = await getRegistrationStatus();
  return Response.json(status);
}
