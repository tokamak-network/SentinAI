/**
 * Detector Agent
 * Runs Z-Score anomaly detection on a fixed interval (default: 10s).
 * On anomaly detection, immediately emits 'anomaly-detected' to the EventBus.
 *
 * Role in the pipeline:
 *   InstanceMetricsStore → DetectorAgent → EventBus('anomaly-detected')
 *   ↳ AnalyzerAgent and ExecutorAgent react in parallel
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getRecentMetrics } from '@/core/instance-metrics-store';
import { detectAnomalies } from '@/core/anomaly/generic-detector';
import { findProtocol } from '@/core/protocol-registry';
import type { DetectionResult } from '@/core/anomaly/generic-detector';
import type { MetricFieldDefinition } from '@/core/metrics';
import type { FieldAnomalyConfig } from '@/core/types';

const logger = createLogger('DetectorAgent');

// ============================================================
// Types
// ============================================================

export interface DetectorAgentConfig {
  instanceId: string;
  /** Protocol ID (e.g. 'opstack-l2') — used to look up field definitions and anomaly config */
  protocolId: string;
  /** Detection interval in milliseconds (default: 10000) */
  intervalMs?: number;
}

// ============================================================
// DetectorAgent
// ============================================================

/**
 * Periodic anomaly detector for a single node instance.
 * Reads from InstanceMetricsStore, emits anomaly-detected events via EventBus.
 */
export class DetectorAgent {
  readonly instanceId: string;
  readonly intervalMs: number;

  private readonly protocolId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastActivityAt: string | null = null;

  constructor(config: DetectorAgentConfig) {
    this.instanceId = config.instanceId;
    this.protocolId = config.protocolId;
    this.intervalMs = config.intervalMs ?? 10_000;
  }

  /**
   * Start the detection loop.
   * Idempotent — calling start() on a running agent is a no-op.
   */
  start(): void {
    if (this.timer !== null) {
      logger.warn(`[DetectorAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    logger.info(`[DetectorAgent:${this.instanceId}] Starting (interval=${this.intervalMs}ms)`);
    this.running = true;

    this.timer = setInterval(() => {
      void this.runDetection();
    }, this.intervalMs);
  }

  /**
   * Stop the detection loop.
   */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    logger.info(`[DetectorAgent:${this.instanceId}] Stopped`);
  }

  isRunning(): boolean {
    return this.running && this.timer !== null;
  }

  getLastActivityAt(): string | null {
    return this.lastActivityAt;
  }

  // ============================================================
  // Private
  // ============================================================

  private async runDetection(): Promise<void> {
    try {
      const result = await this.detect();
      if (!result) return;

      this.lastActivityAt = new Date().toISOString();

      if (result.hasAnomaly) {
        logger.info(
          `[DetectorAgent:${this.instanceId}] Anomaly detected — ${result.anomalies.length} field(s)`
        );

        const bus = getAgentEventBus();
        bus.emit({
          type: 'anomaly-detected',
          instanceId: this.instanceId,
          payload: {
            detection: result,
            protocolId: this.protocolId,
          },
          timestamp: new Date().toISOString(),
          correlationId: randomUUID(),
        });
      } else {
        logger.debug(`[DetectorAgent:${this.instanceId}] No anomalies`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[DetectorAgent:${this.instanceId}] Detection error: ${message}`);
      // Non-fatal: detection failure doesn't stop the agent
    }
  }

  private async detect(): Promise<DetectionResult | null> {
    const points = await getRecentMetrics(this.instanceId);
    if (points.length < 3) {
      // Not enough history for statistical detection
      return null;
    }

    // Look up protocol descriptor for field definitions and anomaly config
    const descriptor = findProtocol(this.protocolId);
    let fieldDefs: MetricFieldDefinition[];
    let anomalyConfigs: Record<string, FieldAnomalyConfig>;

    if (descriptor) {
      fieldDefs = descriptor.metricsFields;
      anomalyConfigs = descriptor.anomalyConfig;
    } else {
      // Fallback: derive field definitions from current data point fields
      const latestPoint = points[points.length - 1];
      fieldDefs = Object.keys(latestPoint.fields).map((fieldName) => ({
        fieldName,
        displayName: fieldName,
        unit: 'count' as const,
      }));
      // Enable z-score for all fields with default config
      anomalyConfigs = Object.fromEntries(
        fieldDefs.map((f) => [
          f.fieldName,
          {
            enabled: true,
            method: 'z-score' as const,
          },
        ])
      );
    }

    // Build current fields and history maps
    const latestPoint = points[points.length - 1];
    const currentFields: Record<string, number | null> = { ...latestPoint.fields };

    const fieldHistory: Record<string, number[]> = {};
    for (const fieldDef of fieldDefs) {
      fieldHistory[fieldDef.fieldName] = points
        .slice(0, -1) // exclude current
        .map((p) => p.fields[fieldDef.fieldName])
        .filter((v): v is number => v !== null && v !== undefined);
    }

    return detectAnomalies(
      this.instanceId,
      currentFields,
      fieldHistory,
      fieldDefs,
      anomalyConfigs
    );
  }
}
