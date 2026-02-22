/**
 * AI Routing Policy API
 * GET /api/ai-routing/policy
 * POST /api/ai-routing/policy
 */

import { NextRequest, NextResponse } from 'next/server';
import { getRoutingPolicy, setRoutingPolicy } from '@/lib/ai-routing';
import type { RoutingPolicy } from '@/types/ai-routing';

export const dynamic = 'force-dynamic';

function getConfiguredApiKey(): string | null {
  const key = process.env.SENTINAI_API_KEY?.trim();
  return key ? key : null;
}

export function isAuthorizedPolicyMutation(request: NextRequest): boolean {
  const configuredKey = getConfiguredApiKey();
  if (!configuredKey) return false;
  const providedKey = request.headers.get('x-api-key');
  return providedKey === configuredKey;
}

export async function GET() {
  return NextResponse.json({
    policy: getRoutingPolicy(),
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorizedPolicyMutation(request)) {
      return NextResponse.json(
        { error: 'Unauthorized: policy update requires admin x-api-key' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const update: Partial<RoutingPolicy> = {};

    if (typeof body.name === 'string') update.name = body.name as RoutingPolicy['name'];
    if (typeof body.abPercent === 'number') update.abPercent = body.abPercent;
    if (typeof body.budgetUsdDaily === 'number') update.budgetUsdDaily = body.budgetUsdDaily;
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;

    const policy = setRoutingPolicy(update);
    return NextResponse.json({ success: true, policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /ai-routing/policy] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
