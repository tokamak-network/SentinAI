/**
 * Remediation Agent — Executes corrective actions in response to domain agent events
 *
 * Event-reactive agent: subscribes to security-alert, reliability-issue, rca-result
 * and performs the appropriate remediation action (EOA refill, L1 failover, playbook execution).
 *
 * This closes the "detect → act" gap in Agent V2 where domain agents emit events
 * but no agent was consuming them to execute remediation.
 */

import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { RoleAgent } from '@/core/agent-orchestrator';

const logger = createLogger('RemediationAgent');

// ============================================================
// Types
// ============================================================

export interface RemediationAgentConfig {
  instanceId: string;
}

interface RemediationResult {
  action: string;
  success: boolean;
  detail: string;
}

// ============================================================
// RemediationAgent
// ============================================================

export class RemediationAgent implements RoleAgent {
  readonly instanceId: string;

  private running = false;
  private actionCount = 0;
  private lastActivityAt: string | null = null;

  private readonly securityHandler: AgentEventHandler;
  private readonly reliabilityHandler: AgentEventHandler;
  private readonly rcaHandler: AgentEventHandler;

  constructor(config: RemediationAgentConfig) {
    this.instanceId = config.instanceId;

    this.securityHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleSecurityAlert(event);
    };

    this.reliabilityHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleReliabilityIssue(event);
    };

    this.rcaHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleRCAResult(event);
    };
  }

  start(): void {
    if (this.running) {
      logger.warn(`[RemediationAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    const bus = getAgentEventBus();
    bus.on('security-alert', this.securityHandler);
    bus.on('reliability-issue', this.reliabilityHandler);
    bus.on('rca-result', this.rcaHandler);
    logger.info(`[RemediationAgent:${this.instanceId}] Subscribed to security-alert, reliability-issue, rca-result`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const bus = getAgentEventBus();
    bus.off('security-alert', this.securityHandler);
    bus.off('reliability-issue', this.reliabilityHandler);
    bus.off('rca-result', this.rcaHandler);
    logger.info(`[RemediationAgent:${this.instanceId}] Unsubscribed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getActionCount(): number {
    return this.actionCount;
  }

  getLastActivityAt(): string | null {
    return this.lastActivityAt;
  }

  // ============================================================
  // security-alert → EOA refill
  // ============================================================

  private async handleSecurityAlert(event: AgentEvent): Promise<void> {
    const alerts = event.payload['alerts'] as Array<{
      type: string;
      metric: string;
      value: number;
      detail: string;
    }> | undefined;
    if (!alerts || alerts.length === 0) return;

    const results: RemediationResult[] = [];

    for (const alert of alerts) {
      if (alert.type === 'eoa-balance') {
        const result = await this.executeEOARefill(alert.metric);
        results.push(result);
      }
    }

    if (results.length > 0) {
      this.actionCount += results.length;
      this.lastActivityAt = new Date().toISOString();

      const bus = getAgentEventBus();
      bus.emit({
        type: 'remediation-complete',
        instanceId: this.instanceId,
        payload: {
          trigger: 'security-alert',
          results,
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    }
  }

  private async executeEOARefill(metric: string): Promise<RemediationResult> {
    // Extract role from metric name (e.g., "batcher_balance" → "batcher")
    const role = metric.replace('_balance', '') as 'batcher' | 'proposer' | 'challenger';

    try {
      const { canRefill, refillEOA } = await import('@/lib/eoa-balance-monitor');
      const { getSentinaiL1RpcUrl } = await import('@/lib/l1-rpc-failover');
      const { getChainPlugin } = await import('@/chains');

      const plugin = getChainPlugin();
      const eoaConfig = plugin.eoaConfigs.find(c => c.role === role);
      const envKey = eoaConfig?.addressEnvVar || `${role.toUpperCase()}_EOA_ADDRESS`;
      const targetAddr = process.env[envKey];

      if (!targetAddr) {
        return { action: 'eoa-refill', success: false, detail: `${role} EOA address not configured (${envKey})` };
      }

      const l1RpcUrl = getSentinaiL1RpcUrl();
      const check = await canRefill(l1RpcUrl, targetAddr as `0x${string}`);

      if (!check.allowed) {
        logger.info(`[RemediationAgent:${this.instanceId}] EOA refill denied for ${role}: ${check.reason}`);
        return { action: 'eoa-refill', success: false, detail: `${role} refill denied: ${check.reason}` };
      }

      const result = await refillEOA(l1RpcUrl, targetAddr as `0x${string}`, role);

      if (result.success) {
        logger.info(
          `[RemediationAgent:${this.instanceId}] EOA refill executed: ${role} ${result.previousBalanceEth?.toFixed(4)} → ${result.newBalanceEth?.toFixed(4)} ETH`
        );
        return {
          action: 'eoa-refill',
          success: true,
          detail: `${role} refilled: ${result.previousBalanceEth?.toFixed(4)} → ${result.newBalanceEth?.toFixed(4)} ETH (tx: ${result.txHash})`,
        };
      }

      return { action: 'eoa-refill', success: false, detail: `${role} refill failed: ${result.reason}` };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[RemediationAgent:${this.instanceId}] EOA refill error: ${message}`);
      return { action: 'eoa-refill', success: false, detail: `${role} refill error: ${message}` };
    }
  }

  // ============================================================
  // reliability-issue → L1 failover
  // ============================================================

  private async handleReliabilityIssue(event: AgentEvent): Promise<void> {
    const issues = event.payload['issues'] as Array<{
      type: string;
      detail: string;
    }> | undefined;
    if (!issues || issues.length === 0) return;

    const results: RemediationResult[] = [];

    for (const issue of issues) {
      if (issue.type === 'l1-rpc-unhealthy' || issue.type === 'l1-consecutive-failures') {
        const result = await this.executeL1Failover(issue.detail);
        results.push(result);
        break; // One failover per event is sufficient
      }
    }

    if (results.length > 0) {
      this.actionCount += results.length;
      this.lastActivityAt = new Date().toISOString();

      const bus = getAgentEventBus();
      bus.emit({
        type: 'remediation-complete',
        instanceId: this.instanceId,
        payload: {
          trigger: 'reliability-issue',
          results,
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length,
        },
        timestamp: new Date().toISOString(),
        correlationId: event.correlationId,
      });
    }
  }

  private async executeL1Failover(reason: string): Promise<RemediationResult> {
    try {
      const { executeFailover } = await import('@/lib/l1-rpc-failover');
      const event = await executeFailover(`RemediationAgent: ${reason}`);

      if (event) {
        logger.info(
          `[RemediationAgent:${this.instanceId}] L1 failover executed: ${event.fromUrl} → ${event.toUrl}`
        );
        return {
          action: 'l1-failover',
          success: true,
          detail: `L1 RPC failover: switched to ${event.toUrl}`,
        };
      }

      return { action: 'l1-failover', success: false, detail: 'No failover target available' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[RemediationAgent:${this.instanceId}] L1 failover error: ${message}`);
      return { action: 'l1-failover', success: false, detail: `Failover error: ${message}` };
    }
  }

  // ============================================================
  // rca-result → log remediation advice
  // ============================================================

  private async handleRCAResult(event: AgentEvent): Promise<void> {
    const rcaResult = event.payload['rcaResult'] as {
      rootCause?: { component: string; description: string; confidence: number };
      remediations?: Array<{ action: string; priority: string }>;
    } | undefined;
    if (!rcaResult?.rootCause) return;

    this.actionCount += 1;
    this.lastActivityAt = new Date().toISOString();

    const { rootCause, remediations } = rcaResult;
    const remediationSummary = remediations?.map(r => r.action).join('; ') ?? 'none';

    logger.info(
      `[RemediationAgent:${this.instanceId}] RCA remediation advice: component=${rootCause.component}, ` +
      `cause="${rootCause.description}" (confidence=${rootCause.confidence.toFixed(2)}), ` +
      `remediations=[${remediationSummary}]`
    );

    const bus = getAgentEventBus();
    bus.emit({
      type: 'remediation-complete',
      instanceId: this.instanceId,
      payload: {
        trigger: 'rca-result',
        results: [{
          action: 'rca-remediation-logged',
          success: true,
          detail: `RCA: ${rootCause.description} → ${remediationSummary}`,
        }],
        successCount: 1,
        failureCount: 0,
      },
      timestamp: new Date().toISOString(),
      correlationId: event.correlationId,
    });
  }
}
