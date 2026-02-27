/**
 * Analyzer Agent
 * Subscribes to 'anomaly-detected' events and performs AI deep analysis asynchronously.
 * Emits 'analysis-complete' when finished — does NOT block the executor.
 *
 * Role in the pipeline:
 *   EventBus('anomaly-detected') → AnalyzerAgent → AI chatCompletion() → EventBus('analysis-complete')
 *
 * Key design: fire-and-forget — analysis runs concurrently with executor.
 */

import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { chatCompletion } from '@/lib/ai-client';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { DetectionResult } from '@/core/anomaly/generic-detector';

const logger = createLogger('AnalyzerAgent');

// ============================================================
// Types
// ============================================================

export interface AnalyzerAgentConfig {
  instanceId: string;
}

export interface AnalysisPayload {
  detection: DetectionResult;
  aiSeverity: 'low' | 'medium' | 'high' | 'critical';
  aiSummary: string;
  durationMs: number;
}

// ============================================================
// AnalyzerAgent
// ============================================================

/**
 * Event-driven AI analyzer for a single node instance.
 * Subscribes to anomaly-detected events and runs AI analysis asynchronously.
 */
export class AnalyzerAgent {
  readonly instanceId: string;

  private running = false;
  private analysisCount = 0;
  private readonly handler: AgentEventHandler;

  constructor(config: AnalyzerAgentConfig) {
    this.instanceId = config.instanceId;

    // Pre-bind the handler so we can remove it in stop()
    this.handler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      // Fire-and-forget: don't await so executor can run simultaneously
      void this.handleAnomalyDetected(event);
    };
  }

  /**
   * Start listening for anomaly-detected events.
   */
  start(): void {
    if (this.running) {
      logger.warn(`[AnalyzerAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    getAgentEventBus().on('anomaly-detected', this.handler);
    logger.info(`[AnalyzerAgent:${this.instanceId}] Subscribed to anomaly-detected`);
  }

  /**
   * Stop listening for events.
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    getAgentEventBus().off('anomaly-detected', this.handler);
    logger.info(`[AnalyzerAgent:${this.instanceId}] Unsubscribed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getAnalysisCount(): number {
    return this.analysisCount;
  }

  // ============================================================
  // Private
  // ============================================================

  private async handleAnomalyDetected(event: AgentEvent): Promise<void> {
    const detection = event.payload['detection'] as DetectionResult | undefined;
    if (!detection?.hasAnomaly) return;

    const startedAt = Date.now();
    logger.info(
      `[AnalyzerAgent:${this.instanceId}] Running AI analysis (correlationId=${event.correlationId})`
    );

    try {
      const systemPrompt = [
        'You are an expert L2 blockchain node operations analyst.',
        'Analyze the given anomaly detection results and provide a concise severity assessment.',
        'Respond in JSON format: { "severity": "low|medium|high|critical", "summary": "..." }',
        'Keep the summary under 100 words.',
      ].join('\n');

      const anomalySummary = detection.anomalies
        .map(
          (a) =>
            `Field: ${a.displayName}, Method: ${a.method}, Value: ${a.currentValue}, ` +
            (a.zScore !== undefined ? `Z-Score: ${a.zScore.toFixed(2)}, ` : '') +
            `Severity: ${a.severity}, Message: ${a.message}`
        )
        .join('\n');

      const userPrompt = [
        `Instance ID: ${this.instanceId}`,
        `Timestamp: ${detection.timestamp}`,
        `Anomalies detected (${detection.anomalies.length}):`,
        anomalySummary,
        '',
        'Assess the overall severity and provide a brief operational summary.',
      ].join('\n');

      const result = await chatCompletion({
        systemPrompt,
        userPrompt,
        modelTier: 'fast',
        maxTokens: 256,
      });

      // Parse the AI response
      let aiSeverity: AnalysisPayload['aiSeverity'] = 'medium';
      let aiSummary = result.content;

      try {
        // Strip markdown code blocks if present
        const jsonText = result.content
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();
        const parsed = JSON.parse(jsonText) as { severity?: string; summary?: string };
        const severityMap: Record<string, AnalysisPayload['aiSeverity']> = {
          low: 'low', medium: 'medium', high: 'high', critical: 'critical',
        };
        aiSeverity = severityMap[parsed.severity?.toLowerCase() ?? ''] ?? 'medium';
        aiSummary = parsed.summary ?? result.content;
      } catch {
        // Non-fatal: use raw response as summary
      }

      const durationMs = Date.now() - startedAt;
      this.analysisCount += 1;

      logger.info(
        `[AnalyzerAgent:${this.instanceId}] Analysis complete — severity=${aiSeverity} (${durationMs}ms)`
      );

      const payload: AnalysisPayload = {
        detection,
        aiSeverity,
        aiSummary,
        durationMs,
      };

      getAgentEventBus().emit({
        type: 'analysis-complete',
        instanceId: this.instanceId,
        payload: payload as unknown as Record<string, unknown>,
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[AnalyzerAgent:${this.instanceId}] Analysis error: ${message}`);
      // Non-fatal: emit analysis-complete with fallback severity so pipeline continues
      getAgentEventBus().emit({
        type: 'analysis-complete',
        instanceId: this.instanceId,
        payload: {
          detection,
          aiSeverity: 'medium',
          aiSummary: `AI analysis failed: ${message}`,
          durationMs: Date.now() - startedAt,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    }
  }
}
