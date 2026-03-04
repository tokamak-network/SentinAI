/**
 * Scaling Agent — Resource Optimization Domain Specialist
 *
 * Periodically evaluates scaling needs and predictive signals.
 * Wraps existing modules:
 *   - scaling-decision.ts → score-based tier calculation
 *   - predictive-scaler.ts → AI time-series prediction
 *   - k8s-scaler.ts → execution + cooldown + auto-scaling checks
 *
 * Interval: 30s (default)
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getRecentMetrics } from '@/core/instance-metrics-store';
import { makeScalingDecision } from '@/lib/scaling-decision';
import { predictScaling } from '@/lib/predictive-scaler';
import {
  getCurrentVcpu,
  isAutoScalingEnabled,
  checkCooldown,
} from '@/lib/k8s-scaler';
import { DEFAULT_SCALING_CONFIG } from '@/types/scaling';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';

const logger = createLogger('ScalingAgent');

// ============================================================
// ScalingAgent
// ============================================================

export class ScalingAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'scaling';

  constructor(config: { instanceId: string; protocolId: string; intervalMs?: number }) {
    super({ ...config, intervalMs: config.intervalMs ?? 30_000 });
  }

  protected async tick(): Promise<void> {
    const startMs = Date.now();

    // 1. Read latest metrics from InstanceMetricsStore
    const recentPoints = await getRecentMetrics(this.instanceId, 1);
    if (recentPoints.length === 0) {
      logger.debug(`[ScalingAgent:${this.instanceId}] No metrics available, skipping`);
      return;
    }

    const latest = recentPoints[0];
    const scalingMetrics = {
      cpuUsage: (latest.fields['cpuUsage'] as number | null) ?? 0,
      txPoolPending: (latest.fields['txPoolPending'] as number | null) ?? 0,
      gasUsedRatio: (latest.fields['gasUsedRatio'] as number | null) ?? 0,
    };

    // 2. Calculate scaling decision
    const decision = makeScalingDecision(scalingMetrics, DEFAULT_SCALING_CONFIG);

    // 3. Gather scaling context in parallel
    const [currentVcpu, autoScalingEnabled, cooldown] = await Promise.all([
      getCurrentVcpu(),
      isAutoScalingEnabled(),
      checkCooldown(),
    ]);

    // 4. Check predictive scaling (best-effort)
    let predictiveOverride = false;
    try {
      const prediction = await predictScaling(currentVcpu);
      if (prediction && prediction.recommendedAction !== 'maintain') {
        predictiveOverride = true;
        logger.info(
          `[ScalingAgent:${this.instanceId}] Predictive override: ${prediction.predictedVcpu} vCPU ` +
          `(confidence=${prediction.confidence.toFixed(2)}, action=${prediction.recommendedAction})`
        );
      }
    } catch {
      // Non-fatal: predictive scaling failure doesn't block scoring
    }

    // 5. Emit recommendation if scaling needed or prediction triggers
    const needsScaling = decision.targetVcpu !== currentVcpu || predictiveOverride;

    if (needsScaling) {
      const bus = getAgentEventBus();
      bus.emit({
        type: 'scaling-recommendation',
        instanceId: this.instanceId,
        payload: {
          decision,
          predictiveOverride,
          currentVcpu,
          autoScalingEnabled,
          inCooldown: cooldown.inCooldown,
          cooldownRemainingSeconds: cooldown.remainingSeconds,
        },
        timestamp: new Date().toISOString(),
        correlationId: randomUUID(),
      });

      // 5. Record experience
      await this.recordDomainExperience({
        trigger: {
          type: 'scaling-score',
          metric: 'compositeScore',
          value: decision.score,
        },
        action: `recommend ${currentVcpu}→${decision.targetVcpu} vCPU` +
          (predictiveOverride ? ' (predictive)' : ''),
        outcome: 'success',
        resolutionMs: Date.now() - startMs,
        metricsSnapshot: scalingMetrics,
      });
    }
  }
}
