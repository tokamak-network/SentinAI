/**
 * Layer 3: Alert Dispatcher (Redis-backed)
 * Slack/Webhook alert dispatch and cooldown management
 */

import { MetricDataPoint } from '@/types/prediction';
import {
  DeepAnalysisResult,
  AlertConfig,
  AlertRecord,
  AlertChannel,
  AnomalyResult
} from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';
import { getStore } from '@/lib/redis-store';
import logger from '@/lib/logger';

// ============================================================================
// Dead Letter Queue (DLQ)
// ============================================================================

interface FailedAlert {
  id: string;
  payload: object;
  webhookUrl: string;
  error: string;
  attempts: number;
  firstFailedAt: number;
  lastAttemptAt: number;
}

let failedAlerts: FailedAlert[] = [];
const MAX_DLQ_SIZE = 100;

function addToDeadLetterQueue(webhookUrl: string, payload: object, error: string): void {
  const entry: FailedAlert = {
    id: crypto.randomUUID(),
    payload,
    webhookUrl,
    error,
    attempts: 1,
    firstFailedAt: Date.now(),
    lastAttemptAt: Date.now(),
  };
  failedAlerts.push(entry);
  if (failedAlerts.length > MAX_DLQ_SIZE) {
    failedAlerts = failedAlerts.slice(-MAX_DLQ_SIZE);
  }
  logger.warn(`[AlertDispatcher] Alert added to DLQ: ${entry.id} (${error})`);
}

export function getDeadLetterQueue(): FailedAlert[] {
  return [...failedAlerts];
}

export function getDeadLetterQueueSize(): number {
  return failedAlerts.length;
}

export async function retryDeadLetterQueue(): Promise<{ succeeded: number; failed: number }> {
  let succeeded = 0;
  let failed = 0;
  const remaining: FailedAlert[] = [];

  for (const entry of failedAlerts) {
    const result = await sendWebhookWithRetry(entry.webhookUrl, entry.payload);
    if (result.success) {
      succeeded++;
    } else {
      entry.attempts++;
      entry.lastAttemptAt = Date.now();
      entry.error = result.error || entry.error;
      remaining.push(entry);
      failed++;
    }
  }

  failedAlerts = remaining;
  return { succeeded, failed };
}

// ============================================================================
// Webhook Delivery with Retry
// ============================================================================

/**
 * Send a webhook with timeout, retry with exponential backoff.
 * Non-retryable: 4xx (except 429). Retryable: 5xx, 429, timeout, network errors.
 */
