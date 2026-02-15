/**
 * Daily Report Generator Module
 * Generates AI-powered daily operation reports using Claude Opus 4.6 via LiteLLM Gateway.
 * Saves reports as markdown files to the filesystem.
 */

import fs from 'fs/promises';
import path from 'path';
import type {
  DailyAccumulatedData,
  DailyReportResponse,
  HourlySummary,
  MetricSnapshot,
} from '@/types/daily-report';
import { chatCompletion } from './ai-client';
import { formatAWSCostForReport } from './aws-cost-tracker';
import { getChainPlugin } from '@/chains';

const REPORTS_DIR = process.env.REPORTS_DIR || 'data/reports';

// ============================================================
// AI Prompt Templates
// ============================================================

function buildDailyReportSystemPrompt(): string {
  const plugin = getChainPlugin();
  return `${plugin.aiPrompts.dailyReportContext}

Report structure (follow this format exactly):

# SentinAI Daily Operations Report — {date}

## Executive Summary
- Operational status: [Normal/Warning/Caution/Critical]
- Overall availability: [%]
- Major issues: [Yes/None]

One-line summary: (single line)

---

## Key Metrics

| Metric | Average | Peak | Status |
|--------|---------|------|--------|
| CPU Usage | XX% | XX% | Normal/Caution/Critical |
| TxPool Pending | X | X | Normal/Caution/Critical |
| Gas Used Ratio | XX% | XX% | Normal/Caution/Critical |
| Block Interval | Xs | Xs | Normal/Caution/Critical |

**Analysis:**
- CPU: (analysis details)
- TxPool: (analysis details)
- Gas: (analysis details)
- Block: (analysis details)

---

## Resource Scaling Review

**Scaling events:**
- (list events if any, otherwise "None")

**Current resource assessment:**
- vCPU status: (assessment)
- Memory usage: (assessment)
- Recommendations: (describe if any)

---

## Anomalies & Alerts

**Issues found:**
- (Critical: ...)
- (Warning: ...)
- (or "No anomalies detected")

**Impact:** (High/Medium/Low or "None")

---

## Recommendations & Tomorrow's Forecast

**Action items:**
1. (High priority)
2. (Medium priority)
3. (Low priority)

**Tomorrow's forecast:**
- Trend: (rising/falling/stable)
- Expected load: (low/medium/high)
- Preemptive actions: (describe if any)

---

Writing rules:
- Write in English
- Use tables, lists, and status indicators for visibility
- Provide objective analysis based on data
- Separate each section with clear headers and dividers
- Use specific numbers (e.g., not "high", but "85%")
- Status indicators: Normal, Caution, Critical`;
}

// ============================================================
// User Prompt Helpers
// ============================================================

function calculateOverallStats(snapshots: MetricSnapshot[]): {
  avgCpu: number;
  maxCpu: number;
  avgTxPool: number;
  maxTxPool: number;
  avgGasRatio: number;
  avgBlockInterval: number;
} {
  if (snapshots.length === 0) {
    return { avgCpu: 0, maxCpu: 0, avgTxPool: 0, maxTxPool: 0, avgGasRatio: 0, avgBlockInterval: 0 };
  }

  const avgCpu = snapshots.reduce((s, snap) => s + snap.cpu.mean, 0) / snapshots.length;
  const maxCpu = Math.max(...snapshots.map(s => s.cpu.max));
  const avgTxPool = snapshots.reduce((s, snap) => s + snap.txPool.mean, 0) / snapshots.length;
  const maxTxPool = Math.max(...snapshots.map(s => s.txPool.max));
  const avgGasRatio = snapshots.reduce((s, snap) => s + snap.gasUsedRatio.mean, 0) / snapshots.length;
  const avgBlockInterval = snapshots.reduce((s, snap) => s + snap.blockInterval.mean, 0) / snapshots.length;

  return {
    avgCpu: Number(avgCpu.toFixed(1)),
    maxCpu: Number(maxCpu.toFixed(1)),
    avgTxPool: Number(avgTxPool.toFixed(1)),
    maxTxPool: Number(maxTxPool.toFixed(1)),
    avgGasRatio: Number((avgGasRatio * 100).toFixed(1)),
    avgBlockInterval: Number(avgBlockInterval.toFixed(2)),
  };
}

function formatHourlySummaryTable(summaries: HourlySummary[]): string {
  const activeSummaries = summaries.filter(s => s.snapshotCount > 0);

  if (activeSummaries.length === 0) {
    return '(No data available)';
  }

  const header = '| Time | Avg CPU | Max CPU | Avg TxPool | Gas Ratio | Block Interval | Blocks |';
  const separator = '|------|----------|----------|-------------|----------|-----------|---------|';
  const rows = activeSummaries.map(s =>
    `| ${String(s.hour).padStart(2, '0')}:00 | ${s.avgCpu.toFixed(1)}% | ${s.maxCpu.toFixed(1)}% | ${s.avgTxPool.toFixed(0)} | ${(s.avgGasRatio * 100).toFixed(1)}% | ${s.avgBlockInterval.toFixed(2)}s | ${s.blocksProduced} |`
  );

  return [header, separator, ...rows].join('\n');
}

