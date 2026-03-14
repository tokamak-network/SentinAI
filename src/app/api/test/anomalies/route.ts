/**
 * Test API: Trigger anomalies
 * POST: Create mock anomaly for E2E testing
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Mock storage for test anomalies
const testAnomalies: Record<string, unknown>[] = [];

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const anomalyType = body.anomalyType as string;
    const severity = (body.severity as string) || 'medium';

    const anomaly = {
      id: `anomaly-${Date.now()}-${Math.random()}`,
      type: anomalyType,
      severity,
      timestamp: new Date().toISOString(),
    };

    testAnomalies.push(anomaly);

    return NextResponse.json(anomaly);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Failed to trigger anomaly', details: message },
      { status: 500 }
    );
  }
}
