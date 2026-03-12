export const agentMarketplaceServiceKeys = [
  'sequencer_health',
  'incident_summary',
  'batch_submission_status',
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
