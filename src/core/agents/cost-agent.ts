/**
 * Cost Agent — Resource Cost Tracking Domain Specialist
 *
 * Periodically checks resource usage and identifies cost optimization opportunities.
 * Wraps existing modules:
 *   - cost-optimizer.ts → generateCostReport()
 *   - usage-tracker.ts → recordUsage(), getUsageSummary()
 *   - k8s-scaler.ts → getCurrentVcpu()
 *
 * Interval: 300s / 5 min (default)
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { generateCostReport } from '@/lib/cost-optimizer';
import { recordUsage, getUsageSummary } from '@/lib/usage-tracker';
import { getCurrentVcpu } from '@/lib/k8s-scaler';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';
import type { CostRecommendation } from '@/types/cost';

const logger = createLogger('CostAgent');

// ============================================================
// CostAgent
// ============================================================

export class CostAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'cost';
  private lastCostScalingAt: string | null = null;

  constructor(config: { instanceId: string; protocolId: string; intervalMs?: number }) {
    super({ ...config, intervalMs: config.intervalMs ?? 300_000 });
  }

  getLastCostScalingAt(): string | null {
    return this.lastCostScalingAt;
  }

  protected async tick(): Promise<void> {
    const startMs = Date.now();

    // 1. Record current usage
    try {
      const currentVcpu = await getCurrentVcpu();
      await recordUsage(currentVcpu, 0); // CPU utilization not available from metrics alone
    } catch {
      logger.debug(`[CostAgent:${this.instanceId}] Usage recording skipped`);
    }

    // 2. Generate cost report + usage summary in parallel
    try {
      const [report, summary] = await Promise.all([
        generateCostReport(7),
        getUsageSummary(7),
      ]);

      // Identify actionable insights
      const insights: Array<{ type: string; detail: string; savingsUsd: number }> = [];

      if (report.recommendations) {
        for (const rec of report.recommendations) {
          const savings = rec.currentCost - rec.projectedCost;
          if (savings > 0) {
            insights.push({
              type: 'cost-savings',
              detail: rec.description,
              savingsUsd: savings,
            });
          }
        }
      }

      // Check for overprovisioning
      if (summary.avgVcpu > 2 && summary.peakVcpu <= 2) {
        insights.push({
          type: 'overprovision',
          detail: `Average vCPU (${summary.avgVcpu.toFixed(1)}) exceeds peak need (${summary.peakVcpu}). Consider downscaling.`,
          savingsUsd: (summary.avgVcpu - summary.peakVcpu) * 0.04656 * 24 * 30, // monthly savings
        });
      }

      // 3. Emit cost insights if any found
      if (insights.length > 0) {
        const totalSavings = insights.reduce((sum, i) => sum + i.savingsUsd, 0);

        const bus = getAgentEventBus();
        bus.emit({
          type: 'cost-insight',
          instanceId: this.instanceId,
          payload: {
            insights,
            totalPotentialSavingsUsd: totalSavings,
            currentMonthlyCost: report.currentMonthly,
          },
          timestamp: new Date().toISOString(),
          correlationId: randomUUID(),
        });

        await this.recordDomainExperience({
          trigger: { type: 'cost-analysis', metric: 'monthlyCost', value: report.currentMonthly },
          action: `cost insight: ${insights.length} opportunities, $${totalSavings.toFixed(2)} potential savings`,
          outcome: 'success',
          resolutionMs: Date.now() - startMs,
          metricsSnapshot: {
            currentMonthlyCost: report.currentMonthly,
            totalSavings,
          },
        });

        logger.info(
          `[CostAgent:${this.instanceId}] ${insights.length} cost insight(s), potential savings: $${totalSavings.toFixed(2)}/mo`
        );

        // Auto-apply scheduling if a 'schedule' recommendation exists
        const scheduleRec = report.recommendations?.find(
          (r: CostRecommendation) => r.type === 'schedule' && r.confidence >= 0.5
        );
        if (scheduleRec) {
          await this.applyScheduleFromInsight(scheduleRec);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`[CostAgent:${this.instanceId}] Cost analysis skipped: ${message}`);
    }
  }

  /**
   * Build a schedule profile from usage data and apply it.
   * Emits 'scaling-recommendation' so NotifierAgent can report the result.
   */
  private async applyScheduleFromInsight(rec: CostRecommendation): Promise<void> {
    try {
      // Dynamic import to avoid circular dependency
      const { buildScheduleProfile, applyScheduledScaling } = await import('@/lib/scheduled-scaler');

      const profile = await buildScheduleProfile(7, { enabled: true });
      if (!profile) {
        logger.info(`[CostAgent:${this.instanceId}] Schedule profile: insufficient data, skipping`);
        return;
      }

      const result = await applyScheduledScaling({ enabled: true });

      const bus = getAgentEventBus();
      bus.emit({
        type: 'scaling-recommendation',
        instanceId: this.instanceId,
        payload: {
          source: 'cost-insight',
          type: 'schedule',
          profile: {
            id: profile.id,
            generatedAt: profile.generatedAt,
            avgDailyVcpu: profile.metadata.avgDailyVcpu,
            estimatedMonthlySavings: profile.metadata.estimatedMonthlySavings,
            coveragePct: profile.metadata.coveragePct,
            slotCount: profile.slots.length,
          },
          execution: {
            executed: result.executed,
            previousVcpu: result.previousVcpu,
            targetVcpu: result.targetVcpu,
            message: result.message,
            skippedReason: result.skippedReason,
          },
          recommendation: {
            title: rec.title,
            savings: rec.currentCost - rec.projectedCost,
            confidence: rec.confidence,
          },
        },
        timestamp: new Date().toISOString(),
        correlationId: randomUUID(),
      });

      this.lastCostScalingAt = new Date().toISOString();

      logger.info(
        `[CostAgent:${this.instanceId}] Schedule applied: ${result.message} (savings: $${profile.metadata.estimatedMonthlySavings.toFixed(2)}/mo)`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[CostAgent:${this.instanceId}] Schedule application failed: ${message}`);
    }
  }
}
