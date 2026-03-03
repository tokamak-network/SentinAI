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
  category: 'anomaly-resolution' | 'scaling-action' | 'rca-diagnosis' | 'remediation';
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
