export interface OperationRecord {
  id: string;
  timestamp: string;
  anomalyType: string;
  action: string;
  success: boolean;
  resolutionMs: number;
}

export interface OperationalPattern {
  id: string;
  anomalyType: string;
  effectiveAction: string;
  successRate: number;
  occurrences: number;
  confidence: number;
  avgResolutionMs: number;
  lastSeen: string;
}

export interface PlaybookVersion {
  versionId: string;
  generatedBy: string;
  generatedAt: string;
  source: 'hardcoded' | 'ai-assisted' | 'evolved';
  confidence: number;
  successRate: number;
  totalApplications: number;
  playbook: Record<string, unknown>;
}
