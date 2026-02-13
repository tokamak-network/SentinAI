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

const REPORTS_DIR = process.env.REPORTS_DIR || 'data/reports';

// ============================================================
// AI Prompt Templates
// ============================================================

const SYSTEM_PROMPT = `당신은 Optimism L2 노드 운영 전문가입니다. 제공된 24시간 운영 데이터를 분석하여 한국어로 일일 운영 보고서를 작성합니다.

보고서 구조 (정확히 이 형식을 따를 것):

# SentinAI 일일 운영 보고서 — {날짜}

## 📊 Executive Summary
- 운영 상태: [정상/경고/주의/위험]
- 전체 가용성: [%]
- 주요 이슈: [있음/없음]

한 문장 요약: (한 줄)

---

## 📈 핵심 지표 (Key Metrics)

| 지표 | 평균 | 최고 | 상태 |
|------|------|------|------|
| CPU 사용률 | XX% | XX% | 🟢/🟡/🔴 |
| TxPool Pending | X | X | 🟢/🟡/🔴 |
| Gas Used Ratio | XX% | XX% | 🟢/🟡/🔴 |
| 블록 간격 | X초 | X초 | 🟢/🟡/🔴 |

**분석:**
- CPU: (분석 내용)
- TxPool: (분석 내용)
- Gas: (분석 내용)
- 블록: (분석 내용)

---

## ⚙️ 리소스 스케일링 리뷰

**스케일링 이벤트:**
- (있으면 이벤트 나열, 없으면 "없음")

**현재 리소스 평가:**
- vCPU 상태: (평가)
- 메모리 사용: (평가)
- 권고사항: (있으면 기술)

---

## ⚠️ 이상 징후 & 알람

**발견된 이슈:**
- (Critical: ...)
- (Warning: ...)
- (또는 "이상 없음")

**영향도:** (High/Medium/Low 또는 "없음")

---

## 💡 권고사항 & 내일 예측

**조치사항:**
1. (우선순위 높음)
2. (우선순위 중간)
3. (우선순위 낮음)

**내일 예측:**
- 트렌드: (상승/하강/안정)
- 예상 부하: (낮음/중간/높음)
- 사전 조치: (있으면 기술)

---

작성 규칙:
- 한국어로 작성
- 테이블, 리스트, 이모지로 가시성 높게
- 데이터에 근거한 객관적 분석
- 각 섹션은 명확한 헤더와 구분선으로 분리
- 수치는 구체적으로 (예: "높음" X, "85%" O)
- 이모지 활용: 🟢정상 🟡주의 🔴위험`;

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
    return '(데이터 없음)';
  }

  const header = '| 시간 | 평균 CPU | 최대 CPU | 평균 TxPool | Gas 비율 | 블록 간격 | 블록 수 |';
  const separator = '|------|----------|----------|-------------|----------|-----------|---------|';
  const rows = activeSummaries.map(s =>
    `| ${String(s.hour).padStart(2, '0')}:00 | ${s.avgCpu.toFixed(1)}% | ${s.maxCpu.toFixed(1)}% | ${s.avgTxPool.toFixed(0)} | ${(s.avgGasRatio * 100).toFixed(1)}% | ${s.avgBlockInterval.toFixed(2)}s | ${s.blocksProduced} |`
  );

  return [header, separator, ...rows].join('\n');
}

