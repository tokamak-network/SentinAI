# SentinAI Daily Operations Report — Implementation Statement

> **Purpose**: A specification at a level that an AI agent reading this document (Claude Opus 4.6) can complete implementation → testing without any additional questions.

---

## 1. Requirements

### 1.1 Function definition

L2 node operation data collected for 24 hours is analyzed using the `claude-opus-4-6` model, and a daily operation report is created and saved as a markdown file.

### 1.2 Input data

| data | Source | Collection method |
|--------|------|-----------|
| CPU Utilization (%) | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| TxPool wait count | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| Gas usage rate (0-1) | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| L2 block height | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| Block creation interval (seconds) | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| Current vCPU | `metrics-store.ts` ring buffer | Snapshots every 5 minutes |
| K8s component log analysis | `analyze-logs` API | Accumulated at each analysis point |
| Scaling Event | `scaler` API | Accumulation when an event occurs |

### 1.3 Trigger

- **Automatically**: Runs daily at 23:55 KST with `node-cron`
- **Manual**: `POST /api/reports/daily` API call

### 1.4 Save

- Path: `data/reports/YYYY-MM-DD.md`
- Can be overridden with environment variable `REPORTS_DIR` (default: `data/reports`)
- Secure persistence through volume mount in Docker environment

### 1.5 AI Model

- Model: `claude-opus-4-6`
- Call method: Existing LiteLLM gateway (OpenAI compatible API)
- Endpoint: `${AI_GATEWAY_URL}/v1/chat/completions`
- 인증: `Authorization: Bearer ${ANTHROPIC_API_KEY}`

---

## 2. Architecture

### 2.1 Data flow

```
┌───────────────────────────────────────────────────────────────────┐
│                        SentinAI Runtime                           │
│                                                                   │
│  [/api/metrics GET]                                               │
│       │ pushMetric()                                              │
│       ▼                                                           │
│  ┌─────────────────┐    takeSnapshot() (*/5 * * * *)              │
│  │  metrics-store   │────────────────────────┐                    │
│  │  Ring Buffer     │                        │                    │
│  │  (60 pts, ~1hr)  │                        ▼                    │
│  └─────────────────┘              ┌──────────────────────┐        │
│                                   │  daily-accumulator    │        │
│ [/api/scaler POST] │ (in-memory singleton) │ │
│       │ addScalingEvent()         │                      │        │
│       └──────────────────────────►│  snapshots[]         │        │
│                                   │  hourlySummaries[]   │        │
│  [/api/analyze-logs GET]          │  logAnalysisResults[]│        │
│       │ addLogAnalysisResult()    │  scalingEvents[]     │        │
│       └──────────────────────────►│                      │        │
│                                   └──────────┬───────────┘        │
│                                              │                    │
│                    ┌─────────────────────────┘                    │
│ │ Daily 23:55 KST (cron) │
│ │ or POST /api/reports/daily │
│                    ▼                                              │
│           ┌──────────────────────┐                                │
│           │ daily-report-generator│                                │
│           │                      │                                │
│ │ 1. Prompt assembly │ │
│           │ 2. Claude Opus 4.6   │──► LiteLLM Gateway             │
│ │ 3. Save Markdown │ │
│           └──────────┬───────────┘                                │
│                      │                                            │
│                      ▼                                            │
│           data/reports/YYYY-MM-DD.md                              │
└───────────────────────────────────────────────────────────────────┘
```

### 2.2 Key design decisions

**Problem**: Currently, the ring buffer in `metrics-store.ts` only holds a maximum of 60 data points (~1 hour). Daily reports require 24 hours of data.

**SOLVED**: The `daily-accumulator.ts` module stores statistical snapshots of the ring buffer every 5 minutes (up to 288 per day). Snapshots are memory efficient because they are statistical summaries (mean, min, max, stdDev) rather than raw data.

**Scheduling**: Initialize `node-cron` in Next.js `instrumentation.ts` hook. Runs once at server startup, registers two cron jobs:
- `*/5 * * * *` — 5-minute snapshots
- `55 23 * * *` — Generate daily report (based on KST)

---

## 3. File structure

