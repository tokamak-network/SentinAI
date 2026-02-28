/**
 * Proposal 32 - Self-Evolving Playbook System Types
 */

export type LedgerOutcome = 'success' | 'failure' | 'partial' | 'timeout';

export interface OperationRecord {
  operationId: string;
  instanceId: string;
  timestamp: string;
  trigger: {
    anomalyType: 'z-score' | 'threshold' | 'plateau' | 'monotonic' | string;
    metricName: string;
    zScore?: number;
    metricValue: number;
  };
  playbookId: string | null;
  action: string;
  outcome: LedgerOutcome;
  resolutionMs: number;
  verificationPassed: boolean;
  failureReason?: string;
}

export interface IncidentPattern {
  triggerSignature: string;
  action: string;
  occurrences: number;
  successRate: number;
  avgResolutionMs: number;
  samples: OperationRecord[];
}

export interface AnalyzerOptions {
  now?: Date;
  windowDays?: number;
  minOccurrences?: number;
  sampleLimit?: number;
}

export type PlaybookReviewStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'trusted'
  | 'archived'
  | 'suspended';

export interface EvolutionEntry {
  version: number;
  timestamp: string;
  reason: string;
  confidenceDelta: number;
  changedBy: 'system' | 'team' | 'operator';
}

export interface EvolvedPlaybook {
  playbookId: string;
  instanceId: string;
  triggerSignature: string;
  action: string;
  confidence: number;
  reviewStatus: PlaybookReviewStatus;
  generatedFrom: 'hardcoded' | 'pattern' | 'ai-assisted';
  performance: {
    totalApplications: number;
    successRate: number;
    avgResolutionMs: number;
    lastApplied: string;
    lastOutcome: LedgerOutcome;
  };
  evolution: {
    version: number;
    changelog: EvolutionEntry[];
  };
}
