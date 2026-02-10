/**
 * Metrics Seed API Endpoint
 * POST: Inject scenario-based time-series data into MetricsStore
 * Used for testing Predictive Scaling without real RPC/K8s connections
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushMetric, clearMetrics, getRecentMetrics, getMetricsCount } from '@/lib/metrics-store';
import { resetPredictionState } from '@/lib/predictive-scaler';
import { MetricDataPoint } from '@/types/prediction';

export const dynamic = 'force-dynamic';

type Scenario = 'stable' | 'rising' | 'spike' | 'falling' | 'live';

const VALID_SCENARIOS: Scenario[] = ['stable', 'rising', 'spike', 'falling', 'live'];
const LIVE_MIN_DATA_POINTS = 20;

/**
 * Linear interpolation between two values
 */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Add random jitter to a value
 */
function jitter(value: number, range: number): number {
  return value + (Math.random() - 0.5) * 2 * range;
}

/**
 * Generate scenario-specific data points
 */
function generateScenarioData(scenario: Scenario): MetricDataPoint[] {
  const points: MetricDataPoint[] = [];
  const count = 20;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 to 1
    const timestamp = new Date(now - (count - 1 - i) * 60_000).toISOString();

    let cpuUsage: number;
    let txPoolPending: number;
    let gasUsedRatio: number;
    let blockInterval: number;

    switch (scenario) {
      case 'stable':
        cpuUsage = jitter(20, 5);
        txPoolPending = Math.round(jitter(20, 10));
        gasUsedRatio = jitter(0.15, 0.05);
        blockInterval = jitter(2.0, 0.3);
        break;

      case 'rising':
        cpuUsage = jitter(lerp(15, 50, t), 3);
        txPoolPending = Math.round(jitter(lerp(10, 80, t), 10));
        gasUsedRatio = jitter(lerp(0.10, 0.45, t), 0.03);
        blockInterval = jitter(lerp(2.0, 2.8, t), 0.2);
        break;

      case 'spike':
        if (i < count - 5) {
          cpuUsage = jitter(30, 3);
          txPoolPending = Math.round(jitter(50, 15));
          gasUsedRatio = jitter(0.25, 0.05);
          blockInterval = jitter(2.0, 0.2);
        } else {
          cpuUsage = jitter(95, 2);
          txPoolPending = Math.round(jitter(5000, 500));
          gasUsedRatio = jitter(0.95, 0.03);
          blockInterval = jitter(6.0, 1.0);
        }
        break;

      case 'falling':
        cpuUsage = jitter(lerp(80, 20, t), 3);
        txPoolPending = Math.round(jitter(lerp(300, 20, t), 10));
        gasUsedRatio = jitter(lerp(0.75, 0.15, t), 0.03);
        blockInterval = jitter(lerp(4.0, 2.0, t), 0.2);
        break;

      default:
        cpuUsage = jitter(20, 5);
        txPoolPending = Math.round(jitter(20, 10));
        gasUsedRatio = jitter(0.15, 0.05);
        blockInterval = jitter(2.0, 0.3);
        break;
    }

    // Clamp values to valid ranges
    cpuUsage = Math.max(0, Math.min(100, cpuUsage));
    txPoolPending = Math.max(0, txPoolPending);
    gasUsedRatio = Math.max(0, Math.min(1, gasUsedRatio));
    blockInterval = Math.max(0.5, blockInterval);

    points.push({
      timestamp,
      cpuUsage: Number(cpuUsage.toFixed(2)),
      txPoolPending,
      gasUsedRatio: Number(gasUsedRatio.toFixed(4)),
      blockHeight: 12_500_000 + i * 30,
      blockInterval: Number(blockInterval.toFixed(2)),
      currentVcpu: 1,
    });
  }

  return points;
}

/**
 * POST /api/metrics/seed?scenario=rising
 * Injects mock time-series data into MetricsStore
 */
export async function POST(request: NextRequest) {
  // Block in production to prevent data corruption
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is only available in development mode' },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const scenario = url.searchParams.get('scenario') as Scenario | null;

  if (!scenario || !VALID_SCENARIOS.includes(scenario)) {
    return NextResponse.json(
      {
        error: `Invalid scenario. Must be one of: ${VALID_SCENARIOS.join(', ')}`,
        validScenarios: VALID_SCENARIOS,
      },
      { status: 400 }
    );
  }

  // Live scenario: use existing real data in MetricsStore
  if (scenario === 'live') {
    const count = await getMetricsCount();
    if (count < LIVE_MIN_DATA_POINTS) {
      return NextResponse.json(
        {
          error: `Insufficient data for live prediction: ${count}/${LIVE_MIN_DATA_POINTS} points. Wait for more metrics to accumulate.`,
          currentCount: count,
          requiredCount: LIVE_MIN_DATA_POINTS,
        },
        { status: 400 }
      );
    }

    // Only reset prediction cache, keep real data intact
    await resetPredictionState();

    const liveData = await getRecentMetrics();
    return NextResponse.json({
      success: true,
      scenario: 'live',
      dataPointCount: count,
      timeRange: {
        from: liveData[0]?.timestamp || null,
        to: liveData[liveData.length - 1]?.timestamp || null,
      },
      summary: {
        cpuRange: `${Math.min(...liveData.map(d => d.cpuUsage)).toFixed(1)}% - ${Math.max(...liveData.map(d => d.cpuUsage)).toFixed(1)}%`,
        txPoolRange: `${Math.min(...liveData.map(d => d.txPoolPending))} - ${Math.max(...liveData.map(d => d.txPoolPending))}`,
      },
    });
  }

  // Mock scenarios: clear existing data and inject generated data
  await clearMetrics();
  await resetPredictionState();

  const dataPoints = generateScenarioData(scenario);
  for (const point of dataPoints) {
    await pushMetric(point);
  }

  return NextResponse.json({
    success: true,
    scenario,
    injectedCount: dataPoints.length,
    timeRange: {
      from: dataPoints[0].timestamp,
      to: dataPoints[dataPoints.length - 1].timestamp,
    },
    summary: {
      cpuRange: `${Math.min(...dataPoints.map(d => d.cpuUsage)).toFixed(1)}% - ${Math.max(...dataPoints.map(d => d.cpuUsage)).toFixed(1)}%`,
      txPoolRange: `${Math.min(...dataPoints.map(d => d.txPoolPending))} - ${Math.max(...dataPoints.map(d => d.txPoolPending))}`,
    },
  });
}
