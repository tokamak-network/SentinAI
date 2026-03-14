/**
 * Test API: Record A/B test execution result
 * POST: Record success/failure for A/B test execution
 */

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Mock storage for A/B test results
const executionResults: Record<string, unknown>[] = [];

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const result = {
      id: `result-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      ...body,
    };

    executionResults.push(result);

    return NextResponse.json({
      success: true,
      result,
      totalResults: executionResults.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to record execution result', details: message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('sessionId');

    let results = executionResults;
    if (sessionId) {
      results = results.filter(
        (r: Record<string, unknown>) => r.sessionId === sessionId
      );
    }

    return NextResponse.json({
      count: results.length,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to retrieve results', details: message },
      { status: 500 }
    );
  }
}
