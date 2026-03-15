/**
 * Reliability Agent — L1 RPC Failover & Health Domain Specialist
 *
 * Monitors L1 RPC endpoint health and triggers failover when needed.
 * Wraps existing modules:
 *   - l1-rpc-failover.ts → healthCheckEndpoint(), executeFailover(), checkProxydBackends()
 *
 * Interval: 30s (default)
 */

import { randomUUID } from 'crypto';
import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import {
  getActiveL1RpcUrl,
  healthCheckEndpoint,
  checkProxydBackends,
  getL1FailoverState,
  hasHealthyBackup,
} from '@/lib/l1-rpc-failover';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';

const logger = createLogger('ReliabilityAgent');

// ============================================================
// ReliabilityAgent
// ============================================================

export class ReliabilityAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'reliability';

  /** Track consecutive health-check failures to avoid false positives from transient blips */
  private l1HealthCheckFailures = 0;
  private static readonly L1_FAILURE_THRESHOLD = 2;

  constructor(config: { instanceId: string; protocolId: string; intervalMs?: number }) {
    super({ ...config, intervalMs: config.intervalMs ?? 30_000 });
  }

  protected async tick(): Promise<void> {
    const startMs = Date.now();
    const issues: Array<{ type: string; detail: string }> = [];

    // 1. L1 RPC health check — require consecutive failures before emitting
    let l1HealthPassed = false;
    try {
      const activeUrl = getActiveL1RpcUrl();
      if (activeUrl) {
        const healthy = await healthCheckEndpoint(activeUrl);
        if (!healthy) {
          this.l1HealthCheckFailures += 1;
          if (this.l1HealthCheckFailures >= ReliabilityAgent.L1_FAILURE_THRESHOLD) {
            issues.push({
              type: 'l1-rpc-unhealthy',
              detail: `Active L1 RPC endpoint failed health check ${this.l1HealthCheckFailures} consecutive times`,
            });
          } else {
            logger.warn(
              `[ReliabilityAgent:${this.instanceId}] L1 health check failed (${this.l1HealthCheckFailures}/${ReliabilityAgent.L1_FAILURE_THRESHOLD}), waiting for confirmation`
            );
          }
        } else {
          this.l1HealthCheckFailures = 0;
          l1HealthPassed = true;
        }
      }
    } catch {
      logger.debug(`[ReliabilityAgent:${this.instanceId}] L1 health check skipped (no L1 RPC configured)`);
    }

    // 2. Proxyd backend check (best-effort)
    try {
      const backendEvent = await checkProxydBackends();
      if (backendEvent) {
        issues.push({
          type: 'proxyd-backend-replaced',
          detail: `Proxyd backend replaced: ${backendEvent.backendName}`,
        });
      }
    } catch {
      // Non-fatal: proxyd check may not be configured
    }

    // 3. Failover state check — inspect active endpoint's consecutive failures
    //    Skip when our direct health check passed: the consecutiveFailures counter
    //    is updated by a separate path (reportL1Failure) and may be stale.
    if (!l1HealthPassed) {
      try {
        const state = getL1FailoverState();
        const activeEndpoint = state.endpoints[state.activeIndex];
        if (activeEndpoint && activeEndpoint.consecutiveFailures >= 3) {
          issues.push({
            type: 'l1-consecutive-failures',
            detail: `L1 RPC has ${activeEndpoint.consecutiveFailures} consecutive failures`,
          });
        }
      } catch {
        // Non-fatal
      }
    }

    // 4. Pre-check: for failover-related issues, verify a backup endpoint exists
    //    before emitting. Avoids unnecessary remediation failure + Slack alarm.
    const failoverIssues = issues.filter(
      i => i.type === 'l1-rpc-unhealthy' || i.type === 'l1-consecutive-failures'
    );
    const nonFailoverIssues = issues.filter(
      i => i.type !== 'l1-rpc-unhealthy' && i.type !== 'l1-consecutive-failures'
    );

    let emittableIssues = [...nonFailoverIssues];
    if (failoverIssues.length > 0) {
      const backupAvailable = await hasHealthyBackup();
      if (backupAvailable) {
        emittableIssues.push(...failoverIssues);
      } else {
        logger.warn(
          `[ReliabilityAgent:${this.instanceId}] L1 issue detected but no healthy backup endpoint available, suppressing failover event`
        );
      }
    }

    // 5. Emit reliability issues
    if (emittableIssues.length > 0) {
      // Reset counter after emitting so the threshold re-applies for the next incident
      this.l1HealthCheckFailures = 0;

      const bus = getAgentEventBus();
      bus.emit({
        type: 'reliability-issue',
        instanceId: this.instanceId,
        payload: { issues: emittableIssues, issueCount: emittableIssues.length },
        timestamp: new Date().toISOString(),
        correlationId: randomUUID(),
      });

      await this.recordDomainExperience({
        trigger: { type: emittableIssues[0].type, metric: 'l1_health', value: emittableIssues.length },
        action: `reliability issue: ${emittableIssues.map(i => i.type).join(', ')}`,
        outcome: 'success',
        resolutionMs: Date.now() - startMs,
      });

      logger.info(
        `[ReliabilityAgent:${this.instanceId}] ${emittableIssues.length} reliability issue(s) detected`
      );
    }
  }
}
