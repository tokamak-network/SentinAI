/**
 * GET /api/v2/config/ai-provider
 * Returns the currently configured AI provider and auth type.
 */

import { NextResponse } from 'next/server';
import { getProviderInfo } from '@/lib/ai-client';

export const dynamic = 'force-dynamic';

function getAnthropicAuthType(): 'apikey' | 'oauth' | null {
  if (process.env.ANTHROPIC_API_KEY) return 'apikey';
  if (process.env.ANTHROPIC_OAUTH_TOKEN) return 'oauth';
  return null;
}

export async function GET(): Promise<NextResponse> {
  const info = getProviderInfo();

  return NextResponse.json({
    provider: info?.provider ?? null,
    hasGateway: info?.hasGateway ?? false,
    anthropicAuthType: getAnthropicAuthType(),
    configured: info !== null,
  });
}
