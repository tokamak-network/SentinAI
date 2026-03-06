/**
 * Notifier Agent — Sends Slack/Webhook notifications for domain agent events
 *
 * Event-reactive agent: subscribes to cost-insight, scaling-recommendation,
 * verification-complete, remediation-complete and dispatches Slack Block Kit
 * notifications via ALERT_WEBHOOK_URL.
 *
 * Cooldown per event type prevents notification flooding.
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
  'cost-insight': 60 * 60 * 1000,          // 1 hour
  'scaling-recommendation': 60 * 60 * 1000, // 1 hour
  'verification-complete': 10 * 60 * 1000,  // 10 min
  'remediation-complete': 10 * 60 * 1000,   // 10 min
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

  private readonly costHandler: AgentEventHandler;
  private readonly scalingRecommendationHandler: AgentEventHandler;
  private readonly verificationHandler: AgentEventHandler;
  private readonly remediationHandler: AgentEventHandler;

  constructor(config: { instanceId: string }) {
    this.instanceId = config.instanceId;

    this.costHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleCostInsight(event);
    };

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
  }

  start(): void {
    if (this.running) {
      logger.warn(`[NotifierAgent:${this.instanceId}] Already running, ignoring start()`);
      return;
    }

    this.running = true;
    const bus = getAgentEventBus();
    bus.on('cost-insight', this.costHandler);
    bus.on('scaling-recommendation', this.scalingRecommendationHandler);
    bus.on('verification-complete', this.verificationHandler);
    bus.on('remediation-complete', this.remediationHandler);
    logger.info(`[NotifierAgent:${this.instanceId}] Subscribed to cost-insight, scaling-recommendation, verification-complete, remediation-complete`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const bus = getAgentEventBus();
    bus.off('cost-insight', this.costHandler);
    bus.off('scaling-recommendation', this.scalingRecommendationHandler);
    bus.off('verification-complete', this.verificationHandler);
    bus.off('remediation-complete', this.remediationHandler);
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

  /**
   * Returns true if the event type is in cooldown (should be suppressed).
   * Updates the last notified timestamp on first call / after cooldown expires.
   */
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

  private async handleCostInsight(event: AgentEvent): Promise<void> {
    const insights = event.payload['insights'] as Array<{
      type: string;
      detail: string;
      savingsUsd: number;
    }> | undefined;
    const totalSavings = (event.payload['totalPotentialSavingsUsd'] as number) ?? 0;

    if (!insights || insights.length === 0) return;
    if (this.isInCooldown('cost-insight')) return;

    const blocks = [
      header(':moneybag:', 'SentinAI Cost Insight'),
      fields(['Time', event.timestamp]),
      divider(),
      section(`*${insights.length} optimization opportunity(s) — potential savings: $${totalSavings.toFixed(2)}/mo*`),
      section(insights.map(i => `• ${i.detail} _(saves $${i.savingsUsd.toFixed(2)}/mo)_`).join('\n')),
      context('SentinAI Agent V2 • Cost Agent'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  private async handleScalingRecommendation(event: AgentEvent): Promise<void> {
    const source = event.payload['source'] as string | undefined;
    if (source !== 'cost-insight') return;

    const profile = event.payload['profile'] as {
      id: string;
      avgDailyVcpu: number;
      estimatedMonthlySavings: number;
      coveragePct: number;
    } | undefined;
    const execution = event.payload['execution'] as {
      executed: boolean;
      previousVcpu: number;
      targetVcpu: number;
      message: string;
      skippedReason?: string;
    } | undefined;
    const recommendation = event.payload['recommendation'] as {
      title: string;
      savings: number;
      confidence: number;
    } | undefined;

    if (!profile || !execution) return;
    if (this.isInCooldown('scaling-recommendation')) return;

    const emoji = execution.executed ? ':chart_with_upwards_trend:' : ':clipboard:';
    const title = execution.executed ? 'Scaling Schedule Applied' : 'Scaling Schedule Created';
    const statusText = execution.executed
      ? `${execution.previousVcpu} → ${execution.targetVcpu} vCPU`
      : execution.skippedReason ?? 'pending';

    const blocks = [
      header(emoji, `SentinAI ${title}`),
      fields(['Time', event.timestamp]),
      divider(),
      fields(
        ['Avg vCPU/day', `${profile.avgDailyVcpu}`],
        ['Coverage', `${profile.coveragePct}%`],
        ['Est. Savings', `$${profile.estimatedMonthlySavings.toFixed(2)}/mo`],
        ['Status', statusText],
      ),
      ...(recommendation ? [
        context(`Confidence: ${(recommendation.confidence * 100).toFixed(0)}% • SentinAI Agent V2 • Cost Agent → Scheduled Scaler`),
      ] : [
        context('SentinAI Agent V2 • Cost Agent → Scheduled Scaler'),
      ]),
    ];

    await this.sendSlackBlocks(blocks);
  }

  private async handleVerificationComplete(event: AgentEvent): Promise<void> {
    const record = event.payload['operationRecord'] as {
      executed: boolean;
      passed: boolean;
      detail: string;
      expectedVcpu: number;
      observedVcpu: number;
    } | undefined;

    // Only notify on failures
    if (!record || !record.executed || record.passed) return;
    if (this.isInCooldown('verification-complete')) return;

    const blocks = [
      header(':warning:', 'SentinAI Verification Failed'),
      fields(['Time', event.timestamp]),
      divider(),
      fields(
        ['Expected', `${record.expectedVcpu} vCPU`],
        ['Observed', `${record.observedVcpu} vCPU`],
      ),
      section(`*Detail:* ${record.detail}`),
      context('SentinAI Agent V2 • Verifier Agent'),
    ];

    await this.sendSlackBlocks(blocks);
  }

  private async handleRemediationComplete(event: AgentEvent): Promise<void> {
    const trigger = event.payload['trigger'] as string ?? 'unknown';
    const results = event.payload['results'] as Array<{
      action: string;
      success: boolean;
      detail: string;
    }> | undefined;

    if (!results || results.length === 0) return;
    if (this.isInCooldown('remediation-complete')) return;

    const successCount = (event.payload['successCount'] as number) ?? 0;
    const failureCount = (event.payload['failureCount'] as number) ?? 0;

    const emoji = failureCount > 0 ? ':rotating_light:' : ':white_check_mark:';
    const title = failureCount > 0 ? 'Remediation Alert' : 'Remediation Complete';

    const resultLines = results
      .map(r => `${r.success ? ':white_check_mark:' : ':x:'} \`${r.action}\` ${r.detail}`)
      .join('\n');

    const blocks = [
      header(emoji, `SentinAI ${title}`),
      fields(
        ['Trigger', trigger],
        ['Time', event.timestamp],
        ['Results', `${successCount} succeeded, ${failureCount} failed`],
      ),
      divider(),
      section(resultLines),
      context('SentinAI Agent V2 • Remediation Agent'),
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

    // Fallback text for clients that don't support blocks
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
