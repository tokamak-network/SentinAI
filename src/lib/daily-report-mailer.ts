/**
 * Daily Report Mailer Module
 * Delivers daily reports via Slack webhook (Slack Block Kit format)
 */

import { readExistingReport } from './daily-report-generator';

// ============================================================================
// Types
// ============================================================================

export interface DeliveryResult {
  success: boolean;
  method: 'slack';
  webhookUrl?: string;
  error?: string;
  timestamp?: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract summary from markdown report content
 * Removes frontmatter and returns first N characters
 */
function extractSummary(markdown: string | undefined, maxLength: number = 200): string {
  if (!markdown) return '보고서를 생성할 수 없습니다.';

  // Remove frontmatter (---...---)
  const content = markdown.replace(/^---[\s\S]*?---\n/, '');

  // Get first N characters and trim
  let summary = content.substring(0, maxLength).trim();

  // Ensure it doesn't cut in the middle of a sentence
  if (summary.length === maxLength) {
    const lastNewline = summary.lastIndexOf('\n');
    if (lastNewline > 0) {
      summary = summary.substring(0, lastNewline);
    }
  }

  return summary;
}

/**
 * Format time to Korean locale (KST)
 */
function formatTime(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return isoString;
  }
}

/**
 * Mask webhook URL for logging (security)
 * https://hooks.slack.com/services/T.../B.../xxx → https://hooks.slack.com/services/T***
 */
function maskUrl(url: string): string {
  if (url.length < 40) {
    return url.replace(/./g, '*');
  }
  return url.substring(0, 40) + '***';
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ============================================================================
// Slack Message Formatting
// ============================================================================

/**
 * Extract status emoji from report content
 */
function extractStatusEmoji(markdown: string | undefined): string {
  if (!markdown) return '❓';
  const lowerContent = markdown.toLowerCase();
  if (lowerContent.includes('위험') || lowerContent.includes('critical')) return '🔴';
  if (lowerContent.includes('주의') || lowerContent.includes('warning')) return '🟡';
  return '🟢';
}

/**
 * Generate Slack Block Kit message for daily report with enhanced structure
 */
function formatDailyReportMessage(reportContent: string, date: string): object {
  const summaryText = extractSummary(reportContent, 300);
  const statusEmoji = extractStatusEmoji(reportContent);
  const reportUrl = `https://sentinai.tokamak.network/api/reports/daily/view?date=${date}`;
  const dashboardUrl = `https://sentinai.tokamak.network/thanos-sepolia`;

  return {
    blocks: [
      // Header with status
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${statusEmoji} SentinAI 일일 운영 보고서`,
          emoji: true,
        },
      },

      // Info section
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*📅 날짜*\n${date}`,
          },
          {
            type: 'mrkdwn',
            text: `*⏰ 생성 시각*\n${formatTime(new Date().toISOString())}`,
          },
          {
            type: 'mrkdwn',
            text: '*📍 시스템*\nThanos Sepolia',
          },
          {
            type: 'mrkdwn',
            text: '*🔍 유형*\n24H 자동 분석',
          },
        ],
      },

      // Divider
      { type: 'divider' },

      // Summary section
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📌 Executive Summary*\n${summaryText}`,
        },
      },

      // Divider
      { type: 'divider' },

      // Quick stats section (placeholder)
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*📊 상세 분석*\n자세한 CPU, TxPool, Gas, 블록 지표는 아래 버튼에서 확인하세요.`,
        },
      },

      // Action buttons
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📄 전체 리포트',
              emoji: true,
            },
            url: reportUrl,
            action_id: 'view_full_report',
            style: 'primary',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: '📊 대시보드',
              emoji: true,
            },
            url: dashboardUrl,
            action_id: 'open_dashboard',
          },
        ],
      },

      // Divider
      { type: 'divider' },

      // Footer
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '🤖 Powered by SentinAI | Optimism L2 Monitoring',
          },
        ],
      },
    ],
  };
}

// ============================================================================
// Main Delivery Function
// ============================================================================

/**
 * Deliver daily report via Slack webhook
 * Uses ALERT_WEBHOOK_URL environment variable
 */
export async function deliverDailyReport(date: Date): Promise<DeliveryResult> {
  try {
    const dateStr = formatDate(date);

    // 1. Read the existing report file
    console.log(`[DailyReportMailer] Fetching report for ${dateStr}...`);
    const reportContent = await readExistingReport(dateStr);

    if (!reportContent) {
      return {
        success: false,
        method: 'slack',
        error: `Report not found for date ${dateStr}`,
        timestamp: new Date().toISOString(),
      };
    }

    // 2. Format Slack message
    const slackMessage = formatDailyReportMessage(reportContent, dateStr);

    // 3. Get webhook URL from environment
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (!webhookUrl) {
      console.warn('[DailyReportMailer] ALERT_WEBHOOK_URL not configured');
      return {
        success: false,
        method: 'slack',
        error: 'ALERT_WEBHOOK_URL environment variable not configured',
        timestamp: new Date().toISOString(),
      };
    }

    // 4. Send webhook request
    console.log(`[DailyReportMailer] Sending report to Slack...`);
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[DailyReportMailer] Webhook failed with status ${response.status}: ${errorText}`);
      return {
        success: false,
        method: 'slack',
        error: `Webhook responded with status ${response.status}`,
        timestamp: new Date().toISOString(),
      };
    }

    // 5. Success
    console.log(`[DailyReportMailer] Report delivered successfully to Slack`);
    return {
      success: true,
      method: 'slack',
      webhookUrl: maskUrl(webhookUrl),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[DailyReportMailer] Delivery failed: ${message}`);
    return {
      success: false,
      method: 'slack',
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================================================
// Manual Trigger Function (for testing)
// ============================================================================

/**
 * Manually trigger daily report delivery (for testing/manual override)
 * Returns delivery result
 */
export async function triggerDailyReportDelivery(dateStr?: string): Promise<DeliveryResult> {
  const date = dateStr
    ? new Date(dateStr)
    : (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d;
      })();

  if (isNaN(date.getTime())) {
    return {
      success: false,
      method: 'slack',
      error: 'Invalid date format. Use YYYY-MM-DD',
      timestamp: new Date().toISOString(),
    };
  }

  return deliverDailyReport(date);
}
