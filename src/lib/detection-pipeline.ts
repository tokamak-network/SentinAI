/**
 * Detection Pipeline
 * Extracted from metrics/route.ts for reuse by both the API route and agent-loop.
 * Runs the 4-layer anomaly detection pipeline:
 *   Layer 1: Statistical (Z-Score)
 *   Layer 2: AI deep analysis (async)
 *   Layer 3: Alert dispatch (async)
 *   Layer 4: Auto-remediation (async)
 */

import type { MetricDataPoint } from '@/types/prediction';
import type { AnomalyResult } from '@/types/anomaly';
import { getRecentMetrics } from '@/lib/metrics-store';
import { detectAnomalies } from '@/lib/anomaly-detector';
import { analyzeAnomalies } from '@/lib/anomaly-ai-analyzer';
import { dispatchAlert } from '@/lib/alert-dispatcher';
import {
  createOrUpdateEvent,
  addDeepAnalysis,
  addAlertRecord,
  resolveActiveEventIfExists,
  getActiveEventId,
  getEventById,
} from '@/lib/anomaly-event-store';
import { getAllLiveLogs } from '@/lib/log-ingester';
import logger from '@/lib/logger';

// ============================================================
// Types
// ============================================================

export interface DetectionResult {
  anomalies: AnomalyResult[];
  activeEventId: string | undefined;
  /** Whether Layer 2+ background analysis was triggered */
  deepAnalysisTriggered: boolean;
}

// ============================================================
// Detection Pipeline
// ============================================================

/**
 * Run the full anomaly detection pipeline (Layer 1-4).
 * Layer 1 runs synchronously. Layers 2-4 run asynchronously (non-blocking).
 */
export async function runDetectionPipeline(
  dataPoint: MetricDataPoint,
  balances?: { batcherBalanceEth?: number; proposerBalanceEth?: number; challengerBalanceEth?: number }
): Promise<DetectionResult> {
  const history = await getRecentMetrics();

  // When the current dataPoint is a live metric (no seedTtlExpiry), exclude seed data
  // from history to prevent stale spike scenario data from triggering false anomalies.
  const filteredHistory = dataPoint.seedTtlExpiry
    ? history
    : history.filter(p => !p.seedTtlExpiry);

  const anomalies = detectAnomalies(dataPoint, filteredHistory, balances);

  if (anomalies.length > 0) {
    logger.info(`[Detection] ${anomalies.length} anomalies detected`);

    const event = await createOrUpdateEvent(anomalies);

    // Layers 2-4: async, non-blocking
    let deepAnalysisTriggered = false;
    if (!event.deepAnalysis) {
      deepAnalysisTriggered = true;
      runDeepAnalysis(event.id, anomalies, dataPoint).catch((err) => {
        logger.error('[Detection] Unexpected deep analysis error:', err);
      });
    }

    return {
      anomalies,
      activeEventId: event.id,
      deepAnalysisTriggered,
    };
  }

  // No anomalies — resolve any active event
  await resolveActiveEventIfExists();
  const activeEventId = (await getActiveEventId()) || undefined;

  return {
    anomalies: [],
    activeEventId,
    deepAnalysisTriggered: false,
  };
}

// ============================================================
// Background Analysis (Layers 2-4)
// ============================================================

async function runDeepAnalysis(
  eventId: string,
  anomalies: AnomalyResult[],
  dataPoint: MetricDataPoint
): Promise<void> {
  try {
    const logs = await getAllLiveLogs();
    const analysis = await analyzeAnomalies(anomalies, dataPoint, logs);
    await addDeepAnalysis(eventId, analysis);

    // Layer 3: Alert dispatch
    const alertRecord = await dispatchAlert(analysis, dataPoint, anomalies);
    if (alertRecord) {
      await addAlertRecord(eventId, alertRecord);
    }

    // Layer 4: Auto-Remediation
    if (process.env.AUTO_REMEDIATION_ENABLED === 'true') {
      try {
        const { executeRemediation } = await import('@/lib/remediation-engine');
        const event = await getEventById(eventId);
        if (event) {
          await executeRemediation(event, analysis);
        }
      } catch (err) {
        logger.error('[Layer4] Remediation failed:', err);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('[Detection] AI analysis failed:', errorMsg);
    await addDeepAnalysis(eventId, {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: `AI analysis failed: ${errorMsg}`,
      suggestedActions: ['Manual inspection required'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }
}
