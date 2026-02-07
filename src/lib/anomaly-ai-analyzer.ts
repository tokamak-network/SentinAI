/**
 * Layer 2: AI Semantic Anomaly Analyzer
 * Claude-based anomaly context analysis
 */

import { MetricDataPoint } from '@/types/prediction';
import { AnomalyResult, DeepAnalysisResult, AnomalyType } from '@/types/anomaly';
import { AISeverity } from '@/types/scaling';

// ============================================================================
// Configuration
// ============================================================================

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/** Minimum interval between AI calls (milliseconds) - 1 minute */
const MIN_AI_CALL_INTERVAL_MS = 60 * 1000;

/** Analysis result cache TTL (milliseconds) - 5 minutes */
const ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000;

// ============================================================================
// In-Memory State
// ============================================================================

/** Last AI call time */
let lastAICallTime = 0;

/** Recent analysis result cache */
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
 * Generate hash of anomaly list (for cache key)
 */
function hashAnomalies(anomalies: AnomalyResult[]): string {
  const sorted = anomalies
    .map(a => `${a.metric}:${a.rule}:${a.direction}`)
    .sort()
    .join('|');
  return sorted;
}

/**
 * Convert anomaly list to text for AI prompt
 */
function formatAnomaliesForPrompt(anomalies: AnomalyResult[]): string {
  return anomalies
    .map((a, i) => `${i + 1}. [${a.metric}] ${a.description} (rule: ${a.rule}, z-score: ${a.zScore.toFixed(2)})`)
    .join('\n');
}

/**
 * Convert metrics to text for AI prompt
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
 * Convert logs to text for AI prompt
 */
function formatLogsForPrompt(logs: Record<string, string>): string {
  let result = '';
  for (const [component, log] of Object.entries(logs)) {
    // Truncate to last 1000 chars if log is too long
    const truncatedLog = log.length > 1000 ? '...' + log.slice(-1000) : log;
    result += `\n[${component}]\n${truncatedLog}\n`;
  }
  return result;
}

/**
 * Parse AI response
 */
function parseAIResponse(content: string): DeepAnalysisResult {
  // Remove Markdown code blocks
  const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();

  try {
    const parsed = JSON.parse(jsonStr);

    // Validate required fields and apply defaults
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
    // Default response on JSON parse failure
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'AI response parse failed. Raw: ' + content.substring(0, 200),
      suggestedActions: ['Manual log inspection required'],
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
 * Perform AI deep analysis on detected anomalies
 *
 * @param anomalies List of anomalies detected by Layer 1
 * @param metrics Current metric data
 * @param logs Per-component logs (op-geth, op-node, etc.)
 * @returns AI deep analysis result
 *
 * @remarks
 * - AI calls are rate limited to at least 1 minute intervals
 * - Identical anomaly patterns return cached results for 5 minutes
 * - Returns default response on AI Gateway call failure
 */
export async function analyzeAnomalies(
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint,
  logs: Record<string, string>
): Promise<DeepAnalysisResult> {
  const now = Date.now();

  // 1. Cache check: return cached result for identical anomaly pattern
  const anomalyHash = hashAnomalies(anomalies);
  if (analysisCache &&
      analysisCache.anomalyHash === anomalyHash &&
      now - analysisCache.timestamp < ANALYSIS_CACHE_TTL_MS) {
    console.log('[AnomalyAIAnalyzer] Returning cached analysis');
    return analysisCache.result;
  }

  // 2. Rate limiting: return cached result or default response if interval not met
  if (now - lastAICallTime < MIN_AI_CALL_INTERVAL_MS) {
    console.log('[AnomalyAIAnalyzer] Rate limited, returning cached or default');
    if (analysisCache) {
      return analysisCache.result;
    }
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: [],
      predictedImpact: 'Rate limited - analysis pending',
      suggestedActions: ['Retry after a short wait'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }

  // 3. Build user prompt
  const userPrompt = `## Detected Anomalies
${formatAnomaliesForPrompt(anomalies)}

## Current Metrics
${formatMetricsForPrompt(metrics)}

## Recent Component Logs
${formatLogsForPrompt(logs)}

Analyze these anomalies and provide your assessment.`;

  // 4. Call AI Gateway
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

    // 5. Update cache
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

    // Default response on failure
    return {
      severity: 'medium',
      anomalyType: 'performance',
      correlations: anomalies.map(a => a.description),
      predictedImpact: `AI analysis failed: ${errorMessage}`,
      suggestedActions: ['Manual log and metric inspection required', 'Check AI Gateway connection status'],
      relatedComponents: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Clear analysis cache (for testing)
 */
export function clearAnalysisCache(): void {
  analysisCache = null;
  lastAICallTime = 0;
}

/**
 * Get current rate limit status
 */
export function getRateLimitStatus(): { canCall: boolean; nextAvailableAt: number } {
  const now = Date.now();
  const canCall = now - lastAICallTime >= MIN_AI_CALL_INTERVAL_MS;
  const nextAvailableAt = lastAICallTime + MIN_AI_CALL_INTERVAL_MS;
  return { canCall, nextAvailableAt };
}