function summarizeScalingEvents(data: DailyAccumulatedData): string {
  if (data.scalingEvents.length === 0) {
    return '스케일링 이벤트 없음';
  }

  return data.scalingEvents
    .map(e => {
      const time = new Date(e.timestamp).toLocaleTimeString('ko-KR', {
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
    return '로그 이상 없음';
  }

  const critical = data.logAnalysisResults.filter(r => r.severity === 'critical');
  const warning = data.logAnalysisResults.filter(r => r.severity === 'warning');
  const normal = data.logAnalysisResults.filter(r => r.severity === 'normal');

  const lines: string[] = [];

  for (const entry of [...critical, ...warning]) {
    const time = new Date(entry.timestamp).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Seoul',
    });
    const tag = entry.severity === 'critical' ? 'CRITICAL' : 'WARNING';
    lines.push(`- [${tag}] ${time}: ${entry.summary}`);
  }

  if (normal.length > 0) {
    lines.push(`- [NORMAL] ${normal.length}건 (이상 없음)`);
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
    : '없음';

  const awsCostSection = data.awsCost
    ? `## AWS 서비스 비용
- 일일 총 비용: $${data.awsCost.dailyTotal.toFixed(2)}
- 월간 예상: $${data.awsCost.monthlyProjected.toFixed(2)}

### 서비스별 상세
${data.awsCost.services.map(s => `- ${s.service}: $${s.dailyCost.toFixed(3)}/day (~$${s.monthlyCost.toFixed(2)}/month) - ${s.description}`).join('\n')}
`
    : '(AWS 비용 데이터 없음)';

  return `# ${data.date} 운영 데이터

## 메타데이터
- 데이터 수집 시작: ${data.startTime}
- 마지막 스냅샷: ${data.lastSnapshotTime}
- 데이터 완성도: ${completeness}%
- 총 스냅샷 수: ${data.snapshots.length}개

## 전체 통계 (24시간)
- 평균 CPU: ${overall.avgCpu}%, 최대: ${overall.maxCpu}%
- 평균 TxPool: ${overall.avgTxPool}, 최대: ${overall.maxTxPool}
- 평균 Gas 비율: ${overall.avgGasRatio}%
- 평균 블록 간격: ${overall.avgBlockInterval}초

## 시간별 상세
${hourlyTable}

## 스케일링 이벤트 (${data.scalingEvents.length}건)
${scalingInfo}

## 로그 분석 결과 (${data.logAnalysisResults.length}건)
${logInfo}

## AWS 비용 분석
${awsCostSection}

## 데이터 갭
${dataGaps}

위 데이터를 바탕으로 일일 운영 보고서를 작성해주세요.`;
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

  return `# SentinAI 일일 운영 보고서 — ${data.date}

> ⚠️ **주의**: 이 보고서는 AI 분석 없이 수집된 운영 데이터만으로 생성되었습니다.

## 1. 요약 (Executive Summary)

${data.date} 일일 운영 데이터를 바탕으로 한 자동 보고서입니다. 자세한 분석은 AI provider 복구 후 다시 생성해주세요.

---

## 2. 핵심 지표 분석

### 2.1 CPU 사용률
- 평균: ${overall.avgCpu}%
- 최대: ${overall.maxCpu}%
- 데이터 포인트: ${data.snapshots.length}개

### 2.2 트랜잭션 풀
- 평균 대기: ${overall.avgTxPool}건
- 최대 대기: ${overall.maxTxPool}건

### 2.3 Gas 사용률
- 평균: ${overall.avgGasRatio}%

### 2.4 블록 생성
- 평균 블록 간격: ${overall.avgBlockInterval}초
- 수집 기간: ${data.startTime} ~ ${data.lastSnapshotTime}

---

## 3. 시간별 상세

${formatHourlySummaryTable(data.hourlySummaries)}

---

## 4. 리소스 스케일링 리뷰

${summarizeScalingEvents(data)}

---

## 5. 로그 분석 결과

${summarizeLogAnalysis(data)}

---

## 6. AWS 서비스 비용

${data.awsCost ? formatAWSCostForReport(data.awsCost) : '(AWS 비용 데이터 없음)'}

---

## 7. 데이터 완성도

- 완성도: ${(data.metadata.dataCompleteness * 100).toFixed(1)}%
- 수집된 스냅샷: ${data.snapshots.length}개
- 스케일링 이벤트: ${data.scalingEvents.length}건
- 로그 분석 항목: ${data.logAnalysisResults.length}건

---

*이 보고서는 AI 분석 없이 SentinAI에 의해 자동 생성되었습니다. 자세한 분석은 AI provider 복구 후 재생성됩니다.*`;
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

  const systemPrompt = SYSTEM_PROMPT;
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
title: SentinAI 일일 운영 보고서
date: ${data.date}
generated: ${generatedAt}
generator: ${aiResult.model}
---

${content}

---
*이 보고서는 SentinAI에 의해 자동 생성되었습니다.*
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
title: SentinAI 일일 운영 보고서 (Fallback)
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
