/**
 * Layer 2: AI Semantic Anomaly Analyzer
 * Claude 기반 이상 컨텍스트 분석
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, DeepAnalysisResult, AnomalyType } from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

// ============================================================================
// Configuration
// ============================================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/** AI 호출 최소 간격 (밀리초) - 1분 */
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;

/** 최근 분석 결과 캐시 TTL (밀리초) - 5분 */
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** 마지막 AI 호출 시간 */
let lastAICallTime = 0;

/** 최근 분석 결과 캐시 */
interface AnalysisCache {
  result: DeepAnalysisResult;
  anomalyHash: string;
  timestamp: number;
}
let analysisCache: AnalysisCache | null = null;

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a Senior SRE for an Optimism L2 Rollup Network performing anomaly analysis.

Your task is to analyze detected anomalies in the context of:
1. **Metrics data** - CPU, TxPool, Gas, Block intervals
2. **Component logs** - op-geth, op-node, op-batcher, op-proposer
3. **Known failure patterns** for Optimism Rollups

## Optimism Component Relationships:
- **op-node** derives L2 state from L1, feeds to all other components
- **op-geth** executes transactions, depends on op-node
- **op-batcher** submits transaction batches to L1, depends on op-node
- **op-proposer** submits state roots to L1, depends on op-node

## Common Failure Patterns:
1. **L1 Reorg** → op-node derivation reset → temporary sync stall
2. **L1 Gas Spike** → batcher unable to post → txpool accumulation
3. **op-geth Crash** → CPU drops to 0% → all downstream affected
4. **Network Partition** → P2P gossip failure → unsafe head divergence
5. **Sequencer Stall** → block height plateau → txpool growth

## Analysis Guidelines:
- Correlate anomalies: multiple symptoms often share a root cause
- Consider timing: which anomaly appeared first?
- Check logs for error messages, warnings, state changes
- Assess impact: how does this affect end users?

Return ONLY a JSON object (no markdown code blocks):
{
  "severity": "low" | "medium" | "high" | "critical",
  "anomalyType": "performance" | "security" | "consensus" | "liveness",
  "correlations": ["correlation1", "correlation2"],
  "predictedImpact": "description of expected impact",
  "suggestedActions": ["action1", "action2"],
  "relatedComponents": ["op-geth", "op-node"]
}`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 이상 목록의 해시 생성 (캐시 키용)
 */
function hashAnomalies(anomalies: AnomalyResult[]): string {
  const sorted = anomalies
    .map(a => `${a.metric}:${a.rule}:${a.direction}`)
    .sort()
    .join('|');
  return sorted;
}

/**
 * 이상 목록을 AI 프롬프트용 텍스트로 변환
 */
function formatAnomaliesForPrompt(anomalies: AnomalyResult[]): string {
  return anomalies
    .map((a, i) => `${i + 1}. [${a.metric}] ${a.description} (rule: ${a.rule}, z-score: ${a.zScore.toFixed(2)})`)
    .join('\n');
}

/**
 * 메트릭을 AI 프롬프트용 텍스트로 변환
 */
function formatMetricsForPrompt(metrics: MetricDataPoint): string {
  return `
