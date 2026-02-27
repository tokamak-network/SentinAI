/**
 * Executor Agent
 * Subscribes to 'anomaly-detected' events and immediately executes scaling decisions.
 * Does NOT wait for AI analysis — executes based on metric-only scoring.
 * This achieves the 10s→2s critical response time improvement.
 *
 * Role in the pipeline:
 *   EventBus('anomaly-detected') → ExecutorAgent → ScalingDecision → K8sScaler → EventBus('execution-complete')
 *
 * Key design: parallel with AnalyzerAgent — both react to the same anomaly event.
 */

import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { makeScalingDecision } from '@/lib/scaling-decision';
import {
  scaleOpGeth,
  getCurrentVcpu,
  isAutoScalingEnabled,
  checkCooldown,
  addScalingHistory,
} from '@/lib/k8s-scaler';
import { addScalingEvent } from '@/lib/daily-accumulator';
import { getRecentMetrics } from '@/core/instance-metrics-store';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { TargetVcpu, TargetMemoryGiB, ScalingDecision } from '@/types/scaling';
import type { DetectionResult } from '@/core/anomaly/generic-detector';

const logger = createLogger('ExecutorAgent');

// ============================================================
// Types
// ============================================================

export interface ExecutorAgentConfig {
  instanceId: string;
}

export interface ExecutionPayload {
  decision: ScalingDecision;
  executed: boolean;
  previousVcpu: number;
  currentVcpu: number;
  reason: string;
  durationMs: number;
}

// ============================================================
// Helpers
// ============================================================

function clampToValidVcpu(vcpu: number): TargetVcpu {
  if (vcpu >= 8) return 8;
  if (vcpu >= 4) return 4;
  if (vcpu >= 2) return 2;
  return 1;
}

// ============================================================
// ExecutorAgent
// ============================================================

/**
 * Event-driven scaling executor for a single node instance.
 * Reacts immediately to anomaly events without waiting for AI analysis.
 */
export class ExecutorAgent {
  readonly instanceId: string;

  private running = false;
  private executionCount = 0;
  private lastExecutedAt: string | null = null;
  private readonly handler: AgentEventHandler;

  constructor(config: ExecutorAgentConfig) {
    this.instanceId = config.instanceId;

    this.handler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      // Fire-and-forget: execute concurrently with AnalyzerAgent
      void this.handleAnomalyDetected(event);
    };
  }

  /**
   * Start listening for anomaly-detected events.
   */
  start(): void {
    if (this.running) {
      logger.warn(`[ExecutorAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    getAgentEventBus().on('anomaly-detected', this.handler);
    logger.info(`[ExecutorAgent:${this.instanceId}] Subscribed to anomaly-detected`);
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    getAgentEventBus().off('anomaly-detected', this.handler);
    logger.info(`[ExecutorAgent:${this.instanceId}] Unsubscribed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getExecutionCount(): number {
    return this.executionCount;
  }

  getLastExecutedAt(): string | null {
    return this.lastExecutedAt;
  }

  // ============================================================
  // Private
  // ============================================================

  private async handleAnomalyDetected(event: AgentEvent): Promise<void> {
    const detection = event.payload['detection'] as DetectionResult | undefined;
    if (!detection?.hasAnomaly) return;

    const startedAt = Date.now();
    logger.info(
      `[ExecutorAgent:${this.instanceId}] Evaluating scaling (correlationId=${event.correlationId})`
    );

    try {
      // Build scaling metrics from the latest InstanceMetricsStore data
      const recentPoints = await getRecentMetrics(this.instanceId, 1);
      const latestPoint = recentPoints[0];

      const scalingMetrics = {
        cpuUsage: (latestPoint?.fields['cpuUsage'] as number | null) ?? 0,
        txPoolPending: (latestPoint?.fields['txPoolPending'] as number | null) ?? 0,
        gasUsedRatio: (latestPoint?.fields['gasUsedRatio'] as number | null) ?? 0,
        // aiSeverity: intentionally undefined — not waiting for AnalyzerAgent
      };

      const decision = makeScalingDecision(scalingMetrics, DEFAULT_SCALING_CONFIG);
      const targetVcpu = clampToValidVcpu(decision.targetVcpu);

      const autoScalingEnabled = await isAutoScalingEnabled();
      const cooldown = await checkCooldown();
      const currentVcpu = await getCurrentVcpu();

      let executed = false;
      let reason = decision.reason;

      if (!autoScalingEnabled) {
        reason = `[Skip] Auto-scaling disabled. ${reason}`;
      } else if (cooldown.inCooldown) {
        reason = `[Skip] Cooldown ${cooldown.remainingSeconds}s. ${reason}`;
      } else if (targetVcpu === currentVcpu) {
        reason = `[Skip] Already at ${currentVcpu} vCPU. ${reason}`;
      } else {
        // Execute the scaling action
        const targetMemoryGiB = (targetVcpu * 2) as TargetMemoryGiB;
        const scaleResult = await scaleOpGeth(targetVcpu, targetMemoryGiB, DEFAULT_SCALING_CONFIG);

        if (scaleResult.success && scaleResult.previousVcpu !== scaleResult.currentVcpu) {
          executed = true;
          reason = `[Executed] ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU. ${reason}`;

          await addScalingHistory({
            timestamp: scaleResult.timestamp,
            fromVcpu: scaleResult.previousVcpu,
            toVcpu: scaleResult.currentVcpu,
            reason,
            triggeredBy: 'auto',
            decision,
          });

          await addScalingEvent({
            timestamp: scaleResult.timestamp,
            fromVcpu: scaleResult.previousVcpu,
            toVcpu: scaleResult.currentVcpu,
            trigger: 'auto',
            reason,
          });

          logger.info(
            `[ExecutorAgent:${this.instanceId}] Scaling executed: ${scaleResult.previousVcpu} → ${scaleResult.currentVcpu} vCPU`
          );
        }
      }

      const durationMs = Date.now() - startedAt;
      this.executionCount += 1;
      this.lastExecutedAt = new Date().toISOString();

      const payload: ExecutionPayload = {
        decision,
        executed,
        previousVcpu: currentVcpu,
        currentVcpu: executed ? targetVcpu : currentVcpu,
        reason,
        durationMs,
      };

      getAgentEventBus().emit({
        type: 'execution-complete',
        instanceId: this.instanceId,
        payload: payload as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[ExecutorAgent:${this.instanceId}] Execution error: ${message}`);
      // Emit execution-complete with failure state so VerifierAgent can record it
      getAgentEventBus().emit({
        type: 'execution-complete',
        instanceId: this.instanceId,
        payload: {
          executed: false,
          reason: `Execution failed: ${message}`,
          durationMs: Date.now() - startedAt,
          error: message,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    }
  }
}
