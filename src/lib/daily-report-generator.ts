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

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const REPORTS_DIR = process.env.REPORTS_DIR || 'data/reports';

// ============================================================
// AI Prompt Templates
// ============================================================

const SYSTEM_PROMPT = `당신은 Optimism L2 노드 운영 전문가입니다. 제공된 24시간 운영 데이터를 분석하여 한국어로 일일 운영 보고서를 작성합니다.

보고서 구조:

# SentinAI 일일 운영 보고서 — {날짜}

## 1. 요약 (Executive Summary)
하루 전체 운영 상태를 3-4문장으로 요약합니다.

## 2. 핵심 지표 분석
### 2.1 CPU 사용률
시간대별 패턴, 피크 시간, 평균 부하 분석.
### 2.2 트랜잭션 풀
TxPool pending 추이, 비정상적 급증 여부.
### 2.3 Gas 사용률
Gas 사용 비율 추이, EVM 연산 부하 분석.
### 2.4 블록 생성
블록 간격 추이, 총 블록 수, 체인 건강성 평가.

## 3. 리소스 스케일링 리뷰
스케일링 이벤트 적절성 평가, vCPU 변경 이력 분석.
스케일링 이벤트가 없었다면 현재 리소스가 적절한지 평가.

## 4. 이상 징후 및 보안
로그 분석에서 발견된 warning/critical 이슈 분석.
이슈가 없었다면 "이상 없음"으로 기록.

## 5. 권고사항
발견된 이슈에 대한 구체적 조치 제안.
트렌드 기반 내일 예측 및 사전 조치 권고.

작성 규칙:
- 한국어로 작성
- 마크다운 형식 (헤더, 테이블, 목록 활용)
- 데이터에 근거한 객관적 분석
- 데이터 부족 시 해당 섹션에서 명시적으로 언급
- 권고사항은 Optimism 공식 문서(https://docs.optimism.io/) 기반`;

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

## 데이터 갭
${dataGaps}

위 데이터를 바탕으로 일일 운영 보고서를 작성해주세요.`;
}

// ============================================================
// Report Generation
// ============================================================

/**
 * Generate a daily report using AI analysis.
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

  // Check API key
  if (!ANTHROPIC_API_KEY) {
    return {
      success: false,
      error: 'ANTHROPIC_API_KEY is not set. Cannot generate AI report.',
      metadata: {
        date: data.date,
        generatedAt,
        dataCompleteness: data.metadata.dataCompleteness,
        snapshotCount: data.snapshots.length,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  const systemPrompt = SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(data);

  try {
    console.log('[Daily Report] Requesting report from AI Gateway...');

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

    if (!response.ok) {
      throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    const promptTokens = result.usage?.prompt_tokens || 0;
    const completionTokens = result.usage?.completion_tokens || 0;

    // Build final markdown with frontmatter
    const reportMarkdown = `---
title: SentinAI 일일 운영 보고서
date: ${data.date}
generated: ${generatedAt}
generator: claude-opus-4-6
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
    console.error('[Daily Report] AI Gateway Error:', errorMessage);

    return {
      success: false,
      error: `AI report generation failed: ${errorMessage}`,
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
