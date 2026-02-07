/**
 * Root Cause Analysis Engine
 * Analyzes root causes of Optimism Rollup incidents and traces causal chains
 *
 * NOTE: Adapts to the existing MetricDataPoint type from prediction.ts
 * which uses `blockHeight`/`blockInterval` and `timestamp: string`.
 */

import type { AnomalyResult } from '@/types/anomaly';
import type { MetricDataPoint } from '@/types/prediction';
import type {
  RCAEvent,
  RCAResult,
  RCAHistoryEntry,
  RCAComponent,
  ComponentDependency,
  RootCauseInfo,
  RemediationAdvice,
} from '@/types/rca';
import type { AISeverity } from '@/types/scaling';

// ============================================================================
// Constants
// ============================================================================

/**
 * AI Gateway configuration
 */
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://api.ai.tokamak.network';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

/**
 * Optimism Rollup component dependency graph
 */
export const DEPENDENCY_GRAPH: Record<RCAComponent, ComponentDependency> = {
  'op-geth': {
    dependsOn: ['op-node'],
    feeds: [],
  },
  'op-node': {
    dependsOn: ['l1'],
    feeds: ['op-geth', 'op-batcher', 'op-proposer'],
  },
  'op-batcher': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'op-proposer': {
    dependsOn: ['op-node', 'l1'],
    feeds: [],
  },
  'l1': {
    dependsOn: [],
    feeds: ['op-node', 'op-batcher', 'op-proposer'],
  },
  'system': {
    dependsOn: [],
    feeds: ['op-geth', 'op-node', 'op-batcher', 'op-proposer'],
  },
};

/**
 * Log level to RCAEventType mapping
 */
const LOG_LEVEL_MAP: Record<string, 'error' | 'warning'> = {
  'ERROR': 'error',
  'ERR': 'error',
  'FATAL': 'error',
  'WARN': 'warning',
  'WARNING': 'warning',
};

/**
 * Component name normalization map
 */
const COMPONENT_NAME_MAP: Record<string, RCAComponent> = {
  'op-geth': 'op-geth',
  'geth': 'op-geth',
  'op-node': 'op-node',
  'node': 'op-node',
  'op-batcher': 'op-batcher',
  'batcher': 'op-batcher',
  'op-proposer': 'op-proposer',
  'proposer': 'op-proposer',
};

/**
 * Maximum RCA history entries to keep
 */
const MAX_HISTORY_SIZE = 20;

// ============================================================================
// In-Memory State
// ============================================================================

let rcaHistory: RCAHistoryEntry[] = [];

// ============================================================================
// Timeline Builder Functions
// ============================================================================

/**
 * Extract timestamp from a log line
 */
function extractTimestamp(logLine: string): number | null {
  // ISO 8601 format
  const isoMatch = logLine.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/);
  if (isoMatch) {
    const date = new Date(isoMatch[1]);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  // Geth-style [MM-DD|HH:mm:ss.mmm]
  const gethMatch = logLine.match(/\[(\d{2})-(\d{2})\|(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?\]/);
  if (gethMatch) {
    const now = new Date();
    const [, month, day, hour, minute, second, ms] = gethMatch;
    const date = new Date(
      now.getFullYear(),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10),
      parseInt(second, 10),
      ms ? parseInt(ms, 10) : 0
    );
    return date.getTime();
  }

  // General format YYYY-MM-DD HH:mm:ss
  const generalMatch = logLine.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})/);
  if (generalMatch) {
    const date = new Date(`${generalMatch[1]}T${generalMatch[2]}Z`);
    if (!isNaN(date.getTime())) {
      return date.getTime();
    }
  }

  return null;
}

/**
 * Extract log level from a log line
 */
function extractLogLevel(logLine: string): 'error' | 'warning' | null {
  const upperLine = logLine.toUpperCase();

  for (const [levelStr, eventType] of Object.entries(LOG_LEVEL_MAP)) {
    const regex = new RegExp(`\\b${levelStr}\\b`);
    if (regex.test(upperLine)) {
      return eventType;
    }
  }

  return null;
}

/**
 * Normalize component name
 */
function normalizeComponentName(name: string): RCAComponent {
  const lowered = name.toLowerCase().trim();
  return COMPONENT_NAME_MAP[lowered] || 'system';
}

/**
 * Parse logs into a list of RCAEvents
 */
