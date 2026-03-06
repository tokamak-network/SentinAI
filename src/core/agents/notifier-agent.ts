/**
 * Notifier Agent — Sends Slack/Webhook notifications for domain agent events
 *
 * Event-reactive agent: subscribes to cost-insight, verification-complete,
 * remediation-complete and dispatches Slack notifications via ALERT_WEBHOOK_URL.
 *
 * This ensures V2 agent pipeline sends alerts independently of the browser
 * dashboard polling (which triggered alerts via V1's detection-pipeline.ts).
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

// ============================================================
// NotifierAgent
// ============================================================

export class NotifierAgent implements RoleAgent {
  readonly instanceId: string;

  private running = false;
  private notificationCount = 0;
  private lastActivityAt: string | null = null;

  private readonly costHandler: AgentEventHandler;
  private readonly verificationHandler: AgentEventHandler;
  private readonly remediationHandler: AgentEventHandler;

  constructor(config: { instanceId: string }) {
    this.instanceId = config.instanceId;

    this.costHandler = (event: AgentEvent) => {
      if (event.instanceId !== this.instanceId) return;
      void this.handleCostInsight(event);
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
    bus.on('verification-complete', this.verificationHandler);
    bus.on('remediation-complete', this.remediationHandler);
    logger.info(`[NotifierAgent:${this.instanceId}] Subscribed to cost-insight, verification-complete, remediation-complete`);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    const bus = getAgentEventBus();
    bus.off('cost-insight', this.costHandler);
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

    const lines = [
      ':moneybag: *SentinAI Cost Insight*',
      `Instance: \`${this.instanceId}\``,
      `Time: ${event.timestamp}`,
      '',
      `*${insights.length} optimization opportunity(s) — potential savings: $${totalSavings.toFixed(2)}/mo*`,
      '',
      ...insights.map(i => `- ${i.detail} (saves $${i.savingsUsd.toFixed(2)}/mo)`),
    ];

    await this.sendSlackNotification(lines.join('\n'));
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

    const lines = [
      ':warning: *SentinAI Verification Failed*',
      `Instance: \`${this.instanceId}\``,
      `Time: ${event.timestamp}`,
      '',
      `*Expected:* ${record.expectedVcpu} vCPU`,
      `*Observed:* ${record.observedVcpu} vCPU`,
      `*Detail:* ${record.detail}`,
    ];

    await this.sendSlackNotification(lines.join('\n'));
  }

  private async handleRemediationComplete(event: AgentEvent): Promise<void> {
    const trigger = event.payload['trigger'] as string ?? 'unknown';
    const results = event.payload['results'] as Array<{
      action: string;
      success: boolean;
      detail: string;
    }> | undefined;

    if (!results || results.length === 0) return;

    const successCount = (event.payload['successCount'] as number) ?? 0;
    const failureCount = (event.payload['failureCount'] as number) ?? 0;

    const emoji = failureCount > 0 ? ':rotating_light:' : ':white_check_mark:';
    const lines = [
      `${emoji} *SentinAI Remediation ${failureCount > 0 ? 'Alert' : 'Complete'}*`,
      `Instance: \`${this.instanceId}\``,
      `Trigger: ${trigger}`,
      `Time: ${event.timestamp}`,
      '',
      `*Results:* ${successCount} succeeded, ${failureCount} failed`,
      '',
      ...results.map(r => `${r.success ? ':white_check_mark:' : ':x:'} [${r.action}] ${r.detail}`),
    ];

    await this.sendSlackNotification(lines.join('\n'));
  }

  // ============================================================
  // Webhook delivery
  // ============================================================

  private async sendSlackNotification(text: string): Promise<void> {
    const webhookUrl = await this.getWebhookUrl();
    if (!webhookUrl) {
      logger.debug(`[NotifierAgent:${this.instanceId}] No webhook URL configured, skipping notification`);
      return;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
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
