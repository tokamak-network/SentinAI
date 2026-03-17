/**
 * Playbook Matcher
 * Match anomaly events to predefined recovery playbooks
 *
 * Three-layer resolution:
 * 1. Abstract playbooks (Redis dynamic from proposal-32)
 * 2. Chain-specific playbooks (existing Playbook type)
 * 3. Core hardcoded abstract playbooks
 */

import type { AnomalyEvent, DeepAnalysisResult } from '@/types/anomaly';
import type { Playbook, RCAComponent, RemediationAction } from '@/types/remediation';
import type { AbstractPlaybook } from '@/playbooks/types';
import { getChainPlugin } from '@/chains';
import { matchAbstractPlaybooks, resolvePlaybookActions } from './abstract-playbook-matcher';

// ============================================================
// Playbook Definitions (loaded from chain plugin)
// ============================================================

function getPlaybooks(): Playbook[] {
  return getChainPlugin().getPlaybooks();
}

/** @deprecated Use getChainPlugin().getPlaybooks() */
export const PLAYBOOKS: Playbook[] = getPlaybooks();

// ============================================================
// Matching Logic
// ============================================================

/**
 * Identify the affected component from anomaly event
 */
function identifyComponent(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): RCAComponent {
  const plugin = getChainPlugin();

  // Priority 1: AI analysis component identification
  if (analysis?.relatedComponents && analysis.relatedComponents.length > 0) {
    const normalized = plugin.normalizeComponentName(analysis.relatedComponents[0]);
    if (normalized !== 'system') return normalized;
  }

  // Priority 2: Anomaly metrics hint
  for (const anomaly of event.anomalies) {
    const component = plugin.mapMetricToComponent(anomaly.metric);
    if (component !== 'system') return component;
  }

  // Fallback
  return 'system';
}

/** Metric alias map: alternate names → canonical names */
const METRIC_ALIASES: Record<string, string> = {
  batchPosterBalance: 'batcherBalance',
};

/**
 * Normalize metric name: resolve aliases and camelCase-ify space-separated names.
 * e.g. "pod restart count" → "podRestartCount", "batchPosterBalance" → "batcherBalance"
 */
function normalizeMetric(raw: string): string {
  const alias = METRIC_ALIASES[raw];
  if (alias) return alias;
  // "pod restart count" → "podRestartCount"
  return raw.replace(/\s+(\w)/g, (_, c: string) => c.toUpperCase());
}

/** Parse time string (e.g. "300s", "2h", "24h") to seconds */
function parseTimeSeconds(timeStr: string): number {
  const m = timeStr.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/i);
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case 's': return n;
    case 'm': return n * 60;
    case 'h': return n * 3600;
    case 'd': return n * 86400;
    default: return NaN;
  }
}

/**
 * Normalize space-separated metric names to camelCase in a condition string.
 * e.g. "pod restart count > 3" → "podRestartCount > 3"
 */
function normalizeConditionSpaces(condition: string): string {
  // Match: words-with-spaces before an operator
  return condition.replace(
    /^([\w][\w\s]*?)\s+(stagnant|monotonic increase|increasing|high|>=?|<=?|==)/i,
    (_, metric, op) => `${normalizeMetric(metric.trim())} ${op}`
  );
}

/**
 * Evaluate a single (non-compound) metric condition string against event anomalies.
 */
