/**
 * Notifier Agent — Operator-facing Slack notifications
 *
 * Design principle: agents handle everything autonomously. The operator
 * only receives notifications when:
 *   1. An agent action FAILED and needs human attention
 *   2. A significant state change was EXECUTED (scaling applied)
 *
 * Suppressed (handled silently by agents):
 *   - Cost insights (agent auto-applies schedule)
 *   - Successful remediation (refill worked)
 *   - L1 RPC health-check failures (auto-failover handles these)
 *   - Scaling schedule creation without execution
 *   - Verification success
 *
 * Always notified (even on success):
 *   - L1 RPC failover result (success or failure)
 *
 * Cooldown per event type prevents duplicate alerts.
 */

import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getStore } from '@/lib/redis-store';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { RoleAgent } from '@/core/agent-orchestrator';

const logger = createLogger('NotifierAgent');

// ============================================================
// Constants
// ============================================================

const WEBHOOK_TIMEOUT_MS = 5_000;

/** Per-event-type cooldown in milliseconds */
const COOLDOWN_MS: Record<string, number> = {
  'scaling-recommendation': 60 * 60 * 1000, // 1 hour
  'verification-complete': 10 * 60 * 1000,  // 10 min
  'remediation-complete': 10 * 60 * 1000,   // 10 min
  'reliability-issue': 5 * 60 * 1000,       // 5 min
};

// ============================================================
// Slack Block Kit Helpers
// ============================================================

function header(emoji: string, title: string) {
  return {
    type: 'header' as const,
    text: { type: 'plain_text' as const, text: `${emoji} ${title}`, emoji: true },
  };
}

function fields(...pairs: [string, string][]) {
  return {
    type: 'section' as const,
    fields: pairs.map(([label, value]) => ({
      type: 'mrkdwn' as const,
      text: `*${label}:*\n${value}`,
    })),
  };
}

function section(text: string) {
  return {
    type: 'section' as const,
    text: { type: 'mrkdwn' as const, text },
  };
}

function divider() {
  return { type: 'divider' as const };
}

function context(text: string) {
  return {
    type: 'context' as const,
    elements: [{ type: 'mrkdwn' as const, text }],
  };
}

// ============================================================
// NotifierAgent
// ============================================================

export class NotifierAgent implements RoleAgent {
  readonly instanceId: string;

  private running = false;
  private notificationCount = 0;
  private lastActivityAt: string | null = null;

  /** Last notification timestamp per event type for cooldown */
  private lastNotifiedAt = new Map<string, number>();

  private readonly scalingRecommendationHandler: AgentEventHandler;
  private readonly verificationHandler: AgentEventHandler;
  private readonly remediationHandler: AgentEventHandler;
  private readonly reliabilityHandler: AgentEventHandler;

  constructor(config: { instanceId: string }) {
    this.instanceId = config.instanceId;

    this.scalingRecommendationHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleScalingRecommendation(event);
    };

