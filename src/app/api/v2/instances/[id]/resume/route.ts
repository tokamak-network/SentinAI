/**
 * v2 Instance Resume Endpoint
 * GET -> Agent resume (operational experience profile)
 *
 * Generates a public-facing profile from Experience Store and Pattern Extractor.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import { generateResume } from '@/lib/agent-resume';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    const resume = await generateResume(id, instance.protocolId);

    return NextResponse.json({
      data: resume,
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 GET /instances/${id}/resume] error:`, error);
    return NextResponse.json(
      { error: 'Failed to generate resume.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
