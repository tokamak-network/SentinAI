/**
 * NLOps API Endpoint
 * POST: Process natural language commands
 * GET: Health check & info
 */

import { NextRequest, NextResponse } from 'next/server';
import { processCommand, isNLOpsEnabled } from '@/lib/nlops-engine';
import type { NLOpsRequest, NLOpsResponse } from '@/types/nlops';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse<NLOpsResponse | { error: string }>> {
  if (!isNLOpsEnabled()) {
    return NextResponse.json(
      { error: 'NLOps is disabled. Set NLOPS_ENABLED=true to enable.' },
      { status: 503 }
    );
  }

  try {
    const body: NLOpsRequest = await request.json();
    const { message, confirmAction } = body;

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }
    if (message.trim().length === 0) {
      return NextResponse.json({ error: 'Message cannot be empty' }, { status: 400 });
    }
    if (message.length > 500) {
      return NextResponse.json({ error: 'Message is too long (max 500 characters)' }, { status: 400 });
    }

    const baseUrl = getBaseUrl(request);
    const response = await processCommand(message, baseUrl, confirmAction);

    return NextResponse.json(response);
  } catch (error) {
    console.error('[NLOps API] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return NextResponse.json(
      {
        error: 'Failed to process command',
        intent: { type: 'unknown' as const, originalInput: '' },
        executed: false,
        response: `An error occurred while processing the command: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}

function getBaseUrl(request: NextRequest): string {
  const url = new URL(request.url);
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
  return `${url.protocol}//${url.host}${basePath}`;
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    enabled: isNLOpsEnabled(),
    version: '1.0.0',
    supportedIntents: ['query', 'scale', 'analyze', 'config', 'explain', 'rca'],
    supportedLanguages: ['ko', 'en'],
  });
}
