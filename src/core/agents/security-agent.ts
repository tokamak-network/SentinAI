/**
 * Security Agent — Anomaly Pattern & EOA Balance Domain Specialist
 *
 * Monitors for abnormal patterns and EOA balance health.
 * Wraps existing modules:
 *   - eoa-balance-monitor.ts → getAllBalanceStatus() — EOA threshold checks
 *   - Metric-based anomaly patterns (gas spikes, unusual TX patterns)
 *
 * Interval: 60s (default)
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getRecentMetrics } from '@/core/instance-metrics-store';
import { getAllBalanceStatus } from '@/lib/eoa-balance-monitor';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';

const logger = createLogger('SecurityAgent');

// ============================================================
// Constants
// ============================================================

const GAS_SPIKE_MULTIPLIER = 3;
const TX_POOL_SURGE_MULTIPLIER = 5;
const MIN_WINDOW_SIZE = 5;

type SecurityAlert = { type: string; metric: string; value: number; detail: string };

// ============================================================
// SecurityAgent
// ============================================================

export class SecurityAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'security';

  constructor(config: { instanceId: string; protocolId: string; intervalMs?: number }) {
    super({ ...config, intervalMs: config.intervalMs ?? 60_000 });
  }

  protected async tick(): Promise<void> {
    const startMs = Date.now();
    const alerts: SecurityAlert[] = [];

    // 1. EOA balance monitoring (best-effort)
    try {
      const status = await getAllBalanceStatus();
      const roleEntries: Array<[string, { balanceEth: number; level: string } | null]> = [
        ...Object.entries(status.roles),
      ];
      for (const [role, result] of roleEntries) {
        if (result && (result.level === 'critical' || result.level === 'low')) {
          alerts.push({
            type: 'eoa-balance',
            metric: `${role}_balance`,
            value: result.balanceEth,
            detail: `${role} EOA balance ${result.level}: ${result.balanceEth.toFixed(4)} ETH`,
          });
        }
      }
    } catch {
      logger.debug(`[SecurityAgent:${this.instanceId}] EOA check skipped (no L1 RPC or EOA addresses)`);
    }

    // 2. Metric-based anomaly patterns (gas spikes, abnormal TX patterns)
    try {
      const recentPoints = await getRecentMetrics(this.instanceId, 10);
      if (recentPoints.length >= MIN_WINDOW_SIZE) {
        const gasSurge = detectSurge(recentPoints, 'gasUsedRatio', GAS_SPIKE_MULTIPLIER, 'gas-spike');
        if (gasSurge) alerts.push(gasSurge);

        const txSurge = detectSurge(recentPoints, 'txPoolPending', TX_POOL_SURGE_MULTIPLIER, 'tx-pool-surge');
        if (txSurge) alerts.push(txSurge);
      }
    } catch {
      logger.debug(`[SecurityAgent:${this.instanceId}] Metric anomaly check skipped`);
    }

    // 3. Emit security alerts
    if (alerts.length > 0) {
      const bus = getAgentEventBus();
      bus.emit({
        type: 'security-alert',
        instanceId: this.instanceId,
        payload: { alerts, alertCount: alerts.length },
        timestamp: new Date().toISOString(),
        correlationId: randomUUID(),
      });

      // Record experience for each alert type in parallel
      await Promise.all(
        alerts.map(alert =>
          this.recordDomainExperience({
            trigger: { type: alert.type, metric: alert.metric, value: alert.value },
            action: `security alert: ${alert.detail}`,
            outcome: 'success',
            resolutionMs: Date.now() - startMs,
          })
        )
      );

      logger.info(
        `[SecurityAgent:${this.instanceId}] ${alerts.length} security alert(s) emitted`
      );
    }
  }
}

// ============================================================
// Helpers
// ============================================================

/**
 * Detect a sudden surge in a metric field by comparing the latest value
 * against the rolling average of prior values.
 */
function detectSurge(
  points: Array<{ fields: Record<string, unknown> }>,
  fieldName: string,
  multiplier: number,
  alertType: string,
): SecurityAlert | null {
  const values = points
    .map(p => p.fields[fieldName])
    .filter((v): v is number => v !== null && v !== undefined);

  if (values.length < MIN_WINDOW_SIZE) return null;

  const avg = values.slice(0, -1).reduce((a, b) => a + b, 0) / (values.length - 1);
  const latest = values[values.length - 1];

  if (avg > 0 && latest > avg * multiplier) {
    return {
      type: alertType,
      metric: fieldName,
      value: latest,
      detail: `${fieldName} surge: ${latest} vs avg ${avg.toFixed(3)} (${(latest / avg).toFixed(1)}x)`,
    };
  }
  return null;
}
