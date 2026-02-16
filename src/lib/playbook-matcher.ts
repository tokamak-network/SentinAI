/**
 * Playbook Matcher
 * Match anomaly events to predefined recovery playbooks
 */

import type { AnomalyEvent, DeepAnalysisResult } from '@/types/anomaly';
import type { Playbook, RCAComponent } from '@/types/remediation';
import { getChainPlugin } from '@/chains';

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

/**
 * Check if metric condition matches anomaly data
 */
function matchesMetricCondition(
  condition: string,
  event: AnomalyEvent
): boolean {
  // Simple pattern matching — expand as needed
  const anomalyMetrics = event.anomalies.map(a => a.metric);

  if (condition.includes('cpuUsage') && anomalyMetrics.includes('cpuUsage')) {
    const anomaly = event.anomalies.find(a => a.metric === 'cpuUsage');
    if (condition.includes('> 90') && anomaly && anomaly.value > 90) return true;
    if (condition.includes('> 80') && anomaly && anomaly.value > 80) return true;
  }

  if (condition.includes('txPoolPending') && anomalyMetrics.includes('txPoolPending')) {
    if (condition.includes('monotonic increase')) {
      const anomaly = event.anomalies.find(a => a.metric === 'txPoolPending');
      return anomaly?.direction === 'spike';
    }
  }

  if (condition.includes('l2BlockHeight stagnant')) {
    const anomaly = event.anomalies.find(a => a.metric === 'l2BlockHeight');
    return anomaly?.direction === 'plateau';
  }

  if (condition.includes('l1BlockNumber stagnant')) {
    // Would need L1 metrics — placeholder for now
    return false;
  }

  if (condition.includes('hybridScore')) {
    // TODO: Calculate hybrid score from multiple anomalies
    return event.anomalies.length >= 2; // Heuristic: multiple anomalies = high score
  }

  // EOA balance conditions
  if (condition.includes('batcherBalance')) {
    const anomaly = event.anomalies.find(a => a.metric === 'batcherBalance');
    return anomaly?.rule === 'threshold-breach';
  }
  if (condition.includes('proposerBalance')) {
    const anomaly = event.anomalies.find(a => a.metric === 'proposerBalance');
    return anomaly?.rule === 'threshold-breach';
  }

  return false;
}

/**
 * Check if log pattern matches (placeholder — requires log ingestion)
 */
function matchesLogPattern(
  _pattern: string,
  _event: AnomalyEvent
): boolean {
  // TODO: Integrate with log ingestion module when available
  // For now, return false as logs are not yet ingested into events
  return false;
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

    // Check if any metric indicator matches
    const metricMatch = metricIndicators.some(i =>
      matchesMetricCondition(i.condition, event)
    );

    // Check if any log indicator matches
    const logMatch = logIndicators.length === 0 || logIndicators.some(i =>
      matchesLogPattern(i.condition, event)
    );

    if (metricMatch || logMatch) {
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
