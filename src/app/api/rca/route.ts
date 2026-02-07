/**
 * RCA API Endpoint
 * POST: Trigger RCA analysis
 * GET: Get RCA history
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  performRCA,
  addRCAHistory,
  getRCAHistory,
  getRCAHistoryCount,
} from '@/lib/rca-engine';
import { getRecentMetrics } from '@/lib/metrics-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import type { RCARequest, RCAResponse, RCAHistoryResponse } from '@/types/rca';

// Disable Next.js caching for this route
export const dynamic = 'force-dynamic';

/**
 * POST: Trigger RCA analysis
 */
export async function POST(request: NextRequest): Promise<NextResponse<RCAResponse>> {
  const startTime = Date.now();
  console.log('[API /rca] POST request received');

  try {
    // Parse request body
    let body: RCARequest = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is acceptable
    }

    const triggeredBy = body.autoTriggered ? 'auto' : 'manual';
    console.log(`[API /rca] Triggered by: ${triggeredBy}`);

    // 1. Collect recent metrics from MetricsStore
    const metrics = getRecentMetrics();
    console.log(`[API /rca] Collected ${metrics.length} metric data points`);

    // 2. Detect anomalies using the latest metrics
    let anomalies: ReturnType<typeof detectAnomalies> = [];
    if (metrics.length > 1) {
      const currentMetric = metrics[metrics.length - 1];
      const historyMetrics = metrics.slice(0, -1);
      anomalies = detectAnomalies(currentMetric, historyMetrics);
      console.log(`[API /rca] Detected ${anomalies.filter(a => a.isAnomaly).length} anomalies`);
    }

    // 3. Collect logs from all components
    let logs: Record<string, string>;
    try {
      logs = await getAllLiveLogs();
      console.log(`[API /rca] Collected logs from ${Object.keys(logs).length} components`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[API /rca] Failed to get live logs, using mock: ${errorMessage}`);
      logs = generateMockLogs('normal');
    }

    // 4. Perform RCA analysis
    const result = await performRCA(anomalies, logs, metrics);

    // 5. Add to history
    addRCAHistory(result, triggeredBy);

    console.log(`[API /rca] Analysis complete in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /rca] Error:', errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: 'RCA analysis failed',
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

/**
 * GET: Get RCA history
 */
export async function GET(request: NextRequest): Promise<NextResponse<RCAHistoryResponse>> {
  console.log('[API /rca] GET request received');

  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const limit = limitParam ? Math.min(parseInt(limitParam, 10), 20) : 10;

    const history = getRCAHistory(limit);
    const total = getRCAHistoryCount();

    return NextResponse.json({
      history,
      total,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API /rca] Error:', errorMessage);

    return NextResponse.json(
      {
        history: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}
