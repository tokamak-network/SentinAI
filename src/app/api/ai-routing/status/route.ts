/**
 * AI Routing Status API
 * GET /api/ai-routing/status
 */

import { NextResponse } from 'next/server';
import { getRoutingStatus } from '@/lib/ai-routing';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const status = getRoutingStatus();
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /ai-routing/status] Error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
