/**
 * Experience Store Types
 *
 * Captures operational events (scaling, anomaly resolution, RCA) with metrics context
 * and trace ID. Foundation for the Agent-for-Hire revenue model — agents accumulate
 * verifiable operational experience over time.
 */

export interface ExperienceEntry {
  id: string;
  instanceId: string;
  protocolId: string;
  timestamp: string;
  category: 'anomaly-resolution' | 'scaling-action' | 'rca-diagnosis' | 'remediation' | 'security-alert' | 'reliability-failover' | 'cost-optimization';
  trigger: {
    type: string;         // e.g., 'z-score', 'threshold', 'plateau'
    metric: string;       // e.g., 'cpuUsage', 'gasUsedRatio'
    value: number;
  };
  action: string;           // what was done
  outcome: 'success' | 'failure' | 'partial';
  resolutionMs: number;
  metricsSnapshot: Record<string, number>;
  traceId?: string;
}

export interface ExperienceStats {
  totalOperations: number;
  successRate: number;
  avgResolutionMs: number;
  topCategories: { category: string; count: number }[];
  operatingDays: number;
}

// === Domain Category Mapping ===

export type ExperienceCategory = ExperienceEntry['category'];

/** Canonical mapping from domain agent type to experience category. Single source of truth. */
export const DOMAIN_CATEGORY_MAP: Record<string, ExperienceCategory> = {
  scaling: 'scaling-action',
  security: 'security-alert',
  reliability: 'reliability-failover',
  rca: 'rca-diagnosis',
  cost: 'cost-optimization',
} as const;

// === Experience Transfer Types ===

/** An anonymized pattern that can be transferred to a new agent instance. */
export interface TransferablePattern {
  signature: string;
  trigger: { type: string; metric: string; valueRange: [number, number] };
  action: string;
  successRate: number;
  occurrences: number;
  confidence: number;
  sourceProtocol: string;
}

/** Result of bootstrapping a new agent with transferred patterns. */
export interface TransferResult {
  patternsTransferred: number;
  sourceProtocol: string;
  discountApplied: number;
  patterns: TransferablePattern[];
}
