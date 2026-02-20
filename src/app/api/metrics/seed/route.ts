/**
 * Metrics Seed API Endpoint
 * POST: Inject scenario-based time-series data into MetricsStore
 * Used for testing Predictive Scaling without real RPC/K8s connections
 */

import { NextRequest, NextResponse } from 'next/server';
import { pushMetric, clearMetrics, getRecentMetrics, getMetricsCount } from '@/lib/metrics-store';
import { resetPredictionState } from '@/lib/predictive-scaler';
import { initVcpuProfile, clearVcpuProfile, getVcpuValuesForScenario } from '@/lib/seed-vcpu-manager';
import { getStore } from '@/lib/redis-store';
import { MetricDataPoint } from '@/types/prediction';

export const dynamic = 'force-dynamic';

type Scenario = 'stable' | 'rising' | 'spike' | 'falling' | 'live';

const VALID_SCENARIOS: Scenario[] = ['stable', 'rising', 'spike', 'falling', 'live'];
const LIVE_MIN_DATA_POINTS = 20;
const SEED_TTL_SECONDS = 80; // Seed data expires after 80 seconds (covers all demo scenarios)

let seedTimeoutHandle: NodeJS.Timeout | null = null;

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
 * Generate scenario-specific data points with TTL metadata
 */
function generateScenarioData(scenario: Scenario): MetricDataPoint[] {
  const points: MetricDataPoint[] = [];
  const count = 20;
  const now = Date.now();

  // Calculate TTL expiry: now + 40 seconds
  const ttlExpiry = new Date(now + SEED_TTL_SECONDS * 1000).toISOString();

  // Get vCPU progression for this scenario
  const vcpuProgression = getVcpuValuesForScenario(scenario);

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

    // Use vCPU value from scenario progression
    const currentVcpu = vcpuProgression[i] || 1;

    points.push({
      timestamp,
      cpuUsage: Number(cpuUsage.toFixed(2)),
      txPoolPending,
      gasUsedRatio: Number(gasUsedRatio.toFixed(4)),
      blockHeight: 12_500_000 + i * 30,
      blockInterval: Number(blockInterval.toFixed(2)),
      currentVcpu: Number(currentVcpu.toFixed(2)),
      seedTtlExpiry: ttlExpiry, // Add TTL metadata
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
    clearVcpuProfile(); // Clear vCPU seed profile when switching to live

    // Clear seed scenario flag in state store (cross-worker persistence)
    await getStore().setSeedScenario(null);

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
  initVcpuProfile(scenario); // Initialize vCPU progression for the scenario

  // Store active seed scenario in state store (works across worker threads)
  await getStore().setSeedScenario(scenario);
  console.info(`[Seed API] Set active seed scenario in store: ${scenario}`);

  const dataPoints = generateScenarioData(scenario);
  for (const point of dataPoints) {
    await pushMetric(point);
  }

  console.info(`[Seed API] Injected ${dataPoints.length} data points for scenario: ${scenario}`);
  console.info(`[Seed API] Seed scenario persisted to state store`);

  // Schedule automatic cleanup after TTL expires
  if (seedTimeoutHandle) {
    clearTimeout(seedTimeoutHandle);
  }

  seedTimeoutHandle = setTimeout(async () => {
    try {
      await clearMetrics();
      await resetPredictionState();
      await getStore().setSeedScenario(null);
      clearVcpuProfile();
      console.info(`[Seed API] TTL expired (${SEED_TTL_SECONDS}s): Cleared seed data, switched to live metrics`);
    } catch (error) {
      console.error('[Seed API] Error clearing seed data on TTL:', error);
    }
  }, SEED_TTL_SECONDS * 1000);

  console.info(`[Seed API] Scheduled automatic cleanup in ${SEED_TTL_SECONDS}s`);

  return NextResponse.json({
    success: true,
    scenario,
    injectedCount: dataPoints.length,
    ttlSeconds: SEED_TTL_SECONDS,
    ttlExpiry: new Date(Date.now() + SEED_TTL_SECONDS * 1000).toISOString(),
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