async function sendWebhookWithRetry(
  url: string,
  payload: object,
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const timeoutMs = parseInt(process.env.WEBHOOK_TIMEOUT_MS || '5000', 10);
  const maxAttempts = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3', 10);
  const baseBackoffMs = parseInt(process.env.WEBHOOK_RETRY_BACKOFF_MS || '100', 10);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        return { success: true, statusCode: response.status };
      }

      // Non-retryable 4xx (except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return { success: false, statusCode: response.status, error: `HTTP ${response.status}` };
      }

      // Retryable (5xx or 429)
      throw new Error(`HTTP ${response.status}`);
    } catch (err) {
      clearTimeout(timer);
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isAbort = err instanceof Error && err.name === 'AbortError';

      if (attempt < maxAttempts) {
        const delay = baseBackoffMs * Math.pow(2, attempt - 1);
        logger.warn(`[AlertDispatcher] Webhook attempt ${attempt}/${maxAttempts} failed (${isAbort ? 'timeout' : errorMessage}), retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return {
        success: false,
        error: `Failed after ${maxAttempts} attempts: ${isAbort ? `timeout after ${timeoutMs}ms` : errorMessage}`,
      };
    }
  }

  return { success: false, error: 'Unexpected: exhausted retry loop' };
}

// ============================================================================
// Slack Message Formatting
// ============================================================================

/**
 * Generate a Slack Block Kit formatted message
 */
export function formatSlackMessage(
  analysis: DeepAnalysisResult,
  metrics: MetricDataPoint,
  anomalies: AnomalyResult[]
): object {
  const severityEmoji: Record<AISeverity, string> = {
    low: ':large_blue_circle:',
    medium: ':large_yellow_circle:',
    high: ':large_orange_circle:',
    critical: ':red_circle:',
  };

  const typeEmoji: Record<string, string> = {
    performance: ':chart_with_upwards_trend:',
    security: ':shield:',
    consensus: ':link:',
    liveness: ':heartbeat:',
  };

  const anomalySummary = anomalies
    .map(a => `• \`${a.metric}\`: ${a.description}`)
    .join('\n');

  const actionsList = analysis.suggestedActions
    .map((action, i) => `${i + 1}. ${action}`)
    .join('\n');

  return {
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${severityEmoji[analysis.severity]} SentinAI Anomaly Alert`,
          emoji: true,
        },
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Severity:*\n${analysis.severity.toUpperCase()}`,
          },
          {
            type: 'mrkdwn',
            text: `*Type:*\n${typeEmoji[analysis.anomalyType] || ''} ${analysis.anomalyType}`,
          },
          {
            type: 'mrkdwn',
            text: `*Components:*\n${analysis.relatedComponents.join(', ') || 'Unknown'}`,
          },
          {
            type: 'mrkdwn',
            text: `*Time:*\n${new Date().toISOString()}`,
          },
        ],
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Detected Anomalies:*\n${anomalySummary}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Impact:*\n${analysis.predictedImpact}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Correlations:*\n${analysis.correlations.join(', ') || 'None identified'}`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Suggested Actions:*\n${actionsList || 'No specific actions recommended'}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Current Metrics: CPU ${metrics.cpuUsage.toFixed(1)}% | TxPool ${metrics.txPoolPending} | Block #${metrics.blockHeight}`,
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate UUID v4 (simple implementation)
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Check if an anomaly type is in cooldown
 */
async function isInCooldown(anomalyType: string): Promise<boolean> {
  const store = getStore();
  const config = await store.getAlertConfig();
  const lastAlert = await store.getLastAlertTime(anomalyType);

  if (!lastAlert) return false;

  const cooldownMs = config.thresholds.cooldownMinutes * 60 * 1000;
  return Date.now() - lastAlert < cooldownMs;
}

/**
 * Check if severity level qualifies for notification
 */
async function shouldNotifyForSeverity(severity: AISeverity): Promise<boolean> {
  const store = getStore();
  const config = await store.getAlertConfig();
  return config.thresholds.notifyOn.includes(severity);
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Dispatch an alert
 *
 * @param analysis AI deep analysis result
 * @param metrics Current metrics
 * @param anomalies List of detected anomalies
 * @returns Dispatched alert record (null if not dispatched)
 */
export async function dispatchAlert(
  analysis: DeepAnalysisResult,
  metrics: MetricDataPoint,
  anomalies: AnomalyResult[]
): Promise<AlertRecord | null> {
  const store = getStore();
  const config = await store.getAlertConfig();

  // 1. Check if alerts are enabled
  if (!config.enabled) {
    logger.info('[AlertDispatcher] Alerts disabled, skipping');
    return null;
  }

  // 2. Check severity level
  if (!(await shouldNotifyForSeverity(analysis.severity))) {
    logger.info(`[AlertDispatcher] Severity ${analysis.severity} not in notify list, skipping`);
    return null;
  }

  // 3. Check cooldown
  if (await isInCooldown(analysis.anomalyType)) {
    logger.info(`[AlertDispatcher] Anomaly type ${analysis.anomalyType} in cooldown, skipping`);
    return null;
  }

  // 4. Create alert record
  const channel: AlertChannel = config.webhookUrl ? 'slack' : 'dashboard';
  const record: AlertRecord = {
    id: generateUUID(),
    anomaly: anomalies[0], // Representative anomaly
    analysis,
    sentAt: new Date().toISOString(),
    channel,
    success: false,
  };

  // 5. Send webhook (if URL configured)
  if (config.webhookUrl) {
    const slackMessage = formatSlackMessage(analysis, metrics, anomalies);
    const webhookResult = await sendWebhookWithRetry(config.webhookUrl, slackMessage);

    if (webhookResult.success) {
      record.success = true;
      logger.info(`[AlertDispatcher] Alert sent to Slack: ${analysis.severity} ${analysis.anomalyType}`);
    } else {
      record.error = webhookResult.error;
      addToDeadLetterQueue(config.webhookUrl, slackMessage, webhookResult.error || 'Unknown error');
      logger.error('[AlertDispatcher] Webhook error:', webhookResult.error);
    }
  } else {
    // Dashboard-only alert
    record.success = true;
    logger.info(`[AlertDispatcher] Dashboard alert recorded: ${analysis.severity} ${analysis.anomalyType}`);
  }

  // 6. Update state
  await store.setLastAlertTime(analysis.anomalyType, Date.now());
  await store.addAlertToHistory(record);

  return record;
}

// ============================================================================
// Configuration Management
// ============================================================================

/**
 * Get current alert configuration
 */
export async function getAlertConfig(): Promise<AlertConfig> {
  const store = getStore();
  return store.getAlertConfig();
}

/**
 * Update alert configuration
 */
export async function updateAlertConfig(updates: Partial<AlertConfig>): Promise<AlertConfig> {
  const store = getStore();
  const current = await store.getAlertConfig();

  if (updates.webhookUrl !== undefined) {
    current.webhookUrl = updates.webhookUrl;
  }
  if (updates.enabled !== undefined) {
    current.enabled = updates.enabled;
  }
  if (updates.thresholds) {
    if (updates.thresholds.notifyOn) {
      current.thresholds.notifyOn = updates.thresholds.notifyOn;
    }
    if (updates.thresholds.cooldownMinutes !== undefined) {
      current.thresholds.cooldownMinutes = updates.thresholds.cooldownMinutes;
    }
  }

  await store.setAlertConfig(current);
  return current;
}

/**
 * Get alert history (last 24 hours)
 */
export async function getAlertHistory(): Promise<AlertRecord[]> {
  const store = getStore();
  return store.getAlertHistory();
}

/**
 * Get next available alert time (when in cooldown)
 */
export async function getNextAlertAvailableAt(anomalyType: string): Promise<number | null> {
  const store = getStore();
  const config = await store.getAlertConfig();
  const lastAlert = await store.getLastAlertTime(anomalyType);

  if (!lastAlert) return null;

  const cooldownMs = config.thresholds.cooldownMinutes * 60 * 1000;
  const nextAvailable = lastAlert + cooldownMs;

  return Date.now() < nextAvailable ? nextAvailable : null;
}

/**
 * Reset alert history (for testing)
 */
export async function clearAlertHistory(): Promise<void> {
  const store = getStore();
  await store.clearAlertHistory();
}