function evalSingleMetricCondition(
  condition: string,
  event: AnomalyEvent
): boolean {
  const trimmed = normalizeConditionSpaces(condition.trim());

  // Special case: hybridScore — use heuristic (multiple anomalies = high score)
  if (trimmed.includes('hybridScore')) {
    return event.anomalies.length >= 2;
  }

  // Pattern: "metric stagnant"
  const stagnantMatch = trimmed.match(/^(\S+)\s+stagnant$/i);
  if (stagnantMatch) {
    const metric = normalizeMetric(stagnantMatch[1]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    return anomaly?.direction === 'plateau';
  }

  // Pattern: "metric monotonic increase" or "metric increasing"
  const increasingMatch = trimmed.match(/^(\S+)\s+(monotonic increase|increasing)$/i);
  if (increasingMatch) {
    const metric = normalizeMetric(increasingMatch[1]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    if (!anomaly) return false;
    return anomaly.rule === 'monotonic-increase' || anomaly.direction === 'spike';
  }

  // Pattern: "metric high"
  const highMatch = trimmed.match(/^(\S+)\s+high$/i);
  if (highMatch) {
    const metric = normalizeMetric(highMatch[1]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    if (!anomaly) return false;
    return anomaly.isAnomaly && (anomaly.direction === 'spike' || anomaly.rule === 'threshold-breach');
  }

  // Pattern: "metric < level" (level = critical | warning | low | ...)
  const levelMatch = trimmed.match(/^(\S+)\s+<\s+(critical|warning|low|high)$/i);
  if (levelMatch) {
    const metric = normalizeMetric(levelMatch[1]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    return anomaly?.rule === 'threshold-breach';
  }

  // Pattern: "metric > Ns" or "metric > Nh" (time unit)
  const timeMatch = trimmed.match(/^(\S+)\s*(>=?|<=?|==)\s*(\d+(?:\.\d+)?[smhd])$/i);
  if (timeMatch) {
    const metric = normalizeMetric(timeMatch[1]);
    const op = timeMatch[2];
    const thresholdSec = parseTimeSeconds(timeMatch[3]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    if (!anomaly) return false;
    // value is assumed to be in seconds for time-based metrics
    return compare(anomaly.value, op, thresholdSec);
  }

  // Pattern: "metric >/>=/<=/==/< N" (numeric)
  const numericMatch = trimmed.match(/^(\S+)\s*(>=?|<=?|==)\s*(-?\d+(?:\.\d+)?)$/);
  if (numericMatch) {
    const metric = normalizeMetric(numericMatch[1]);
    const op = numericMatch[2];
    const threshold = parseFloat(numericMatch[3]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    if (!anomaly) return false;
    return compare(anomaly.value, op, threshold);
  }

  // Pattern: "metric > identifier" (named threshold, e.g. guardGwei, threshold)
  const namedThresholdMatch = trimmed.match(/^(\S+)\s*(>=?|<=?|==)\s*([a-zA-Z]\w*)$/);
  if (namedThresholdMatch) {
    const metric = normalizeMetric(namedThresholdMatch[1]);
    const anomaly = event.anomalies.find(a => a.metric === metric);
    if (!anomaly) return false;
    return anomaly.rule === 'threshold-breach' || anomaly.direction === 'spike';
  }

  return false;
}

function compare(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case '>':  return value > threshold;
    case '>=': return value >= threshold;
    case '<':  return value < threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    default:   return false;
  }
}

/**
 * Check if metric condition matches anomaly data.
 * Supports compound conditions joined by &&.
 */
function matchesMetricCondition(
  condition: string,
  event: AnomalyEvent
): boolean {
  if (condition.includes('&&')) {
    const parts = condition.split('&&');
    // At least one part must match (partial match on compound conditions)
    return parts.some(part => evalSingleMetricCondition(part, event));
  }
  return evalSingleMetricCondition(condition, event);
}

/**
 * Check if log pattern matches recent log lines in the event.
 * Falls back to substring matching when the pattern is not valid regex.
 */
function matchesLogPattern(
  pattern: string,
  event: AnomalyEvent
): boolean {
  if (!event.recentLogs?.length) return false;
  try {
    const regex = new RegExp(pattern, 'i');
    return event.recentLogs.some(line => regex.test(line));
  } catch {
    return event.recentLogs.some(line =>
      pattern.split('|').some(p => line.toLowerCase().includes(p.trim().toLowerCase()))
    );
  }
}

/**
 * Match event to playbook
 */
export function matchPlaybook(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): Playbook | null {
  const component = identifyComponent(event, analysis);

  // Find playbooks matching the component
  const candidatePlaybooks = getPlaybooks().filter(
    p => p.trigger.component === component
  );

  // Match indicators
  for (const playbook of candidatePlaybooks) {
    const metricIndicators = playbook.trigger.indicators.filter(i => i.type === 'metric');
    const logIndicators = playbook.trigger.indicators.filter(i => i.type === 'log_pattern');

    // Match if any indicator (metric or log) fires
    const anyMatch =
      metricIndicators.some(i => matchesMetricCondition(i.condition, event)) ||
      logIndicators.some(i => matchesLogPattern(i.condition, event));

    if (anyMatch) {
      return playbook;
    }
  }

  // No match
  return null;
}

/**
 * Get playbook by name (for manual triggering)
 */
export function getPlaybookByName(name: string): Playbook | null {
  return getPlaybooks().find(p => p.name === name) || null;
}

// ============================================================
// Three-Layer Unified Matcher
// ============================================================

/**
 * Match event to best playbook with three-layer resolution:
 * Layer 1: Redis dynamic abstract playbooks (proposal-32 generated)
 * Layer 2: Chain-specific playbooks (existing)
 * Layer 3: Core hardcoded abstract playbooks
 *
 * Returns matched playbook with resolved actions
 */
export async function matchPlaybookWithLayers(
  event: AnomalyEvent,
  analysis?: DeepAnalysisResult
): Promise<{
  playbook: AbstractPlaybook | Playbook;
  actions: RemediationAction[];
  source: 'abstract' | 'chain-specific';
} | null> {
  // Determine node layer from anomalies
  const nodeLayer = event.anomalies[0]?.metric.includes('l2') !== false ? 'l2' : 'l1';

  // Layer 1 & 3: Try abstract playbooks first
  const abstractMatches = await matchAbstractPlaybooks(event, nodeLayer);

  if (abstractMatches.length > 0) {
    const playbook = abstractMatches[0];
    const actions = resolvePlaybookActions(playbook, 'primary');

    return {
      playbook,
      actions,
      source: 'abstract',
    };
  }

  // Layer 2: Fall back to chain-specific playbooks (existing system)
  const chainPlaybook = matchPlaybook(event, analysis);

  if (chainPlaybook) {
    // Playbook.actions are already RemediationAction[]
    const actions = chainPlaybook.actions || [];

    return {
      playbook: chainPlaybook,
      actions,
      source: 'chain-specific',
    };
  }

  // No match found in any layer
  return null;
}
