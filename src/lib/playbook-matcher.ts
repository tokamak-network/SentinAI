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
  if (condition.includes('challengerBalance')) {
    const anomaly = event.anomalies.find(a => a.metric === 'challengerBalance');
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
  void _pattern;
  void _event;

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
