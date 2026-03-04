/**
 * RCA Agent — Root Cause Analysis Domain Specialist
 *
 * Event-reactive agent: subscribes to 'anomaly-detected' events
 * and performs dependency-graph-based root cause analysis.
 * Wraps existing modules:
 *   - rca-engine.ts → performRCA(), addRCAHistory()
 *
 * Unlike other domain agents, RCA does NOT use periodic tick().
 * Instead it reacts to events via EventBus subscription.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { performRCA, addRCAHistory } from '@/lib/rca-engine';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { DetectionResult, FieldAnomaly } from '@/core/anomaly/generic-detector';
import type { AnomalyResult } from '@/types/anomaly';
import type { MetricDataPoint } from '@/types/prediction';

const logger = createLogger('RCAAgent');

// ============================================================
// RCADomainAgent
// ============================================================

export class RCADomainAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'rca';
  private readonly handler: AgentEventHandler;
  private diagnosisCount = 0;

  constructor(config: { instanceId: string; protocolId: string }) {
    super({ ...config, intervalMs: 0 }); // no periodic tick

    this.handler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleAnomaly(event);
    };
  }

  /**
   * Override: subscribe to anomaly-detected events instead of periodic tick.
   */
  override start(): void {
    if (this.running) {
      logger.warn(`[RCAAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    getAgentEventBus().on('anomaly-detected', this.handler);
    logger.info(`[RCAAgent:${this.instanceId}] Subscribed to anomaly-detected`);
  }

  /**
   * Override: unsubscribe from events.
   */
  override stop(): void {
    if (!this.running) return;
    this.running = false;
    getAgentEventBus().off('anomaly-detected', this.handler);
    logger.info(`[RCAAgent:${this.instanceId}] Unsubscribed`);
  }

  getDiagnosisCount(): number {
    return this.diagnosisCount;
  }

  /**
   * tick() is not used — this agent is event-reactive.
   */
  protected async tick(): Promise<void> {
    // No-op: event-reactive agent
  }

  // ============================================================
  // Private
  // ============================================================

  private async handleAnomaly(event: AgentEvent): Promise<void> {
    const startMs = Date.now();
    const detection = event.payload['detection'] as DetectionResult | undefined;
    if (!detection?.hasAnomaly) return;

    logger.info(
      `[RCAAgent:${this.instanceId}] Running RCA for anomaly (correlationId=${event.correlationId})`
    );

    try {
      const topAnomaly = detection.anomalies[0];
      const fieldName = topAnomaly?.fieldName ?? 'unknown';

      // Convert FieldAnomaly[] → AnomalyResult[] for RCA engine
      const anomalyInputs: AnomalyResult[] = detection.anomalies.map(toAnomalyResult);
      const logs: Record<string, string> = {};
      const metrics: MetricDataPoint[] = [{
        timestamp: event.timestamp,
        cpuUsage: 0,
        gasUsedRatio: 0,
        txPoolPending: 0,
        blockHeight: 0,
        blockInterval: 0,
        currentVcpu: 1,
      }];

      const rcaResult = await performRCA(anomalyInputs, logs, metrics);

      // Record in history
      await addRCAHistory(rcaResult, 'auto');
      this.diagnosisCount += 1;

      // Emit RCA result
      const bus = getAgentEventBus();
      bus.emit({
        type: 'rca-result',
        instanceId: this.instanceId,
        payload: {
          rcaResult,
          triggeredBy: 'anomaly-detected',
          anomalyField: fieldName,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId ?? randomUUID(),
      });

      // Record experience
      const rootCauseDesc = rcaResult.rootCause.description;
      const confidence = rcaResult.rootCause.confidence;

      await this.recordDomainExperience({
        trigger: {
          type: 'anomaly',
          metric: fieldName,
          value: topAnomaly?.zScore ?? 0,
        },
        action: `RCA: ${rootCauseDesc} (confidence=${confidence.toFixed(2)})`,
        outcome: confidence > 0.5 ? 'success' : 'partial',
        resolutionMs: Date.now() - startMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[RCAAgent:${this.instanceId}] RCA error: ${message}`);

      await this.recordDomainExperience({
        trigger: { type: 'anomaly', metric: 'rca', value: 0 },
        action: `RCA failed: ${message}`,
        outcome: 'failure',
        resolutionMs: Date.now() - startMs,
      });
    }
  }
}

// ============================================================
// Adapters
// ============================================================

/** Convert FieldAnomaly (generic-detector) → AnomalyResult (rca-engine) */
function toAnomalyResult(a: FieldAnomaly): AnomalyResult {
  return {
    isAnomaly: true,
    metric: a.fieldName,
    value: a.currentValue,
    zScore: a.zScore ?? 0,
    direction: a.severity === 'critical' ? 'spike' : 'spike',
    description: a.message,
    rule: a.method === 'z-score' ? 'z-score' : 'threshold-breach',
  };
}
