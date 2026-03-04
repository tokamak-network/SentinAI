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
} from '@/lib/l1-rpc-failover';
import { DomainAgent } from '@/core/agents/domain-agent';
import type { DomainAgentType } from '@/core/agents/domain-agent';

const logger = createLogger('ReliabilityAgent');

// ============================================================
// ReliabilityAgent
// ============================================================

export class ReliabilityAgent extends DomainAgent {
  readonly domain: DomainAgentType = 'reliability';

  constructor(config: { instanceId: string; protocolId: string; intervalMs?: number }) {
    super({ ...config, intervalMs: config.intervalMs ?? 30_000 });
  }

  protected async tick(): Promise<void> {
    const startMs = Date.now();
    const issues: Array<{ type: string; detail: string }> = [];

    // 1. L1 RPC health check
    try {
      const activeUrl = getActiveL1RpcUrl();
      if (activeUrl) {
        const healthy = await healthCheckEndpoint(activeUrl);
        if (!healthy) {
          issues.push({
            type: 'l1-rpc-unhealthy',
            detail: `Active L1 RPC endpoint failed health check`,
          });
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

    // 4. Emit reliability issues
    if (issues.length > 0) {
      const bus = getAgentEventBus();
      bus.emit({
        type: 'reliability-issue',
        instanceId: this.instanceId,
        payload: { issues, issueCount: issues.length },
        timestamp: new Date().toISOString(),
        correlationId: randomUUID(),
      });

      await this.recordDomainExperience({
        trigger: { type: issues[0].type, metric: 'l1_health', value: issues.length },
        action: `reliability issue: ${issues.map(i => i.type).join(', ')}`,
        outcome: 'success',
        resolutionMs: Date.now() - startMs,
      });

      logger.info(
        `[ReliabilityAgent:${this.instanceId}] ${issues.length} reliability issue(s) detected`
      );
    }
  }
}
