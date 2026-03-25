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
 *   - L1 RPC health-check failures (auto-failover handles these)
 *   - Scaling schedule creation without execution
 *   - Verification success
 *
 * Always notified (even on success):
 *   - EOA refill result (success or failure)
 *   - L1 RPC failover result (success or failure)
 *
 * Cooldown per event type prevents duplicate alerts.
 */

import { createLogger } from '@/lib/logger';
import { getAgentEventBus } from '@/core/agent-event-bus';
import { getStore } from '@/lib/redis-store';
import { getChainPlugin } from '@/chains';
import type { AgentEvent, AgentEventHandler } from '@/core/agent-event-bus';
import type { RoleAgent } from '@/core/agent-orchestrator';

const logger = createLogger('NotifierAgent');

// ============================================================
// Constants
// ============================================================

const WEBHOOK_TIMEOUT_MS = 5_000;

// ============================================================
// Formatting Helpers
// ============================================================

/** Format ISO timestamp → KST human-readable (e.g. "Mar 25, 14:30 KST") */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('en-US', {
      timeZone: 'Asia/Seoul',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }) + ' KST';
  } catch {
    return iso;
  }
}

/** Get chain display name from plugin (e.g. "Thanos Sepolia") */
function getChainName(): string {
  try {
    const plugin = getChainPlugin();
    return plugin.l2Chain?.name ?? 'Unknown Chain';
  } catch {
    return 'Unknown Chain';
  }
}

/** Human-readable guidance for remediation failure reasons */
const REMEDIATION_GUIDANCE: Record<string, string> = {
  // EOA refill reasons
  'treasury-low': 'Treasury wallet ETH balance is below the minimum (EOA_TREASURY_MIN_ETH). Top up the treasury wallet.',
  'treasury-check-failed': 'Failed to query treasury balance via RPC. Check L1 RPC connectivity and endpoint configuration.',
  'no-signer': 'TREASURY_PRIVATE_KEY env var is not set. Configure the signing key.',
  'cooldown': 'Refill is in cooldown period (EOA_REFILL_COOLDOWN_MIN). Will auto-retry after cooldown expires.',
  'daily-limit': 'Daily refill limit (EOA_REFILL_MAX_DAILY_ETH) reached. Resets tomorrow or adjust the limit.',
  'gas-high': 'L1 gas price exceeds the guard threshold (EOA_GAS_GUARD_GWEI). Will auto-retry when gas drops.',
  'tx-reverted': 'Refill transaction reverted. Check treasury balance and target EOA address.',
  'tx-timeout': 'Refill transaction timed out. Check L1 network status.',
  // L1 failover reasons
  'no-failover-target': 'No backup L1 RPC endpoint available. Configure L1_RPC_BACKUP_URLS env var.',
};

/** Per-event-type cooldown in milliseconds */
const COOLDOWN_MS: Record<string, number> = {
  'scaling-recommendation': 60 * 60 * 1000, // 1 hour
  'verification-complete': 10 * 60 * 1000,  // 10 min
  'remediation-complete': 10 * 60 * 1000,   // 10 min
  'reliability-issue': 5 * 60 * 1000,       // 5 min
};

// ============================================================
// L1 Explorer Helper
// ============================================================

function getL1ExplorerTxUrl(txHash: string): string | null {
  try {
    const plugin = getChainPlugin();
    const explorerUrl = plugin.l1Chain.blockExplorers?.default?.url;
    if (!explorerUrl) return null;
    return `${explorerUrl.replace(/\/$/, '')}/tx/${txHash}`;
  } catch {
    return null;
  }
}

