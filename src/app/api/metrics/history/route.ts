import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/redis-store';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Map duration strings to number of 1-minute data points */
const DURATION_MAP: Record<string, number> = {
  '15m': 15,
  '30m': 30,
  '1h': 60,
};

/**
 * GET /api/metrics/history?duration=15m|30m|1h
 *
 * Returns recent metrics from the ring buffer (max 60 data points at 1-minute intervals).
 * Default duration is 1h (all available data).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const duration = searchParams.get('duration') || '1h';

  const count = DURATION_MAP[duration];
  if (!count) {
    return NextResponse.json(
      { error: `Invalid duration. Supported: ${Object.keys(DURATION_MAP).join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const store = getStore();
    const metrics = await store.getRecentMetrics(count);

    return NextResponse.json({
      metrics,
      count: metrics.length,
      duration,
      maxAvailable: 60,
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Failed to fetch metrics history: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