```
New files:
src/types/daily-report.ts ← Type definition
src/lib/daily-accumulator.ts ← 24-hour metrics accumulator
src/lib/daily-report-generator.ts ← Generate AI report + save file
src/lib/scheduler.ts ← node-cron scheduler
src/instrumentation.ts ← Next.js server startup hook
src/app/api/reports/daily/route.ts ← API endpoint

Edit file:
src/app/api/scaler/route.ts ← Add scaling event record
src/app/api/analyze-logs/route.ts ← Add log analysis result record
next.config.ts ← enable instrumentationHook
package.json ← node-cron dependencies
Dockerfile ← Create data/reports directory
docker-compose.yml ← volume mount

Runtime generation:
data/reports/YYYY-MM-DD.md ← Daily report file
```

---

## 4. Type definition

### File: `src/types/daily-report.ts`

```typescript
/**
 * Daily Report Type Definitions
 */

// ============================================================
// Metric Snapshot (every 5 minutes)
// ============================================================

/** Metric statistics snapshot from the ring buffer at 5-minute intervals */
export interface MetricSnapshot {
  /** ISO 8601 timestamp */
  timestamp: string;
/** Number of ring buffer data points at the time of snapshot (0-60) */
  dataPointCount: number;
  cpu: { mean: number; min: number; max: number; stdDev: number };
  txPool: { mean: number; min: number; max: number; stdDev: number };
  gasUsedRatio: { mean: number; min: number; max: number; stdDev: number };
  blockInterval: { mean: number; min: number; max: number; stdDev: number };
/** Latest L2 block height at the time of snapshot */
  latestBlockHeight: number;
/** vCPU settings at the time of snapshot */
  currentVcpu: number;
}

// ============================================================
// Hourly Summary
// ============================================================

/** Hourly aggregate summary (for AI prompts) */
export interface HourlySummary {
/** Time (0-23) */
  hour: number;
/** Number of snapshots at that time (maximum 12) */
  snapshotCount: number;
  avgCpu: number;
  maxCpu: number;
  avgTxPool: number;
  maxTxPool: number;
  avgGasRatio: number;
  avgBlockInterval: number;
/** Estimated number of blocks created at that time */
  blocksProduced: number;
/** vCPU change history */
  vcpuChanges: Array<{ timestamp: string; from: number; to: number }>;
}

// ============================================================
// Log Analysis & Scaling Events
// ============================================================

/** Log analysis result entry (collected from analyze-logs API) */
export interface LogAnalysisEntry {
  timestamp: string;
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  actionItem: string;
}

/** Scaling events (collected from scaler API) */
export interface ScalingEvent {
  timestamp: string;
  fromVcpu: number;
  toVcpu: number;
  trigger: 'auto' | 'manual' | 'predictive';
  reason: string;
}

// ============================================================
// Daily Accumulated Data
// ============================================================

/** 24-hour accumulated data (input for report generation) */
export interface DailyAccumulatedData {
/** Target date (YYYY-MM-DD) */
  date: string;
/** Data collection start time (ISO 8601) */
  startTime: string;
/** Last snapshot time (ISO 8601) */
  lastSnapshotTime: string;
/** Snapshots every 5 minutes (maximum 288) */
  snapshots: MetricSnapshot[];
/** Hourly summary (24) */
  hourlySummaries: HourlySummary[];
/** Log analysis results */
  logAnalysisResults: LogAnalysisEntry[];
/** Scaling event */
  scalingEvents: ScalingEvent[];
/** Data quality metadata */
  metadata: {
/** Actual collection rate compared to expected (0-1) */
    dataCompleteness: number;
/** Data collection gap (server restart, etc.) */
    dataGaps: Array<{ start: string; end: string; reason: string }>;
  };
}

// ============================================================
// Accumulator State (memory singleton)
// ============================================================

/** Accumulator internal state */
export interface AccumulatorState {
  currentDate: string;
  data: DailyAccumulatedData;
  lastSnapshotTimestamp: number;
  startedAt: string;
}

// ============================================================
// API Types
// ============================================================

/** POST /api/reports/daily request body */
export interface DailyReportRequest {
/** Target date (today if omitted) */
  date?: string;
/** Overwrite existing report */
  force?: boolean;
/** Contains debug information (prompt, number of tokens) */
  debug?: boolean;
}

/** POST /api/reports/daily response */
export interface DailyReportResponse {
  success: boolean;
/** Generated report file path */
  reportPath?: string;
/** Report markdown content */
  reportContent?: string;
  error?: string;
/** Debug information */
  debug?: {
    promptTokens: number;
    completionTokens: number;
    systemPrompt: string;
    userPrompt: string;
  };
  metadata: {
    date: string;
    generatedAt: string;
    dataCompleteness: number;
    snapshotCount: number;
    processingTimeMs: number;
  };
}
```