function summarizeScalingEvents(data: DailyAccumulatedData): string {
  if (data.scalingEvents.length === 0) {
    return 'No scaling events';
  }

  return data.scalingEvents
    .map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul',
      });
      return `- ${time}: ${e.fromVcpu} vCPU → ${e.toVcpu} vCPU (${e.trigger}, ${e.reason})`;
    })
    .join('\n');
}

function summarizeLogAnalysis(data: DailyAccumulatedData): string {
  if (data.logAnalysisResults.length === 0) {
    return 'No log anomalies';
  }

  const critical = data.logAnalysisResults.filter(r => r.severity === 'critical');
  const warning = data.logAnalysisResults.filter(r => r.severity === 'warning');
  const normal = data.logAnalysisResults.filter(r => r.severity === 'normal');

  const lines: string[] = [];

  for (const entry of [...critical, ...warning]) {
    const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
    const tag = entry.severity === 'critical' ? 'CRITICAL' : 'WARNING';
    lines.push(`- [${tag}] ${time}: ${entry.summary}`);
  }

  if (normal.length > 0) {
    lines.push(`- [NORMAL] ${normal.length} entries (no anomalies)`);
  }

  return lines.join('\n');
}

function buildUserPrompt(data: DailyAccumulatedData): string {
  const overall = calculateOverallStats(data.snapshots);
  const hourlyTable = formatHourlySummaryTable(data.hourlySummaries);
  const scalingInfo = summarizeScalingEvents(data);
  const logInfo = summarizeLogAnalysis(data);
  const completeness = (data.metadata.dataCompleteness * 100).toFixed(1);

  const dataGaps = data.metadata.dataGaps.length > 0
    ? data.metadata.dataGaps.map(g => `- ${g.start} ~ ${g.end}: ${g.reason}`).join('\n')
    : 'None';

  const awsCostSection = data.awsCost
    ? `## AWS Service Costs
- Daily total: $${data.awsCost.dailyTotal.toFixed(2)}
- Monthly projection: $${data.awsCost.monthlyProjected.toFixed(2)}

### Service Breakdown
${data.awsCost.services.map(s => `- ${s.service}: $${s.dailyCost.toFixed(3)}/day (~$${s.monthlyCost.toFixed(2)}/month) - ${s.description}`).join('\n')}
`
    : '(No AWS cost data available)';

  return `# ${data.date} Operations Data

## Metadata
- Data collection start: ${data.startTime}
- Last snapshot: ${data.lastSnapshotTime}
- Data completeness: ${completeness}%
- Total snapshots: ${data.snapshots.length}

## Overall Statistics (24 hours)
- Avg CPU: ${overall.avgCpu}%, Max: ${overall.maxCpu}%
- Avg TxPool: ${overall.avgTxPool}, Max: ${overall.maxTxPool}
- Avg Gas ratio: ${overall.avgGasRatio}%
- Avg block interval: ${overall.avgBlockInterval}s

## Hourly Details
${hourlyTable}

## Scaling Events (${data.scalingEvents.length})
${scalingInfo}

## Log Analysis Results (${data.logAnalysisResults.length})
${logInfo}

## AWS Cost Analysis
${awsCostSection}

## Data Gaps
${dataGaps}

Please generate a daily operations report based on the data above.`;
}

// ============================================================
// Fallback Report Generation
// ============================================================

/**
 * Generate a fallback report when AI provider fails.
 * Provides data-driven analysis without AI enrichment.
 */