function parseLogsToEvents(logs: Record<string, string>): RCAEvent[] {
  const events: RCAEvent[] = [];

  for (const [componentName, logText] of Object.entries(logs)) {
    const component = normalizeComponentName(componentName);
    const lines = logText.split('\n').filter(line => line.trim());

    for (const line of lines) {
      const level = extractLogLevel(line);

      // Only extract ERROR or WARN logs as events
      if (!level) continue;

      const timestamp = extractTimestamp(line) || Date.now();

      const description = line
        .replace(/\[\d{2}-\d{2}\|\d{2}:\d{2}:\d{2}(?:\.\d{3})?\]/g, '')
        .replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?/g, '')
        .replace(/\b(ERROR|ERR|FATAL|WARN|WARNING|INFO|DEBUG)\b/gi, '')
        .trim();

      events.push({
        timestamp,
        component,
        type: level,
        description: description || line,
        rawLog: line,
        severity: level === 'error' ? 'high' : 'medium',
      });
    }
  }

  return events;
}

/**
 * Convert AnomalyResult to RCAEvent
 */
function anomaliesToEvents(anomalies: AnomalyResult[]): RCAEvent[] {
  return anomalies
    .filter(a => a.isAnomaly)
    .map(anomaly => {
      let component: RCAComponent = 'system';
      if (anomaly.metric.includes('cpu') || anomaly.metric.includes('memory')) {
        component = 'op-geth';
      } else if (anomaly.metric.includes('txPool') || anomaly.metric.includes('gas')) {
        component = 'op-geth';
      } else if (anomaly.metric.includes('block') || anomaly.metric.includes('Block')) {
        component = 'op-node';
      }

      let severity: AISeverity = 'medium';
      if (Math.abs(anomaly.zScore) > 3.5) {
        severity = 'critical';
      } else if (Math.abs(anomaly.zScore) > 2.5) {
        severity = 'high';
      }

      return {
        timestamp: Date.now(),
        component,
        type: 'metric_anomaly' as const,
        description: anomaly.description,
        severity,
      };
    });
}

/**
 * Build event timeline
 */
export function buildTimeline(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  minutes: number = 5
): RCAEvent[] {
  const logEvents = parseLogsToEvents(logs);
  const anomalyEvents = anomaliesToEvents(anomalies);
  const allEvents = [...logEvents, ...anomalyEvents];

  const cutoffTime = Date.now() - minutes * 60 * 1000;
  const filteredEvents = allEvents.filter(e => e.timestamp >= cutoffTime);

  filteredEvents.sort((a, b) => a.timestamp - b.timestamp);

  return filteredEvents;
}

// ============================================================================
// Dependency Graph Functions
// ============================================================================

/**
 * Find all downstream components affected by a given root component
 */
export function findAffectedComponents(rootComponent: RCAComponent): RCAComponent[] {
  const affected = new Set<RCAComponent>();
  const queue: RCAComponent[] = [rootComponent];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (affected.has(current) && current !== rootComponent) {
      continue;
    }

    const deps = DEPENDENCY_GRAPH[current];
    if (deps) {
      for (const downstream of deps.feeds) {
        if (!affected.has(downstream)) {
          affected.add(downstream);
          queue.push(downstream);
        }
      }
    }
  }

  return Array.from(affected);
}

/**
 * Get upstream dependencies of a component
 */
export function findUpstreamComponents(component: RCAComponent): RCAComponent[] {
  const deps = DEPENDENCY_GRAPH[component];
  return deps ? deps.dependsOn : [];
}

// ============================================================================
// AI Integration
// ============================================================================