---

## 5. Implementation Specification

### 5.1 `src/lib/daily-accumulator.ts` — Metric accumulator

**Role**: Accumulates 24-hour data by storing statistics snapshots in the ring buffer of `metrics-store.ts` every 5 minutes.

**Dependencies**:
- `getMetricsStats()` from `@/lib/metrics-store` — ring buffer 통계 반환
- `getRecentMetrics(count)` from `@/lib/metrics-store` — Returns recent metrics
- 타입: `MetricSnapshot`, `HourlySummary`, `DailyAccumulatedData`, `AccumulatorState`, `LogAnalysisEntry`, `ScalingEvent` from `@/types/daily-report`

**Existing code you must read**:
- `src/lib/metrics-store.ts` — Check the return type `MetricsStoreStats` of `getMetricsStats()`
- `src/types/prediction.ts` — `MetricsStoreStats`, `MetricStatSummary` 타입 확인

**constant**:
```typescript
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;  // 5분
const MAX_SNAPSHOTS_PER_DAY = 288;            // 24 * 60 / 5
```

**Singleton State**: Module level variable `AccumulatorState | null` management.

**Export function**:

| function | Signature | Description |
|------|----------|------|
| `initializeAccumulator` | `(): void` | Accumulator reset (by date). If it has already been initialized today, skip. |
| `takeSnapshot` | `(): MetricSnapshot \| null` | Create a snapshot in the ring buffer. If the interval is less than 4 minutes, null is returned (to prevent duplication). Calling `getMetricsStats()`. If there is no data, null. Push + update hourly summary to `snapshots[]` on success. |
| `addLogAnalysisResult` | `(entry: LogAnalysisEntry): void` | Add log analysis results |
| `addScalingEvent` | `(event: ScalingEvent): void` | Added scaling event. Also recorded in `vcpuChanges` in hourly summary. |
| `getAccumulatedData` | `(date?: string): DailyAccumulatedData \| null` | Return accumulated data. Data available only for today. null if date does not match. |
| `getAccumulatorStatus` | `(): { initialized, currentDate, snapshotCount, lastSnapshotTime, dataCompleteness }` | Status query (for debugging/API) |
| `resetAccumulator` | `(): void` | Initialize state (for testing) |

**Hourly summary update logic**:
```typescript
// cumulative moving average
const n = summary.snapshotCount;
summary.avgCpu = (summary.avgCpu * n + snapshot.cpu.mean) / (n + 1);
summary.maxCpu = Math.max(summary.maxCpu, snapshot.cpu.max);
// ... (txPool, gasRatio, blockInterval same pattern)
summary.snapshotCount = n + 1;

// Estimate number of blocks created: 5 minutes / average block interval
if (snapshot.blockInterval.mean > 0) {
  summary.blocksProduced += Math.round(300 / snapshot.blockInterval.mean);
}
```

**Date change handling**: Compare the current date with `state.currentDate` when calling `takeSnapshot()`. If something has changed, call `initializeAccumulator()` to generate new date data. Previous data is lost (generating reports before midnight prevents this).

**Data completeness calculation**:
```typescript
const elapsedMinutes = (now - startOfDay) / 60000;
const expectedSnapshots = Math.floor(elapsedMinutes / 5);
dataCompleteness = actualSnapshots / expectedSnapshots;  // 0-1
```

---

### 5.2 `src/lib/daily-report-generator.ts` — Report generator

**Role**: Convert accumulated data into AI prompts, call Claude Opus 4.6 to create and save markdown reports.

**Dependencies**:
- `fs.promises` (mkdir, writeFile, readFile, readdir, access)
- `path`
- 타입: `DailyAccumulatedData`, `DailyReportResponse`, `HourlySummary` from `@/types/daily-report`

