export const agentMarketplaceServiceKeys = [
  'sequencer_health',
  'incident_summary',
  'batch_submission_status',
  'derivation_lag',
  'anomaly_feed',
  'health_diagnostics',
  'rca_report',
] as const;

export type AgentMarketplaceServiceKey =
  typeof agentMarketplaceServiceKeys[number];

export const sequencerHealthStatuses = [
  'healthy',
  'degraded',
  'critical',
] as const;

export type SequencerHealthStatus = typeof sequencerHealthStatuses[number];

export const sequencerHealthActions = [
  'proceed',
  'caution',
  'delay',
  'halt',
] as const;

export type SequencerHealthAction = typeof sequencerHealthActions[number];

export type AgentMarketplaceServiceState = 'active' | 'planned';
export type AgentMarketplaceAgentStatus = 'active' | 'suspended';
export type PaymentScheme = 'exact';
export type ResourcePressure = 'normal' | 'elevated' | 'critical';
export type SnapshotTrend = 'rising' | 'falling' | 'stable';
export type IncidentSeverity = 'none' | 'low' | 'medium' | 'high' | 'critical';
export type BatchSubmissionStatus = 'healthy' | 'warning' | 'critical';
export type BatchRiskLevel = 'low' | 'elevated' | 'high';

export interface AgentMarketplacePaymentRequirement {
  scheme: PaymentScheme;
  network: string;
  token: string;
  amount: string;
}

export interface MarketplaceAgentMetadata {
  id: string;
  status: AgentMarketplaceAgentStatus;
  version: string;
  operator: string;
}

export interface AgentMarketplaceServiceDefinition {
  key: AgentMarketplaceServiceKey;
  state: AgentMarketplaceServiceState;
  displayName: string;
  description: string;
  payment?: AgentMarketplacePaymentRequirement;
}

export interface AgentMarketplaceCatalog {
  agent: MarketplaceAgentMetadata;
  services: AgentMarketplaceServiceDefinition[];
  updatedAt: string;
  acceptableUsePolicyVersion: string;
}

export interface SequencerHealthSnapshot {
  status: SequencerHealthStatus;
  healthScore: number;
  action: SequencerHealthAction;
  reasons: string[];
  window: {
    lookbackMinutes: number;
    sampleCount: number;
  };
  blockProduction: {
    latestBlockIntervalSec: number;
    avgBlockIntervalSec: number;
    stdDevBlockIntervalSec: number;
    trend: SnapshotTrend;
    stalled: boolean;
  };
  sync: {
    lagBlocks: number;
    lagTrend: SnapshotTrend;
    catchingUp: boolean;
  };
  incident: {
    activeCount: number;
    highestSeverity: IncidentSeverity;
    lastIncidentAt: string | null;
  };
  resources: {
    cpuPressure: ResourcePressure;
    memoryPressure: ResourcePressure;
  };
  updatedAt: string;
}

export interface IncidentSummarySnapshot {
  status: Exclude<SequencerHealthStatus, 'healthy'> | 'healthy';
  activeCount: number;
  highestSeverity: IncidentSeverity;
  unresolvedCount: number;
  lastIncidentAt: string | null;
  rollingWindow: {
    lookbackHours: number;
    incidentCount: number;
    mttrMinutes: number | null;
  };
}

export interface BatchSubmissionStatusSnapshot {
  status: BatchSubmissionStatus;
  lastSuccessfulSubmissionAt: string | null;
  submissionLagSec: number;
  riskLevel: BatchRiskLevel;
  reasons: string[];
}

// derivation_lag
export type DerivationLagLevel = 'normal' | 'warning' | 'critical' | 'emergency' | 'unknown';

export interface DerivationLagSnapshot {
  available: boolean;
  lag: number | null;
  level: DerivationLagLevel;
  currentL1: number | null;
  headL1: number | null;
  unsafeL2: number | null;
  safeL2: number | null;
  finalizedL2: number | null;
  checkedAt: string;
  message?: string;
}

// anomaly_feed
export type AnomalyFeedStatus = 'normal' | 'elevated' | 'critical';

export interface AnomalyFeedSnapshot {
  status: AnomalyFeedStatus;
  activeCount: number;
  totalRecent: number;
  events: Array<{
    id: string;
    type: string;
    severity: IncidentSeverity;
    status: string;
    description: string;
    detectedAt: string;
    resolvedAt: string | null;
  }>;
  updatedAt: string;
}

// health_diagnostics
export interface HealthDiagnosticsSnapshot {
  generatedAt: string;
  metrics: {
    count: number;
    latestCpuUsage: number | null;
    latestTxPoolPending: number | null;
    currentVcpu: number;
    cooldownRemaining: number;
  };
  anomalies: { total: number; active: number };
  l1Rpc: { activeUrl: string; healthy: boolean; endpointCount: number };
  components: Array<{ component: string; healthy: boolean; details: string }>;
}

// rca_report
export interface RCAReportSnapshot {
  available: boolean;
  totalCount: number;
  reports: Array<{
    id: string;
    rootCause: { component: string; description: string; confidence: number };
    affectedComponents: string[];
    remediation: { immediate: string[]; preventive: string[] };
    triggeredBy: 'manual' | 'auto';
    triggeredAt: string;
  }>;
  updatedAt: string;
}