const RCA_SYSTEM_PROMPT = `You are performing Root Cause Analysis (RCA) for an Optimism L2 Rollup incident.

== Optimism Rollup Component Architecture ==

1. **L1 (Ethereum Mainnet/Sepolia)**
   - External dependency providing L1 block data and finality
   - All L2 components ultimately depend on L1

2. **op-node (Consensus Client / Derivation Driver)**
   - Reads L1 blocks and derives L2 state
   - Feeds derived blocks to op-geth for execution
   - Triggers op-batcher for batch submissions
   - Triggers op-proposer for state root submissions
   - CRITICAL: If op-node fails, ALL downstream components are affected

3. **op-geth (Execution Client)**
   - Executes L2 blocks received from op-node
   - Manages transaction pool (txpool)
   - Depends solely on op-node

4. **op-batcher (Transaction Batch Submitter)**
   - Collects L2 transactions and submits batches to L1
   - Depends on op-node for block data and L1 for gas/submission
   - If batcher fails: txpool accumulates, but L2 continues producing blocks

5. **op-proposer (State Root Proposer)**
   - Submits L2 state roots to L1 for fraud proof window
   - Depends on op-node for state data and L1 for submission
   - If proposer fails: withdrawals delayed, but L2 continues operating

== Component Dependency Graph ==
L1 -> op-node -> op-geth
                -> op-batcher -> L1
                -> op-proposer -> L1

== Common Optimism Failure Patterns ==

1. **L1 Reorg / Gas Spike**: op-batcher/op-proposer submission failures, txpool growth
2. **op-node Derivation Stall**: L2 block production stops, all components show errors
3. **op-geth Crash / OOM**: CPU/Memory anomalies, connection refused errors
4. **Batcher Backlog**: txpool monotonically increasing, no batch submissions
5. **Network Partition / P2P Issues**: Peer disconnections, gossip failures

== Your Task ==

Given the event timeline, anomalies, metrics, and logs below:

1. **Identify the ROOT CAUSE**: Find the earliest triggering event
2. **Trace the CAUSAL CHAIN**: Follow propagation from root cause to symptoms
3. **Consider Dependencies**: Upstream failures propagate downstream
4. **Provide REMEDIATION**: Immediate steps + preventive measures

== Output Format ==

Respond ONLY with a valid JSON object (no markdown code blocks):
{
  "rootCause": {
    "component": "op-geth" | "op-node" | "op-batcher" | "op-proposer" | "l1" | "system",
    "description": "Clear explanation of what triggered the incident",
    "confidence": 0.0-1.0
  },
  "causalChain": [
    {
      "timestamp": <unix_ms>,
      "component": "<component>",
      "type": "error" | "warning" | "metric_anomaly" | "state_change",
      "description": "What happened at this step"
    }
  ],
  "affectedComponents": ["<component1>", "<component2>"],
  "remediation": {
    "immediate": ["Step 1", "Step 2"],
    "preventive": ["Measure 1", "Measure 2"]
  }
}`;

/**
 * Build user prompt for RCA
 */
function buildUserPrompt(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint[],
  logs: Record<string, string>
): string {
  const timelineJson = JSON.stringify(
    timeline.map(e => ({
      time: new Date(e.timestamp).toISOString(),
      component: e.component,
      type: e.type,
      description: e.description,
    })),
    null,
    2
  );

  const anomalySummary = anomalies
    .filter(a => a.isAnomaly)
    .map(a => `- ${a.metric}: ${a.value.toFixed(2)} (z-score: ${a.zScore.toFixed(2)}, ${a.direction})`)
    .join('\n');

  const recentMetrics = metrics.slice(-5).map(m => ({
    time: m.timestamp,
    cpu: m.cpuUsage.toFixed(1),
    txPool: m.txPoolPending,
    gasRatio: m.gasUsedRatio.toFixed(3),
  }));

  const logSummary = Object.entries(logs)
    .map(([comp, log]) => {
      const lines = log.split('\n').filter(l => l.trim());
      const lastLines = lines.slice(-20).join('\n');
      return `=== ${comp} (last 20 lines) ===\n${lastLines}`;
    })
    .join('\n\n');

  return `== Event Timeline (chronological) ==
${timelineJson}

== Detected Anomalies ==
${anomalySummary || 'No statistical anomalies detected'}

== Recent Metrics Snapshot ==
${JSON.stringify(recentMetrics, null, 2)}

== Component Logs ==
${logSummary}

Analyze the above data and identify the root cause of the incident.`;
}

/**
 * Perform RCA analysis via AI Gateway
 */
async function callAIForRCA(
  timeline: RCAEvent[],
  anomalies: AnomalyResult[],
  metrics: MetricDataPoint[],
  logs: Record<string, string>
): Promise<{
  rootCause: RootCauseInfo;
  causalChain: RCAEvent[];
  affectedComponents: RCAComponent[];
  remediation: RemediationAdvice;
}> {
  const userPrompt = buildUserPrompt(timeline, anomalies, metrics, logs);

  const maxRetries = 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[RCA Engine] Calling AI Gateway at ${AI_GATEWAY_URL}... (attempt ${attempt + 1}/${maxRetries + 1})`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4.5',
          messages: [
            { role: 'system', content: RCA_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.2,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`AI Gateway responded with ${response.status}: ${response.statusText} — ${body}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || data.output || '{}';

      const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);

      return {
        rootCause: {
          component: parsed.rootCause?.component || 'system',
          description: parsed.rootCause?.description || 'Unable to determine root cause',
          confidence: parsed.rootCause?.confidence || 0.5,
        },
        causalChain: (parsed.causalChain || []).map((e: Record<string, unknown>) => ({
          timestamp: typeof e.timestamp === 'number' ? e.timestamp : Date.now(),
          component: (e.component as RCAComponent) || 'system',
          type: (e.type as RCAEvent['type']) || 'error',
          description: (e.description as string) || '',
        })),
        affectedComponents: parsed.affectedComponents || [],
        remediation: {
          immediate: parsed.remediation?.immediate || [],
          preventive: parsed.remediation?.preventive || [],
        },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RCA Engine] AI analysis failed (attempt ${attempt + 1}/${maxRetries + 1}):`, errorMessage);

      if (attempt < maxRetries) {
        const delay = 1000 * (attempt + 1);
        console.log(`[RCA Engine] Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      return generateFallbackAnalysis(timeline, anomalies);
    }
  }

  return generateFallbackAnalysis(timeline, anomalies);
}