**Existing code you must read**:
- `src/lib/predictive-scaler.ts` — AI Gateway calling pattern. Use same endpoint/authentication. Difference: Model set to `claude-opus-4-6` and temperature set to `0.3`.

**constant**:
```typescript
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const REPORTS_DIR = process.env.REPORTS_DIR || 'data/reports';
```

**Export function**:

| function | Signature | Description |
|------|----------|------|
| `generateDailyReport` | `(data: DailyAccumulatedData, options?: { force?: boolean; debug?: boolean }): Promise<DailyReportResponse>` | Generate main report. Force is required if there is an existing report. |
| `readExistingReport` | `(date: string): Promise<string \| null>` | Reading Reports from File System |
| `listReports` | `(): Promise<string[]>` | Return list of report files (in reverse date order) |

**AI calling code** (follows predictive-scaler.ts pattern):
```typescript
const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'claude-opus-4-6',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  }),
});

const result = await response.json();
const content = result.choices[0]?.message?.content || '';
const promptTokens = result.usage?.prompt_tokens || 0;
const completionTokens = result.usage?.completion_tokens || 0;
```

**Report file storage format**:
```markdown
---
title: SentinAI Daily Operation Report
date: 2026-02-06
generated: 2026-02-06T23:55:00.000Z
generator: claude-opus-4-6
---

(AI generated markdown content)

---
*This report was automatically generated by SentinAI.*
```

---

### 5.3 AI Prompt Template

#### System Prompt

```
You are an Optimism L2 node operations expert. We analyze the provided 24-hour operation data and prepare daily operation reports in Korean.

Report structure:

# SentinAI Daily Operations Report — {Date}

## 1. Executive Summary
Summarize the entire day's operations in 3-4 sentences.

## 2. Key indicator analysis
### 2.1 CPU utilization
Analysis of patterns, peak hours, and average load by time of day.
### 2.2 Transaction Pool
TxPool pending trend, whether there is an abnormal surge.
### 2.3 Gas usage rate
Gas usage rate trend, EVM operation load analysis.
### 2.4 Block creation
Block interval trend, total number of blocks, and chain health evaluation.

## 3. Resource scaling review
Scaling event adequacy evaluation, vCPU change history analysis.
Assess whether current resources would be adequate if there had been no scaling event.

## 4. Anomalies and security
Analysis of warning/critical issues found in log analysis.
If there were no issues, record as “no problem.”

## 5. Recommendations
Proposal of specific actions for discovered issues.
Trend-based tomorrow predictions and proactive action recommendations.

Writing rules:
- Written in Korean
- Markdown format (using headers, tables, lists)
- Objective analysis based on data
- In case of insufficient data, it is explicitly mentioned in the relevant section.
- Recommendations are based on Optimism’s official document (https://docs.optimism.io/)
```

#### User Prompt (assembled as a helper function)

```
# {date} operational data

## Metadata
- Start data collection: {startTime}
- Last Snapshot: {lastSnapshotTime}
- Data completeness: {dataCompleteness}%
- Total number of snapshots: {snapshots.length}

## Total statistics (24 hours)
- Average CPU: {avgCpu}%, Maximum: {maxCpu}%
- Average TxPool: {avgTxPool}, Maximum: {maxTxPool}
- Average Gas Ratio: {avgGasRatio}%
- Average block interval: {avgBlockInterval} seconds

## Hourly details
| time | Average CPU | Max CPU | Average TxPool | Gas rate | block spacing | number of blocks |
|------|----------|----------|-------------|----------|-----------|---------|
| 00:00 | 15.2% | 22.1% | 12 | 10.5% | 2.01s | 149 |
| 01:00 | 12.8% | 18.3% | 8 | 8.2% | 2.03s | 148 |
| ... | ... | ... | ... | ... | ... | ... |
(Includes only time periods where snapshotCount > 0)

## Scaling events ({n} events)
- 14:32: 1 vCPU → 2 vCPU (auto, CPU rising trend 65%)
- 18:05: 2 vCPU → 1 vCPU (auto, Load normalized)
(if none, "no scaling event")

## Log analysis results ({n} cases)
- [WARNING] 09:15 (op-geth): P2P peer dropped rate increased
- [CRITICAL] 14:30 (op-node): Derivation stall detected
(If not, "No log abnormality")
(For items with normal severity, only the number of cases is displayed)

## data gap
- 03:15 ~ 03:40: server_restart
(“None” if not present)

Please prepare a daily operation report based on the above data.
```