    this.verificationHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleVerificationComplete(event);
    };

    this.remediationHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleRemediationComplete(event);
    };

    this.reliabilityHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleReliabilityIssue(event);
    };
  }

  start(): void {
    if (this.running) {
      logger.warn(`[NotifierAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    const bus = getAgentEventBus();
    bus.on('scaling-recommendation', this.scalingRecommendationHandler);
    bus.on('verification-complete', this.verificationHandler);
    bus.on('remediation-complete', this.remediationHandler);
    bus.on('reliability-issue', this.reliabilityHandler);
    logger.info(`[NotifierAgent:${this.instanceId}] Subscribed to scaling-recommendation, verification-complete, remediation-complete, reliability-issue`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const bus = getAgentEventBus();
    bus.off('scaling-recommendation', this.scalingRecommendationHandler);
    bus.off('verification-complete', this.verificationHandler);
    bus.off('remediation-complete', this.remediationHandler);
    bus.off('reliability-issue', this.reliabilityHandler);
    logger.info(`[NotifierAgent:${this.instanceId}] Unsubscribed`);
  }

  isRunning(): boolean {
    return this.running;
  }

  getNotificationCount(): number {
    return this.notificationCount;
  }

  getLastActivityAt(): string | null {
    return this.lastActivityAt;
  }

  // ============================================================
  // Cooldown
  // ============================================================

  private isInCooldown(eventType: string): boolean {
    const cooldownMs = COOLDOWN_MS[eventType] ?? 10 * 60 * 1000;
    const lastSent = this.lastNotifiedAt.get(eventType);
    const now = Date.now();

    if (lastSent && now - lastSent < cooldownMs) {
      logger.debug(`[NotifierAgent:${this.instanceId}] ${eventType} in cooldown, suppressing`);
      return true;
    }

    this.lastNotifiedAt.set(eventType, now);
    return false;
  }

  // ============================================================
  // Event handlers
  // ============================================================

  /**
   * Scaling schedule: only notify when scaling was actually executed.
   * Schedule creation without execution is silent — agent handled it.
   */
  private async handleScalingRecommendation(event: AgentEvent): Promise<void> {
    const source = event.payload['source'] as string | undefined;
    if (source !== 'cost-insight') return;

    const execution = event.payload['execution'] as {
      executed: boolean;
      previousVcpu: number;
      targetVcpu: number;
      message: string;
      skippedReason?: string;
    } | undefined;

    // Only notify when scaling was actually applied
    if (!execution?.executed) return;
    if (this.isInCooldown('scaling-recommendation')) return;

    const profile = event.payload['profile'] as {
      id: string;
      avgDailyVcpu: number;
      estimatedMonthlySavings: number;
      coveragePct: number;
    } | undefined;

    const blocks = [
      header(':chart_with_upwards_trend:', 'SentinAI Scaling Applied'),
      fields(['Time', event.timestamp]),
      divider(),
      fields(
        ['Change', `${execution.previousVcpu} → ${execution.targetVcpu} vCPU`],
        ['Trigger', 'Cost-based schedule'],
        ...(profile ? [
          ['Est. Savings', `$${profile.estimatedMonthlySavings.toFixed(2)}/mo`] as [string, string],
        ] : []),
      ),
      context('SentinAI Agent V2 • Auto-applied by Cost Agent'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  /**
   * Verification: only notify on FAILURE — success means agent handled it.
   */
  private async handleVerificationComplete(event: AgentEvent): Promise<void> {
    const record = event.payload['operationRecord'] as {
      executed: boolean;
      passed: boolean;
      detail: string;
      expectedVcpu: number;
      observedVcpu: number;
    } | undefined;

    if (!record || !record.executed || record.passed) return;
    if (this.isInCooldown('verification-complete')) return;

    const blocks = [
      header(':warning:', 'SentinAI Action Required — Verification Failed'),
      fields(['Time', event.timestamp]),
      divider(),
      fields(
        ['Expected', `${record.expectedVcpu} vCPU`],
        ['Observed', `${record.observedVcpu} vCPU`],
      ),
      section(`*Detail:* ${record.detail}`),
      context('Automatic scaling was attempted but the result does not match. Manual review recommended.'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  /**
   * Remediation: notify on failure for all types, and also on success
   * for L1 failover (so operator sees the endpoint switch result).
   */
  private async handleRemediationComplete(event: AgentEvent): Promise<void> {
    const trigger = event.payload['trigger'] as string ?? 'unknown';
    const results = event.payload['results'] as Array<{
      action: string;
      success: boolean;
      detail: string;
    }> | undefined;

    if (!results || results.length === 0) return;

    const failureCount = (event.payload['failureCount'] as number) ?? 0;
    const successCount = (event.payload['successCount'] as number) ?? 0;

    // L1 failover: always notify (success or failure) so operator sees the result
    const hasL1Failover = results.some(r => r.action === 'l1-failover');

    if (hasL1Failover) {
      if (this.isInCooldown('remediation-complete')) return;

      const failoverResult = results.find(r => r.action === 'l1-failover')!;

      if (failoverResult.success) {
        const blocks = [
          header(':white_check_mark:', 'SentinAI L1 RPC Failover Complete'),
          fields(
            ['Time', event.timestamp],
          ),
          divider(),
          section(`:arrows_counterclockwise: ${failoverResult.detail}`),
          context('SentinAI Reliability Agent • L1 RPC endpoint switched automatically — no action required'),
        ];
        await this.sendSlackBlocks(blocks);
      } else {
        const blocks = [
          header(':rotating_light:', 'SentinAI Action Required — L1 RPC Failover Failed'),
          fields(
            ['Time', event.timestamp],
          ),
          divider(),
          section(`:x: ${failoverResult.detail}`),
          context('Automatic L1 RPC failover was attempted but failed. Manual intervention required.'),
        ];
        await this.sendSlackBlocks(blocks);
      }
      return;
    }

    // Other remediation: only notify on failure — success is silent
    if (failureCount === 0) return;
    if (this.isInCooldown('remediation-complete')) return;

    const failedResults = results.filter(r => !r.success);

    const blocks = [
      header(':rotating_light:', 'SentinAI Action Required — Remediation Failed'),
      fields(
        ['Trigger', trigger],
        ['Time', event.timestamp],
      ),
      divider(),
      section(failedResults.map(r => `:x: \`${r.action}\` ${r.detail}`).join('\n')),
      context('Automatic remediation was attempted but failed. Manual intervention required.'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  /**
   * Reliability issues: only notify for proxyd backend replacements.
   * L1 RPC health-check failures (l1-rpc-unhealthy, l1-consecutive-failures)
   * are suppressed here — they trigger automatic failover via RemediationAgent,
   * and the operator is notified of the failover result instead.
   */
  private async handleReliabilityIssue(event: AgentEvent): Promise<void> {
    const issues = event.payload['issues'] as Array<{
      type: string;
      detail: string;
    }> | undefined;

    if (!issues || issues.length === 0) return;

    // Only notify for proxyd backend replacements; L1 RPC issues are handled by auto-failover
    const proxydIssues = issues.filter(i => i.type === 'proxyd-backend-replaced');
    if (proxydIssues.length === 0) return;
    if (this.isInCooldown('reliability-issue')) return;

    const issueLines = proxydIssues.map(i => `:arrows_counterclockwise: ${i.detail}`);

    const blocks = [
      header(':arrows_counterclockwise:', 'SentinAI L1 Proxyd Backend Replaced'),
      fields(['Time', event.timestamp]),
      divider(),
      section(issueLines.join('\n')),
      context('SentinAI Reliability Agent • Proxyd backend replaced automatically'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  // ============================================================
  // Webhook delivery
  // ============================================================

  private async sendSlackBlocks(blocks: object[]): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      logger.debug(`[NotifierAgent:${this.instanceId}] No webhook URL configured, skipping notification`);
      return;
    }

    const fallbackText = (blocks[0] as { text?: { text?: string } })?.text?.text ?? 'SentinAI Notification';

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fallbackText, blocks }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });

      if (response.ok) {
        this.notificationCount += 1;
        this.lastActivityAt = new Date().toISOString();
        logger.info(`[NotifierAgent:${this.instanceId}] Notification sent`);
      } else {
        logger.warn(`[NotifierAgent:${this.instanceId}] Webhook responded ${response.status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[NotifierAgent:${this.instanceId}] Notification failed: ${message}`);
    }
  }

  private async getWebhookUrl(): Promise<string | null> {
    try {
      const store = getStore();
      const config = await store.getAlertConfig();
      if (config.webhookUrl) return config.webhookUrl;
    } catch {
      // Fallback to env
    }
    return process.env.ALERT_WEBHOOK_URL || null;
  }
}