function generateFallbackReport(data: DailyAccumulatedData): string {
  const overall = calculateOverallStats(data.snapshots);

  return `# SentinAI Daily Operations Report — ${data.date}

> **Note**: This report was generated using collected operations data only, without AI analysis.

## 1. Executive Summary

This is an automated report based on ${data.date} daily operations data. For detailed analysis, please regenerate after the AI provider is restored.

---

## 2. Key Metrics Analysis

### 2.1 CPU Usage
- Average: ${overall.avgCpu}%
- Peak: ${overall.maxCpu}%
- Data points: ${data.snapshots.length}

### 2.2 Transaction Pool
- Average pending: ${overall.avgTxPool}
- Peak pending: ${overall.maxTxPool}

### 2.3 Gas Usage
- Average: ${overall.avgGasRatio}%

### 2.4 Block Production
- Average block interval: ${overall.avgBlockInterval}s
- Collection period: ${data.startTime} ~ ${data.lastSnapshotTime}

---

## 3. Hourly Details

${formatHourlySummaryTable(data.hourlySummaries)}

---

## 4. Resource Scaling Review

${summarizeScalingEvents(data)}

---

## 5. Log Analysis Results

${summarizeLogAnalysis(data)}

---

## 6. AWS Service Costs

${data.awsCost ? formatAWSCostForReport(data.awsCost) : '(No AWS cost data available)'}

---

## 7. Data Completeness

- Completeness: ${(data.metadata.dataCompleteness * 100).toFixed(1)}%
- Snapshots collected: ${data.snapshots.length}
- Scaling events: ${data.scalingEvents.length}
- Log analysis entries: ${data.logAnalysisResults.length}

---

*This report was auto-generated by SentinAI without AI analysis. Detailed analysis will be available after the AI provider is restored.*`;
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate a daily report using AI analysis.
 * Falls back to data-driven report if AI provider fails.
 */
export async function generateDailyReport(
  data: DailyAccumulatedData,
  options?: { force?: boolean; debug?: boolean }
): Promise<DailyReportResponse> {
  const startTime = Date.now();
  const force = options?.force ?? false;
  const debug = options?.debug ?? false;
  const generatedAt = new Date().toISOString();

  // Check for existing report
  if (!force) {
    const existing = await readExistingReport(data.date);
    if (existing) {
      return {
        success: false,
        error: `Report for ${data.date} already exists. Use force=true to overwrite.`,
        metadata: {
          date: data.date,
          generatedAt,
          dataCompleteness: data.metadata.dataCompleteness,
          snapshotCount: data.snapshots.length,
          processingTimeMs: Date.now() - startTime,
        },
      };
    }
  }

  // Warn if insufficient data
  if (data.snapshots.length < 10) {
    console.warn(`[Daily Report] Low data: only ${data.snapshots.length} snapshots available`);
  }

  const systemPrompt = buildDailyReportSystemPrompt();
  const userPrompt = buildUserPrompt(data);

  try {
    console.log('[Daily Report] Requesting report from AI provider...');

    const aiResult = await chatCompletion({
      systemPrompt,
      userPrompt,
      modelTier: 'best',
      temperature: 0.3,
      maxTokens: 4096,
    });

    const content = aiResult.content || '';
    const promptTokens = aiResult.usage?.promptTokens || 0;
    const completionTokens = aiResult.usage?.completionTokens || 0;

    // Build final markdown with frontmatter
    const reportMarkdown = `---
title: SentinAI Daily Operations Report
date: ${data.date}
generated: ${generatedAt}
generator: ${aiResult.model}
---

${content}

---
*This report was auto-generated by SentinAI.*
`;

    // Save to filesystem
    let reportPath: string | undefined;
    try {
      const dir = path.resolve(REPORTS_DIR);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${data.date}.md`);
      await fs.writeFile(filePath, reportMarkdown, 'utf-8');
      reportPath = filePath;
      console.log(`[Daily Report] Saved to ${filePath}`);
    } catch (fsError) {
      const msg = fsError instanceof Error ? fsError.message : 'Unknown FS error';
      console.error(`[Daily Report] Failed to save file: ${msg}`);
      // Continue — report content is still available in the response
    }

    const reportResponse: DailyReportResponse = {
      success: true,
      reportPath,
      reportContent: reportMarkdown,
      metadata: {
        date: data.date,
        generatedAt,
        dataCompleteness: data.metadata.dataCompleteness,
        snapshotCount: data.snapshots.length,
        processingTimeMs: Date.now() - startTime,
        aiModel: aiResult.model,
      },
    };

    if (debug) {
      reportResponse.debug = {
        promptTokens,
        completionTokens,
        systemPrompt,
        userPrompt,
      };
    }

    return reportResponse;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Daily Report] AI provider error:', errorMessage);
    console.log('[Daily Report] Generating fallback report with collected data...');

    // Generate fallback report using collected data
    const fallbackContent = generateFallbackReport(data);
    const reportMarkdown = `---
title: SentinAI Daily Operations Report (Fallback)
date: ${data.date}
generated: ${generatedAt}
generator: fallback
aiError: ${errorMessage}
---

${fallbackContent}
`;

    // Save fallback report to filesystem
    let reportPath: string | undefined;
    try {
      const dir = path.resolve(REPORTS_DIR);
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, `${data.date}.md`);
      await fs.writeFile(filePath, reportMarkdown, 'utf-8');
      reportPath = filePath;
      console.log(`[Daily Report] Fallback report saved to ${filePath}`);
    } catch (fsError) {
      const msg = fsError instanceof Error ? fsError.message : 'Unknown FS error';
      console.error(`[Daily Report] Failed to save fallback report: ${msg}`);
    }

    return {
      success: true,
      reportPath,
      reportContent: reportMarkdown,
      metadata: {
        date: data.date,
        generatedAt,
        dataCompleteness: data.metadata.dataCompleteness,
        snapshotCount: data.snapshots.length,
        processingTimeMs: Date.now() - startTime,
        aiModel: 'fallback',
      },
      fallback: {
        enabled: true,
        reason: `AI provider error: ${errorMessage}`,
      },
    };
  }
}

/**
 * Read an existing report from the filesystem.
 */
export async function readExistingReport(date: string): Promise<string | null> {
  try {
    const dir = path.resolve(REPORTS_DIR);
    const filePath = path.join(dir, `${date}.md`);
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

/**
 * List all report files (date descending).
 */
export async function listReports(): Promise<string[]> {
  try {
    const dir = path.resolve(REPORTS_DIR);
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    return files
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace('.md', ''))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}