**User prompt assembly helper function**:
- `formatHourlySummaryTable(summaries: HourlySummary[]): string` — Convert only hours with `snapshotCount > 0` to table rows.
- `summarizeScalingEvents(data: DailyAccumulatedData): string` — 시간 + from/to + trigger + reason
- `summarizeLogAnalysis(data: DailyAccumulatedData): string` — Only warning/critical details, display remaining number of cases
- `calculateOverallStats(snapshots: MetricSnapshot[]): object` — Calculate average/max of overall snapshots.

---

### 5.4 `src/lib/scheduler.ts` — Scheduler

**Role**: Schedule 5 minute snapshots with `node-cron` + daily report generation at 23:55.

**Dependencies**:
- `node-cron` (npm package, requires new installation)
- `daily-accumulator.ts`의 `takeSnapshot`, `getAccumulatedData`, `initializeAccumulator`
- `daily-report-generator.ts`의 `generateDailyReport`
- `getAllLiveLogs` in `log-ingester.ts` (collect latest logs when generating report)

**Export function**:

| function | Signature | Description |
|------|----------|------|
| `initializeScheduler` | `(): void` | Register cron job. Avoid duplicate calls (idempotent). |
| `stopScheduler` | `(): void` | Stop cron job (for testing) |
| `getSchedulerStatus` | `(): { initialized, snapshotTaskRunning, reportTaskRunning }` | 상태 조회 |

**Cron Schedule**:
```typescript
// Snapshot every 5 minutes
cron.schedule('*/5 * * * *', () => takeSnapshot(), { timezone: 'Asia/Seoul' });

// Generate report every day at 23:55
cron.schedule('55 23 * * *', async () => {
  const data = getAccumulatedData();
  if (data) {
    await generateDailyReport(data);
  }
}, { timezone: 'Asia/Seoul' });
```

---

### 5.5 `src/instrumentation.ts` — Next.js server startup hook

**Role**: Initializes the scheduler when the server starts.

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initializeScheduler } = await import('./lib/scheduler');
    initializeScheduler();
  }
}
```

**Caution**: The reason for using `import()` is because `node-cron` does not run in Edge runtime. `NEXT_RUNTIME === 'nodejs'` must be checked.

---

### 5.6 `src/app/api/reports/daily/route.ts` — API endpoint

**Dependencies**:
- `NextRequest`, `NextResponse` from `next/server`
- `getAccumulatedData`, `getAccumulatorStatus` from `@/lib/daily-accumulator`
- `generateDailyReport`, `readExistingReport`, `listReports` from `@/lib/daily-report-generator`
- 타입: `DailyReportRequest`, `DailyReportResponse` from `@/types/daily-report`

#### GET /api/reports/daily

| query parameters | Description | Reply |
|---------------|------|------|
| `status=true` |天生します | `{ success, data: AccumulatorStatus }` |
| `list=true` | Report list | `{ success, data: { reports: string[] } }` |
| `date=YYYY-MM-DD` | View specific report | `{ success, data: { date, content } }` or 404 |
| (none) | Basic: Accumulator Status + List of 7 Recent Reports | `{ success, data: { accumulator, recentReports } }` |

**Date format validation**: `/^\d{4}-\d{2}-\d{2}$/` regular expression. 400 for mismatch.

#### POST /api/reports/daily

**Request Body** (JSON):
```json
{
  "date": "2026-02-06",   // optional, default: today
  "force": false,          // optional, overwrite existing
  "debug": false           // optional, include prompts
}
```

**Processing Flow**:
1. Determine date (body.date || today)
2. Verify date format
3. Call `getAccumulatedData(targetDate)`. If null, 400 is returned.
4. Call `generateDailyReport(data, { force, debug })`
5. Return results

---

## 6. Modify existing files

### 6.1 `src/app/api/scaler/route.ts` — Log scaling events

**Position of modification**: Immediately after adding scaling history in POST handler (currently around lines 251-260)

**Additional import**:
```typescript
import { addScalingEvent } from '@/lib/daily-accumulator';
```

**Additional code** (immediately after the existing `addScalingHistory()` call):
```typescript
// Record scaling event in daily accumulator
addScalingEvent({
  timestamp: result.timestamp,
  fromVcpu: result.previousVcpu,
  toVcpu: result.currentVcpu,
  trigger: triggeredBy === 'auto' ? 'auto' : 'manual',
  reason: decision.reason,
});
```

**Location Reference**: Inside the block `if (!dryRun && result.success && result.previousVcpu !== result.currentVcpu)` around line 251-260 of `src/app/api/scaler/route.ts`.

### 6.2 `src/app/api/analyze-logs/route.ts` — Record log analysis results

**Position of modification**: Immediately after calling `analyzeLogChunk()`, before returning `NextResponse.json()`.

**Additional import**:
```typescript
import { addLogAnalysisResult } from '@/lib/daily-accumulator';
```

**Additional code** (now right after line 24 `const analysis = await analyzeLogChunk(logData);`):
```typescript
// Record analysis result in daily accumulator
if (analysis) {
  addLogAnalysisResult({
    timestamp: new Date().toISOString(),
    severity: analysis.severity,
    summary: analysis.summary,
    actionItem: analysis.action_item,
  });
}
```

### 6.3 `next.config.ts`

**Current content**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

**After modification**:
```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    instrumentationHook: true,
  },
};

