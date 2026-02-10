/**
 * Playbook Matcher
 * Match anomaly events to predefined recovery playbooks
 */

import type { AnomalyEvent, DeepAnalysisResult } from '@/types/anomaly';
import type { Playbook, RCAComponent } from '@/types/remediation';

// ============================================================
// Playbook Definitions
// ============================================================

export const PLAYBOOKS: Playbook[] = [
  // Playbook 1: op-geth Resource Exhaustion
  {
    name: 'op-geth-resource-exhaustion',
    description: 'op-geth OOM or high CPU usage',
    trigger: {
      component: 'op-geth',
      indicators: [
        { type: 'metric', condition: 'cpuUsage > 90' },
        { type: 'metric', condition: 'memoryPercent > 85' },
        { type: 'log_pattern', condition: 'out of memory|OOM killed' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'op-geth',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'op-geth',
        waitAfterMs: 30000,
      },
    ],
    fallback: [
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-geth',
      },
    ],
    maxAttempts: 2,
  },

  // Playbook 2: op-node Derivation Stall
  {
    name: 'op-node-derivation-stall',
    description: 'op-node derivation pipeline stagnation',
    trigger: {
      component: 'op-node',
      indicators: [
        { type: 'metric', condition: 'l2BlockHeight stagnant' },
        { type: 'log_pattern', condition: 'derivation pipeline|reset' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-node',
        waitAfterMs: 60000,
      },
      {
        type: 'health_check',
        safetyLevel: 'safe',
        target: 'op-node',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 3: op-batcher Backlog
  {
    name: 'op-batcher-backlog',
    description: 'op-batcher transaction submission failures',
    trigger: {
      component: 'op-batcher',
      indicators: [
        { type: 'metric', condition: 'txPoolPending monotonic increase' },
        { type: 'log_pattern', condition: 'failed to submit|insufficient funds' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-batcher',
      },
      {
        type: 'restart_pod',
        safetyLevel: 'guarded',
        target: 'op-batcher',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 4: General Resource Pressure
  {
    name: 'general-resource-pressure',
    description: 'System-wide resource constraints',
    trigger: {
      component: 'system',
      indicators: [
        { type: 'metric', condition: 'hybridScore >= 70' },
        { type: 'metric', condition: 'cpuUsage > 80' },
      ],
    },
    actions: [
      {
        type: 'scale_up',
        safetyLevel: 'guarded',
        target: 'op-geth',
        params: { targetVcpu: 'next_tier' },
      },
      {
        type: 'zero_downtime_swap',
        safetyLevel: 'guarded',
        target: 'op-geth',
      },
    ],
    maxAttempts: 1,
  },

  // Playbook 5: L1 Connectivity Failure
  {
    name: 'l1-connectivity-failure',
    description: 'L1 RPC connection issues',
    trigger: {
      component: 'l1',
      indicators: [
        { type: 'metric', condition: 'l1BlockNumber stagnant' },
        { type: 'log_pattern', condition: 'connection refused|timeout|ECONNRESET' },
      ],
    },
    actions: [
      {
        type: 'check_l1_connection',
        safetyLevel: 'safe',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-node',
      },
      {
        type: 'collect_logs',
        safetyLevel: 'safe',
        target: 'op-batcher',
      },
    ],
    maxAttempts: 0, // Immediate escalation — L1 issues cannot be auto-resolved
  },
];

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
  // Priority 1: AI analysis component identification
  if (analysis?.relatedComponents && analysis.relatedComponents.length > 0) {
    const firstComponent = analysis.relatedComponents[0].toLowerCase();
    if (firstComponent.includes('geth')) return 'op-geth';
    if (firstComponent.includes('node')) return 'op-node';
    if (firstComponent.includes('batcher')) return 'op-batcher';
    if (firstComponent.includes('proposer')) return 'op-proposer';
    if (firstComponent.includes('l1')) return 'l1';
    if (firstComponent.includes('system')) return 'system';
  }

  // Priority 2: Anomaly metrics hint
  const metrics = event.anomalies.map(a => a.metric);
  if (metrics.includes('cpuUsage') || metrics.includes('gasUsedRatio')) {
    return 'op-geth'; // CPU/gas typically op-geth
  }
  if (metrics.includes('l2BlockHeight') || metrics.includes('l2BlockInterval')) {
    return 'op-node'; // Block progression = op-node
  }
  if (metrics.includes('txPoolPending')) {
    return 'op-batcher'; // TxPool = batcher
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

  return false;
}

/**
 * Check if log pattern matches (placeholder — requires log ingestion)
 */
function matchesLogPattern(
  pattern: string,
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
  const candidatePlaybooks = PLAYBOOKS.filter(
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
  return PLAYBOOKS.find(p => p.name === name) || null;
}
