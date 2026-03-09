/**
 * v2 Instance RCA Endpoint
 * POST → Run Root Cause Analysis for a specific instance
 *
 * Delegates to the existing rca-engine with current global metrics/logs.
 * Returns RCAResult on success.
 *
 * Auth: requires SENTINAI_API_KEY if set.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getInstance } from '@/core/instance-registry';
import {
  performRCA,
  addRCAHistory,
} from '@/lib/rca-engine';
import { getRecentMetrics } from '@/lib/metrics-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { getAllLiveLogs, generateMockLogs } from '@/lib/log-ingester';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

function checkWriteAuth(request: NextRequest): boolean {
  const apiKey = process.env.SENTINAI_API_KEY;
  if (!apiKey) return true;

  const headerKey =
    request.headers.get('x-api-key') ??
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

  return headerKey === apiKey;
}

function meta() {
  return { timestamp: new Date().toISOString(), version: 'v2' };
}

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  request: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  if (!checkWriteAuth(request)) {
    return NextResponse.json(
      { error: 'Authentication failed.', code: 'UNAUTHORIZED' },
      { status: 401 }
    );
  }

  const { id } = await context.params;

  try {
    const instance = await getInstance(id);
    if (!instance) {
      return NextResponse.json(
        { error: 'Instance not found.', code: 'NOT_FOUND' },
        { status: 404 }
      );
    }

    logger.info(`[v2 rca/${id}] Starting RCA analysis`);
    const startTime = Date.now();

    // 1. Collect recent metrics
    const metrics = await getRecentMetrics();

    // 2. Detect anomalies
    let anomalies: ReturnType<typeof detectAnomalies> = [];
    if (metrics.length > 1) {
      const currentMetric = metrics[metrics.length - 1];
      const historyMetrics = metrics.slice(0, -1);
      anomalies = detectAnomalies(currentMetric, historyMetrics);
    }

    // 3. Collect logs
    let logs: Record<string, string>;
    try {
      logs = await getAllLiveLogs();
    } catch (logErr) {
      logger.warn(`[v2 rca/${id}] Log collection failed, using mock:`, logErr);
      logs = generateMockLogs('normal');
    }

    // 4. Perform RCA
    const result = await performRCA(anomalies, logs, metrics);
    await addRCAHistory(result, 'manual');

    logger.info(`[v2 rca/${id}] RCA complete in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      data: {
        instanceId: id,
        result,
      },
      meta: meta(),
    });
  } catch (error) {
    logger.error(`[v2 POST /instances/${id}/rca] error:`, error);
    return NextResponse.json(
      { error: 'RCA 분석에 실패했습니다.', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