export default nextConfig;
```

### 6.4 `package.json`

**Additional dependencies**:
```bash
npm install node-cron
npm install -D @types/node-cron
```

### 6.5 `Dockerfile`

**Current lines 58-59** (added immediately after creating the `.next` directory):
```dockerfile
RUN mkdir -p data/reports \
    && chown nextjs:nodejs data/reports
```

**Caution**: Must be placed before `USER nextjs`.

### 6.6 `docker-compose.yml`

**Current content**:
```yaml
services:
  sentinai:
    build: .
    container_name: sentinai
    ports:
      - "3002:3000"
    env_file:
      - .env.local
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 5s
      retries: 3
```

**After modification**:
```yaml
services:
  sentinai:
    build: .
    container_name: sentinai
    ports:
      - "3002:3000"
    env_file:
      - .env.local
    volumes:
      - sentinai-reports:/app/data/reports
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 10s
      start_period: 5s
      retries: 3

volumes:
  sentinai-reports:
    driver: local
```

---

## 7. Error handling

| Situation | Action |
|------|------|
| Ring buffer empty | `takeSnapshot()` → returns null, logs |
| AI API key not set | `generateDailyReport()` → returns error |
| AI API call failure (network/5xx) | returns error, no retry |
| AI response abnormal | `choices[0]?.message?.content \|\| ''` Fallback |
| File system write failure | returns error, `reportContent` included in API response |
| Existing report exists | Error if `force=false`, overwrite if `force=true` |
| Data < 10 snapshots | `console.warn()` warning, report generation in progress |
| 서버 재시작 | Reset accumulator (lose previous data), write to `metadata.dataGaps` |
| Date change (midnight) | Automatic creation of new date data structures. 23:55 Report retains previous data. |
| `getAccumulatedData()` Request past date | returns null (in-memory, available today only) |

---

## 8. Environment variables

| variable | default | Required | Description |
|------|--------|------|------|
| `AI_GATEWAY_URL` | `https://api.ai.tokamak.network` | N | LiteLLM Gateway URL |
| `ANTHROPIC_API_KEY` | (none) | Y | AI API key (required for report creation) |
| `REPORTS_DIR` | `data/reports` | N | Report storage directory |

---

## 9. Verification procedure

### 9.1 Build Verification
```bash
npm install # node-cron install
npm run build # Verify TypeScript compilation
npm run lint # check ESLint
```

### 9.2 Check accumulator operation
```bash
# Start the server
npm run dev

# Check accumulator status after 5 minutes
curl http://localhost:3002/api/reports/daily?status=true
# Expected response: { "success": true, "data": { "initialized": true, "snapshotCount": 1, ... } }
```

### 9.3 Manual report generation
```bash
# Generate report (debug mode)
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"debug": true}'

# Expectation: success=true, Korean Markdown report in reportContent
# Expectation: Create file data/reports/YYYY-MM-DD.md
```