/** Append explorer link to a detail line if it contains a tx hash */
function appendTxLink(detail: string): string {
  const txMatch = detail.match(/\(tx:\s*(0x[0-9a-fA-F]+)\)/);
  if (!txMatch) return detail;
  const txHash = txMatch[1];
  const url = getL1ExplorerTxUrl(txHash);
  if (!url) return detail;
  return `${detail}\n:mag: <${url}|View on Explorer>`;
}

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

    const chain = getChainName();
    const blocks = [
      header(':chart_with_upwards_trend:', 'Scaling Applied'),
      fields(
        ['Chain', chain],
        ['Time', formatTimestamp(event.timestamp)],
      ),
      divider(),
      section(`:arrow_right:  \`${execution.previousVcpu} vCPU\`  →  \`${execution.targetVcpu} vCPU\``),
      ...(profile ? [
        fields(
          ['Est. Savings', `*$${profile.estimatedMonthlySavings.toFixed(2)}* /mo`],
          ['Trigger', 'Cost-based schedule'],
        ),
      ] : [
        fields(['Trigger', 'Cost-based schedule']),
      ]),
      context(`SentinAI • ${chain} • Cost Agent`),
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

    const chain = getChainName();
    const blocks = [
      header(':warning:', 'Action Required — Verification Failed'),
      fields(
        ['Chain', chain],
        ['Time', formatTimestamp(event.timestamp)],
      ),
      divider(),
      section(`:x:  Expected \`${record.expectedVcpu} vCPU\`  but observed \`${record.observedVcpu} vCPU\``),
      section(`> ${record.detail}`),
      context(`SentinAI • ${chain} • Manual review recommended`),
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

    // EOA refill: always notify (success or failure) so operator sees the result
    const hasEOARefill = results.some(r => r.action === 'eoa-refill');

    if (hasEOARefill) {
      if (this.isInCooldown('remediation-complete')) return;

      const refillResults = results.filter(r => r.action === 'eoa-refill');
      const allSuccess = refillResults.every(r => r.success);
      const allFailed = refillResults.every(r => !r.success);

      const chain = getChainName();
      const ts = formatTimestamp(event.timestamp);

      if (allSuccess) {
        const detailLines = refillResults.map(r => `:white_check_mark: ${appendTxLink(r.detail)}`).join('\n');
        const blocks = [
          header(':fuelpump:', 'EOA Refill Complete'),
          fields(['Chain', chain], ['Time', ts]),
          divider(),
          section(detailLines),
          context(`SentinAI • ${chain} • No action required`),
        ];
        await this.sendSlackBlocks(blocks);
      } else if (allFailed) {
        const failureLines = refillResults.map(r => {
          const reasonMatch = r.detail.match(/(?:denied|failed|error):\s*(\S+)/);
          const reasonKey = reasonMatch?.[1];
          const guidance = reasonKey ? REMEDIATION_GUIDANCE[reasonKey] : undefined;
          const line = `:x: ${r.detail}`;
          return guidance ? `${line}\n> :bulb: _${guidance}_` : line;
        }).join('\n\n');
        const blocks = [
          header(':rotating_light:', 'Action Required — EOA Refill Failed'),
          fields(['Chain', chain], ['Trigger', trigger]),
          fields(['Time', ts]),
          divider(),
          section(failureLines),
          context(`SentinAI • ${chain} • Manual intervention required`),
        ];
        await this.sendSlackBlocks(blocks);
      } else {
        const lines = refillResults.map(r => {
          const icon = r.success ? ':white_check_mark:' : ':x:';
          const text = r.success ? appendTxLink(r.detail) : r.detail;
          return `${icon} ${text}`;
        }).join('\n\n');
        const blocks = [
          header(':warning:', 'EOA Refill — Partial Failure'),
          fields(['Chain', chain], ['Trigger', trigger]),
          fields(['Time', ts]),
          divider(),
          section(lines),
          context(`SentinAI • ${chain} • Review failed items`),
        ];
        await this.sendSlackBlocks(blocks);
      }
      return;
    }

    // L1 failover: always notify (success or failure) so operator sees the result
    const hasL1Failover = results.some(r => r.action === 'l1-failover');

    if (hasL1Failover) {
      if (this.isInCooldown('remediation-complete')) return;

      const failoverResult = results.find(r => r.action === 'l1-failover')!;
      const rawFrom = (failoverResult as Record<string, unknown>).rawFromUrl as string | undefined;
      const rawTo = (failoverResult as Record<string, unknown>).rawToUrl as string | undefined;

      const chain = getChainName();
      const ts = formatTimestamp(event.timestamp);

      if (failoverResult.success) {
        const urlBlocks = (rawFrom && rawTo)
          ? [section(`:arrow_right:  \`${rawFrom}\`\n→  \`${rawTo}\``)]
          : [section(`:arrows_counterclockwise: ${failoverResult.detail}`)];

        const blocks = [
          header(':white_check_mark:', 'L1 RPC Failover Complete'),
          fields(['Chain', chain], ['Time', ts]),
          divider(),
          ...urlBlocks,
          context(`SentinAI • ${chain} • No action required`),
        ];
        await this.sendSlackBlocks(blocks);
      } else {
        const blocks = [
          header(':rotating_light:', 'Action Required — L1 RPC Failover Failed'),
          fields(['Chain', chain], ['Time', ts]),
          divider(),
          section(`:x: ${failoverResult.detail}`),
          ...(rawFrom ? [section(`*Last active:*  \`${rawFrom}\``)] : []),
          context(`SentinAI • ${chain} • Manual intervention required`),
        ];
        await this.sendSlackBlocks(blocks);
      }
      return;
    }

    // Other remediation: only notify on failure — success is silent
    if (failureCount === 0) return;
    if (this.isInCooldown('remediation-complete')) return;

    const chain = getChainName();
    const failedResults = results.filter(r => !r.success);

    const failureLines = failedResults.map(r => {
      const reasonMatch = r.detail.match(/(?:denied|failed|error):\s*(\S+)/);
      const reasonKey = reasonMatch?.[1];
      const guidance = reasonKey ? REMEDIATION_GUIDANCE[reasonKey] : undefined;
      const line = `:x: \`${r.action}\`  ${r.detail}`;
      return guidance ? `${line}\n> :bulb: _${guidance}_` : line;
    }).join('\n\n');

    const blocks = [
      header(':rotating_light:', 'Action Required — Remediation Failed'),
      fields(
        ['Chain', chain],
        ['Trigger', trigger],
      ),
      fields(['Time', formatTimestamp(event.timestamp)]),
      divider(),
      section(failureLines),
      fields(['Failed', `${failureCount} of ${failureCount + successCount}`]),
      context(`SentinAI • ${chain} • Manual intervention required`),
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

    const chain = getChainName();
    const issueLines = proxydIssues.map(i => `:arrows_counterclockwise: ${i.detail}`);

    const blocks = [
      header(':arrows_counterclockwise:', 'L1 Proxyd Backend Replaced'),
      fields(['Chain', chain], ['Time', formatTimestamp(event.timestamp)]),
      divider(),
      section(issueLines.join('\n')),
      context(`SentinAI • ${chain} • Auto-replaced`),
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