/**
 * Fallback analysis when AI call fails
 */
function generateFallbackAnalysis(
  timeline: RCAEvent[],
  _anomalies: AnomalyResult[]
): {
  rootCause: RootCauseInfo;
  causalChain: RCAEvent[];
  affectedComponents: RCAComponent[];
  remediation: RemediationAdvice;
} {
  const errorEvents = timeline.filter(e => e.type === 'error');
  const firstError = errorEvents[0] || timeline[0];

  const rootCauseComponent = firstError?.component || 'system';
  const affectedComponents = findAffectedComponents(rootCauseComponent);

  return {
    rootCause: {
      component: rootCauseComponent,
      description: firstError?.description || 'Unable to determine root cause (AI unavailable)',
      confidence: 0.3,
    },
    causalChain: errorEvents.slice(0, 5),
    affectedComponents,
    remediation: {
      immediate: [
        'Check component logs for detailed error messages',
        'Verify all pods are running: kubectl get pods -n <namespace>',
        'Check L1 connectivity and block sync status',
      ],
      preventive: [
        'Set up automated alerting for critical metrics',
        'Implement health check endpoints for all components',
        'Document incident response procedures',
      ],
    },
  };
}

// ============================================================================
// Main RCA Function
// ============================================================================

/**
 * Generate UUID
 */
function generateId(): string {
  return 'rca-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
 * Perform Root Cause Analysis
 */
export async function performRCA(
  anomalies: AnomalyResult[],
  logs: Record<string, string>,
  metrics: MetricDataPoint[]
): Promise<RCAResult> {
  const startTime = Date.now();
  console.log('[RCA Engine] Starting root cause analysis...');

  // 1. Build event timeline
  const timeline = buildTimeline(anomalies, logs, 5);
  console.log(`[RCA Engine] Built timeline with ${timeline.length} events`);

  // 2. Causal analysis via AI
  const aiResult = await callAIForRCA(timeline, anomalies, metrics, logs);

  // 3. Compose result
  const result: RCAResult = {
    id: generateId(),
    rootCause: aiResult.rootCause,
    causalChain: aiResult.causalChain,
    affectedComponents: aiResult.affectedComponents.length > 0
      ? aiResult.affectedComponents
      : findAffectedComponents(aiResult.rootCause.component),
    timeline,
    remediation: aiResult.remediation,
    generatedAt: new Date().toISOString(),
  };

  console.log(`[RCA Engine] Analysis complete in ${Date.now() - startTime}ms`);
  console.log(`[RCA Engine] Root cause: ${result.rootCause.component} (confidence: ${result.rootCause.confidence})`);

  return result;
}

// ============================================================================
// History Management
// ============================================================================

/**
 * Add an entry to the RCA history
 */
export function addRCAHistory(result: RCAResult, triggeredBy: 'manual' | 'auto'): void {
  const entry: RCAHistoryEntry = {
    id: result.id,
    result,
    triggeredBy,
    triggeredAt: new Date().toISOString(),
  };

  rcaHistory.unshift(entry);

  if (rcaHistory.length > MAX_HISTORY_SIZE) {
    rcaHistory = rcaHistory.slice(0, MAX_HISTORY_SIZE);
  }
}

/**
 * Get RCA history
 */
export function getRCAHistory(limit: number = 10): RCAHistoryEntry[] {
  return rcaHistory.slice(0, Math.min(limit, MAX_HISTORY_SIZE));
}

/**
 * Get a specific RCA result by ID
 */
export function getRCAById(id: string): RCAHistoryEntry | undefined {
  return rcaHistory.find(entry => entry.id === id);
}

/**
 * Get total RCA history count
 */
export function getRCAHistoryCount(): number {
  return rcaHistory.length;
}
