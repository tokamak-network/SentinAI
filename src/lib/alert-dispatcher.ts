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
    console.log('[AlertDispatcher] Alerts disabled, skipping');
    return null;
  }

  // 2. Check severity level
  if (!(await shouldNotifyForSeverity(analysis.severity))) {
    console.log(`[AlertDispatcher] Severity ${analysis.severity} not in notify list, skipping`);
    return null;
  }

  // 3. Check cooldown
  if (await isInCooldown(analysis.anomalyType)) {
    console.log(`[AlertDispatcher] Anomaly type ${analysis.anomalyType} in cooldown, skipping`);
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
    try {
      const slackMessage = formatSlackMessage(analysis, metrics, anomalies);

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slackMessage),
      });

      if (!response.ok) {
        throw new Error(`Webhook responded with ${response.status}`);
      }

      record.success = true;
      console.log(`[AlertDispatcher] Alert sent to Slack: ${analysis.severity} ${analysis.anomalyType}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      record.error = errorMessage;
      console.error('[AlertDispatcher] Webhook error:', errorMessage);
    }
  } else {
    // Dashboard-only alert
    record.success = true;
    console.log(`[AlertDispatcher] Dashboard alert recorded: ${analysis.severity} ${analysis.anomalyType}`);
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