- CPU Usage: ${metrics.cpuUsage.toFixed(2)}%
- TxPool Pending: ${metrics.txPoolPending}
- Gas Used Ratio: ${(metrics.gasUsedRatio * 100).toFixed(2)}%
- L2 Block Height: ${metrics.blockHeight}
- L2 Block Interval: ${metrics.blockInterval.toFixed(2)}s
- Timestamp: ${metrics.timestamp}`;
}

/**
 * 로그를 AI 프롬프트용 텍스트로 변환
 */
function formatLogsForPrompt(logs: Record<string, string>): string {
  let result = '';
  for (const [component, log] of Object.entries(logs)) {
    // 로그가 너무 길면 마지막 1000자만
    const truncatedLog = log.length > 1000 ? '...' + log.slice(-1000) : log;
    result += `\n[${component}]\n${truncatedLog}\n`;
  }
  return result;
}

/**
 * AI 응답 파싱
 */
function parseAIResponse(content: string): DeepAnalysisResult {
  // Markdown 코드 블록 제거
  const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);

    // 필수 필드 검증 및 기본값
    const severity: AISeverity =
      ['low', 'medium', 'high', 'critical'].includes(parsed.severity)
        ? parsed.severity
        : 'medium';

    const anomalyType: AnomalyType =
      ['performance', 'security', 'consensus', 'liveness'].includes(parsed.anomalyType)
        ? parsed.anomalyType
        : 'performance';

    return {
      severity,
      anomalyType,
      correlations: Array.isArray(parsed.correlations) ? parsed.correlations : [],
      predictedImpact: typeof parsed.predictedImpact === 'string' ? parsed.predictedImpact : 'Unknown impact',
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
      relatedComponents: Array.isArray(parsed.relatedComponents) ? parsed.relatedComponents : [],
      timestamp: new Date().toISOString(),
      rawResponse: content,
    };
  } catch {
    // JSON 파싱 실패 시 기본 응답
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'AI 응답 파싱 실패. 원본: ' + content.substring(0, 200),
      suggestedActions: ['수동으로 로그 확인 필요'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
      rawResponse: content,
    };
  }
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * 탐지된 이상에 대한 AI 심층 분석 수행
 *
 * @param anomalies Layer 1에서 탐지된 이상 목록
 * @param metrics 현재 메트릭 데이터
 * @param logs 컴포넌트별 로그 (op-geth, op-node 등)
 * @returns AI 심층 분석 결과
 *
 * @remarks
 * - 최소 1분 간격으로만 AI 호출 (rate limiting)
 * - 동일한 이상 패턴은 5분간 캐시된 결과 반환
 * - AI Gateway 호출 실패 시 기본 응답 반환
 */
export async function analyzeAnomalies(
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint,
  logs: Record<string, string>
): Promise<DeepAnalysisResult> {
  const now = Date.now();

  // 1. 캐시 확인: 동일 이상 패턴이면 캐시된 결과 반환
  const anomalyHash = hashAnomalies(anomalies);
  if (analysisCache &&
      analysisCache.anomalyHash === anomalyHash &&
      now - analysisCache.timestamp < ANALYSIS_CACHE_TTL_MS) {
    console.log('[AnomalyAIAnalyzer] Returning cached analysis');
    return analysisCache.result;
  }

  // 2. Rate limiting: 최소 간격 미달 시 캐시된 결과 반환 또는 기본 응답
  if (now - lastAICallTime < MIN_AI_CALL_INTERVAL_MS) {
    console.log('[AnomalyAIAnalyzer] Rate limited, returning cached or default');
    if (analysisCache) {
      return analysisCache.result;
    }
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'Rate limited - 분석 대기 중',
      suggestedActions: ['잠시 후 다시 시도'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }

  // 3. User 프롬프트 구성
  const userPrompt = `## Detected Anomalies
${formatAnomaliesForPrompt(anomalies)}

## Current Metrics
${formatMetricsForPrompt(metrics)}

## Recent Component Logs
${formatLogsForPrompt(logs)}

Analyze these anomalies and provide your assessment.`;

  // 4. AI Gateway 호출
  try {
    console.log(`[AnomalyAIAnalyzer] Calling AI Gateway with ${anomalies.length} anomalies...`);
    lastAICallTime = now;

    const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'claude-haiku-4.5',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Gateway responded with ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || data.output || '{}';

    const result = parseAIResponse(content);

    // 5. 캐시 업데이트
    analysisCache = {
      result,
      anomalyHash,
      timestamp: now,
    };

    console.log(`[AnomalyAIAnalyzer] Analysis complete: severity=${result.severity}, type=${result.anomalyType}`);
    return result;

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AnomalyAIAnalyzer] AI Gateway Error:', errorMessage);

    // 실패 시 기본 응답
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: anomalies.map(a => a.description),
      predictedImpact: `AI 분석 실패: ${errorMessage}`,
      suggestedActions: ['수동으로 로그 및 메트릭 확인 필요', 'AI Gateway 연결 상태 확인'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * 분석 캐시 초기화 (테스트용)
 */
export function clearAnalysisCache(): void {
  analysisCache = null;
  lastAICallTime = 0;
}

/**
 * 현재 rate limit 상태 조회
 */
export function getRateLimitStatus(): { canCall: boolean; nextAvailableAt: number } {
  const now = Date.now();
  const canCall = now - lastAICallTime >= MIN_AI_CALL_INTERVAL_MS;
  const nextAvailableAt = lastAICallTime + MIN_AI_CALL_INTERVAL_MS;
  return { canCall, nextAvailableAt };
}