### 9.4 Report View
```bash
# Report list
curl "http://localhost:3002/api/reports/daily?list=true"

# View specific report
curl "http://localhost:3002/api/reports/daily?date=2026-02-06"
```

### 9.5 Check to prevent duplication
```bash
# Try to recreate the same date (without force)
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{}'
# Expect: success=false, message "already exists" in error

# Overwrite with force
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
# Expectation: success=true
```

### 9.6 Testing reports with seed data

In data-poor development environments, utilize the existing seed API:

```bash
# 1. Scenario data injection
curl -X POST "http://localhost:3002/api/metrics/seed?scenario=rising"

# 2. Manually trigger a snapshot (test before the accumulator automatically snapshots)
# → Wait 5 minutes after server startup, or inject multiple scenarios in order

# 3. Generate report
curl -X POST http://localhost:3002/api/reports/daily \
  -H "Content-Type: application/json" \
  -d '{"debug": true}'
```

---

## 10. Implementation order

```
Phase 1: Types + Dependencies
1. package.json — node-cron installation
2. src/types/daily-report.ts — Full type definition

Phase 2: Core modules
3. src/lib/daily-accumulator.ts — Metric accumulator
4. src/lib/daily-report-generator.ts — AI report generator
5. src/lib/scheduler.ts — cron scheduler

Phase 3: Server Consolidation
6. src/instrumentation.ts — Server startup hook
7. next.config.ts — Enable instrumentationHook
8. src/app/api/reports/daily/route.ts — API endpoint

Phase 4: Integrating existing code
9. src/app/api/scaler/route.ts — Add addScalingEvent
10. src/app/api/analyze-logs/route.ts — addLogAnalysisResult 추가

Phase 5: Docker
11. Dockerfile — data/reports directory
12. docker-compose.yml — Volume Mount

Phase 6: Verification
  13. npm run build && npm run lint
14. Manual Testing (Section 9)
```

---

## Appendix A: `getMetricsStats()` return type reference

```typescript
//Excerpt from src/types/prediction.ts

interface MetricsStoreStats {
  count: number;
  oldestTimestamp: string | null;
  newestTimestamp: string | null;
  stats: {
    cpu: MetricStatSummary;
    txPool: MetricStatSummary;
    gasUsedRatio: MetricStatSummary;
    blockInterval: MetricStatSummary;
  };
}

interface MetricStatSummary {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  trend: 'rising' | 'falling' | 'stable';
  slope: number;
}
```

## Appendix B: AI Gateway Call Pattern Reference

```typescript
// Excerpted from src/lib/predictive-scaler.ts (using the same pattern)

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${ANTHROPIC_API_KEY}`,
  },
  body: JSON.stringify({
model: 'claude-haiku-4.5', // ← Daily reports use 'claude-opus-4-6'
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
temperature: 0.2, // ← Use 0.3 in daily reports
  }),
});

const result = await response.json();
const content = result.choices[0]?.message?.content || '';
```

## Appendix C: `LogAnalysisResult` type reference

```typescript
//Excerpt from src/lib/ai-analyzer.ts

interface LogAnalysisResult {
  severity: 'normal' | 'warning' | 'critical';
  summary: string;
  action_item: string;
  timestamp: string;
}
```

## Appendix D: analyze-logs/route.ts full code

```typescript
// src/app/api/analyze-logs/route.ts Current full code
// Reference to identify modification point

import { NextResponse } from 'next/server';
import { analyzeLogChunk } from '@/lib/ai-analyzer';
import { generateMockLogs, getAllLiveLogs } from '@/lib/log-ingester';

export async function GET(request: Request) {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') || 'normal';

    let logData: Record<string, string>;

    if (mode === 'live') {
        logData = await getAllLiveLogs();
    } else if (mode === 'attack') {
        logData = generateMockLogs('attack');
    } else {
        logData = generateMockLogs('normal');
    }

    // Call AI (Claude)
    const analysis = await analyzeLogChunk(logData);

// ← addLogAnalysisResult() call location: here (immediately after analysis result, before return)

    return NextResponse.json({
        source: mode === 'live' ? 'k8s-multi-pod-stream' : 'simulated-multi-log',
        raw_logs_preview: JSON.stringify(logData).substring(0, 500) + "...",
        analysis
    });
}
```
