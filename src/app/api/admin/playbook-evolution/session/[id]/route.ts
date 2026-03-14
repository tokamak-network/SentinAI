/**
 * Admin Playbook Evolution Session Status API
 * GET: Return A/B test session status
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

// Mock session storage (shared with main endpoint)
const abSessions = new Map<
  string,
  {
    id: string;
    status: string;
    stats: {
      controlExecutions: number;
      testExecutions: number;
      controlSuccesses: number;
      testSuccesses: number;
    };
  }
>();

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const sessionId = id;

    // Note: In a real implementation, this would fetch from the same storage
    // as the main endpoint. For testing purposes, we return a mock response.
    const mockSession = {
      id: sessionId,
      status: 'running',
      stats: {
        controlExecutions: 20,
        testExecutions: 20,
        controlSuccesses: 14,
        testSuccesses: 18,
      },
    };

    return NextResponse.json({
      session: mockSession,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to retrieve session', details: message },
      { status: 500 }
    );
  }
}
